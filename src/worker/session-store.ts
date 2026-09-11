import type { Env } from "./types.js";

type EncryptedValue = { iv: string; ciphertext: string; updatedAt: string };
const ACTIVE_SESSION_KEY = "active-session";

export async function readUpdatedSession(env: Env): Promise<string | null> {
  const raw = await env.NLOBBY_SESSIONS.get(ACTIVE_SESSION_KEY);
  if (!raw) return null;
  try {
    const encrypted = JSON.parse(raw) as EncryptedValue;
    return decrypt(env.COOKIE_ENCRYPTION_KEY, encrypted);
  } catch {
    throw new Error("Stored N Lobby session could not be read. Update it again.");
  }
}

export async function saveUpdatedSession(env: Env, sessionToken: string): Promise<void> {
  const encrypted = await encrypt(env.COOKIE_ENCRYPTION_KEY, sessionToken);
  await env.NLOBBY_SESSIONS.put(ACTIVE_SESSION_KEY, JSON.stringify(encrypted));
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encrypt(secret: string, value: string): Promise<EncryptedValue> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(secret), new TextEncoder().encode(value));
  return { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)), updatedAt: new Date().toISOString() };
}

async function decrypt(secret: string, value: EncryptedValue): Promise<string> {
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(value.iv) }, await encryptionKey(secret), fromBase64(value.ciphertext));
  return new TextDecoder().decode(plaintext);
}

function toBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}
