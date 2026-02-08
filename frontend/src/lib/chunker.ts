/**
 * File chunking utilities for large file transfers.
 */

export const CHUNK_SIZE = 64 * 1024; // 64KB chunks

export interface FileChunk {
  index: number;
  data: Uint8Array;
  isLast: boolean;
}

/**
 * Read a file as chunks (generator function).
 */
export async function* readFileChunks(
  file: File,
  chunkSize: number = CHUNK_SIZE
): AsyncGenerator<FileChunk> {
  const totalChunks = Math.ceil(file.size / chunkSize);

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const blob = file.slice(start, end);
    const arrayBuffer = await blob.arrayBuffer();

    yield {
      index: i,
      data: new Uint8Array(arrayBuffer),
      isLast: i === totalChunks - 1,
    };
  }
}

/**
 * Combine chunks back into a single Uint8Array.
 */
export function combineChunks(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);

  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

/**
 * Create a downloadable blob from data.
 */
export function createDownloadBlob(data: Uint8Array, mimeType: string = "application/octet-stream"): Blob {
  // Copy to a new ArrayBuffer to ensure compatibility
  const buffer = new ArrayBuffer(data.length);
  new Uint8Array(buffer).set(data);
  return new Blob([buffer], { type: mimeType });
}

/**
 * Trigger a file download in the browser.
 */
export function downloadFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Format file size for display.
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${units[i]}`;
}

/**
 * Calculate transfer progress percentage.
 */
export function calculateProgress(uploaded: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((uploaded / total) * 100);
}

/**
 * Estimate remaining time based on progress and elapsed time.
 */
export function estimateRemainingTime(
  bytesTransferred: number,
  totalBytes: number,
  elapsedMs: number
): string {
  if (bytesTransferred === 0 || elapsedMs === 0) return "Calculating...";

  const bytesPerMs = bytesTransferred / elapsedMs;
  const remainingBytes = totalBytes - bytesTransferred;
  const remainingMs = remainingBytes / bytesPerMs;

  const seconds = Math.ceil(remainingMs / 1000);

  if (seconds < 60) {
    return `${seconds}s remaining`;
  } else if (seconds < 3600) {
    const minutes = Math.ceil(seconds / 60);
    return `${minutes}m remaining`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.ceil((seconds % 3600) / 60);
    return `${hours}h ${minutes}m remaining`;
  }
}

/**
 * Protocol message types for P2P transfer.
 */
export enum P2PMessageType {
  FILE_OFFER = 1,
  FILE_ACCEPT = 2,
  FILE_REJECT = 3,
  FILE_CHUNK = 4,
  FILE_COMPLETE = 5,
  FILE_ERROR = 6,
}

/**
 * Create a P2P file offer message.
 */
export function createFileOffer(
  transferId: string,
  encryptedFilename: string,
  fileSize: number,
  totalChunks: number,
  nonce: string
): Uint8Array {
  const payload = JSON.stringify({
    type: P2PMessageType.FILE_OFFER,
    transferId,
    encryptedFilename,
    fileSize,
    totalChunks,
    nonce,
  });
  return new TextEncoder().encode(payload);
}

/**
 * Create a P2P file chunk message.
 */
export function createFileChunkMessage(
  transferId: string,
  chunkIndex: number,
  data: Uint8Array,
  nonce: Uint8Array
): Uint8Array {
  // Header: type (1 byte) + transferId length (1 byte) + transferId + chunkIndex (4 bytes) + nonce (24 bytes)
  // Followed by chunk data
  const transferIdBytes = new TextEncoder().encode(transferId);
  const header = new Uint8Array(1 + 1 + transferIdBytes.length + 4 + 24);

  let offset = 0;
  header[offset++] = P2PMessageType.FILE_CHUNK;
  header[offset++] = transferIdBytes.length;
  header.set(transferIdBytes, offset);
  offset += transferIdBytes.length;

  // Chunk index (big-endian)
  header[offset++] = (chunkIndex >> 24) & 0xff;
  header[offset++] = (chunkIndex >> 16) & 0xff;
  header[offset++] = (chunkIndex >> 8) & 0xff;
  header[offset++] = chunkIndex & 0xff;

  // Nonce
  header.set(nonce, offset);

  // Combine header and data
  const message = new Uint8Array(header.length + data.length);
  message.set(header);
  message.set(data, header.length);

  return message;
}

/**
 * Parse a P2P message.
 */
export function parseP2PMessage(data: Uint8Array): {
  type: P2PMessageType;
  payload: unknown;
} | null {
  if (data.length === 0) return null;

  const type = data[0] as P2PMessageType;

  if (type === P2PMessageType.FILE_CHUNK) {
    // Parse binary chunk message
    let offset = 1;
    const transferIdLength = data[offset++];
    const transferId = new TextDecoder().decode(
      data.slice(offset, offset + transferIdLength)
    );
    offset += transferIdLength;

    const chunkIndex =
      (data[offset] << 24) |
      (data[offset + 1] << 16) |
      (data[offset + 2] << 8) |
      data[offset + 3];
    offset += 4;

    const nonce = data.slice(offset, offset + 24);
    offset += 24;

    const chunkData = data.slice(offset);

    return {
      type,
      payload: { transferId, chunkIndex, nonce, data: chunkData },
    };
  } else {
    // Parse JSON message
    try {
      const json = new TextDecoder().decode(data);
      const parsed = JSON.parse(json);
      return { type: parsed.type, payload: parsed };
    } catch {
      return null;
    }
  }
}
