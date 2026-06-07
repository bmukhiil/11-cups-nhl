const crypto = require("node:crypto");

const TOKEN_MAX_BYTES = 20 * 1024;
const MIN_SECRET_BYTES = 32;

function base64urlEncode(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buffer.toString("base64url");
}

function base64urlDecode(value) {
  return Buffer.from(value, "base64url");
}

function assertSecret(secret, { production = process.env.NODE_ENV === "production" } = {}) {
  if (!secret) {
    if (production) throw new Error("DRAFT_STATE_SECRET is required in production");
    return "dev-only-draft-state-secret-change-before-production";
  }
  if (production && Buffer.byteLength(secret) < MIN_SECRET_BYTES) {
    throw new Error("DRAFT_STATE_SECRET must be at least 32 bytes in production");
  }
  return secret;
}

function signatureFor(payloadPart, secret) {
  return base64urlEncode(crypto.createHmac("sha256", secret).update(payloadPart).digest());
}

function timingSafeEqualText(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function signDraftPayload(payload, secret, options = {}) {
  const resolvedSecret = assertSecret(secret, options);
  const payloadPart = base64urlEncode(JSON.stringify(payload));
  const signaturePart = signatureFor(payloadPart, resolvedSecret);
  const token = `${payloadPart}.${signaturePart}`;
  if (Buffer.byteLength(token) > TOKEN_MAX_BYTES) throw new Error("Draft token is too large");
  return token;
}

function verifyDraftToken(token, secret, { now = new Date(), production = process.env.NODE_ENV === "production" } = {}) {
  if (!token || typeof token !== "string") throw new Error("Draft token is required");
  if (Buffer.byteLength(token) > TOKEN_MAX_BYTES) throw new Error("Draft token is too large");

  const resolvedSecret = assertSecret(secret, { production });
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("Malformed draft token");

  const expectedSignature = signatureFor(parts[0], resolvedSecret);
  if (!timingSafeEqualText(parts[1], expectedSignature)) throw new Error("Invalid draft token signature");

  let payload;
  try {
    payload = JSON.parse(base64urlDecode(parts[0]).toString("utf8"));
  } catch {
    throw new Error("Malformed draft token payload");
  }

  if (payload.version !== 1) throw new Error("Unsupported draft token version");
  if (!payload.expiresAt || Number.isNaN(Date.parse(payload.expiresAt))) {
    throw new Error("Draft token is missing expiration");
  }
  if (new Date(payload.expiresAt).getTime() <= new Date(now).getTime()) {
    throw new Error("Draft token has expired");
  }

  return payload;
}

module.exports = {
  TOKEN_MAX_BYTES,
  assertSecret,
  signDraftPayload,
  verifyDraftToken,
};
