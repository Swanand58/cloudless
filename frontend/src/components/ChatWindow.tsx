"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useAuthStore } from "@/store/auth";
import {
  useRoomStore,
  DecryptedMessage,
  useChatItems,
  ChatItem,
  FileTransferStatus,
} from "@/store/room";
import { api } from "@/lib/api";
import {
  encryptFilename,
  encryptData,
  decryptFilename,
  decryptData,
} from "@/lib/crypto";
import {
  readFileChunks,
  formatFileSize,
  CHUNK_SIZE,
  createDownloadBlob,
  downloadFile,
} from "@/lib/chunker";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Lock, MessageCircle, Send, Paperclip, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { FileBubble } from "./FileBubble";

interface ActiveTransfer {
  id: string;
  filename: string;
  fileSize: number;
  status: FileTransferStatus;
  progress: number;
}

interface ChatWindowProps {
  className?: string;
}

export function ChatWindow({ className = "" }: ChatWindowProps) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [activeTransfers, setActiveTransfers] = useState<
    Map<string, ActiveTransfer>
  >(new Map());
  const [decryptedFilenames, setDecryptedFilenames] = useState<
    Map<string, string>
  >(new Map());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { user } = useAuthStore();
  const {
    messages,
    transfers,
    typingUsers,
    sendMessage,
    setTyping,
    currentRoom,
    keyPair,
    sharedSecrets,
    loadTransfers,
  } = useRoomStore();

  // Get my user ID
  const myMember = currentRoom?.members.find(
    (m) => m.public_key === keyPair?.publicKey,
  );
  const myUserId = myMember?.user_id;

  // Decrypt filenames when transfers or shared secrets change
  useEffect(() => {
    if (!sharedSecrets.size || !transfers.length) return;

    const [, sharedSecret] = Array.from(sharedSecrets.entries())[0];
    const newDecryptedFilenames = new Map<string, string>();

    transfers.forEach((transfer) => {
      if (decryptedFilenames.has(transfer.id)) {
        newDecryptedFilenames.set(
          transfer.id,
          decryptedFilenames.get(transfer.id)!,
        );
        return;
      }
      try {
        const filename = decryptFilename(
          { ciphertext: transfer.encrypted_filename, nonce: transfer.nonce },
          sharedSecret,
        );
        if (filename) newDecryptedFilenames.set(transfer.id, filename);
      } catch {
        // fallback
      }
    });

    setDecryptedFilenames(newDecryptedFilenames);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transfers, sharedSecrets]);

  // Create unified chat items
  const chatItems = useChatItems(
    messages,
    transfers,
    myUserId,
    decryptedFilenames,
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatItems]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim()) {
      sendMessage(message.trim());
      setMessage("");
      setTyping(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMessage(e.target.value);
    setTyping(true);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => setTyping(false), 2000);
  };

  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Reset file input
      e.target.value = "";

      if (!currentRoom || sharedSecrets.size === 0 || !keyPair) {
        setError("No peer connected yet. Wait for someone to join.");
        return;
      }

      const [, sharedSecret] = Array.from(sharedSecrets.entries())[0];
      const tempId = `temp-${Date.now()}`;

      setActiveTransfers((prev) =>
        new Map(prev).set(tempId, {
          id: tempId,
          filename: file.name,
          fileSize: file.size,
          status: "encrypting",
          progress: 0,
        }),
      );

      try {
        const encryptedFilename = encryptFilename(file.name, sharedSecret);
        const encryptedMimetype = encryptFilename(
          file.type || "application/octet-stream",
          sharedSecret,
        );

        const transfer = await api.initTransfer(
          currentRoom.id,
          encryptedFilename.ciphertext,
          encryptedMimetype.ciphertext,
          file.size,
          encryptedFilename.nonce,
          "relay",
        );

        // Store the decrypted filename
        setDecryptedFilenames((prev) =>
          new Map(prev).set(transfer.id, file.name),
        );

        setActiveTransfers((prev) => {
          const m = new Map(prev);
          m.delete(tempId);
          m.set(transfer.id, {
            id: transfer.id,
            filename: file.name,
            fileSize: file.size,
            status: "uploading",
            progress: 0,
          });
          return m;
        });

        let chunkIndex = 0;
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

        for await (const { data } of readFileChunks(file, CHUNK_SIZE)) {
          const { ciphertext, nonce } = encryptData(data, sharedSecret);
          const combined = new Uint8Array(nonce.length + ciphertext.length);
          combined.set(nonce);
          combined.set(ciphertext, nonce.length);
          await api.uploadChunk(transfer.id, chunkIndex, new Blob([combined]));
          chunkIndex++;

          setActiveTransfers((prev) => {
            const current = prev.get(transfer.id);
            if (!current) return prev;
            const m = new Map(prev);
            m.set(transfer.id, {
              ...current,
              progress: Math.round((chunkIndex / totalChunks) * 100),
            });
            return m;
          });
        }

        setActiveTransfers((prev) => {
          const current = prev.get(transfer.id);
          if (!current) return prev;
          const m = new Map(prev);
          m.set(transfer.id, {
            ...current,
            status: "completed",
            progress: 100,
          });
          return m;
        });

        // Remove from active after a moment and refresh transfers
        setTimeout(() => {
          setActiveTransfers((prev) => {
            const m = new Map(prev);
            m.delete(transfer.id);
            return m;
          });
        }, 2000);

        await loadTransfers();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
        setActiveTransfers((prev) => {
          const m = new Map(prev);
          m.delete(tempId);
          return m;
        });
      }
    },
    [currentRoom, sharedSecrets, keyPair, loadTransfers],
  );

  const handleDownload = useCallback(
    async (transferId: string) => {
      if (!sharedSecrets.size) return;
      const [, sharedSecret] = Array.from(sharedSecrets.entries())[0];

      try {
        const transfer = await api.getTransfer(transferId);
        const filename =
          decryptFilename(
            { ciphertext: transfer.encrypted_filename, nonce: transfer.nonce },
            sharedSecret,
          ) || "download";

        setActiveTransfers((prev) =>
          new Map(prev).set(transferId, {
            id: transferId,
            filename,
            fileSize: transfer.file_size,
            status: "downloading",
            progress: 0,
          }),
        );

        const { data: blob } = await api.downloadFile(transferId);
        const encryptedData = new Uint8Array(await blob.arrayBuffer());

        setActiveTransfers((prev) => {
          const current = prev.get(transferId);
          if (!current) return prev;
          const m = new Map(prev);
          m.set(transferId, { ...current, status: "decrypting", progress: 50 });
          return m;
        });

        // Each encrypted chunk is: nonce (24 bytes) + ciphertext (original + 16 byte auth tag)
        // Original chunk size is CHUNK_SIZE (64KB), so encrypted chunk size is 24 + CHUNK_SIZE + 16
        const nonceLength = 24;
        const authTagLength = 16;
        const encryptedChunkSize = nonceLength + CHUNK_SIZE + authTagLength;
        
        const decryptedChunks: Uint8Array[] = [];
        let offset = 0;

        while (offset < encryptedData.length) {
          const nonce = encryptedData.slice(offset, offset + nonceLength);
          
          // The ciphertext is either a full chunk or the last partial chunk
          const ciphertextEnd = Math.min(offset + encryptedChunkSize, encryptedData.length);
          const ciphertext = encryptedData.slice(offset + nonceLength, ciphertextEnd);
          
          const decrypted = decryptData(ciphertext, nonce, sharedSecret);
          if (!decrypted) {
            throw new Error("Decryption failed");
          }
          decryptedChunks.push(decrypted);
          
          // Move to next chunk
          offset = ciphertextEnd;
        }

        if (decryptedChunks.length === 0) throw new Error("No data decrypted");

        const totalLength = decryptedChunks.reduce(
          (sum, c) => sum + c.length,
          0,
        );
        const result = new Uint8Array(totalLength);
        let ro = 0;
        for (const chunk of decryptedChunks) {
          result.set(chunk, ro);
          ro += chunk.length;
        }

        downloadFile(createDownloadBlob(result), filename);

        setActiveTransfers((prev) => {
          const current = prev.get(transferId);
          if (!current) return prev;
          const m = new Map(prev);
          m.set(transferId, { ...current, status: "completed", progress: 100 });
          return m;
        });

        // Remove from active after a moment
        setTimeout(() => {
          setActiveTransfers((prev) => {
            const m = new Map(prev);
            m.delete(transferId);
            return m;
          });
        }, 2000);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Download failed");
        setActiveTransfers((prev) => {
          const current = prev.get(transferId);
          if (!current) return prev;
          const m = new Map(prev);
          m.set(transferId, { ...current, status: "error" });
          return m;
        });
      }
    },
    [sharedSecrets],
  );

  const typingNames = Array.from(typingUsers.values());
  const canSendFiles = sharedSecrets.size > 0;

  const renderChatItem = (item: ChatItem) => {
    if (item.type === "text") {
      return (
        <MessageBubble
          key={item.id}
          message={item as unknown as DecryptedMessage & { content: string }}
        />
      );
    } else {
      const activeTransfer = item.transferId
        ? activeTransfers.get(item.transferId)
        : undefined;
      return (
        <FileBubble
          key={item.id}
          item={item}
          onDownload={handleDownload}
          activeStatus={activeTransfer?.status}
          activeProgress={activeTransfer?.progress}
        />
      );
    }
  };

  return (
    <Card className={cn("flex flex-col", className)}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium text-foreground text-sm">
            Encrypted Chat
          </span>
          <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1 ml-1">
            <Lock className="h-3 w-3" />
            E2E
          </span>
        </div>
      </div>

      {/* Error */}
      {error && (
        <Alert variant="destructive" className="mx-4 mt-3">
          <AlertDescription className="flex items-center justify-between">
            <span>{error}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setError(null)}
            >
              <X className="h-4 w-4" />
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {chatItems.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            <MessageCircle className="h-12 w-12 mx-auto mb-2 opacity-40" />
            <p>No messages yet</p>
            <p className="text-sm">Start a secure conversation</p>
          </div>
        ) : (
          chatItems.map(renderChatItem)
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Typing indicator */}
      {typingNames.length > 0 && (
        <div className="px-4 py-1 text-sm text-muted-foreground shrink-0">
          {typingNames.length === 1
            ? `${typingNames[0]} is typing...`
            : `${typingNames.join(", ")} are typing...`}
        </div>
      )}

      {/* Peer warning */}
      {!canSendFiles && (
        <div className="px-4 py-2 text-sm text-yellow-600 dark:text-yellow-400 bg-yellow-500/10 shrink-0">
          Waiting for another person to join before you can send files...
        </div>
      )}

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="p-3 border-t border-border shrink-0"
      >
        <div className="flex gap-2 items-center">
          {/* Attachment button */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleAttachClick}
            disabled={!canSendFiles}
            className="shrink-0"
            aria-label="Attach file"
          >
            <Paperclip className="h-5 w-5" />
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileSelect}
            className="hidden"
            accept="*/*"
          />

          {/* Text input */}
          <Input
            value={message}
            onChange={handleInputChange}
            placeholder="Type a message..."
            className="flex-1"
          />

          {/* Send button */}
          <Button
            type="submit"
            size="icon"
            disabled={!message.trim()}
            className="shrink-0"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </form>
    </Card>
  );
}

function MessageBubble({
  message,
}: {
  message: DecryptedMessage & { content: string };
}) {
  const formatTime = (date: Date) =>
    date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div
      className={cn("flex", message.isOwn ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "max-w-[85%] sm:max-w-[70%] rounded-lg px-4 py-2",
          message.isOwn
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground",
        )}
      >
        {!message.isOwn && (
          <p className="text-xs font-medium opacity-75 mb-1">
            {message.senderName}
          </p>
        )}
        <p className="wrap-break-word whitespace-pre-wrap">{message.content}</p>
        <p
          className={cn(
            "text-xs mt-1",
            message.isOwn
              ? "text-primary-foreground/70"
              : "text-muted-foreground",
          )}
        >
          {formatTime(message.timestamp)}
        </p>
      </div>
    </div>
  );
}
