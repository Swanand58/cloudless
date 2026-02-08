import { create } from "zustand";

interface LoaderState {
  isLoading: boolean;
  message: string;
  setLoading: (loading: boolean, message?: string) => void;
}

export const useLoader = create<LoaderState>((set) => ({
  isLoading: true, // Start with loading true to prevent flash
  message: "Loading...",
  setLoading: (loading, message = "Loading...") => set({ isLoading: loading, message }),
}));
