import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for the stored YouTube refresh token. The key is derived from SERENDIP_OWNER_KEY with HKDF,
 * so there is no second secret to keep. Changing the owner key makes the stored token unreadable:
 * decrypt() returns null and the owner connects again.
 */

const INFO = "serendip-youtube-token-v1";

function deriveKey(ownerKey: string): Buffer {
  return Buffer.from(hkdfSync("sha256", ownerKey, "serendip-salt-v1", INFO, 32));
}

/** "v1.<iv>.<tag>.<ciphertext>", each part base64url. */
export function encryptSecret(plain: string, ownerKey: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", deriveKey(ownerKey), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(sealed: string, ownerKey: string): string | null {
  const [v, iv, tag, ct] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !ct) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", deriveKey(ownerKey), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
