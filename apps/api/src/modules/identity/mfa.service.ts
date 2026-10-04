import crypto from "crypto";
import QRCode from "qrcode";
import { prisma } from "../../db/client.js";
import { config } from "../../config/env.js";

const AES_ALGORITHM = "aes-256-gcm";
const DERIVED_KEY_LENGTH = 32; // 256 bits

// Base32 Alphabet (RFC 4648)
const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Encodes a buffer to Base32 string (RFC 4648 standard for TOTP secrets)
 */
function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;

    while (bits >= 5) {
      output += BASE32_CHARS[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_CHARS[(value << (5 - bits)) & 31];
  }

  return output;
}

/**
 * Decodes a Base32 string to Buffer
 */
function base32Decode(base32: string): Buffer {
  const cleaned = base32.toUpperCase().replace(/=+$/, "").replace(/[\s-]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const val = BASE32_CHARS.indexOf(cleaned[i]);
    if (val === -1) continue;

    value = (value << 5) | val;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/**
 * Generates an RFC 6238 TOTP 6-digit code for a given timestamp and Base32 secret
 */
export function generateTotpCode(
  secretBase32: string,
  timestampMs: number = Date.now(),
  timeStepSeconds: number = 30,
): string {
  const key = base32Decode(secretBase32);
  const timeStep = Math.floor(timestampMs / 1000 / timeStepSeconds);

  // Buffer of 8 bytes for 64-bit integer (big endian)
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigInt64BE(BigInt(timeStep));

  const hmac = crypto.createHmac("sha1", key);
  hmac.update(counterBuffer);
  const digest = hmac.digest();

  // Dynamic truncation (RFC 4226)
  const offset = digest[digest.length - 1] & 0xf;
  const codeInt =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  const code = (codeInt % 1000000).toString().padStart(6, "0");
  return code;
}

/**
 * Verifies an RFC 6238 TOTP code with ±2 steps (±60s) tolerance window.
 * Tolerance of 2 steps ensures robustness against minor server clock drift and network lag.
 */
export function verifyTotpToken(
  secretBase32: string,
  token: string,
  windowSteps: number = 2,
  timeStepSeconds: number = 30,
): boolean {
  const cleanToken = token.trim().replace(/\s/g, "");
  if (!/^\d{6}$/.test(cleanToken)) return false;

  const now = Date.now();
  const stepMs = timeStepSeconds * 1000;

  for (let i = -windowSteps; i <= windowSteps; i++) {
    const testTime = now + i * stepMs;
    const expected = generateTotpCode(secretBase32, testTime, timeStepSeconds);
    if (
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(cleanToken))
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Derives a 256-bit encryption key from MFA_ENCRYPTION_SECRET / JWT_SECRET via HKDF-SHA256.
 */
function deriveEncryptionKey(
  secret: string = config.mfa.encryptionSecret,
): Buffer {
  return Buffer.from(
    crypto.hkdfSync(
      "sha256",
      secret,
      "daih-mfa-encryption-salt-v1",
      "daih-mfa-secret-key",
      DERIVED_KEY_LENGTH,
    ),
  );
}

/**
 * Encrypts a TOTP secret using AES-256-GCM.
 * Output format: "iv:authTag:ciphertext" (hex-encoded)
 */
function encryptTotpSecret(rawSecret: string): string {
  const key = deriveEncryptionKey();
  const iv = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv(AES_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(rawSecret, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString("hex"),
    authTag.toString("hex"),
    ciphertext.toString("hex"),
  ].join(":");
}

/**
 * Decrypts a stored TOTP secret.
 * Attempts decryption using the configured secret first, then falls back to the
 * default development secret in case the database was seeded or imported from local dev.
 */
function decryptTotpSecret(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid stored TOTP secret format");
  }
  const [ivHex, authTagHex, ciphertextHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");

  // Attempt 1: Configured key (MFA_ENCRYPTION_SECRET or JWT_SECRET)
  const primaryKey = deriveEncryptionKey(config.mfa.encryptionSecret);
  try {
    const decipher = crypto.createDecipheriv(AES_ALGORITHM, primaryKey, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch (primaryErr) {
    // Attempt 2: Fallback to development secret (for databases seeded in development)
    const devSecret = "dev-secret-key-12345678901234567890";
    if (config.mfa.encryptionSecret !== devSecret) {
      try {
        const fallbackKey = deriveEncryptionKey(devSecret);
        const fallbackDecipher = crypto.createDecipheriv(
          AES_ALGORITHM,
          fallbackKey,
          iv,
        );
        fallbackDecipher.setAuthTag(authTag);
        const decrypted = Buffer.concat([
          fallbackDecipher.update(ciphertext),
          fallbackDecipher.final(),
        ]);
        console.warn(
          "[MFA] Stored TOTP secret decrypted via development secret fallback.",
        );
        return decrypted.toString("utf8");
      } catch {
        // Fall through to throw the primary error
      }
    }
    throw primaryErr;
  }
}

export class MfaService {
  /**
   * Generates a new Base32 TOTP secret and returns the QR code Data URI
   * AND the plain-text secret key (for manual entry in the app).
   * The secret is NOT saved here — caller must call verifyAndSaveTotpSetup.
   */
  async generateTotpSetup(
    email: string,
    issuer = "DAIH Admin Console",
  ): Promise<{
    secret: string;
    qrCodeDataUri: string;
    manualEntryKey: string; // Formatted in groups of 4 (e.g. "JBSW Y3DP EHPK")
    otpauthUri: string;
  }> {
    const rawBytes = crypto.randomBytes(20); // 160-bit secure seed
    const secret = base32Encode(rawBytes);

    const encodedIssuer = encodeURIComponent(issuer);
    const encodedAccount = encodeURIComponent(email);
    const otpauthUri = `otpauth://totp/${encodedIssuer}:${encodedAccount}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;

    // Rendered here, never by a third-party QR service: the URI contains the TOTP secret.
    const qrCodeDataUri = await QRCode.toDataURL(otpauthUri, {
      width: 240,
      margin: 1,
    });

    // Format secret in groups of 4 for human readability (copy-paste into app)
    const manualEntryKey = secret.match(/.{1,4}/g)!.join(" ");

    return { secret, qrCodeDataUri, manualEntryKey, otpauthUri };
  }

  /**
   * Verifies a TOTP code against a raw (unencrypted) secret.
   * Used during setup confirmation before the secret is persisted.
   */
  verifyTotpCode(rawSecret: string, code: string): boolean {
    try {
      return verifyTotpToken(rawSecret, code, 2, 30);
    } catch {
      return false;
    }
  }

  /**
   * Verifies a TOTP code against a stored (encrypted) secret.
   * Used at login challenge verification.
   */
  verifyTotpCodeFromStorage(encryptedSecret: string, code: string): boolean {
    try {
      const rawSecret = decryptTotpSecret(encryptedSecret);
      return verifyTotpToken(rawSecret, code, 2, 30);
    } catch (err: any) {
      console.error(
        `[MFA] Failed to decrypt TOTP secret from storage: ${err?.message}. Check if MFA_ENCRYPTION_SECRET/JWT_SECRET in production matches the key used when MFA was enabled.`,
      );
      return false;
    }
  }

  /**
   * Saves the encrypted TOTP secret and enables MFA for a user.
   * Called after the user has confirmed setup by entering a valid first code.
   */
  async enableTotpMfa(userId: string, rawSecret: string): Promise<void> {
    const encryptedSecret = encryptTotpSecret(rawSecret);
    await prisma.user.update({
      where: { id: userId },
      data: {
        mfaEnabled: true,
        mfaMethod: "TOTP",
        mfaSecret: encryptedSecret,
      },
    });
  }

  /**
   * Enables Email OTP MFA for a user (no secret needed).
   */
  async enableEmailOtpMfa(userId: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: {
        mfaEnabled: true,
        mfaMethod: "EMAIL_OTP",
        mfaSecret: null,
      },
    });
  }

  /**
   * Generates a 6-digit OTP, stores its SHA-256 hash in the DB
   * (valid for 10 minutes, single-use), and returns the raw code.
   * Caller is responsible for emailing it.
   */
  async generateEmailOtp(userId: string): Promise<string> {
    // Invalidate any existing unused OTPs for this user first
    await prisma.mfaOtpToken.updateMany({
      where: {
        userId,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { expiresAt: new Date() }, // immediately expire them
    });

    const rawCode = String(crypto.randomInt(100000, 999999)); // 6-digit
    const tokenHash = crypto.createHash("sha256").update(rawCode).digest("hex");

    await prisma.mfaOtpToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
      },
    });

    return rawCode;
  }

  /**
   * Verifies a submitted 6-digit Email OTP for a user.
   * Returns true on success, false on invalid/expired/used code.
   * Marks the token as used on success.
   */
  async verifyEmailOtp(
    userId: string,
    submittedCode: string,
  ): Promise<boolean> {
    const tokenHash = crypto
      .createHash("sha256")
      .update(submittedCode.trim())
      .digest("hex");

    const token = await prisma.mfaOtpToken.findFirst({
      where: {
        userId,
        tokenHash,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    if (!token) return false;

    // Mark as consumed immediately to prevent replay
    await prisma.mfaOtpToken.update({
      where: { id: token.id },
      data: { usedAt: new Date() },
    });

    return true;
  }

  /**
   * Disables MFA entirely for a user. Super Admin emergency action.
   */
  async disableMfa(userId: string): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: {
        mfaEnabled: false,
        mfaMethod: null,
        mfaSecret: null,
      },
    });

    // Expire all pending OTP tokens too
    await prisma.mfaOtpToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });
  }
}

export const mfaService = new MfaService();
