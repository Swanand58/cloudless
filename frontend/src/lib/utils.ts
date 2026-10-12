import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Format file size for display. */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${units[i]}`;
}

/** Trigger a file download in the browser from an object URL. */
export function saveUrlAs(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

const THUMB_WIDTH = 256;
const MAX_THUMB_LENGTH = 100_000; // Characters of data URL; keeps metadata small

/**
 * Make a small JPEG preview of an image as a data URL.
 * Returns undefined for non-images and for formats this browser cannot
 * decode (e.g. HEIC outside Safari); the file is then shown without a preview.
 */
export async function makeThumbnail(file: File): Promise<string | undefined> {
  if (!file.type.startsWith("image/")) return undefined;

  try {
    const bitmap = await createImageBitmap(file, {
      resizeWidth: THUMB_WIDTH,
      resizeQuality: "medium",
    });
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d")!;
    // JPEG has no transparency; without this, clear areas turn black
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    bitmap.close();

    const thumb = canvas.toDataURL("image/jpeg", 0.7);
    return thumb.length <= MAX_THUMB_LENGTH ? thumb : undefined;
  } catch {
    return undefined;
  }
}
