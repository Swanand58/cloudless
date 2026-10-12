// Run with: npm test
import test from "node:test";
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import {
  CHUNK_SIZE,
  sealFile,
  openStream,
  sha256Hex,
  sealMeta,
  openMeta,
} from "./filecrypt.ts";

const key = nacl.randomBytes(32);

// Two full chunks and a short one, like a real upload
// (filled in slices: randomBytes refuses more than 64KB per call)
const original = new Uint8Array(CHUNK_SIZE * 2 + 1234);
for (let i = 0; i < original.length; i += 65536) {
  original.set(nacl.randomBytes(Math.min(65536, original.length - i)), i);
}

async function sealAll() {
  const sealed = [];
  for await (const chunk of sealFile(new Blob([original]), key)) sealed.push(chunk);
  return sealed;
}

/** Re-split bytes at arbitrary boundaries, as a network stream would. */
async function* inPieces(chunks, pieceSize) {
  const all = new Uint8Array(await new Blob(chunks).arrayBuffer());
  for (let i = 0; i < all.length; i += pieceSize) yield all.subarray(i, i + pieceSize);
}

test("file survives seal, re-split and open", async () => {
  const sealed = await sealAll();
  assert.equal(sealed.length, 3);

  for (const pieceSize of [1000, 65536, CHUNK_SIZE + 40, 10_000_000]) {
    const plain = await openStream(inPieces(sealed, pieceSize), key);
    assert.equal(await sha256Hex(new Blob(plain)), await sha256Hex(new Blob([original])));
  }
});

test("reordered chunks decrypt but fail the hash check", async () => {
  const [a, b, c] = await sealAll();
  const plain = await openStream(inPieces([b, a, c], 65536), key);
  assert.notEqual(await sha256Hex(new Blob(plain)), await sha256Hex(new Blob([original])));
});

test("tampering and wrong keys are rejected", async () => {
  const sealed = await sealAll();
  await assert.rejects(openStream(inPieces(sealed, 65536), nacl.randomBytes(32)));

  sealed[1][100] ^= 1;
  await assert.rejects(openStream(inPieces(sealed, 65536), key));
});

test("metadata round trip drops untrusted thumbnails", () => {
  const meta = { name: "cat.jpg", type: "image/jpeg", sha256: "ab" };
  const thumb = "data:image/jpeg;base64,AAAA";

  assert.deepEqual(openMeta(sealMeta({ ...meta, thumb }, key), key), { ...meta, thumb });
  assert.equal(openMeta(sealMeta({ ...meta, thumb: "https://evil.example/x.jpg" }, key), key).thumb, undefined);
  assert.equal(openMeta(sealMeta(meta, key), nacl.randomBytes(32)), null);
  assert.equal(openMeta("not base64!", key), null);
});
