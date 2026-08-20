const VERSION = "v1";

function base64Encode(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

function base64Decode(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function vaultKey() {
  const source = process.env.CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (!source || source.length < 32) throw new Error("CREDENTIAL_ENCRYPTION_KEY must be configured with at least 32 characters");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function additionalData(ownerId: string, recordId: string) {
  return new TextEncoder().encode(`TradingStockSysyem:${ownerId}:${recordId}`);
}

export async function encryptCredential(value: unknown, ownerId: string, recordId: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: additionalData(ownerId, recordId) }, await vaultKey(), plaintext);
  return `${VERSION}.${base64Encode(iv)}.${base64Encode(new Uint8Array(ciphertext))}`;
}

export async function decryptCredential<T>(sealed: string, ownerId: string, recordId: string): Promise<T> {
  const [version, ivPart, cipherPart] = sealed.split(".");
  if (version !== VERSION || !ivPart || !cipherPart) throw new Error("credential envelope is invalid");
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64Decode(ivPart), additionalData: additionalData(ownerId, recordId) }, await vaultKey(), base64Decode(cipherPart));
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

export async function credentialFingerprint(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest.slice(0, 8)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function maskAccount(accountNumber: string, productCode: string) {
  return `••••-${accountNumber.slice(-4)}-${productCode}`;
}
