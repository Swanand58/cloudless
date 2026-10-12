/**
 * Room and chat store using Zustand.
 *
 * A room has two members. Each keeps one key pair per room in this browser
 * (see keys.ts); the shared secret derived from the two encrypts everything.
 */

import { create } from "zustand";
import { api, RoomResponse, RoomMember, MessageResponse, TransferResponse } from "@/lib/api";
import { wsClient, ChatMessage } from "@/lib/websocket";
import { generateKeyPair, deriveSharedSecret, encryptMessage, decryptMessage, KeyPair } from "@/lib/crypto";
import { useKeysStore } from "./keys";
import { useAuthStore } from "./auth";

export interface DecryptedMessage {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: Date;
  isOwn: boolean;
  /** Encrypted under a key we no longer have (one side re-keyed). */
  unreadable?: boolean;
}

interface RoomState {
  // Current room state
  currentRoom: RoomResponse | null;
  keyPair: KeyPair | null;
  myUserId: string | null;
  sharedSecret: Uint8Array | null;

  // Trust in the peer's key
  peerKeyChanged: boolean; // Differs from the key we saw before
  peerVerified: boolean; // Safety number was compared for the current key

  // Messages
  messages: DecryptedMessage[];

  // Online users
  onlineUsers: Set<string>;
  typingUsers: Map<string, string>; // userId -> userName
  lastUserJoined: string | null; // For toast notification
  lastUserLeft: string | null; // For toast notification

  // Completed transfers, oldest first
  transfers: TransferResponse[];

  // Loading states
  isLoading: boolean;

  // Actions
  createRoom: (name?: string) => Promise<string>;
  joinRoom: (code: string) => Promise<string>;
  loadRoom: (roomId: string) => Promise<void>;
  closeRoom: () => void;
  leaveRoom: () => Promise<void>;
  clearLastUserJoined: () => void;
  clearLastUserLeft: () => void;

  // Trust
  acceptPeerKey: () => void;
  markPeerVerified: () => void;

  // Messaging
  sendMessage: (content: string) => boolean;
  setTyping: (isTyping: boolean) => void;

  // Transfers
  loadTransfers: () => Promise<void>;
}

const EMPTY_ROOM = {
  currentRoom: null,
  keyPair: null,
  myUserId: null,
  sharedSecret: null,
  peerKeyChanged: false,
  peerVerified: false,
  messages: [] as DecryptedMessage[],
  onlineUsers: new Set<string>(),
  typingUsers: new Map<string, string>(),
  lastUserJoined: null,
  lastUserLeft: null,
  transfers: [] as TransferResponse[],
};

// Bumped whenever the open room changes, so a slow load for a room the
// user already navigated away from can tell it is stale and stop.
let loadGeneration = 0;

/** The other member of a two-person room, if they have joined. */
export function getPeer(room: RoomResponse | null, myUserId: string | null): RoomMember | null {
  return room?.members.find((m) => m.user_id !== myUserId) ?? null;
}

function toMessage(
  message: MessageResponse | ChatMessage,
  sharedSecret: Uint8Array | null,
  myUserId: string | null
): DecryptedMessage {
  let content: string | null = null;
  try {
    content = sharedSecret
      ? decryptMessage({ ciphertext: message.encrypted_content, nonce: message.nonce }, sharedSecret)
      : null;
  } catch {
    // Malformed ciphertext or nonce
  }

  return {
    id: message.message_id,
    senderId: message.sender_id,
    senderName: message.sender_name,
    content: content ?? "",
    unreadable: content === null,
    timestamp: new Date(message.timestamp),
    isOwn: message.sender_id === myUserId,
  };
}

/** Derive the shared secret and work out whether the peer's key is the one we know. */
function trustState(room: RoomResponse, keyPair: KeyPair, myUserId: string) {
  const peer = getPeer(room, myUserId);
  if (!peer) {
    return { sharedSecret: null, peerKeyChanged: false, peerVerified: false };
  }

  let sharedSecret: Uint8Array | null = null;
  try {
    sharedSecret = deriveSharedSecret(keyPair.secretKey, peer.public_key);
  } catch {
    // Malformed public key
  }

  const keys = useKeysStore.getState();
  const known = keys.getPeerKey(room.id);
  if (!known) {
    // First time we see this peer: remember their key
    keys.setPeerKey(room.id, { publicKey: peer.public_key, verified: false });
    return { sharedSecret, peerKeyChanged: false, peerVerified: false };
  }

  const peerKeyChanged = known.publicKey !== peer.public_key;
  return {
    sharedSecret,
    peerKeyChanged,
    peerVerified: !peerKeyChanged && known.verified,
  };
}

export const useRoomStore = create<RoomState>((set, get) => {
  /** Re-fetch members, history and transfers, e.g. after a reconnect or a key change. */
  const refresh = async () => {
    const { currentRoom, keyPair, myUserId } = get();
    if (!currentRoom || !keyPair || !myUserId) return;
    const generation = loadGeneration;

    try {
      const [room, history, transfers] = await Promise.all([
        api.getRoom(currentRoom.id),
        api.listMessages(currentRoom.id),
        api.listRoomTransfers(currentRoom.id),
      ]);
      if (generation !== loadGeneration) return;

      const trust = trustState(room, keyPair, myUserId);
      set({
        currentRoom: room,
        ...trust,
        messages: history.map((m) => toMessage(m, trust.sharedSecret, myUserId)),
        transfers,
      });
    } catch (error) {
      console.error("Failed to refresh room:", error);
    }
  };

  const connectWebSocket = (roomId: string) => {
    wsClient.disconnect();

    wsClient.on("chat", (msg) => {
      const { sharedSecret, myUserId } = get();
      const message = toMessage(msg as ChatMessage, sharedSecret, myUserId);
      set((state) =>
        // Deduplicate - skip if message with same ID already exists
        state.messages.some((m) => m.id === message.id)
          ? state
          : { messages: [...state.messages, message] }
      );
    });

    wsClient.on("online_users", (msg) => {
      const { users } = msg as unknown as { users: string[] };
      set({ onlineUsers: new Set(users) });
    });

    wsClient.on("user_joined", (msg) => {
      const { user_id, public_key, display_name } = msg as unknown as {
        user_id: string;
        public_key?: string;
        display_name?: string;
      };
      const known = getPeer(get().currentRoom, get().myUserId);
      set((state) => ({
        onlineUsers: new Set(state.onlineUsers).add(user_id),
        lastUserJoined: display_name || null,
      }));

      // A new member, or a member with a new key: reload so the shared
      // secret and everything decrypted with it are current
      if (!known || known.public_key !== public_key) {
        refresh();
      }
    });

    wsClient.on("user_left", (msg) => {
      const { user_id, display_name } = msg as unknown as { user_id: string; display_name?: string };
      set((state) => {
        const onlineUsers = new Set(state.onlineUsers);
        onlineUsers.delete(user_id);
        const typingUsers = new Map(state.typingUsers);
        typingUsers.delete(user_id);
        return { onlineUsers, typingUsers, lastUserLeft: display_name || "A user" };
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

    // Someone finished uploading a file
    wsClient.on("new_transfer", () => {
      get().loadTransfers();
    });

    // Whatever arrived while disconnected is fetched on reconnect
    wsClient.onReconnect = refresh;

    // Failure is not fatal: the client keeps retrying on its own
    wsClient.connect(roomId).catch(() => {});
  };

  return {
    ...EMPTY_ROOM,
    isLoading: false,

    createRoom: async (name?: string) => {
      // Generate new key pair for this room
      const keyPair = generateKeyPair();
      const room = await api.createRoom(keyPair.publicKey, name);
      useKeysStore.getState().setKeyPair(room.id, keyPair);
      return room.id;
    },

    joinRoom: async (code: string) => {
      const keys = useKeysStore.getState();

      // Already a member with a key in this browser: just open the room.
      // Joining again would replace our key and make the history unreadable.
      const existing = (await api.listRooms()).find((r) => r.code === code);
      if (existing && keys.getKeyPair(existing.id)) {
        return existing.id;
      }

      const keyPair = generateKeyPair();
      const room = await api.joinRoom(code, keyPair.publicKey);
      keys.setKeyPair(room.id, keyPair);
      return room.id;
    },

    loadRoom: async (roomId: string) => {
      const generation = ++loadGeneration;
      set({ ...EMPTY_ROOM, isLoading: true });

      try {
        const me = useAuthStore.getState().user ?? (await api.getMe());
        let room = await api.getRoom(roomId);

        // No key in this browser (new device or cleared storage): make one.
        // Saved before registering, so a failed request is retried next time.
        const keys = useKeysStore.getState();
        let keyPair = keys.getKeyPair(roomId);
        if (!keyPair) {
          keyPair = generateKeyPair();
          keys.setKeyPair(roomId, keyPair);
        }

        // Make sure the server has the key we actually hold
        const mine = room.members.find((m) => m.user_id === me.id);
        if (mine?.public_key !== keyPair.publicKey) {
          room = await api.joinRoom(room.code, keyPair.publicKey);
        }

        const [history, transfers] = await Promise.all([
          api.listMessages(roomId),
          api.listRoomTransfers(roomId),
        ]);
        if (generation !== loadGeneration) return;

        const trust = trustState(room, keyPair, me.id);
        set({
          currentRoom: room,
          keyPair,
          myUserId: me.id,
          ...trust,
          messages: history.map((m) => toMessage(m, trust.sharedSecret, me.id)),
          transfers,
          onlineUsers: new Set(room.members.filter((m) => m.is_online).map((m) => m.user_id)),
          isLoading: false,
        });

        connectWebSocket(roomId);
      } catch (error) {
        if (generation === loadGeneration) set({ isLoading: false });
        throw error;
      }
    },

    // Navigating away: disconnect, but keep the room and its keys
    closeRoom: () => {
      loadGeneration++;
      wsClient.disconnect();
      set({ ...EMPTY_ROOM, isLoading: false });
    },

    // Give up membership for good and forget this room's keys
    leaveRoom: async () => {
      const { currentRoom } = get();
      if (!currentRoom) return;

      await api.leaveRoom(currentRoom.id);
      useKeysStore.getState().removeRoom(currentRoom.id);
      get().closeRoom();
    },

    clearLastUserJoined: () => {
      set({ lastUserJoined: null });
    },

    clearLastUserLeft: () => {
      set({ lastUserLeft: null });
    },

    acceptPeerKey: () => {
      const { currentRoom, myUserId } = get();
      const peer = getPeer(currentRoom, myUserId);
      if (!currentRoom || !peer) return;

      useKeysStore.getState().setPeerKey(currentRoom.id, { publicKey: peer.public_key, verified: false });
      set({ peerKeyChanged: false, peerVerified: false });
    },

    markPeerVerified: () => {
      const { currentRoom, myUserId } = get();
      const peer = getPeer(currentRoom, myUserId);
      if (!currentRoom || !peer) return;

      useKeysStore.getState().setPeerKey(currentRoom.id, { publicKey: peer.public_key, verified: true });
      set({ peerKeyChanged: false, peerVerified: true });
    },

    sendMessage: (content: string) => {
      const { currentRoom, sharedSecret, myUserId } = get();
      if (!currentRoom || !sharedSecret || !myUserId) return false;

      const encrypted = encryptMessage(content, sharedSecret);
      if (!wsClient.sendChat(encrypted.ciphertext, encrypted.nonce)) return false;

      // Add message to local state immediately (optimistic update)
      const me = currentRoom.members.find((m) => m.user_id === myUserId);
      const localMessage: DecryptedMessage = {
        id: `local-${Date.now()}`,
        senderId: myUserId,
        senderName: me?.display_name ?? "",
        content,
        timestamp: new Date(),
        isOwn: true,
      };
      set((state) => ({
        messages: [...state.messages, localMessage],
      }));
      return true;
    },

    setTyping: (isTyping: boolean) => {
      wsClient.sendTyping(isTyping);
    },

    loadTransfers: async () => {
      const { currentRoom } = get();
      if (!currentRoom) return;

      try {
        const transfers = await api.listRoomTransfers(currentRoom.id);
        if (get().currentRoom?.id === currentRoom.id) set({ transfers });
      } catch (error) {
        console.error("Failed to load transfers:", error);
      }
    },
  };
});
