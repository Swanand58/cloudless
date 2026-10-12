/**
 * Persisted key storage using Zustand with localStorage.
 * Keys are stored per-room to maintain E2E encryption across visits.
 *
 * ponytail: keys live in this one browser. Clearing site data or using a
 * second device means a new key and losing that room's history. The upgrade
 * path is a long-term identity key with a backup.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { KeyPair } from "@/lib/crypto";

/** The other person's key as we last saw it. */
export interface PeerKey {
  publicKey: string;
  verified: boolean;
}

interface KeysState {
  // roomId -> our KeyPair
  roomKeys: Record<string, KeyPair>;
  // roomId -> the peer's key we trust
  peerKeys: Record<string, PeerKey>;

  // Actions
  getKeyPair: (roomId: string) => KeyPair | null;
  setKeyPair: (roomId: string, keyPair: KeyPair) => void;
  getPeerKey: (roomId: string) => PeerKey | null;
  setPeerKey: (roomId: string, peerKey: PeerKey) => void;
  removeRoom: (roomId: string) => void;
}

export const useKeysStore = create<KeysState>()(
  persist(
    (set, get) => ({
      roomKeys: {},
      peerKeys: {},

      getKeyPair: (roomId: string) => {
        return get().roomKeys[roomId] || null;
      },

      setKeyPair: (roomId: string, keyPair: KeyPair) => {
        set((state) => ({
          roomKeys: { ...state.roomKeys, [roomId]: keyPair },
        }));
      },

      getPeerKey: (roomId: string) => {
        return get().peerKeys[roomId] || null;
      },

      setPeerKey: (roomId: string, peerKey: PeerKey) => {
        set((state) => ({
          peerKeys: { ...state.peerKeys, [roomId]: peerKey },
        }));
      },

      removeRoom: (roomId: string) => {
        set((state) => {
          const roomKeys = { ...state.roomKeys };
          const peerKeys = { ...state.peerKeys };
          delete roomKeys[roomId];
          delete peerKeys[roomId];
          return { roomKeys, peerKeys };
        });
      },
    }),
    {
      name: "cloudless-room-keys",
    }
  )
);
