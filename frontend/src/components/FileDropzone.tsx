"use client";

import { useCallback, useState } from "react";
import { formatFileSize } from "@/lib/chunker";

interface FileDropzoneProps {
  onFileSelect: (file: File) => void;
  maxSize?: number; // in bytes
  disabled?: boolean;
}

export function FileDropzone({
  onFileSelect,
  maxSize = 1024 * 1024 * 1024, // 1GB default
  disabled = false,
}: FileDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) {
      setIsDragging(true);
    }
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      if (disabled) return;

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        const file = files[0];
        if (file.size > maxSize) {
          setError(`File too large. Maximum size is ${formatFileSize(maxSize)}`);
          return;
        }
        setError(null);
        onFileSelect(file);
      }
    },
    [disabled, maxSize, onFileSelect]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        const file = files[0];
        if (file.size > maxSize) {
          setError(`File too large. Maximum size is ${formatFileSize(maxSize)}`);
          return;
        }
        setError(null);
        onFileSelect(file);
      }
      // Reset input
      e.target.value = "";
    },
    [maxSize, onFileSelect]
  );

  return (
    <div className="w-full">
      <div
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={`
          relative border-2 border-dashed rounded-lg p-8 text-center
          transition-colors duration-200 cursor-pointer
          ${isDragging 
            ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" 
            : "border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500"
          }
          ${disabled ? "opacity-50 cursor-not-allowed" : ""}
        `}
      >
        <input
          type="file"
          onChange={handleFileInput}
          disabled={disabled}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
        />
        
        <div className="space-y-2">
          <svg
            className="mx-auto h-12 w-12 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
          
          <div className="text-gray-600 dark:text-gray-300">
            <span className="font-medium text-blue-600 dark:text-blue-400">
              Click to upload
            </span>{" "}
            or drag and drop
          </div>
          
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Max file size: {formatFileSize(maxSize)}
          </p>
        </div>
      </div>
      
      {error && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
