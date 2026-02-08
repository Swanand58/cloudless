"use client";

import { formatFileSize, calculateProgress } from "@/lib/chunker";

export type TransferStatus = 
  | "pending"
  | "encrypting"
  | "uploading"
  | "ready"
  | "downloading"
  | "decrypting"
  | "completed"
  | "error"
  | "cancelled";

interface TransferProgressProps {
  filename: string;
  fileSize: number;
  status: TransferStatus;
  progress: number; // 0-100
  uploadedBytes?: number;
  error?: string;
  onCancel?: () => void;
  onDownload?: () => void;
}

export function TransferProgress({
  filename,
  fileSize,
  status,
  progress,
  uploadedBytes,
  error,
  onCancel,
  onDownload,
}: TransferProgressProps) {
  const getStatusText = () => {
    switch (status) {
      case "pending":
        return "Preparing...";
      case "encrypting":
        return "Encrypting...";
      case "uploading":
        return `Uploading... ${progress}%`;
      case "ready":
        return "Ready for download";
      case "downloading":
        return `Downloading... ${progress}%`;
      case "decrypting":
        return "Decrypting...";
      case "completed":
        return "Completed";
      case "error":
        return error || "Error";
      case "cancelled":
        return "Cancelled";
      default:
        return status;
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case "completed":
        return "text-green-600 dark:text-green-400";
      case "error":
      case "cancelled":
        return "text-red-600 dark:text-red-400";
      case "ready":
        return "text-blue-600 dark:text-blue-400";
      default:
        return "text-gray-600 dark:text-gray-400";
    }
  };

  const getProgressColor = () => {
    switch (status) {
      case "completed":
        return "bg-green-500";
      case "error":
      case "cancelled":
        return "bg-red-500";
      default:
        return "bg-blue-500";
    }
  };

  const isActive = ["encrypting", "uploading", "downloading", "decrypting"].includes(status);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center space-x-3 min-w-0 flex-1">
          {/* File icon */}
          <div className="flex-shrink-0">
            <svg
              className="h-8 w-8 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
              />
            </svg>
          </div>
          
          {/* File info */}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
              {filename}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {formatFileSize(fileSize)}
              {uploadedBytes !== undefined && uploadedBytes < fileSize && (
                <span> ({formatFileSize(uploadedBytes)} uploaded)</span>
              )}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex-shrink-0 flex items-center space-x-2">
          {status === "ready" && onDownload && (
            <button
              onClick={onDownload}
              className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
              title="Download"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </button>
          )}
          
          {isActive && onCancel && (
            <button
              onClick={onCancel}
              className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
              title="Cancel"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
          
          {status === "completed" && (
            <div className="p-2 text-green-600">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-3">
        <div className="flex justify-between text-sm mb-1">
          <span className={getStatusColor()}>{getStatusText()}</span>
          {isActive && <span className="text-gray-500">{progress}%</span>}
        </div>
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all duration-300 ${getProgressColor()}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Encryption badge */}
      <div className="mt-3 flex items-center text-xs text-gray-500 dark:text-gray-400">
        <svg className="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
        End-to-end encrypted
      </div>
    </div>
  );
}
