"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useRoomStore, DecryptedMessage, getPeer } from "@/store/room";
import { api, TransferResponse } from "@/lib/api";
import {
  CHUNK_SIZE,
  MAX_FILE_SIZE,
  FileMeta,
  sealFile,
  openStream,
  sha256Hex,
  sealMeta,
  openMeta,
} from "@/lib/filecrypt";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Lock, MessageCircle, Send, Paperclip, Download, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { cn, formatFileSize, makeThumbnail, saveUrlAs } from "@/lib/utils";
import { FileBubble, FileStatus } from "./FileBubble";

/** Formats every browser can show in an <img>. Anything else is saved to disk. */
const VIEWABLE_IMAGE = /^image\/(jpeg|png|gif|webp|avif|bmp)$/;

/** A file being uploaded from this browser; not on the server's list yet. */
interface Upload {
  id: string;
  name: string;
  thumb?: string;
  fileSize: number;
  timestamp: Date;
  status: FileStatus;
  progress: number;
}

interface DownloadState {
  status: FileStatus;
  progress: number;
}

type TimelineItem =
  | { kind: "text"; key: string; timestamp: Date; message: DecryptedMessage }
  | { kind: "upload"; key: string; timestamp: Date; upload: Upload }
  | { kind: "transfer"; key: string; timestamp: Date; transfer: TransferResponse; meta: FileMeta | null };

interface ChatWindowProps {
  className?: string;
}

export function ChatWindow({ className = "" }: ChatWindowProps) {
  const [message, setMessage] = useState("");
  const [uploads, setUploads] = useState<Record<string, Upload>>({});
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({});
  const [viewer, setViewer] = useState<{ url: string; name: string } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadCounter = useRef(0);
  // Decrypted files opened this visit: transferId -> object URL.
  // ponytail: never evicted while the room is open. Cap it if people start
  // paging through dozens of 50 MB images in one sitting.
  const objectUrls = useRef(new Map<string, string>());

  const {
    messages,
    transfers,
    typingUsers,
    sendMessage,
    setTyping,
    currentRoom,
    myUserId,
    sharedSecret,
    peerKeyChanged,
    acceptPeerKey,
    loadTransfers,
  } = useRoomStore();

  const peer = getPeer(currentRoom, myUserId);

  // Release decrypted files when leaving the room
  useEffect(() => {
    const urls = objectUrls.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  // Decrypt file metadata whenever transfers or the key change
  const metas = useMemo(() => {
    const result = new Map<string, FileMeta | null>();
    for (const transfer of transfers) {
      result.set(
        transfer.id,
        sharedSecret ? openMeta(transfer.encrypted_meta, sharedSecret) : null
      );
    }
    return result;
  }, [transfers, sharedSecret]);

  // Messages, finished transfers and running uploads as one timeline
  const timeline = useMemo(() => {
    const items: TimelineItem[] = [
      ...messages.map((m) => ({
        kind: "text" as const,
        key: m.id,
        timestamp: m.timestamp,
        message: m,
      })),
      ...transfers.map((t) => ({
        kind: "transfer" as const,
        key: `transfer-${t.id}`,
        timestamp: new Date(t.created_at),
        transfer: t,
        meta: metas.get(t.id) ?? null,
      })),
      ...Object.values(uploads).map((u) => ({
        kind: "upload" as const,
        key: u.id,
        timestamp: u.timestamp,
        upload: u,
      })),
    ];
    // Sort by timestamp ascending (oldest first, newest at bottom)
    return items.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }, [messages, transfers, metas, uploads]);

  useEffect(() => {
    // Small delay to allow DOM to render new items before scrolling
    const timer = setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 50);
    return () => clearTimeout(timer);
  }, [timeline.length]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = message.trim();
    if (!text) return;

    if (sendMessage(text)) {
      setMessage("");
      setTyping(false);
    } else {
      toast.error("Not connected. Trying to reconnect...");
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMessage(e.target.value);
    setTyping(true);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => setTyping(false), 2000);
  };

  const uploadFile = useCallback(
    async (file: File, roomId: string, key: Uint8Array) => {
      if (file.size === 0) {
        toast.error(`${file.name} is empty`);
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`${file.name} is over the ${formatFileSize(MAX_FILE_SIZE)} limit`);
        return;
      }

      const id = `upload-${++uploadCounter.current}`;
      const update = (changes: Partial<Upload>) =>
        setUploads((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], ...changes } } : prev));
      const remove = () =>
        setUploads((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });

      setUploads((prev) => ({
        ...prev,
        [id]: {
          id,
          name: file.name,
          fileSize: file.size,
          timestamp: new Date(),
          status: "preparing",
          progress: 0,
        },
      }));

      let transferId: string | null = null;
      try {
        const [sha256, thumb] = await Promise.all([sha256Hex(file), makeThumbnail(file)]);
        update({ thumb });

        const meta: FileMeta = {
          name: file.name,
          type: file.type || "application/octet-stream",
          sha256,
          thumb,
        };
        const transfer = await api.initTransfer(roomId, sealMeta(meta, key), file.size);
        transferId = transfer.id;
        update({ status: "uploading" });

        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        let index = 0;
        for await (const sealed of sealFile(file, key)) {
          await api.uploadChunk(transfer.id, index++, sealed);
          update({ progress: Math.round((index / totalChunks) * 100) });
        }

        // The finished transfer now comes from the server's list
        await loadTransfers();
      } catch (err) {
        toast.error(
          `Could not send ${file.name}: ${err instanceof Error ? err.message : "upload failed"}`
        );
        // Do not leave a half-uploaded file on the server
        if (transferId) api.cancelTransfer(transferId).catch(() => {});
      } finally {
        remove();
      }
    },
    [loadTransfers]
  );

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // Allow picking the same file again
    if (!currentRoom || !sharedSecret) return;

    // One at a time: steadier progress and memory than uploading in parallel
    for (const file of files) {
      await uploadFile(file, currentRoom.id, sharedSecret);
    }
  };

  const show = (url: string, meta: FileMeta) => {
    if (VIEWABLE_IMAGE.test(meta.type)) {
      setViewer({ url, name: meta.name });
    } else {
      saveUrlAs(url, meta.name);
    }
  };

  const openTransfer = async (transfer: TransferResponse, meta: FileMeta) => {
    if (!sharedSecret || downloads[transfer.id]?.status === "downloading") return;

    const cached = objectUrls.current.get(transfer.id);
    if (cached) {
      show(cached, meta);
      return;
    }

    const setState = (state: DownloadState | null) =>
      setDownloads((prev) => {
        const next = { ...prev };
        if (state) next[transfer.id] = state;
        else delete next[transfer.id];
        return next;
      });

    setState({ status: "downloading", progress: 0 });
    try {
      const { stream, totalBytes } = await api.downloadFile(transfer.id);

      let lastPercent = 0;
      const chunks = await openStream(stream, sharedSecret, (received) => {
        const percent = totalBytes ? Math.floor((received / totalBytes) * 100) : 0;
        // Network reads arrive far more often than the bar needs to move
        if (percent !== lastPercent) {
          lastPercent = percent;
          setState({ status: "downloading", progress: percent });
        }
      });

      // The type comes from the sender; only trust it for formats we display
      const blob = new Blob(chunks as BlobPart[], {
        type: VIEWABLE_IMAGE.test(meta.type) ? meta.type : "application/octet-stream",
      });
      if ((await sha256Hex(blob)) !== meta.sha256) {
        throw new Error("File failed its integrity check");
      }

      const url = URL.createObjectURL(blob);
      objectUrls.current.set(transfer.id, url);
      setState(null);
      show(url, meta);
    } catch (err) {
      setState({ status: "error", progress: 0 });
      toast.error(
        `Could not open ${meta.name}: ${err instanceof Error ? err.message : "download failed"}`
      );
    }
  };

  const typingNames = Array.from(typingUsers.values());
  const canSend = !!sharedSecret;

  const renderItem = (item: TimelineItem) => {
    if (item.kind === "text") {
      return <MessageBubble key={item.key} message={item.message} />;
    }

    if (item.kind === "upload") {
      const { upload } = item;
      return (
        <FileBubble
          key={item.key}
          name={upload.name}
          thumb={upload.thumb}
          fileSize={upload.fileSize}
          senderName=""
          timestamp={upload.timestamp}
          isOwn
          status={upload.status}
          progress={upload.progress}
        />
      );
    }

    const { transfer, meta } = item;
    const download = downloads[transfer.id];
    return (
      <FileBubble
        key={item.key}
        name={meta?.name}
        thumb={meta?.thumb}
        fileSize={transfer.file_size}
        senderName={transfer.sender_name}
        timestamp={item.timestamp}
        isOwn={transfer.sender_id === myUserId}
        status={download?.status ?? "ready"}
        progress={download?.progress}
        onOpen={meta ? () => openTransfer(transfer, meta) : undefined}
      />
    );
  };

  return (
    <Card className={cn("flex flex-col", className)}>
      {/* Header */}
      <div className="px-3 sm:px-4 py-2 sm:py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-1.5 sm:gap-2">
          <MessageCircle className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" />
          <span className="font-medium text-foreground text-xs sm:text-sm">
            {peer ? peer.display_name : "Encrypted Chat"}
          </span>
          <span className="text-[10px] sm:text-xs text-green-600 dark:text-green-400 flex items-center gap-0.5 ml-1">
            <Lock className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
            E2E
          </span>
        </div>
      </div>

      {/* The other person's key is not the one we saw before */}
      {peerKeyChanged && peer && (
        <Alert variant="destructive" className="mx-2 sm:mx-4 mt-3 w-auto">
          <ShieldAlert className="h-4 w-4" />
          <AlertDescription className="space-y-2">
            <p>
              {peer.display_name}&apos;s security key has changed. This happens when
              someone clears their browser or switches device, and older messages
              and files may no longer open. Verify their identity before sending
              anything sensitive.
            </p>
            <Button variant="outline" size="sm" onClick={acceptPeerKey}>
              Continue with the new key
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-2 sm:p-4 space-y-3 sm:space-y-4">
        {timeline.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            <MessageCircle className="h-10 w-10 sm:h-12 sm:w-12 mx-auto mb-2 opacity-40" />
            <p className="text-sm sm:text-base">No messages yet</p>
            <p className="text-xs sm:text-sm">Send a message or a photo</p>
          </div>
        ) : (
          timeline.map(renderItem)
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Typing indicator */}
      {typingNames.length > 0 && (
        <div className="px-4 py-1 text-sm text-muted-foreground shrink-0">
          {typingNames.join(", ")} {typingNames.length === 1 ? "is" : "are"} typing...
        </div>
      )}

      {/* Peer warning */}
      {!canSend && (
        <div className="px-4 py-2 text-sm text-yellow-600 dark:text-yellow-400 bg-yellow-500/10 shrink-0">
          Waiting for the other person to join. Share the room code with them.
        </div>
      )}

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="p-2 sm:p-3 border-t border-border shrink-0 safe-bottom"
      >
        <div className="flex gap-1.5 sm:gap-2 items-center">
          {/* Attachment button */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            disabled={!canSend}
            className="shrink-0"
            aria-label="Attach photos or files"
          >
            <Paperclip className="h-5 w-5" />
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />

          {/* Text input */}
          <Input
            value={message}
            onChange={handleInputChange}
            placeholder="Type a message..."
            disabled={!canSend}
            maxLength={4000}
            className="flex-1"
          />

          {/* Send button */}
          <Button
            type="submit"
            size="icon"
            disabled={!canSend || !message.trim()}
            className="shrink-0"
            aria-label="Send message"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </form>

      {/* Full-size image viewer */}
      <Dialog open={!!viewer} onOpenChange={(open) => !open && setViewer(null)}>
        <DialogContent className="sm:max-w-4xl p-3 gap-3">
          <DialogTitle className="truncate pr-8 text-sm">{viewer?.name}</DialogTitle>
          {viewer && (
            <>
              {/* A local blob URL: next/image cannot load or optimize it */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={viewer.url}
                alt={viewer.name}
                className="max-h-[75dvh] w-full object-contain rounded-md"
              />
              <Button
                variant="secondary"
                className="w-full sm:w-auto sm:ml-auto"
                onClick={() => saveUrlAs(viewer.url, viewer.name)}
              >
                <Download className="h-4 w-4 mr-1.5" />
                Save
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function MessageBubble({ message }: { message: DecryptedMessage }) {
  const formatTime = (date: Date) =>
    date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div
      className={cn("flex", message.isOwn ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "max-w-[80%] sm:max-w-[70%] rounded-lg px-3 py-1.5 sm:px-4 sm:py-2",
          message.isOwn
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground",
        )}
      >
        {!message.isOwn && (
          <p className="text-[11px] sm:text-xs font-medium opacity-75 mb-0.5">
            {message.senderName}
          </p>
        )}
        {message.unreadable ? (
          <p className="text-sm italic opacity-75">Encrypted with a previous key</p>
        ) : (
          <p className="wrap-break-word whitespace-pre-wrap text-sm sm:text-base">{message.content}</p>
        )}
        <p
          className={cn(
            "text-[10px] sm:text-xs mt-0.5",
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
