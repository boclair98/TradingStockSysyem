import assert from "node:assert/strict";
import test from "node:test";
import { credentialFingerprint, decryptCredential, encryptCredential, maskAccount } from "../engine/credentialVault";

test("broker credentials are authenticated, encrypted and owner-bound", async () => {
  const previous = process.env.CREDENTIAL_ENCRYPTION_KEY;
  process.env.CREDENTIAL_ENCRYPTION_KEY = "unit-test-only-encryption-key-with-more-than-thirty-two-characters";
  try {
    const secret = { appKey: "public-key", appSecret: "never-plaintext", accountNumber: "12345678" };
    const sealed = await encryptCredential(secret, "user-a", "connection-a");
    assert.match(sealed, /^v1\./);
    assert.equal(sealed.includes(secret.appSecret), false);
    assert.deepEqual(await decryptCredential(sealed, "user-a", "connection-a"), secret);
    await assert.rejects(() => decryptCredential(sealed, "user-b", "connection-a"));
    await assert.rejects(() => decryptCredential(sealed.slice(0, -2) + "aa", "user-a", "connection-a"));
  } finally {
    if (previous === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    else process.env.CREDENTIAL_ENCRYPTION_KEY = previous;
  }
});

test("account references expose only a suffix and deterministic fingerprint", async () => {
  assert.equal(maskAccount("12345678", "01"), "••••-5678-01");
  assert.equal((await credentialFingerprint("same-input")).length, 16);
  assert.equal(await credentialFingerprint("same-input"), await credentialFingerprint("same-input"));
});
