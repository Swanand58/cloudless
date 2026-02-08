/**
 * Room and chat store using Zustand.
 */

import { create } from "zustand";
import { api, RoomResponse, TransferResponse } from "@/lib/api";
import { wsClient, ChatMessage } from "@/lib/websocket";
import { generateKeyPair, deriveSharedSecret, encryptMessage, decryptMessage, KeyPair } from "@/lib/crypto";
import { useKeysStore } from "./keys";

export interface DecryptedMessage {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: Date;
  isOwn: boolean;
}

interface RoomState {
  // Current room state
  currentRoom: RoomResponse | null;
  keyPair: KeyPair | null;
  sharedSecrets: Map<string, Uint8Array>; // userId -> sharedSecret
  
  // Messages
  messages: DecryptedMessage[];
  
  // Online users
  onlineUsers: Set<string>;
  typingUsers: Map<string, string>; // userId -> userName
  
  // Transfers
  transfers: TransferResponse[];
  
  // Loading states
  isLoading: boolean;
  isConnecting: boolean;
  
  // Actions
  createRoom: (name?: string) => Promise<RoomResponse>;
  joinRoom: (code: string) => Promise<RoomResponse>;
  leaveRoom: () => void;
  loadRoom: (roomId: string) => Promise<void>;
  
  // Messaging
  sendMessage: (content: string) => void;
  setTyping: (isTyping: boolean) => void;
  
  // Transfers
  loadTransfers: () => Promise<void>;
  addTransfer: (transfer: TransferResponse) => void;
  updateTransfer: (transferId: string, updates: Partial<TransferResponse>) => void;
  
  // Crypto
  getSharedSecret: (userId: string) => Uint8Array | null;
  
  // Internal
  _handleChatMessage: (message: ChatMessage) => void;
  _setupWebSocket: () => void;
  _cleanupWebSocket: () => void;
}

export const useRoomStore = create<RoomState>((set, get) => ({
  currentRoom: null,
  keyPair: null,
  sharedSecrets: new Map(),
  messages: [],
  onlineUsers: new Set(),
  typingUsers: new Map(),
  transfers: [],
  isLoading: false,
  isConnecting: false,

  createRoom: async (name?: string) => {
    set({ isLoading: true });
    
    // Generate new key pair for this room
    const keyPair = generateKeyPair();
    
    try {
      const room = await api.createRoom(keyPair.publicKey, name);
      
      // Persist key pair using keys store
      useKeysStore.getState().setKeyPair(room.id, keyPair);
      
      set({ 
        currentRoom: room, 
        keyPair,
        messages: [],
        sharedSecrets: new Map(),
        onlineUsers: new Set([room.members[0].user_id]),
        isLoading: false 
      });
      
      // Connect WebSocket
      get()._setupWebSocket();
      
      return room;
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  joinRoom: async (code: string) => {
    set({ isLoading: true });
    
    // Generate new key pair for this room
    const keyPair = generateKeyPair();
    
    try {
      const room = await api.joinRoom(code, keyPair.publicKey);
      
      // Persist key pair using keys store
      useKeysStore.getState().setKeyPair(room.id, keyPair);
      
      // Derive shared secrets with other members
      const sharedSecrets = new Map<string, Uint8Array>();
      for (const member of room.members) {
        if (member.public_key && member.public_key !== keyPair.publicKey) {
          const secret = deriveSharedSecret(keyPair.secretKey, member.public_key);
          sharedSecrets.set(member.user_id, secret);
        }
      }
      
      set({ 
        currentRoom: room, 
        keyPair,
        sharedSecrets,
        messages: [],
        onlineUsers: new Set(room.members.filter(m => m.is_online).map(m => m.user_id)),
        isLoading: false 
      });
      
      // Connect WebSocket
      get()._setupWebSocket();
      
      return room;
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  leaveRoom: () => {
    const { currentRoom } = get();
    
    // Clean up stored key pair when leaving room
    if (currentRoom) {
      useKeysStore.getState().removeKeyPair(currentRoom.id);
    }
    
    get()._cleanupWebSocket();
    set({
      currentRoom: null,
      keyPair: null,
      sharedSecrets: new Map(),
      messages: [],
      onlineUsers: new Set(),
      typingUsers: new Map(),
      transfers: [],
    });
  },

  loadRoom: async (roomId: string) => {
    set({ isLoading: true });
    
    try {
      let room = await api.getRoom(roomId);
      
      // Check if we have a key pair in state or persisted store
      let keyPair = get().keyPair;
      
      // Try to load from persisted keys store
      if (!keyPair) {
        keyPair = useKeysStore.getState().getKeyPair(roomId);
      }
      
      // If we still don't have a key pair, generate one and join/rejoin
      if (!keyPair) {
        keyPair = generateKeyPair();
        // Join/rejoin to register our public key
        await api.joinRoom(room.code, keyPair.publicKey);
        // Reload room to get updated member list with our new public key
        room = await api.getRoom(roomId);
        // Persist the new key pair
        useKeysStore.getState().setKeyPair(roomId, keyPair);
      }
      
      // Derive shared secrets with other members
      const sharedSecrets = new Map<string, Uint8Array>();
      for (const member of room.members) {
        if (member.public_key && member.public_key !== keyPair.publicKey) {
          const secret = deriveSharedSecret(keyPair.secretKey, member.public_key);
          sharedSecrets.set(member.user_id, secret);
        }
      }
      
      set({ 
        currentRoom: room, 
        keyPair,
        sharedSecrets,
        onlineUsers: new Set(room.members.filter(m => m.is_online).map(m => m.user_id)),
        isLoading: false 
      });
      
      // Connect WebSocket
      get()._setupWebSocket();
      
      // Load transfers
      await get().loadTransfers();
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  sendMessage: (content: string) => {
    const { currentRoom, sharedSecrets, keyPair } = get();
    if (!currentRoom || sharedSecrets.size === 0) return;
    
    // Get first shared secret (for 1:1 rooms)
    const [, sharedSecret] = Array.from(sharedSecrets.entries())[0];
    
    const encrypted = encryptMessage(content, sharedSecret);
    wsClient.sendChat(encrypted.ciphertext, encrypted.nonce);
    
    // Add message to local state immediately (optimistic update)
    // Get current user ID from room members
    const myMember = currentRoom.members.find(m => m.public_key === keyPair?.publicKey);
    if (myMember) {
      const localMessage: DecryptedMessage = {
        id: `local-${Date.now()}`,
        senderId: myMember.user_id,
        senderName: myMember.display_name,
        content,
        timestamp: new Date(),
        isOwn: true,
      };
      set((state) => ({
        messages: [...state.messages, localMessage],
      }));
    }
  },

  setTyping: (isTyping: boolean) => {
    wsClient.sendTyping(isTyping);
  },

  loadTransfers: async () => {
    const { currentRoom } = get();
    if (!currentRoom) return;
    
    try {
      const transfers = await api.listRoomTransfers(currentRoom.id);
      set({ transfers });
    } catch (error) {
      // Only log if not a rate limit error
      if (error instanceof Error && !error.message.includes("Rate limit")) {
        console.error("Failed to load transfers:", error);
      }
    }
  },

  addTransfer: (transfer: TransferResponse) => {
    set((state) => ({
      transfers: [transfer, ...state.transfers],
    }));
  },

  updateTransfer: (transferId: string, updates: Partial<TransferResponse>) => {
    set((state) => ({
      transfers: state.transfers.map((t) =>
        t.id === transferId ? { ...t, ...updates } : t
      ),
    }));
  },

  getSharedSecret: (userId: string) => {
    return get().sharedSecrets.get(userId) ?? null;
  },

  _handleChatMessage: (message: ChatMessage) => {
    const { sharedSecrets, currentRoom } = get();
    const sharedSecret = sharedSecrets.get(message.sender_id);
    
    if (!sharedSecret) {
      console.error("No shared secret for sender");
      return;
    }
    
    const decrypted = decryptMessage(
      { ciphertext: message.encrypted_content, nonce: message.nonce },
      sharedSecret
    );
    
    if (!decrypted) {
      console.error("Failed to decrypt message");
      return;
    }
    
    // Get current user ID from room members
    const myPublicKey = get().keyPair?.publicKey;
    const myMember = currentRoom?.members.find(m => m.public_key === myPublicKey);
    
    const decryptedMessage: DecryptedMessage = {
      id: message.message_id,
      senderId: message.sender_id,
      senderName: message.sender_name,
      content: decrypted,
      timestamp: new Date(message.timestamp),
      isOwn: message.sender_id === myMember?.user_id,
    };
    
    set((state) => {
      // Deduplicate - skip if message with same ID already exists
      if (state.messages.some(m => m.id === decryptedMessage.id)) {
        return state;
      }
      return {
        messages: [...state.messages, decryptedMessage],
      };
    });
  },

  _setupWebSocket: async () => {
    const { currentRoom, keyPair } = get();
    if (!currentRoom) return;
    
    set({ isConnecting: true });
    
    try {
      // connect() handles cleanup of existing connection internally
      await wsClient.connect(currentRoom.id);
      
      // Get my user ID to filter out own messages
      const myMember = currentRoom.members.find(m => m.public_key === keyPair?.publicKey);
      const myUserId = myMember?.user_id;
      
      // Set up message handlers
      wsClient.on("chat", (msg) => {
        const chatMsg = msg as ChatMessage;
        // Skip own messages - we already added them locally when sending
        if (chatMsg.sender_id === myUserId) return;
        get()._handleChatMessage(chatMsg);
      });
      
      wsClient.on("online_users", (msg) => {
        const { users } = msg as unknown as { users: string[] };
        set({ onlineUsers: new Set(users) });
      });
      
      wsClient.on("user_joined", (msg) => {
        const { user_id, public_key } = msg as unknown as { 
          user_id: string; 
          public_key?: string;
          display_name?: string;
        };
        set((state) => {
          const onlineUsers = new Set(state.onlineUsers);
          onlineUsers.add(user_id);
          
          // If public key is included, derive/update shared secret
          if (public_key && state.keyPair) {
            const newSecrets = new Map(state.sharedSecrets);
            // Always update the secret - the user may have new keys
            const secret = deriveSharedSecret(state.keyPair.secretKey, public_key);
            newSecrets.set(user_id, secret);
            
            // Also update the room members list with new public key
            const updatedRoom = state.currentRoom ? {
              ...state.currentRoom,
              members: state.currentRoom.members.map(m => 
                m.user_id === user_id ? { ...m, public_key, is_online: true } : m
              )
            } : null;
            
            return { onlineUsers, sharedSecrets: newSecrets, currentRoom: updatedRoom };
          }
          
          return { onlineUsers };
        });
        
        // Only refresh room if we don't have the public key in the message
        if (!public_key) {
          setTimeout(() => {
            const currentState = get();
            if (!currentState.sharedSecrets.has(user_id) && currentRoom) {
              get().loadRoom(currentRoom.id);
            }
          }, 500);
        }
      });
      
      wsClient.on("user_left", (msg) => {
        const { user_id } = msg as unknown as { user_id: string };
        set((state) => {
          const onlineUsers = new Set(state.onlineUsers);
          onlineUsers.delete(user_id);
          const typingUsers = new Map(state.typingUsers);
          typingUsers.delete(user_id);
          return { onlineUsers, typingUsers };
        });
      });
      
      wsClient.on("typing", (msg) => {
        const { user_id, user_name, is_typing } = msg as unknown as {
          user_id: string;
          user_name: string;
          is_typing: boolean;
        };
        set((state) => {
          const typingUsers = new Map(state.typingUsers);
          if (is_typing) {
            typingUsers.set(user_id, user_name);
          } else {
            typingUsers.delete(user_id);
          }
          return { typingUsers };
        });
      });
      
      wsClient.on("transfer_update", (msg) => {
        const { transfer_id, status, progress } = msg as unknown as {
          transfer_id: string;
          status: string;
          progress?: number;
        };
        get().updateTransfer(transfer_id, { status, uploaded_chunks: progress });
      });
      
      // Handle new transfer notifications (when someone uploads a file)
      wsClient.on("new_transfer", (msg) => {
        const { transfer_id, sender_id, sender_name, encrypted_filename, file_size, status } = 
          msg as unknown as {
            transfer_id: string;
            sender_id: string;
            sender_name: string;
            encrypted_filename: string;
            file_size: number;
            status: string;
          };
        
        // Only add if we don't already have this transfer and it's not from us
        const myMember = get().currentRoom?.members.find(
          m => m.public_key === get().keyPair?.publicKey
        );
        if (sender_id !== myMember?.user_id) {
          // Reload transfers to get the full transfer data
          get().loadTransfers();
        }
      });
      
      set({ isConnecting: false });
    } catch (error) {
      console.error("WebSocket connection failed:", error);
      set({ isConnecting: false });
    }
  },

  _cleanupWebSocket: () => {
    wsClient.disconnect();
  },
}));
