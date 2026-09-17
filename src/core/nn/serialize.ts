/**
 * Weight (de)serialisation. Explicit little-endian so a model saved on one
 * machine loads identically on another, and hand-rolled base64 so the same code
 * runs in the browser, in a worker and under Node (no btoa/Buffer dependency).
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const LOOKUP = (() => {
  const t = new Uint8Array(128);
  for (let i = 0; i < ALPHABET.length; i++) t[ALPHABET.charCodeAt(i)] = i;
  return t;
})();

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += ALPHABET[(n >>> 18) & 63] + ALPHABET[(n >>> 12) & 63] + ALPHABET[(n >>> 6) & 63] + ALPHABET[n & 63];
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    out += ALPHABET[(n >>> 18) & 63] + ALPHABET[(n >>> 12) & 63] + '==';
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += ALPHABET[(n >>> 18) & 63] + ALPHABET[(n >>> 12) & 63] + ALPHABET[(n >>> 6) & 63] + '=';
  }
  return out;
}

export function base64ToBytes(b64: string): Uint8Array {
  let len = b64.length;
  while (len > 0 && b64[len - 1] === '=') len--;
  const byteLen = Math.floor((len * 3) / 4);
  const out = new Uint8Array(byteLen);
  let o = 0;
  for (let i = 0; i < len; i += 4) {
    const c0 = LOOKUP[b64.charCodeAt(i)];
    const c1 = LOOKUP[b64.charCodeAt(i + 1)];
    const c2 = i + 2 < len ? LOOKUP[b64.charCodeAt(i + 2)] : 0;
    const c3 = i + 3 < len ? LOOKUP[b64.charCodeAt(i + 3)] : 0;
    const n = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    if (o < byteLen) out[o++] = (n >>> 16) & 255;
    if (o < byteLen) out[o++] = (n >>> 8) & 255;
    if (o < byteLen) out[o++] = n & 255;
  }
  return out;
}

export function encodeWeights(w: Float32Array): string {
  const bytes = new Uint8Array(w.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < w.length; i++) view.setFloat32(i * 4, w[i], true);
  return bytesToBase64(bytes);
}

export function decodeWeights(b64: string): Float32Array {
  const bytes = base64ToBytes(b64);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(bytes.byteLength / 4);
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true);
  return out;
}
