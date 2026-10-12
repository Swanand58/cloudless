"use client";

import { Progress } from "@/components/ui/progress";
import { FileIcon, Download, Loader2, Lock, AlertCircle } from "lucide-react";
import { cn, formatFileSize } from "@/lib/utils";

export type FileStatus = "preparing" | "uploading" | "ready" | "downloading" | "error";

interface FileBubbleProps {
  /** Undefined when the metadata could not be decrypted. */
  name?: string;
  /** JPEG preview as a data URL, for images. */
  thumb?: string;
  fileSize: number;
  senderName: string;
  timestamp: Date;
  isOwn: boolean;
  status: FileStatus;
  /** 0-100, while uploading or downloading. */
  progress?: number;
  onOpen?: () => void;
}

export function FileBubble({
  name,
  thumb,
  fileSize,
  senderName,
  timestamp,
  isOwn,
  status,
  progress = 0,
  onOpen,
}: FileBubbleProps) {
  const formatTime = (date: Date) =>
    date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const isActive = status === "preparing" || status === "uploading" || status === "downloading";
  const canOpen = status === "ready" && !!name && !!onOpen;

  const statusText: Record<FileStatus, string> = {
    preparing: "Encrypting...",
    uploading: `Uploading ${progress}%`,
    ready: "",
    downloading: `Downloading ${progress}%`,
    error: "Failed. Tap to retry",
  };

  const getFileExtension = (filename: string | undefined) => {
    if (!filename) return "FILE";
    const ext = filename.split(".").pop()?.toUpperCase();
    return ext && ext.length <= 5 ? ext : "FILE";
  };

  const mutedText = isOwn ? "text-primary-foreground/70" : "text-muted-foreground";

  return (
    <div className={cn("flex", isOwn ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] sm:max-w-[70%] rounded-lg overflow-hidden",
          isOwn ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
        )}
      >
        {/* Sender name for received files */}
        {!isOwn && (
          <p className="text-[11px] sm:text-xs font-medium opacity-75 px-2.5 sm:px-3 pt-1.5 sm:pt-2">{senderName}</p>
        )}

        <button
          type="button"
          className={cn(
            "block w-full text-left transition-opacity",
            canOpen || status === "error" ? "cursor-pointer hover:opacity-80" : "cursor-default",
            isActive && "opacity-90"
          )}
          disabled={!(canOpen || status === "error") || !onOpen}
          onClick={onOpen}
          aria-label={name ? `Open ${name}` : "Encrypted file"}
        >
          {thumb ? (
            /* Image preview. A data URL, so next/image has nothing to optimize. */
            <div className="relative p-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={thumb}
                alt={name || "Image"}
                className="block w-56 sm:w-64 max-h-80 object-cover rounded-md"
              />
              {isActive && (
                <div className="absolute inset-1 rounded-md bg-black/40 flex items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-white" />
                </div>
              )}
            </div>
          ) : (
            /* File card */
            <div className="flex items-center gap-2 sm:gap-3 p-2 sm:p-3">
              {/* File icon with extension badge */}
              <div className="relative shrink-0">
                <div
                  className={cn(
                    "w-10 h-10 sm:w-12 sm:h-12 rounded-lg flex items-center justify-center",
                    isOwn ? "bg-primary-foreground/20" : "bg-background/50"
                  )}
                >
                  <FileIcon
                    className={cn(
                      "h-5 w-5 sm:h-6 sm:w-6",
                      isOwn ? "text-primary-foreground" : "text-muted-foreground"
                    )}
                  />
                </div>
                <span
                  className={cn(
                    "absolute -bottom-1 left-1/2 -translate-x-1/2 text-[9px] sm:text-[10px] font-bold px-0.5 sm:px-1 rounded",
                    isOwn ? "bg-primary-foreground text-primary" : "bg-foreground text-background"
                  )}
                >
                  {getFileExtension(name)}
                </span>
              </div>

              {/* File info */}
              <div className="flex-1 min-w-0">
                <p className="text-xs sm:text-sm font-medium truncate">
                  {name || "Encrypted with a previous key"}
                </p>
                <p className={cn("text-[10px] sm:text-xs", mutedText)}>
                  {formatFileSize(fileSize)}
                </p>
              </div>

              {/* Action/Status indicator */}
              <div className="shrink-0">
                {isActive && <Loader2 className="h-5 w-5 animate-spin" />}
                {canOpen && <Download className="h-5 w-5" />}
                {status === "error" && <AlertCircle className="h-5 w-5 text-destructive" />}
              </div>
            </div>
          )}
        </button>

        {/* Progress bar for active transfers */}
        {(isActive || status === "error") && (
          <div className="px-2.5 sm:px-3 pb-1.5 sm:pb-2">
            {isActive && (
              <Progress
                value={progress}
                className={cn("h-1", isOwn ? "bg-primary-foreground/20" : "bg-muted-foreground/20")}
              />
            )}
            <p className={cn("text-[10px] sm:text-xs mt-0.5", mutedText)}>
              {statusText[status]}
            </p>
          </div>
        )}

        {/* Footer with size, time and encryption badge */}
        <div
          className={cn(
            "flex items-center justify-between gap-3 px-2.5 sm:px-3 pb-1.5 sm:pb-2 text-[10px] sm:text-xs",
            mutedText
          )}
        >
          <span className="flex items-center gap-0.5">
            <Lock className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
            {thumb ? formatFileSize(fileSize) : "E2E"}
          </span>
          <span>{formatTime(timestamp)}</span>
        </div>
      </div>
    </div>
  );
}
