"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth";
import { useRoomStore } from "@/store/room";

export default function Home() {
  const router = useRouter();
  const { isAuthenticated, user, fetchUser, logout } = useAuthStore();
  const { createRoom, joinRoom } = useRoomStore();
  const [joinCode, setJoinCode] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const handleCreateRoom = async () => {
    setError(null);
    setIsCreating(true);
    try {
      const room = await createRoom();
      router.push(`/room/${room.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create room");
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode.trim()) return;

    setError(null);
    setIsJoining(true);
    try {
      const room = await joinRoom(joinCode.trim().toUpperCase());
      router.push(`/room/${room.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join room");
    } finally {
      setIsJoining(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8">
        <div className="max-w-md w-full text-center space-y-8">
          {/* Logo and Title */}
          <div>
            <div className="flex justify-center mb-4">
              <div className="p-4 bg-blue-600 rounded-2xl">
                <svg className="h-12 w-12 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
            </div>
            <h1 className="text-4xl font-bold text-gray-900 dark:text-white">Cloudless</h1>
            <p className="mt-2 text-lg text-gray-600 dark:text-gray-400">
              Secure, self-hosted file transfer
            </p>
          </div>

          {/* Features */}
          <div className="grid grid-cols-2 gap-4 text-left">
            <div className="p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
              <div className="text-blue-600 dark:text-blue-400 mb-2">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h3 className="font-medium text-gray-900 dark:text-white">E2E Encrypted</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">Your files are encrypted before leaving your device</p>
            </div>

            <div className="p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
              <div className="text-green-600 dark:text-green-400 mb-2">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
                </svg>
              </div>
              <h3 className="font-medium text-gray-900 dark:text-white">Self-Hosted</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">Runs on your own hardware, under your control</p>
            </div>

            <div className="p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
              <div className="text-purple-600 dark:text-purple-400 mb-2">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="font-medium text-gray-900 dark:text-white">P2P Transfer</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">Direct transfers when possible, no middleman</p>
            </div>

            <div className="p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
              <div className="text-orange-600 dark:text-orange-400 mb-2">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <h3 className="font-medium text-gray-900 dark:text-white">Verified</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">Safety numbers to verify recipients</p>
            </div>
          </div>

          {/* Auth buttons */}
          <div className="space-y-4">
            <button
              onClick={() => router.push("/login")}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors"
            >
              Sign In
            </button>
            <button
              onClick={() => router.push("/register")}
              className="w-full bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-900 dark:text-white font-medium py-3 px-4 rounded-lg border border-gray-300 dark:border-gray-600 transition-colors"
            >
              Create Account
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-600 rounded-lg">
              <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <span className="text-xl font-bold text-gray-900 dark:text-white">Cloudless</span>
          </div>

          <div className="flex items-center space-x-4">
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {user?.display_name}
            </span>
            <button
              onClick={() => router.push("/settings")}
              className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            <button
              onClick={logout}
              className="text-sm text-red-600 hover:text-red-700 dark:text-red-400"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-6">
          {/* Create Room */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-center space-x-3 mb-4">
              <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                <svg className="h-6 w-6 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Create Room</h2>
            </div>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              Start a new secure transfer room. Share the code with your friend to begin.
            </p>
            <button
              onClick={handleCreateRoom}
              disabled={isCreating}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-3 px-4 rounded-lg transition-colors"
            >
              {isCreating ? "Creating..." : "Create New Room"}
            </button>
          </div>

          {/* Join Room */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-center space-x-3 mb-4">
              <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
                <svg className="h-6 w-6 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Join Room</h2>
            </div>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              Enter a room code to join an existing transfer session.
            </p>
            <form onSubmit={handleJoinRoom} className="space-y-3">
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="Enter room code"
                maxLength={6}
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-500 focus:ring-2 focus:ring-green-500 focus:border-transparent uppercase tracking-widest text-center text-xl font-mono"
              />
              <button
                type="submit"
                disabled={isJoining || !joinCode.trim()}
                className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-medium py-3 px-4 rounded-lg transition-colors"
              >
                {isJoining ? "Joining..." : "Join Room"}
              </button>
            </form>
          </div>
        </div>

        {/* Security Note */}
        <div className="mt-8 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="flex items-start space-x-3">
            <svg className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <div>
              <h3 className="font-medium text-gray-900 dark:text-white">Your Security</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                All files are encrypted on your device before transfer. The server never sees your data.
                Use safety numbers to verify you&apos;re talking to the right person.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
