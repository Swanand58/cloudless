/**
 * Persisted key pair storage using Zustand with localStorage.
 * Keys are stored per-room to maintain E2E encryption across page refreshes.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { KeyPair } from "@/lib/crypto";

interface KeysState {
  // roomId -> KeyPair
  roomKeys: Record<string, KeyPair>;
  
  // Actions
  getKeyPair: (roomId: string) => KeyPair | null;
  setKeyPair: (roomId: string, keyPair: KeyPair) => void;
  removeKeyPair: (roomId: string) => void;
  clearAllKeys: () => void;
}

export const useKeysStore = create<KeysState>()(
  persist(
    (set, get) => ({
      roomKeys: {},

      getKeyPair: (roomId: string) => {
        return get().roomKeys[roomId] || null;
      },

      setKeyPair: (roomId: string, keyPair: KeyPair) => {
        set((state) => ({
          roomKeys: {
            ...state.roomKeys,
            [roomId]: keyPair,
          },
        }));
      },

      removeKeyPair: (roomId: string) => {
        set((state) => {
          const { [roomId]: _, ...rest } = state.roomKeys;
          return { roomKeys: rest };
        });
      },

      clearAllKeys: () => {
        set({ roomKeys: {} });
      },
    }),
    {
      name: "cloudless-room-keys",
      // Only persist roomKeys
      partialize: (state) => ({ roomKeys: state.roomKeys }),
    }
  )
);
