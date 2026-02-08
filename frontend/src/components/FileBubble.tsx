"use client";

import { formatFileSize } from "@/lib/chunker";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { FileIcon, Download, Check, Loader2, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatItem, FileTransferStatus } from "@/store/room";

interface FileBubbleProps {
  item: ChatItem;
  onDownload?: (transferId: string) => void;
  activeStatus?: FileTransferStatus;
  activeProgress?: number;
}

export function FileBubble({ item, onDownload, activeStatus, activeProgress }: FileBubbleProps) {
  const formatTime = (date: Date) =>
    date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  // Use active status if provided (for ongoing transfers), otherwise use item status
  const status = activeStatus || item.status || "ready";
  const progress = activeProgress ?? (status === "completed" ? 100 : 0);

  const isActive = ["encrypting", "uploading", "downloading", "decrypting"].includes(status);
  const isReady = status === "ready";
  const isCompleted = status === "completed";

  const statusText: Record<string, string> = {
    encrypting: "Encrypting...",
    uploading: `Uploading ${progress}%`,
    ready: "Tap to download",
    downloading: `Downloading ${progress}%`,
    decrypting: "Decrypting...",
    completed: "Downloaded",
    error: "Failed",
  };

  const getFileExtension = (filename: string | undefined) => {
    if (!filename) return "FILE";
    const ext = filename.split(".").pop()?.toUpperCase();
    return ext && ext.length <= 5 ? ext : "FILE";
  };

  return (
    <div className={cn("flex", item.isOwn ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] sm:max-w-[70%] rounded-lg overflow-hidden",
          item.isOwn ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
        )}
      >
        {/* Sender name for received files */}
        {!item.isOwn && (
          <p className="text-xs font-medium opacity-75 px-3 pt-2">{item.senderName}</p>
        )}

        {/* File card */}
        <div
          className={cn(
            "flex items-center gap-3 p-3 cursor-pointer transition-opacity",
            isReady && !item.isOwn && "hover:opacity-80",
            isActive && "opacity-90"
          )}
          onClick={() => {
            if (isReady && !item.isOwn && onDownload && item.transferId) {
              onDownload(item.transferId);
            }
          }}
        >
          {/* File icon with extension badge */}
          <div className="relative shrink-0">
            <div
              className={cn(
                "w-12 h-12 rounded-lg flex items-center justify-center",
                item.isOwn ? "bg-primary-foreground/20" : "bg-background/50"
              )}
            >
              <FileIcon
                className={cn(
                  "h-6 w-6",
                  item.isOwn ? "text-primary-foreground" : "text-muted-foreground"
                )}
              />
            </div>
            <span
              className={cn(
                "absolute -bottom-1 left-1/2 -translate-x-1/2 text-[10px] font-bold px-1 rounded",
                item.isOwn ? "bg-primary-foreground text-primary" : "bg-foreground text-background"
              )}
            >
              {getFileExtension(item.filename)}
            </span>
          </div>

          {/* File info */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              {item.filename || "Encrypted file"}
            </p>
            <p
              className={cn(
                "text-xs",
                item.isOwn ? "text-primary-foreground/70" : "text-muted-foreground"
              )}
            >
              {formatFileSize(item.fileSize || 0)}
            </p>
          </div>

          {/* Action/Status indicator */}
          <div className="shrink-0">
            {isActive && (
              <Loader2
                className={cn(
                  "h-5 w-5 animate-spin",
                  item.isOwn ? "text-primary-foreground" : "text-muted-foreground"
                )}
              />
            )}
            {isReady && !item.isOwn && (
              <Download
                className={cn(
                  "h-5 w-5",
                  item.isOwn ? "text-primary-foreground" : "text-primary"
                )}
              />
            )}
            {isCompleted && <Check className="h-5 w-5 text-green-500" />}
            {item.isOwn && isReady && <Check className="h-5 w-5 text-green-400" />}
          </div>
        </div>

        {/* Progress bar for active transfers */}
        {isActive && (
          <div className="px-3 pb-2">
            <Progress
              value={progress}
              className={cn("h-1", item.isOwn ? "bg-primary-foreground/20" : "bg-muted-foreground/20")}
            />
            <p
              className={cn(
                "text-xs mt-1",
                item.isOwn ? "text-primary-foreground/70" : "text-muted-foreground"
              )}
            >
              {statusText[status]}
            </p>
          </div>
        )}

        {/* Footer with time and encryption badge */}
        <div
          className={cn(
            "flex items-center justify-between px-3 pb-2 text-xs",
            item.isOwn ? "text-primary-foreground/70" : "text-muted-foreground"
          )}
        >
          <span className="flex items-center gap-1">
            <Lock className="h-3 w-3" />
            E2E
          </span>
          <span>{formatTime(item.timestamp)}</span>
        </div>
      </div>
    </div>
  );
}
