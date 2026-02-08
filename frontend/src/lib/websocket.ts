/**
 * WebSocket client for real-time communication.
 */

import { api } from "./api";

export type MessageType =
  | "chat"
  | "signal"
  | "typing"
  | "transfer_update"
  | "new_transfer"
  | "user_joined"
  | "user_left"
  | "online_users"
  | "ping"
  | "pong";

export interface WebSocketMessage {
  type: MessageType;
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

export interface SignalMessage extends WebSocketMessage {
  type: "signal";
  from_user: string;
  signal_type: "offer" | "answer" | "ice-candidate";
  signal_data: unknown;
}

export interface TypingMessage extends WebSocketMessage {
  type: "typing";
  user_id: string;
  user_name: string;
  is_typing: boolean;
}

export interface TransferUpdateMessage extends WebSocketMessage {
  type: "transfer_update";
  transfer_id: string;
  user_id: string;
  status: string;
  progress?: number;
  timestamp: string;
}

export interface UserJoinedMessage extends WebSocketMessage {
  type: "user_joined";
  user_id: string;
  timestamp: string;
}

export interface UserLeftMessage extends WebSocketMessage {
  type: "user_left";
  user_id: string;
  display_name?: string;
  timestamp: string;
}

export interface OnlineUsersMessage extends WebSocketMessage {
  type: "online_users";
  users: string[];
}

type MessageHandler = (message: WebSocketMessage) => void;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private roomId: string | null = null;
  private handlers: Map<MessageType, Set<MessageHandler>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private pingInterval: NodeJS.Timeout | null = null;

  connect(roomId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Clean up existing connection first
      if (this.ws) {
        // Remove handlers to prevent errors during cleanup
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.onmessage = null;
        this.ws.onopen = null;
        
        if (this.ws.readyState === WebSocket.OPEN || 
            this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close(1000, "Reconnecting");
        }
        this.ws = null;
      }
      this.stopPing();

      this.roomId = roomId;
      const url = api.getWebSocketUrl(roomId);

      try {
        this.ws = new WebSocket(url);
        let resolved = false;

        this.ws.onopen = () => {
          console.log("WebSocket connected");
          this.reconnectAttempts = 0;
          this.startPing();
          resolved = true;
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message: WebSocketMessage = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (error) {
            console.error("Failed to parse WebSocket message:", error);
          }
        };

        this.ws.onclose = (event) => {
          console.log("WebSocket closed:", event.code, event.reason);
          this.stopPing();

          // Attempt reconnect if not intentional close
          if (event.code !== 1000 && this.roomId) {
            this.attemptReconnect();
          }
          
          // Reject if we haven't connected yet
          if (!resolved) {
            reject(new Error(`WebSocket closed before connecting: ${event.code}`));
          }
        };

        this.ws.onerror = (error) => {
          console.error("WebSocket error:", error);
          // Only reject if we haven't resolved yet
          if (!resolved) {
            reject(error);
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  disconnect() {
    this.stopPing();
    if (this.ws) {
      this.ws.close(1000, "Client disconnect");
      this.ws = null;
    }
    this.roomId = null;
    this.reconnectAttempts = 0;
    // Clear all handlers to prevent duplicates on reconnect
    this.handlers.clear();
  }

  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("Max reconnect attempts reached");
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(`Attempting reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      if (this.roomId) {
        this.connect(this.roomId).catch(console.error);
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

  private handleMessage(message: WebSocketMessage) {
    const handlers = this.handlers.get(message.type);
    if (handlers) {
      handlers.forEach((handler) => handler(message));
    }
  }

  on(type: MessageType, handler: MessageHandler) {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.handlers.get(type)?.delete(handler);
    };
  }

  off(type: MessageType, handler: MessageHandler) {
    this.handlers.get(type)?.delete(handler);
  }

  send(message: WebSocketMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn("WebSocket not connected, message not sent:", message);
    }
  }

  // Convenience methods for sending specific message types
  sendChat(encryptedContent: string, nonce: string) {
    this.send({
      type: "chat",
      encrypted_content: encryptedContent,
      nonce,
    });
  }

  sendSignal(
    targetUser: string,
    signalType: "offer" | "answer" | "ice-candidate",
    signalData: unknown
  ) {
    this.send({
      type: "signal",
      target_user: targetUser,
      signal_type: signalType,
      signal_data: signalData,
    });
  }

  sendTyping(isTyping: boolean) {
    this.send({
      type: "typing",
      is_typing: isTyping,
    });
  }

  sendTransferUpdate(transferId: string, status: string, progress?: number) {
    this.send({
      type: "transfer_update",
      transfer_id: transferId,
      status,
      progress,
    });
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// Export singleton instance
export const wsClient = new WebSocketClient();
