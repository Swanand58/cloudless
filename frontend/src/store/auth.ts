/**
 * Authentication store using Zustand.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api, UserResponse } from "@/lib/api";

interface AuthState {
  user: UserResponse | null;
  isLoading: boolean;
  isAuthenticated: boolean;

  // Actions
  login: (username: string, password: string) => Promise<void>;
  register: (
    username: string,
    password: string,
    displayName: string,
    inviteCode: string
  ) => Promise<void>;
  logout: () => void;
  fetchUser: () => Promise<void>;
  checkAuth: () => Promise<boolean>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isLoading: false,
      isAuthenticated: false,

      login: async (username: string, password: string) => {
        set({ isLoading: true });
        try {
          await api.login(username, password);
          const user = await api.getMe();
          set({ user, isAuthenticated: true, isLoading: false });
        } catch (error) {
          set({ isLoading: false });
          throw error;
        }
      },

      register: async (
        username: string,
        password: string,
        displayName: string,
        inviteCode: string
      ) => {
        set({ isLoading: true });
        try {
          await api.register(username, password, displayName, inviteCode);
          const user = await api.getMe();
          set({ user, isAuthenticated: true, isLoading: false });
        } catch (error) {
          set({ isLoading: false });
          throw error;
        }
      },

      logout: () => {
        api.logout();
        set({ user: null, isAuthenticated: false });
      },

      fetchUser: async () => {
        if (!api.isAuthenticated()) {
          set({ user: null, isAuthenticated: false });
          return;
        }

        set({ isLoading: true });
        try {
          const user = await api.getMe();
          set({ user, isAuthenticated: true, isLoading: false });
        } catch {
          api.logout();
          set({ user: null, isAuthenticated: false, isLoading: false });
        }
      },

      checkAuth: async () => {
        if (!api.isAuthenticated()) {
          return false;
        }

        try {
          await api.getMe();
          return true;
        } catch {
          api.logout();
          set({ user: null, isAuthenticated: false });
          return false;
        }
      },
    }),
    {
      name: "auth-storage",
      partialize: (state) => ({
        // Only persist essential data
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
