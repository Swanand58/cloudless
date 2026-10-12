/**
 * File encryption pipeline: chunking, sealing, stream decryption, integrity.
 * Pure functions with no app imports, so they can be tested under plain Node.
 *
 * A sealed chunk is nonce (24 bytes) || XSalsa20-Poly1305 ciphertext.
 * The server stores sealed chunks and streams them back concatenated.
 */

import nacl from "tweetnacl";
// Default import: Node cannot see this CommonJS package's named exports
import naclUtil from "tweetnacl-util";

const { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } = naclUtil;

export const CHUNK_SIZE = 512 * 1024; // Must match the backend's chunk_size
export const MAX_FILE_SIZE = 50 * 1024 * 1024; // Must match max_file_size_mb

const NONCE_LENGTH = nacl.secretbox.nonceLength; // 24
const TAG_LENGTH = nacl.secretbox.overheadLength; // 16
const SEALED_CHUNK_SIZE = NONCE_LENGTH + CHUNK_SIZE + TAG_LENGTH;

const THUMB_PREFIX = "data:image/jpeg;base64,";

/** What the recipient needs to know about a file. Encrypted as one blob. */
export interface FileMeta {
  name: string;
  type: string;
  /** Hex SHA-256 of the original file, checked after decryption. */
  sha256: string;
  /** Small JPEG preview as a data URL, for images the sender could decode. */
  thumb?: string;
}

/** Encrypt bytes into nonce || ciphertext. */
export function seal(data: Uint8Array, key: Uint8Array): Uint8Array {
  const nonce = nacl.randomBytes(NONCE_LENGTH);
  const ciphertext = nacl.secretbox(data, nonce, key);
  const sealed = new Uint8Array(NONCE_LENGTH + ciphertext.length);
  sealed.set(nonce);
  sealed.set(ciphertext, NONCE_LENGTH);
  return sealed;
}

/** Decrypt nonce || ciphertext. Returns null if tampered or the key is wrong. */
export function open(sealed: Uint8Array, key: Uint8Array): Uint8Array | null {
  if (sealed.length < NONCE_LENGTH + TAG_LENGTH) return null;
  return nacl.secretbox.open(
    sealed.subarray(NONCE_LENGTH),
    sealed.subarray(0, NONCE_LENGTH),
    key
  );
}

/** Encrypt a file as a sequence of sealed chunks, read lazily. */
export async function* sealFile(
  file: Blob,
  key: Uint8Array
): AsyncGenerator<Uint8Array> {
  for (let start = 0; start < file.size; start += CHUNK_SIZE) {
    const chunk = await file.slice(start, start + CHUNK_SIZE).arrayBuffer();
    yield seal(new Uint8Array(chunk), key);
  }
}

/**
 * Decrypt a stream of concatenated sealed chunks as it arrives.
 * Network reads do not line up with chunk boundaries, so bytes are buffered
 * until a whole sealed chunk is available.
 */
export async function openStream(
  stream: AsyncIterable<Uint8Array>,
  key: Uint8Array,
  onProgress?: (bytesReceived: number) => void
): Promise<Uint8Array[]> {
  const plaintext: Uint8Array[] = [];
  let buffer = new Uint8Array(0);
  let received = 0;

  const openOrThrow = (sealed: Uint8Array) => {
    const chunk = open(sealed, key);
    if (!chunk) throw new Error("Decryption failed");
    plaintext.push(chunk);
  };

  for await (const part of stream) {
    received += part.length;
    onProgress?.(received);

    const joined = new Uint8Array(buffer.length + part.length);
    joined.set(buffer);
    joined.set(part, buffer.length);

    let offset = 0;
    while (joined.length - offset >= SEALED_CHUNK_SIZE) {
      openOrThrow(joined.subarray(offset, offset + SEALED_CHUNK_SIZE));
      offset += SEALED_CHUNK_SIZE;
    }
    buffer = joined.slice(offset);
  }

  // The last chunk is shorter unless the file is an exact multiple
  if (buffer.length > 0) openOrThrow(buffer);

  return plaintext;
}

/** Hex SHA-256 of a blob. */
export async function sha256Hex(data: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await data.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

/** Encrypt file metadata to a base64 string the server can store. */
export function sealMeta(meta: FileMeta, key: Uint8Array): string {
  return encodeBase64(seal(decodeUTF8(JSON.stringify(meta)), key));
}

/**
 * Decrypt and validate file metadata.
 * The content comes from the other person, so nothing in it is trusted:
 * a thumbnail that is not an inline JPEG is dropped rather than rendered.
 */
export function openMeta(sealed: string, key: Uint8Array): FileMeta | null {
  try {
    const bytes = open(decodeBase64(sealed), key);
    if (!bytes) return null;
    const meta = JSON.parse(encodeUTF8(bytes));
    if (
      typeof meta?.name !== "string" ||
      typeof meta.type !== "string" ||
      typeof meta.sha256 !== "string"
    ) {
      return null;
    }
    return {
      name: meta.name,
      type: meta.type,
      sha256: meta.sha256,
      thumb:
        typeof meta.thumb === "string" && meta.thumb.startsWith(THUMB_PREFIX)
          ? meta.thumb
          : undefined,
    };
  } catch {
    return null;
  }
}
