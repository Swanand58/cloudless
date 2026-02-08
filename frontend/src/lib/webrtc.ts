/**
 * WebRTC peer connection manager for P2P file transfers.
 */

import Peer, { Instance as SimplePeerInstance } from "simple-peer";
import { wsClient } from "./websocket";

export interface PeerConnection {
  peer: SimplePeerInstance;
  userId: string;
  connected: boolean;
}

export type DataHandler = (userId: string, data: Uint8Array) => void;
export type ConnectionHandler = (userId: string, connected: boolean) => void;

export class WebRTCManager {
  private peers: Map<string, PeerConnection> = new Map();
  private dataHandlers: Set<DataHandler> = new Set();
  private connectionHandlers: Set<ConnectionHandler> = new Set();
  private myUserId: string | null = null;

  constructor() {
    // Listen for WebRTC signaling messages
    wsClient.on("signal", (message) => {
      const msg = message as unknown as {
        from_user: string;
        signal_type: string;
        signal_data: unknown;
      };
      const { from_user, signal_type, signal_data } = msg;

      if (signal_type === "offer") {
        // Received offer, create answering peer
        this.handleOffer(from_user, signal_data);
      } else if (signal_type === "answer") {
        // Received answer to our offer
        this.handleAnswer(from_user, signal_data);
      } else if (signal_type === "ice-candidate") {
        // Received ICE candidate
        this.handleIceCandidate(from_user, signal_data);
      }
    });
  }

  setMyUserId(userId: string) {
    this.myUserId = userId;
  }

  /**
   * Initiate a P2P connection to another user.
   */
  connect(targetUserId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.peers.has(targetUserId)) {
        const existing = this.peers.get(targetUserId)!;
        if (existing.connected) {
          resolve();
          return;
        }
      }

      const peer = new Peer({
        initiator: true,
        trickle: true,
      });

      const connection: PeerConnection = {
        peer,
        userId: targetUserId,
        connected: false,
      };

      this.setupPeerHandlers(connection, resolve, reject);
      this.peers.set(targetUserId, connection);
    });
  }

  /**
   * Handle incoming offer from another user.
   */
  private handleOffer(fromUserId: string, signalData: unknown) {
    // Create non-initiating peer to answer
    const peer = new Peer({
      initiator: false,
      trickle: true,
    });

    const connection: PeerConnection = {
      peer,
      userId: fromUserId,
      connected: false,
    };

    this.setupPeerHandlers(connection, () => {}, () => {});
    this.peers.set(fromUserId, connection);

    // Signal the offer to the peer
    peer.signal(signalData as Peer.SignalData);
  }

  /**
   * Handle answer to our offer.
   */
  private handleAnswer(fromUserId: string, signalData: unknown) {
    const connection = this.peers.get(fromUserId);
    if (connection) {
      connection.peer.signal(signalData as Peer.SignalData);
    }
  }

  /**
   * Handle ICE candidate.
   */
  private handleIceCandidate(fromUserId: string, signalData: unknown) {
    const connection = this.peers.get(fromUserId);
    if (connection) {
      connection.peer.signal(signalData as Peer.SignalData);
    }
  }

  /**
   * Set up event handlers for a peer connection.
   */
  private setupPeerHandlers(
    connection: PeerConnection,
    resolve: () => void,
    reject: (error: Error) => void
  ) {
    const { peer, userId } = connection;

    peer.on("signal", (data) => {
      // Determine signal type
      let signalType: "offer" | "answer" | "ice-candidate";
      if (data.type === "offer") {
        signalType = "offer";
      } else if (data.type === "answer") {
        signalType = "answer";
      } else {
        signalType = "ice-candidate";
      }

      // Send signal through WebSocket
      wsClient.sendSignal(userId, signalType, data);
    });

    peer.on("connect", () => {
      console.log(`P2P connected to ${userId}`);
      connection.connected = true;
      this.notifyConnectionHandlers(userId, true);
      resolve();
    });

    peer.on("data", (data: Uint8Array) => {
      this.notifyDataHandlers(userId, data);
    });

    peer.on("close", () => {
      console.log(`P2P connection closed: ${userId}`);
      connection.connected = false;
      this.notifyConnectionHandlers(userId, false);
      this.peers.delete(userId);
    });

    peer.on("error", (error) => {
      console.error(`P2P error with ${userId}:`, error);
      connection.connected = false;
      this.notifyConnectionHandlers(userId, false);
      reject(error);
    });
  }

  /**
   * Send data to a peer.
   */
  send(targetUserId: string, data: Uint8Array): boolean {
    const connection = this.peers.get(targetUserId);
    if (connection?.connected) {
      try {
        connection.peer.send(data);
        return true;
      } catch (error) {
        console.error(`Failed to send to ${targetUserId}:`, error);
        return false;
      }
    }
    return false;
  }

  /**
   * Send data to all connected peers.
   */
  broadcast(data: Uint8Array): number {
    let sent = 0;
    for (const [userId, connection] of this.peers) {
      if (connection.connected) {
        try {
          connection.peer.send(data);
          sent++;
        } catch (error) {
          console.error(`Failed to broadcast to ${userId}:`, error);
        }
      }
    }
    return sent;
  }

  /**
   * Disconnect from a specific peer.
   */
  disconnect(targetUserId: string) {
    const connection = this.peers.get(targetUserId);
    if (connection) {
      connection.peer.destroy();
      this.peers.delete(targetUserId);
    }
  }

  /**
   * Disconnect from all peers.
   */
  disconnectAll() {
    for (const connection of this.peers.values()) {
      connection.peer.destroy();
    }
    this.peers.clear();
  }

  /**
   * Check if connected to a peer.
   */
  isConnected(targetUserId: string): boolean {
    return this.peers.get(targetUserId)?.connected ?? false;
  }

  /**
   * Get list of connected peer user IDs.
   */
  getConnectedPeers(): string[] {
    return Array.from(this.peers.entries())
      .filter(([_, conn]) => conn.connected)
      .map(([userId]) => userId);
  }

  /**
   * Register a data handler.
   */
  onData(handler: DataHandler): () => void {
    this.dataHandlers.add(handler);
    return () => this.dataHandlers.delete(handler);
  }

  /**
   * Register a connection handler.
   */
  onConnection(handler: ConnectionHandler): () => void {
    this.connectionHandlers.add(handler);
    return () => this.connectionHandlers.delete(handler);
  }

  private notifyDataHandlers(userId: string, data: Uint8Array) {
    this.dataHandlers.forEach((handler) => handler(userId, data));
  }

  private notifyConnectionHandlers(userId: string, connected: boolean) {
    this.connectionHandlers.forEach((handler) => handler(userId, connected));
  }
}

// Export singleton instance
export const webrtcManager = new WebRTCManager();
