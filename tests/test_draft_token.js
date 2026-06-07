const test = require("node:test");
const assert = require("node:assert/strict");
const {
  signDraftPayload,
  verifyDraftToken,
} = require("../app/security/draftToken");

const SECRET = "12345678901234567890123456789012";

function payload(overrides = {}) {
  return {
    version: 1,
    draftRunId: "draft-1",
    expiresAt: "2030-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("draft token signs and verifies payload", () => {
  const token = signDraftPayload(payload(), SECRET, { production: true });
  const verified = verifyDraftToken(token, SECRET, { now: "2029-01-01T00:00:00.000Z", production: true });

  assert.equal(verified.draftRunId, "draft-1");
});

test("draft token rejects changed payload", () => {
  const token = signDraftPayload(payload(), SECRET, { production: true });
  const [body, signature] = token.split(".");
  const changedBody = Buffer.from(JSON.stringify(payload({ draftRunId: "draft-2" }))).toString("base64url");

  assert.throws(
    () => verifyDraftToken(`${changedBody}.${signature}`, SECRET, { now: "2029-01-01T00:00:00.000Z", production: true }),
    /Invalid draft token signature/,
  );
});

test("draft token rejects changed signature", () => {
  const token = signDraftPayload(payload(), SECRET, { production: true });

  assert.throws(
    () => verifyDraftToken(`${token}x`, SECRET, { now: "2029-01-01T00:00:00.000Z", production: true }),
    /Invalid draft token signature/,
  );
});

test("draft token rejects expired payload", () => {
  const token = signDraftPayload(payload({ expiresAt: "2028-01-01T00:00:00.000Z" }), SECRET, { production: true });

  assert.throws(
    () => verifyDraftToken(token, SECRET, { now: "2029-01-01T00:00:00.000Z", production: true }),
    /expired/,
  );
});

test("draft token requires strong production secret", () => {
  assert.throws(
    () => signDraftPayload(payload(), "short", { production: true }),
    /at least 32 bytes/,
  );
});

test("draft token rejects unsupported version", () => {
  const token = signDraftPayload(payload({ version: 2 }), SECRET, { production: true });

  assert.throws(
    () => verifyDraftToken(token, SECRET, { now: "2029-01-01T00:00:00.000Z", production: true }),
    /Unsupported/,
  );
});
