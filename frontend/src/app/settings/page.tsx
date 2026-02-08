"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/store/auth";
import { api } from "@/lib/api";

interface Invite {
  code: string;
  max_uses: number;
  use_count: number;
  expires_at: string | null;
  note: string | null;
}

export default function SettingsPage() {
  const router = useRouter();
  const { isAuthenticated, user, fetchUser, logout } = useAuthStore();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [isCreatingInvite, setIsCreatingInvite] = useState(false);
  const [newInviteNote, setNewInviteNote] = useState("");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      await fetchUser();
      if (!isAuthenticated) {
        router.push("/login");
        return;
      }
      loadInvites();
    };
    init();
  }, [isAuthenticated, fetchUser, router]);

  const loadInvites = async () => {
    try {
      const data = await api.listInvites();
      setInvites(data);
    } catch (error) {
      console.error("Failed to load invites:", error);
    }
  };

  const handleCreateInvite = async () => {
    setIsCreatingInvite(true);
    try {
      await api.createInvite(1, 7, newInviteNote || undefined);
      setNewInviteNote("");
      await loadInvites();
    } catch (error) {
      console.error("Failed to create invite:", error);
    } finally {
      setIsCreatingInvite(false);
    }
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link href="/" className="flex items-center space-x-2">
              <div className="p-1.5 bg-blue-600 rounded-lg">
                <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <span className="font-bold text-gray-900 dark:text-white">Cloudless</span>
            </Link>
            <div className="h-6 w-px bg-gray-300 dark:bg-gray-600"></div>
            <span className="text-gray-600 dark:text-gray-400">Settings</span>
          </div>

          <button
            onClick={logout}
            className="text-sm text-red-600 hover:text-red-700 dark:text-red-400"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        {/* Profile */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Profile</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-500 dark:text-gray-400">Username</label>
              <p className="text-gray-900 dark:text-white">{user?.username}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500 dark:text-gray-400">Display Name</label>
              <p className="text-gray-900 dark:text-white">{user?.display_name}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500 dark:text-gray-400">Account Type</label>
              <p className="text-gray-900 dark:text-white">
                {user?.is_admin ? "Administrator" : "User"}
              </p>
            </div>
          </div>
        </div>

        {/* Invite Friends */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Invite Friends</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Create invite codes to let friends register on your Cloudless instance.
          </p>

          {/* Create Invite */}
          <div className="flex space-x-3 mb-6">
            <input
              type="text"
              value={newInviteNote}
              onChange={(e) => setNewInviteNote(e.target.value)}
              placeholder="Note (optional, e.g., 'For Alice')"
              className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <button
              onClick={handleCreateInvite}
              disabled={isCreatingInvite}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium rounded-lg transition-colors whitespace-nowrap"
            >
              {isCreatingInvite ? "Creating..." : "Create Invite"}
            </button>
          </div>

          {/* Invite List */}
          {invites.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
              No invite codes yet. Create one to invite friends.
            </p>
          ) : (
            <div className="space-y-3">
              {invites.map((invite) => (
                <div
                  key={invite.code}
                  className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
                >
                  <div>
                    <div className="flex items-center space-x-2">
                      <code className="font-mono font-bold text-blue-600 dark:text-blue-400">
                        {invite.code}
                      </code>
                      {invite.use_count >= invite.max_uses && (
                        <span className="text-xs px-2 py-0.5 bg-gray-200 dark:bg-gray-600 rounded text-gray-600 dark:text-gray-300">
                          Used
                        </span>
                      )}
                    </div>
                    {invite.note && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{invite.note}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-1">
                      {invite.use_count}/{invite.max_uses} uses
                      {invite.expires_at && (
                        <span>
                          {" "}
                          - Expires {new Date(invite.expires_at).toLocaleDateString()}
                        </span>
                      )}
                    </p>
                  </div>
                  <button
                    onClick={() => copyCode(invite.code)}
                    className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                    title="Copy code"
                  >
                    {copiedCode === invite.code ? (
                      <svg className="h-5 w-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Security Info */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Security</h2>
          <div className="space-y-4 text-sm">
            <div className="flex items-start space-x-3">
              <svg className="h-5 w-5 text-green-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <div>
                <p className="font-medium text-gray-900 dark:text-white">End-to-End Encryption</p>
                <p className="text-gray-500 dark:text-gray-400">
                  All files are encrypted on your device using XSalsa20-Poly1305 before leaving your browser.
                </p>
              </div>
            </div>
            <div className="flex items-start space-x-3">
              <svg className="h-5 w-5 text-green-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <div>
                <p className="font-medium text-gray-900 dark:text-white">Zero Knowledge</p>
                <p className="text-gray-500 dark:text-gray-400">
                  The server never sees your encryption keys or file contents. Even filenames are encrypted.
                </p>
              </div>
            </div>
            <div className="flex items-start space-x-3">
              <svg className="h-5 w-5 text-green-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <div>
                <p className="font-medium text-gray-900 dark:text-white">Password Security</p>
                <p className="text-gray-500 dark:text-gray-400">
                  Your password is hashed using Argon2id, a memory-hard function resistant to GPU attacks.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
