/**
 * API client for backend communication.
 */

// Empty in production: the API is served from the same origin under /api.
// Set NEXT_PUBLIC_API_URL only for local development against a separate backend.
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

interface UserResponse {
  id: string;
  username: string;
  display_name: string;
  is_admin: boolean;
  created_at: string;
}

interface RoomMember {
  user_id: string;
  username: string;
  display_name: string;
  public_key: string;
  is_online: boolean;
  joined_at: string;
}

interface RoomResponse {
  id: string;
  code: string;
  name: string | null;
  created_at: string;
  expires_at: string | null;
  members: RoomMember[];
}

interface RoomListItem {
  id: string;
  code: string;
  name: string | null;
  member_count: number;
  peer_name: string | null;
  created_at: string;
  expires_at: string | null;
}

/** Stored chat message, same shape as the WebSocket chat event. */
interface MessageResponse {
  message_id: string;
  sender_id: string;
  sender_name: string;
  encrypted_content: string;
  nonce: string;
  timestamp: string;
}

interface TransferResponse {
  id: string;
  room_id: string;
  sender_id: string;
  sender_name: string;
  encrypted_meta: string;
  file_size: number;
  status: string;
  total_chunks: number;
  created_at: string;
}

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

class ApiClient {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private requestQueue: Map<string, Promise<unknown>> = new Map();

  constructor() {
    // Load tokens from localStorage on init (client-side only)
    if (typeof window !== "undefined") {
      this.accessToken = localStorage.getItem("access_token");
      this.refreshToken = localStorage.getItem("refresh_token");
    }
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    retryCount: number = 0
  ): Promise<T> {
    const url = `${API_BASE}${endpoint}`;
    const headers: HeadersInit = {
      "Content-Type": "application/json",
      ...options.headers,
    };

    if (this.accessToken) {
      (headers as Record<string, string>)["Authorization"] = `Bearer ${this.accessToken}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    // Handle rate limiting with exponential backoff
    if (response.status === 429 && retryCount < 3) {
      const retryAfter = parseInt(response.headers.get("Retry-After") || "1", 10);
      const backoffMs = Math.min(retryAfter * 1000, (2 ** retryCount) * 1000);
      console.warn(`Rate limited, retrying in ${backoffMs}ms...`);
      await this.sleep(backoffMs);
      return this.request<T>(endpoint, options, retryCount + 1);
    }

    if (response.status === 401 && this.refreshToken) {
      // Try to refresh token
      const refreshed = await this.refresh();
      if (refreshed) {
        // Retry with new token
        (headers as Record<string, string>)["Authorization"] = `Bearer ${this.accessToken}`;
        const retryResponse = await fetch(url, { ...options, headers });
        if (!retryResponse.ok) {
          const error = await retryResponse.json().catch(() => ({}));
          throw new ApiError(
            error.detail || "Request failed",
            retryResponse.status,
            error.detail
          );
        }
        return retryResponse.json();
      }
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new ApiError(
        error.detail || "Request failed",
        response.status,
        error.detail
      );
    }

    // Handle empty responses
    const text = await response.text();
    return text ? JSON.parse(text) : ({} as T);
  }

  // Deduplicate identical requests
  private async deduplicatedRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const key = `${options.method || 'GET'}:${endpoint}`;
    
    // Only deduplicate GET requests
    if (options.method && options.method !== 'GET') {
      return this.request<T>(endpoint, options);
    }

    // Check if there's already a pending request for this endpoint
    const pending = this.requestQueue.get(key);
    if (pending) {
      return pending as Promise<T>;
    }

    // Create new request and store it
    const requestPromise = this.request<T>(endpoint, options).finally(() => {
      this.requestQueue.delete(key);
    });
    
    this.requestQueue.set(key, requestPromise);
    return requestPromise;
  }

  setTokens(accessToken: string, refreshToken: string) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    if (typeof window !== "undefined") {
      localStorage.setItem("access_token", accessToken);
      localStorage.setItem("refresh_token", refreshToken);
    }
  }

  clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;
    if (typeof window !== "undefined") {
      localStorage.removeItem("access_token");
      localStorage.removeItem("refresh_token");
    }
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  // Auth endpoints
  async login(username: string, password: string): Promise<TokenResponse> {
    const response = await this.request<TokenResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    this.setTokens(response.access_token, response.refresh_token);
    return response;
  }

  async register(
    username: string,
    password: string,
    displayName: string,
    inviteCode: string
  ): Promise<TokenResponse> {
    const response = await this.request<TokenResponse>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        username,
        password,
        display_name: displayName,
        invite_code: inviteCode,
      }),
    });
    this.setTokens(response.access_token, response.refresh_token);
    return response;
  }

  async refresh(): Promise<boolean> {
    if (!this.refreshToken) return false;

    try {
      const response = await this.request<TokenResponse>("/api/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ refresh_token: this.refreshToken }),
      });
      this.setTokens(response.access_token, response.refresh_token);
      return true;
    } catch {
      this.clearTokens();
      return false;
    }
  }

  async getMe(): Promise<UserResponse> {
    return this.request<UserResponse>("/api/auth/me");
  }

  async logout() {
    this.clearTokens();
  }

  // Password change. The server signs out every older session, so the
  // fresh tokens it returns replace ours.
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const response = await this.request<TokenResponse>("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    });
    this.setTokens(response.access_token, response.refresh_token);
  }

  // Invite endpoints
  async createInvite(
    maxUses: number = 1,
    expiresInDays: number = 7,
    note?: string
  ): Promise<{ code: string }> {
    return this.request("/api/auth/invites", {
      method: "POST",
      body: JSON.stringify({
        max_uses: maxUses,
        expires_in_days: expiresInDays,
        note,
      }),
    });
  }

  async listInvites(): Promise<
    Array<{
      code: string;
      max_uses: number;
      use_count: number;
      expires_at: string | null;
      note: string | null;
    }>
  > {
    return this.request("/api/auth/invites");
  }

  // Room endpoints
  async createRoom(publicKey: string, name?: string): Promise<RoomResponse> {
    return this.request("/api/rooms", {
      method: "POST",
      body: JSON.stringify({ name, public_key: publicKey }),
    });
  }

  async joinRoom(code: string, publicKey: string): Promise<RoomResponse> {
    return this.request("/api/rooms/join", {
      method: "POST",
      body: JSON.stringify({ code, public_key: publicKey }),
    });
  }

  async listRooms(): Promise<RoomListItem[]> {
    return this.request("/api/rooms");
  }

  async getRoom(roomId: string): Promise<RoomResponse> {
    return this.deduplicatedRequest(`/api/rooms/${roomId}`);
  }

  async listMessages(roomId: string): Promise<MessageResponse[]> {
    return this.request(`/api/rooms/${roomId}/messages`);
  }

  async deleteRoom(roomId: string): Promise<void> {
    await this.request(`/api/rooms/${roomId}`, { method: "DELETE" });
  }

  async leaveRoom(roomId: string): Promise<void> {
    await this.request(`/api/rooms/${roomId}/leave`, { method: "POST" });
  }

  // Transfer endpoints
  async initTransfer(
    roomId: string,
    encryptedMeta: string,
    fileSize: number
  ): Promise<TransferResponse> {
    return this.request("/api/transfers", {
      method: "POST",
      body: JSON.stringify({
        room_id: roomId,
        encrypted_meta: encryptedMeta,
        file_size: fileSize,
      }),
    });
  }

  /**
   * Fetch with the access token, for binary bodies that bypass request().
   * A long transfer can outlive the token, so a 401 refreshes it and retries once.
   */
  private async authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const send = () =>
      fetch(url, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${this.accessToken}` },
      });

    const response = await send();
    if (response.status === 401 && (await this.refresh())) {
      return send();
    }
    return response;
  }

  /** Upload one sealed chunk as the raw request body. Safe to retry. */
  async uploadChunk(
    transferId: string,
    chunkIndex: number,
    chunk: Uint8Array,
    maxRetries: number = 3
  ): Promise<void> {
    const url = `${API_BASE}/api/transfers/${transferId}/chunks/${chunkIndex}`;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.authedFetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: new Blob([chunk as BlobPart]),
          signal: AbortSignal.timeout(60000),
        });

        if (response.ok) return;

        const error = await response.json().catch(() => ({}));
        const apiError = new ApiError(
          error.detail || "Upload failed",
          response.status,
          error.detail
        );
        // The server refused this chunk; sending it again will not help
        if (response.status < 500 && response.status !== 429) {
          attempt = maxRetries;
        }
        throw apiError;
      } catch (err) {
        if (attempt >= maxRetries) throw err;
        // Wait before retry with increasing delay
        await this.sleep(1000 * (attempt + 1));
      }
    }
  }

  /** Download a transfer as a stream of encrypted bytes. */
  async downloadFile(transferId: string): Promise<{
    stream: AsyncGenerator<Uint8Array>;
    totalBytes: number;
  }> {
    const response = await this.authedFetch(
      `${API_BASE}/api/transfers/${transferId}/download`
    );

    if (!response.ok || !response.body) {
      const error = await response.json().catch(() => ({}));
      throw new ApiError(
        error.detail || "Download failed",
        response.status,
        error.detail
      );
    }

    // A reader loop rather than for-await on the body: Safari has no
    // async iteration for ReadableStream
    const reader = response.body.getReader();
    async function* read() {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    }

    return {
      stream: read(),
      totalBytes: Number(response.headers.get("Content-Length")) || 0,
    };
  }

  async listRoomTransfers(roomId: string): Promise<TransferResponse[]> {
    return this.deduplicatedRequest(`/api/transfers/room/${roomId}`);
  }

  async cancelTransfer(transferId: string): Promise<void> {
    await this.request(`/api/transfers/${transferId}`, { method: "DELETE" });
  }

  // WebSocket URL. The token is sent as the first message, not in the URL.
  getWebSocketUrl(roomId: string): string {
    const base = API_BASE || window.location.origin;
    return `${base.replace(/^http/, "ws")}/api/ws/${roomId}`;
  }
}

// Export singleton instance
export const api = new ApiClient();
export { ApiError };
export type {
  UserResponse,
  RoomResponse,
  RoomListItem,
  RoomMember,
  MessageResponse,
  TransferResponse,
};
