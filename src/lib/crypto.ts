function getCrypto(): Crypto {
  if (typeof globalThis !== 'undefined' && globalThis.crypto) {
    return globalThis.crypto;
  }
  throw new Error('WebCrypto API indisponível neste ambiente.');
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function generateRandomTokenHex(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  getCrypto().getRandomValues(bytes);
  return toHex(bytes);
}

export async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hashBuf = await getCrypto().subtle.digest('SHA-256', encoded);
  return toHex(new Uint8Array(hashBuf));
}

async function derivePbkdf2Bits(secret: string, saltStr: string, bits = 256): Promise<ArrayBuffer> {
  const cryptoApi = getCrypto();
  const keyMaterial = await cryptoApi.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  return cryptoApi.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode(saltStr),
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    bits
  );
}

export async function hashPin(pin: string, existingSalt?: string): Promise<{ hash: string; salt: string }> {
  const salt = existingSalt || generateRandomTokenHex(16);
  const derived = await derivePbkdf2Bits(pin, salt, 256);
  return {
    hash: toHex(new Uint8Array(derived)),
    salt,
  };
}

export async function verifyPin(pin: string, salt: string, expectedHash: string): Promise<boolean> {
  if (!salt || !expectedHash) return false;
  const { hash } = await hashPin(pin, salt);
  if (hash.length !== expectedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) {
    diff |= hash.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  }
  return diff === 0;
}

async function deriveAesKey(tokenHex: string, last4: string): Promise<CryptoKey> {
  const cryptoApi = getCrypto();
  const keyMaterial = await cryptoApi.subtle.importKey(
    'raw',
    new TextEncoder().encode(`${tokenHex}:${last4}`),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return cryptoApi.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode(`caderneta-consulta:${tokenHex.slice(0, 16)}`),
      iterations: 50_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptPublicPayload(
  payloadJson: string,
  tokenHex: string,
  last4: string
): Promise<string> {
  const cryptoApi = getCrypto();
  const key = await deriveAesKey(tokenHex, last4);
  const iv = new Uint8Array(12);
  cryptoApi.getRandomValues(iv);
  const cipherBuf = await cryptoApi.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(payloadJson)
  );
  const cipherBytes = new Uint8Array(cipherBuf);
  const combined = new Uint8Array(iv.length + cipherBytes.length);
  combined.set(iv, 0);
  combined.set(cipherBytes, iv.length);
  return toBase64(combined);
}

export async function decryptPublicPayload(
  cipherB64: string,
  tokenHex: string,
  last4: string
): Promise<string> {
  const cryptoApi = getCrypto();
  const combined = fromBase64(cipherB64);
  const iv = combined.slice(0, 12);
  const cipherBytes = combined.slice(12);
  const key = await deriveAesKey(tokenHex, last4);
  const plainBuf = await cryptoApi.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    cipherBytes
  );
  return new TextDecoder().decode(plainBuf);
}
