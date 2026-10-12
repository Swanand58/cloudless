/**
 * WebSocket client for real-time communication.
 */

import { api } from "./api";

export type MessageType =
  | "chat"
  | "typing"
  | "new_transfer"
  | "user_joined"
  | "user_left"
  | "online_users"
  | "ping"
  | "pong";

export interface WebSocketMessage {
  type: MessageType | "auth";
  [key: string]: unknown;
}

export interface ChatMessage extends WebSocketMessage {
  type: "chat";
  message_id: string;
  sender_id: string;
  sender_name: string;
  encrypted_content: string;
  nonce: string;
  timestamp: string;
}

type MessageHandler = (message: WebSocketMessage) => void;

// Close codes sent by the server
const CLOSE_INVALID_TOKEN = 4001;
const CLOSE_NOT_MEMBER = 4003;
const CLOSE_ROOM_GONE = 4004;

const MAX_RECONNECT_DELAY = 30000;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private roomId: string | null = null;
  private handlers: Map<MessageType, Set<MessageHandler>> = new Map();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  /** Called after every successful reconnect, to catch up on what was missed. */
  onReconnect: (() => void) | null = null;

  connect(roomId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.closeSocket();
      this.roomId = roomId;

      const ws = new WebSocket(api.getWebSocketUrl(roomId));
      this.ws = ws;
      let opened = false;

      ws.onopen = () => {
        opened = true;
        // The server expects the token as the first message
        ws.send(JSON.stringify({ type: "auth", token: api.getAccessToken() }));

        const isReconnect = this.reconnectAttempts > 0;
        this.reconnectAttempts = 0;
        this.startPing();
        resolve();
        if (isReconnect) this.onReconnect?.();
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          this.handlers
            .get(message.type as MessageType)
            ?.forEach((handler) => handler(message));
        } catch (error) {
          console.error("Failed to parse WebSocket message:", error);
        }
      };

      ws.onclose = async (event) => {
        this.stopPing();
        if (!opened) reject(new Error(`WebSocket closed before connecting: ${event.code}`));

        // Intentional close, or the room is not ours to be in: stay closed
        if (
          event.code === 1000 ||
          event.code === CLOSE_NOT_MEMBER ||
          event.code === CLOSE_ROOM_GONE ||
          this.ws !== ws
        ) {
          return;
        }

        // An expired token will never work again; get a new one first
        if (event.code === CLOSE_INVALID_TOKEN && !(await api.refresh())) {
          return;
        }

        this.scheduleReconnect();
      };
    });
  }

  disconnect() {
    this.closeSocket();
    this.roomId = null;
    this.reconnectAttempts = 0;
    this.onReconnect = null;
    // Clear all handlers to prevent duplicates on the next connect
    this.handlers.clear();
  }

  private closeSocket() {
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ws = this.ws;
    this.ws = null; // Marks this socket as abandoned for its onclose handler
    ws?.close(1000, "Client disconnect");
  }

  /**
   * Retry forever with capped backoff: a tab can sit open through sleep or
   * a network change and should recover on its own.
   */
  private scheduleReconnect() {
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, MAX_RECONNECT_DELAY);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      if (this.roomId) {
        // A failed attempt closes the socket, whose onclose schedules the next
        this.connect(this.roomId).catch(() => {});
      }
    }, delay);
  }

  private startPing() {
    this.pingInterval = setInterval(() => {
      this.send({ type: "ping" });
    }, 30000); // Ping every 30 seconds
  }

  private stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  on(type: MessageType, handler: MessageHandler) {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
  }

  send(message: WebSocketMessage): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  // Convenience methods for sending specific message types
  sendChat(encryptedContent: string, nonce: string): boolean {
    return this.send({
      type: "chat",
      encrypted_content: encryptedContent,
      nonce,
    });
  }

  sendTyping(isTyping: boolean) {
    this.send({
      type: "typing",
      is_typing: isTyping,
    });
  }
}

// Export singleton instance
export const wsClient = new WebSocketClient();
