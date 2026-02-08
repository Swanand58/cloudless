"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/store/auth";
import { useRoomStore } from "@/store/room";
import { FileDropzone } from "@/components/FileDropzone";
import { TransferProgress, TransferStatus } from "@/components/TransferProgress";
import { ChatWindow } from "@/components/ChatWindow";
import { PeerStatus } from "@/components/PeerStatus";
import { SafetyNumber } from "@/components/SafetyNumber";
import { api } from "@/lib/api";
import { encryptFilename, encryptData } from "@/lib/crypto";
import { readFileChunks, formatFileSize, CHUNK_SIZE, createDownloadBlob, downloadFile } from "@/lib/chunker";
import { decryptFilename, decryptData } from "@/lib/crypto";
import { decodeBase64 } from "tweetnacl-util";

interface ActiveTransfer {
  id: string;
  filename: string;
  fileSize: number;
  status: TransferStatus;
  progress: number;
  uploadedBytes: number;
}

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params.id as string;

  const { isAuthenticated, user, fetchUser } = useAuthStore();
  const { currentRoom, keyPair, sharedSecrets, loadRoom, leaveRoom, transfers, loadTransfers } = useRoomStore();

  const [activeTransfers, setActiveTransfers] = useState<Map<string, ActiveTransfer>>(new Map());
  const [showSafetyNumber, setShowSafetyNumber] = useState(false);
  const [selectedPeer, setSelectedPeer] = useState<{ userId: string; name: string; publicKey: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decryptedFilenames, setDecryptedFilenames] = useState<Map<string, string>>(new Map());
  const [dismissedTransfers, setDismissedTransfers] = useState<Set<string>>(new Set());

  // Track if we've initialized to prevent re-running
  const [hasInitialized, setHasInitialized] = useState(false);

  useEffect(() => {
    // Prevent re-initialization
    if (hasInitialized) return;

    const init = async () => {
      await fetchUser();
    };
    init();
  }, [fetchUser, hasInitialized]);

  useEffect(() => {
    // Wait for auth check, but only initialize once
    if (hasInitialized) return;
    
    // If not authenticated after fetchUser, redirect
    if (!isAuthenticated) {
      // Give a small delay to allow auth state to settle
      const timeout = setTimeout(() => {
        if (!api.isAuthenticated()) {
          router.push("/login");
        }
      }, 100);
      return () => clearTimeout(timeout);
    }

    // Load room
    const initRoom = async () => {
      try {
        setHasInitialized(true);
        await loadRoom(roomId);
        setIsLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load room");
        setIsLoading(false);
      }
    };
    initRoom();

    return () => {
      leaveRoom();
    };
  }, [roomId, isAuthenticated, loadRoom, leaveRoom, router, hasInitialized]);

  // Decrypt filenames when transfers or shared secrets change
  useEffect(() => {
    if (!sharedSecrets.size || !transfers.length) return;

    const [, sharedSecret] = Array.from(sharedSecrets.entries())[0];
    const newDecryptedFilenames = new Map<string, string>();

    transfers.forEach((transfer) => {
      // Skip if already decrypted
      if (decryptedFilenames.has(transfer.id)) {
        newDecryptedFilenames.set(transfer.id, decryptedFilenames.get(transfer.id)!);
        return;
      }

      try {
        const filename = decryptFilename(
          { ciphertext: transfer.encrypted_filename, nonce: transfer.nonce },
          sharedSecret
        );
        if (filename) {
          newDecryptedFilenames.set(transfer.id, filename);
        }
      } catch {
        // Failed to decrypt, will show fallback
      }
    });

    setDecryptedFilenames(newDecryptedFilenames);
  }, [transfers, sharedSecrets]); // Note: decryptedFilenames not in deps to avoid loop

  const handleDismissTransfer = useCallback((transferId: string) => {
    setDismissedTransfers((prev) => new Set(prev).add(transferId));
  }, []);

  const handleFileSelect = useCallback(async (file: File) => {
    if (!currentRoom || sharedSecrets.size === 0 || !keyPair) {
      setError("No peer connected yet. Wait for someone to join.");
      return;
    }

    // Get shared secret (first peer for now)
    const [peerId, sharedSecret] = Array.from(sharedSecrets.entries())[0];

    // Create transfer ID for tracking
    const tempId = `temp-${Date.now()}`;
    
    // Initialize transfer state
    setActiveTransfers((prev) => new Map(prev).set(tempId, {
      id: tempId,
      filename: file.name,
      fileSize: file.size,
      status: "encrypting",
      progress: 0,
      uploadedBytes: 0,
    }));

    try {
      // Encrypt filename
      const encryptedFilename = encryptFilename(file.name, sharedSecret);
      const encryptedMimetype = encryptFilename(file.type || "application/octet-stream", sharedSecret);

      // Initialize transfer on server
      const transfer = await api.initTransfer(
        currentRoom.id,
        encryptedFilename.ciphertext,
        encryptedMimetype.ciphertext,
        file.size,
        encryptedFilename.nonce,
        "relay"
      );

      // Update with real transfer ID
      setActiveTransfers((prev) => {
        const newMap = new Map(prev);
        newMap.delete(tempId);
        newMap.set(transfer.id, {
          id: transfer.id,
          filename: file.name,
          fileSize: file.size,
          status: "uploading",
          progress: 0,
          uploadedBytes: 0,
        });
        return newMap;
      });

      // Upload encrypted chunks
      let chunkIndex = 0;
      let uploadedBytes = 0;
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

      for await (const { data } of readFileChunks(file, CHUNK_SIZE)) {
        // Encrypt chunk
        const { ciphertext, nonce } = encryptData(data, sharedSecret);
        
        // Combine nonce and ciphertext for upload
        const combined = new Uint8Array(nonce.length + ciphertext.length);
        combined.set(nonce);
        combined.set(ciphertext, nonce.length);
        
        // Upload chunk
        const blob = new Blob([combined]);
        await api.uploadChunk(transfer.id, chunkIndex, blob);
        
        chunkIndex++;
        uploadedBytes += data.length;
        
        // Update progress
        setActiveTransfers((prev) => {
          const current = prev.get(transfer.id);
          if (!current) return prev;
          const newMap = new Map(prev);
          newMap.set(transfer.id, {
            ...current,
            progress: Math.round((chunkIndex / totalChunks) * 100),
            uploadedBytes,
          });
          return newMap;
        });
      }

      // Mark as completed
      setActiveTransfers((prev) => {
        const current = prev.get(transfer.id);
        if (!current) return prev;
        const newMap = new Map(prev);
        newMap.set(transfer.id, {
          ...current,
          status: "completed",
          progress: 100,
        });
        return newMap;
      });

      // Reload transfers
      await loadTransfers();

    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setActiveTransfers((prev) => {
        const newMap = new Map(prev);
        newMap.delete(tempId);
        return newMap;
      });
    }
  }, [currentRoom, sharedSecrets, keyPair, loadTransfers]);

  const handleDownload = useCallback(async (transferId: string) => {
    if (!sharedSecrets.size) return;

    const [, sharedSecret] = Array.from(sharedSecrets.entries())[0];

    try {
      // Get transfer info
      const transfer = await api.getTransfer(transferId);
      
      // Decrypt filename
      const filename = decryptFilename(
        { ciphertext: transfer.encrypted_filename, nonce: transfer.nonce },
        sharedSecret
      ) || "download";

      // Update status
      setActiveTransfers((prev) => new Map(prev).set(transferId, {
        id: transferId,
        filename,
        fileSize: transfer.file_size,
        status: "downloading",
        progress: 0,
        uploadedBytes: 0,
      }));

      // Download file
      const { data: blob } = await api.downloadFile(transferId);
      const encryptedData = new Uint8Array(await blob.arrayBuffer());

      // Update status
      setActiveTransfers((prev) => {
        const current = prev.get(transferId);
        if (!current) return prev;
        const newMap = new Map(prev);
        newMap.set(transferId, { ...current, status: "decrypting", progress: 50 });
        return newMap;
      });

      // Decrypt chunks - data is stored as nonce (24 bytes) + ciphertext per chunk
      // For simplicity, treating as single chunk here
      const nonceLength = 24;
      const decryptedChunks: Uint8Array[] = [];
      let offset = 0;
      
      while (offset < encryptedData.length) {
        // Each chunk has nonce + ciphertext
        // We need to figure out chunk boundaries - for now assume single blob
        const nonce = encryptedData.slice(offset, offset + nonceLength);
        // Read until end or next chunk marker
        const remainingData = encryptedData.slice(offset + nonceLength);
        
        // Try to decrypt
        const decrypted = decryptData(remainingData, nonce, sharedSecret);
        if (decrypted) {
          decryptedChunks.push(decrypted);
          break; // Single chunk for now
        }
        
        offset += nonceLength + remainingData.length;
      }

      if (decryptedChunks.length === 0) {
        throw new Error("Decryption failed");
      }

      // Combine and download
      const totalLength = decryptedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const result = new Uint8Array(totalLength);
      let resultOffset = 0;
      for (const chunk of decryptedChunks) {
        result.set(chunk, resultOffset);
        resultOffset += chunk.length;
      }

      const downloadBlob = createDownloadBlob(result);
      downloadFile(downloadBlob, filename);

      // Update status
      setActiveTransfers((prev) => {
        const current = prev.get(transferId);
        if (!current) return prev;
        const newMap = new Map(prev);
        newMap.set(transferId, { ...current, status: "completed", progress: 100 });
        return newMap;
      });

    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
      setActiveTransfers((prev) => {
        const current = prev.get(transferId);
        if (!current) return prev;
        const newMap = new Map(prev);
        newMap.set(transferId, { ...current, status: "error" });
        return newMap;
      });
    }
  }, [sharedSecrets]);

  const handleVerifyPeer = (member: { user_id: string; display_name: string; public_key: string }) => {
    setSelectedPeer({
      userId: member.user_id,
      name: member.display_name,
      publicKey: member.public_key,
    });
    setShowSafetyNumber(true);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading room...</p>
        </div>
      </div>
    );
  }

  if (error && !currentRoom) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <div className="p-4 bg-red-100 dark:bg-red-900/30 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
            <svg className="h-8 w-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Room Not Found</h1>
          <p className="text-gray-600 dark:text-gray-400 mb-4">{error}</p>
          <Link
            href="/"
            className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
          >
            Go Home
          </Link>
        </div>
      </div>
    );
  }

  const otherMembers = currentRoom?.members.filter(m => m.public_key !== keyPair?.publicKey) || [];

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
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
            
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-sm text-gray-500 dark:text-gray-400">Room</span>
                <code className="bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded text-sm font-mono font-bold text-blue-600 dark:text-blue-400">
                  {currentRoom?.code}
                </code>
                <button
                  onClick={() => navigator.clipboard.writeText(currentRoom?.code || "")}
                  className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  title="Copy code"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <span className="text-sm text-gray-600 dark:text-gray-400">{user?.display_name}</span>
            <Link
              href="/"
              className="text-sm text-red-600 hover:text-red-700 dark:text-red-400"
            >
              Leave Room
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-6">
        {error && (
          <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300">
            {error}
            <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Left Column - File Transfer */}
          <div className="lg:col-span-2 space-y-6">
            {/* File Upload */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Send Files
              </h2>
              <FileDropzone
                onFileSelect={handleFileSelect}
                disabled={sharedSecrets.size === 0}
                maxSize={1024 * 1024 * 1024}
              />
              {sharedSecrets.size === 0 && (
                <p className="mt-2 text-sm text-yellow-600 dark:text-yellow-400">
                  Waiting for another person to join...
                </p>
              )}
            </div>

            {/* Active Transfers */}
            {activeTransfers.size > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Active Transfers</h3>
                {Array.from(activeTransfers.values()).map((transfer) => (
                  <TransferProgress
                    key={transfer.id}
                    filename={transfer.filename}
                    fileSize={transfer.fileSize}
                    status={transfer.status}
                    progress={transfer.progress}
                    uploadedBytes={transfer.uploadedBytes}
                  />
                ))}
              </div>
            )}

            {/* Received Files */}
            {transfers.filter(t => t.sender_id !== user?.id && t.status === "ready" && !dismissedTransfers.has(t.id)).length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  Received Files
                </h2>
                <div className="space-y-3">
                  {transfers
                    .filter(t => t.sender_id !== user?.id && t.status === "ready" && !dismissedTransfers.has(t.id))
                    .map((transfer) => {
                      const filename = decryptedFilenames.get(transfer.id);
                      return (
                        <div
                          key={transfer.id}
                          className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
                        >
                          <div className="flex items-center space-x-3">
                            <svg className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                            </svg>
                            <div>
                              <p className="text-sm font-medium text-gray-900 dark:text-white truncate max-w-[200px]" title={filename}>
                                {filename || `File from ${transfer.sender_name}`}
                              </p>
                              <p className="text-xs text-gray-500">
                                {formatFileSize(transfer.file_size)} • from {transfer.sender_name}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center space-x-2">
                            <button
                              onClick={() => handleDownload(transfer.id)}
                              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
                            >
                              Download
                            </button>
                            <button
                              onClick={() => handleDismissTransfer(transfer.id)}
                              className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
                              title="Dismiss"
                            >
                              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* Chat */}
            <ChatWindow className="h-[400px]" />
          </div>

          {/* Right Column - Room Info */}
          <div className="space-y-6">
            {/* Peer Status */}
            <PeerStatus />

            {/* Verify Identity */}
            {otherMembers.length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
                  Verify Identity
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                  Verify you&apos;re talking to the right person
                </p>
                {otherMembers.map((member) => (
                  <button
                    key={member.user_id}
                    onClick={() => handleVerifyPeer(member)}
                    className="w-full text-left p-2 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg transition-colors flex items-center justify-between"
                  >
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      {member.display_name}
                    </span>
                    <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  </button>
                ))}
              </div>
            )}

            {/* Security Info */}
            <div className="bg-green-50 dark:bg-green-900/20 rounded-xl border border-green-200 dark:border-green-800 p-4">
              <div className="flex items-start space-x-3">
                <svg className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                <div>
                  <h3 className="font-medium text-green-800 dark:text-green-200 text-sm">End-to-End Encrypted</h3>
                  <p className="text-xs text-green-700 dark:text-green-300 mt-1">
                    Files are encrypted on your device. The server cannot read your data.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Safety Number Modal */}
      {showSafetyNumber && selectedPeer && keyPair && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="max-w-md w-full">
            <SafetyNumber
              myPublicKey={keyPair.publicKey}
              peerPublicKey={selectedPeer.publicKey}
              peerName={selectedPeer.name}
              onVerified={() => setShowSafetyNumber(false)}
            />
            <button
              onClick={() => setShowSafetyNumber(false)}
              className="mt-4 w-full py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
