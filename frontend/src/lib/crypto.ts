/**
 * Client-side cryptographic utilities using TweetNaCl.
 * All encryption/decryption happens in the browser - server never sees plaintext.
 */

import nacl from "tweetnacl";
import { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } from "tweetnacl-util";

export interface KeyPair {
  publicKey: string; // Base64 encoded
  secretKey: string; // Base64 encoded
}

export interface EncryptedData {
  ciphertext: string; // Base64 encoded
  nonce: string; // Base64 encoded
}

/**
 * Generate a new X25519 key pair for key exchange.
 */
export function generateKeyPair(): KeyPair {
  const keyPair = nacl.box.keyPair();
  return {
    publicKey: encodeBase64(keyPair.publicKey),
    secretKey: encodeBase64(keyPair.secretKey),
  };
}

/**
 * Derive a shared secret from our secret key and peer's public key.
 * Uses X25519 Elliptic Curve Diffie-Hellman.
 */
export function deriveSharedSecret(
  ourSecretKey: string,
  theirPublicKey: string
): Uint8Array {
  const secretKey = decodeBase64(ourSecretKey);
  const publicKey = decodeBase64(theirPublicKey);
  return nacl.box.before(publicKey, secretKey);
}

/**
 * Encrypt a message using XSalsa20-Poly1305 with a shared secret.
 * Note: TweetNaCl uses XSalsa20 (24-byte nonce) which is similar to XChaCha20.
 */
export function encryptMessage(
  message: string,
  sharedSecret: Uint8Array
): EncryptedData {
  const messageBytes = decodeUTF8(message);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const ciphertext = nacl.secretbox(messageBytes, nonce, sharedSecret);

  return {
    ciphertext: encodeBase64(ciphertext),
    nonce: encodeBase64(nonce),
  };
}

/**
 * Decrypt a message using XSalsa20-Poly1305 with a shared secret.
 */
export function decryptMessage(
  encrypted: EncryptedData,
  sharedSecret: Uint8Array
): string | null {
  const ciphertext = decodeBase64(encrypted.ciphertext);
  const nonce = decodeBase64(encrypted.nonce);
  const decrypted = nacl.secretbox.open(ciphertext, nonce, sharedSecret);

  if (!decrypted) {
    return null; // Decryption failed (tampered or wrong key)
  }

  return encodeUTF8(decrypted);
}

/**
 * Encrypt binary data (e.g., file chunks) using XSalsa20-Poly1305.
 */
export function encryptData(
  data: Uint8Array,
  sharedSecret: Uint8Array
): { ciphertext: Uint8Array; nonce: Uint8Array } {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const ciphertext = nacl.secretbox(data, nonce, sharedSecret);

  return { ciphertext, nonce };
}

/**
 * Decrypt binary data using XSalsa20-Poly1305.
 */
export function decryptData(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  sharedSecret: Uint8Array
): Uint8Array | null {
  return nacl.secretbox.open(ciphertext, nonce, sharedSecret);
}

/**
 * Encrypt a file in chunks for streaming upload.
 * Returns an async generator that yields encrypted chunks.
 */
export async function* encryptFileChunks(
  file: File,
  sharedSecret: Uint8Array,
  chunkSize: number = 64 * 1024 // 64KB chunks
): AsyncGenerator<{ chunk: Uint8Array; nonce: Uint8Array; index: number }> {
  const totalChunks = Math.ceil(file.size / chunkSize);

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const blob = file.slice(start, end);
    const arrayBuffer = await blob.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    const { ciphertext, nonce } = encryptData(data, sharedSecret);
    yield { chunk: ciphertext, nonce, index: i };
  }
}

/**
 * Decrypt file chunks and reconstruct the file.
 */
export async function decryptFileChunks(
  chunks: { data: Uint8Array; nonce: Uint8Array }[],
  sharedSecret: Uint8Array
): Promise<Uint8Array | null> {
  const decryptedChunks: Uint8Array[] = [];

  for (const { data, nonce } of chunks) {
    const decrypted = decryptData(data, nonce, sharedSecret);
    if (!decrypted) {
      return null; // Decryption failed
    }
    decryptedChunks.push(decrypted);
  }

  // Combine all chunks
  const totalLength = decryptedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of decryptedChunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

/**
 * Generate a safety number from two public keys for verification.
 * Both parties will compute the same number.
 */
export async function generateSafetyNumber(
  publicKeyA: string,
  publicKeyB: string
): Promise<string> {
  // Sort keys for consistent ordering
  const keys = [publicKeyA, publicKeyB].sort();
  const combined = keys.join("");

  // Hash using Web Crypto API (SHA-256)
  const encoder = new TextEncoder();
  const data = encoder.encode(combined);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);

  // Convert to 60-digit safety number (12 groups of 5 digits)
  let safetyNumber = "";
  for (let i = 0; i < 30; i += 5) {
    // Take 5 bytes and convert to number
    let num = 0;
    for (let j = 0; j < 5; j++) {
      num = (num * 256) + hashArray[i + j];
    }
    safetyNumber += String(num % 100000).padStart(5, "0");
  }

  // Format as groups of 5
  return safetyNumber.match(/.{5}/g)?.join(" ") || safetyNumber;
}

/**
 * Generate emoji fingerprint for visual verification.
 */
export async function generateEmojiFingerprint(publicKey: string): Promise<string[]> {
  const emojis = [
    "🔐", "🔑", "🛡️", "⚡", "🌟", "🎯", "🚀", "💎",
    "🔮", "🌈", "🎪", "🎭", "🎨", "🎸", "🎺", "🎻",
    "🌺", "🌸", "🌼", "🌻", "🍀", "🌴", "🌵", "🎄",
    "🦊", "🦁", "🐯", "🦄", "🐲", "🦅", "🦋", "🐙",
  ];

  const keyBytes = decodeBase64(publicKey);
  // Convert to ArrayBuffer for Web Crypto API compatibility
  const buffer = new ArrayBuffer(keyBytes.length);
  new Uint8Array(buffer).set(keyBytes);
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = new Uint8Array(hashBuffer);

  const fingerprint: string[] = [];
  for (let i = 0; i < 8; i++) {
    fingerprint.push(emojis[hashArray[i] % emojis.length]);
  }

  return fingerprint;
}

/**
 * Encrypt filename for transfer (server should not know file names).
 */
export function encryptFilename(
  filename: string,
  sharedSecret: Uint8Array
): EncryptedData {
  return encryptMessage(filename, sharedSecret);
}

/**
 * Decrypt filename after transfer.
 */
export function decryptFilename(
  encrypted: EncryptedData,
  sharedSecret: Uint8Array
): string | null {
  return decryptMessage(encrypted, sharedSecret);
}
