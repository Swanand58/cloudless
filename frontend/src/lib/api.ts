/**
 * API client for backend communication.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

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
  room_type: string;
  allow_relay: boolean;
  created_at: string;
  expires_at: string | null;
  members: RoomMember[];
}

interface TransferResponse {
  id: string;
  room_id: string;
  sender_id: string;
  sender_name: string;
  encrypted_filename: string;
  encrypted_mimetype: string | null;
  file_size: number;
  mode: string;
  status: string;
  nonce: string;
  total_chunks: number;
  uploaded_chunks: number;
  created_at: string;
  expires_at: string | null;
  download_count: number;
  max_downloads: number;
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

  // Password change
  async changePassword(currentPassword: string, newPassword: string): Promise<{ message: string }> {
    return this.request("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    });
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
  async createRoom(
    publicKey: string,
    name?: string,
    allowRelay: boolean = true,
    expiresInHours: number = 24
  ): Promise<RoomResponse> {
    return this.request("/api/rooms", {
      method: "POST",
      body: JSON.stringify({
        name,
        public_key: publicKey,
        allow_relay: allowRelay,
        expires_in_hours: expiresInHours,
      }),
    });
  }

  async joinRoom(code: string, publicKey: string): Promise<RoomResponse> {
    return this.request("/api/rooms/join", {
      method: "POST",
      body: JSON.stringify({ code, public_key: publicKey }),
    });
  }

  async listRooms(): Promise<
    Array<{
      id: string;
      code: string;
      name: string | null;
      room_type: string;
      member_count: number;
      created_at: string;
      expires_at: string | null;
    }>
  > {
    return this.request("/api/rooms");
  }

  async getRoom(roomId: string): Promise<RoomResponse> {
    return this.deduplicatedRequest(`/api/rooms/${roomId}`);
  }

  async getSafetyNumber(
    roomId: string,
    peerUserId: string
  ): Promise<{
    safety_number: string;
    emoji_fingerprint_self: string[];
    emoji_fingerprint_peer: string[];
  }> {
    return this.request(`/api/rooms/${roomId}/safety-number/${peerUserId}`);
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
    encryptedFilename: string,
    encryptedMimetype: string | null,
    fileSize: number,
    nonce: string,
    mode: "p2p" | "relay" = "relay",
    expiresInHours: number = 24,
    maxDownloads: number = 9999
  ): Promise<TransferResponse> {
    return this.request("/api/transfers", {
      method: "POST",
      body: JSON.stringify({
        room_id: roomId,
        encrypted_filename: encryptedFilename,
        encrypted_mimetype: encryptedMimetype,
        file_size: fileSize,
        nonce,
        mode,
        expires_in_hours: expiresInHours,
        max_downloads: maxDownloads,
      }),
    });
  }

  async uploadChunk(
    transferId: string,
    chunkIndex: number,
    chunk: Blob
  ): Promise<{
    transfer_id: string;
    chunk_index: number;
    uploaded_chunks: number;
    total_chunks: number;
    status: string;
  }> {
    const formData = new FormData();
    formData.append("chunk", chunk);

    const url = `${API_BASE}/api/transfers/${transferId}/chunks/${chunkIndex}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new ApiError(
        error.detail || "Upload failed",
        response.status,
        error.detail
      );
    }

    return response.json();
  }

  async getTransfer(transferId: string): Promise<TransferResponse> {
    return this.request(`/api/transfers/${transferId}`);
  }

  async downloadFile(transferId: string): Promise<{
    data: Blob;
    nonce: string;
  }> {
    const url = `${API_BASE}/api/transfers/${transferId}/download`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new ApiError(
        error.detail || "Download failed",
        response.status,
        error.detail
      );
    }

    const nonce = response.headers.get("X-Transfer-Nonce") || "";
    const data = await response.blob();

    return { data, nonce };
  }

  async listRoomTransfers(roomId: string): Promise<TransferResponse[]> {
    return this.deduplicatedRequest(`/api/transfers/room/${roomId}`);
  }

  async cancelTransfer(transferId: string): Promise<void> {
    await this.request(`/api/transfers/${transferId}`, { method: "DELETE" });
  }

  // WebSocket URL
  getWebSocketUrl(roomId: string): string {
    const wsBase = API_BASE.replace(/^http/, "ws");
    return `${wsBase}/api/ws/${roomId}?token=${this.accessToken}`;
  }
}

// Export singleton instance
export const api = new ApiClient();
export { ApiError };
export type { UserResponse, RoomResponse, RoomMember, TransferResponse };
