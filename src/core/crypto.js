// Password and PIN hashing with PBKDF2-SHA-256 (WebCrypto). Secrets are never stored;
// only a random salt and the derived hash are. Requires a secure context (https,
// localhost, or the desktop app's donut:// scheme).

const ITERATIONS = 310_000;
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function subtle() {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Secure passwords need a secure connection. Open DonutOS over https:// or from localhost.');
  }
  return crypto.subtle;
}

async function derive(secret, salt, iterations) {
  const key = await subtle().importKey('raw', new TextEncoder().encode(secret.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

/** Returns a storable record: { alg, iterations, salt, hash }. */
export async function hashSecret(secret, { iterations = ITERATIONS } = {}) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(secret, salt, iterations);
  return { alg: 'PBKDF2-SHA256', iterations, salt: b64(salt), hash: b64(hash) };
}

/** Constant-time comparison of `secret` against a stored record. */
export async function verifySecret(secret, record) {
  if (!record || record.alg !== 'PBKDF2-SHA256') return false;
  const expected = unb64(record.hash);
  const actual = await derive(secret, unb64(record.salt), record.iterations);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}
