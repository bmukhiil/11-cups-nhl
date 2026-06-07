const { loadCardStore } = require("./cardStore");
const {
  selectCardAction,
  startDraftAction,
  useLifelineAction,
} = require("./statelessApi");
const { checkRateLimit } = require("./security/rateLimit");

const MAX_BODY_BYTES = 32 * 1024;
const store = loadCardStore();

function setSecurityHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function sendJson(res, status, payload) {
  setSecurityHeaders(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function clientKey(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

function validateOrigin(req) {
  if (process.env.NODE_ENV !== "production") return;
  const allowed = process.env.ALLOWED_ORIGIN;
  if (!allowed) throw new Error("ALLOWED_ORIGIN is required in production");
  const origin = req.headers.origin;
  if (origin && origin !== allowed) throw new Error("Origin is not allowed");
}

async function applyRateLimit(req, route) {
  const result = await checkRateLimit({ key: clientKey(req), route, request: req });
  if (!result.allowed) {
    const error = new Error("Rate limit exceeded");
    error.statusCode = 429;
    throw error;
  }
}

async function parseBody(req, allowedFields = []) {
  if (req.method !== "POST") return {};
  const contentType = String(req.headers["content-type"] || "");
  if (!contentType.toLowerCase().startsWith("application/json")) {
    const error = new Error("Content-Type must be application/json");
    error.statusCode = 415;
    throw error;
  }
  const body = typeof req.body === "object" && req.body !== null
    ? req.body
    : await new Promise((resolve, reject) => {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
        if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
          const error = new Error("Request body too large");
          error.statusCode = 413;
          reject(error);
          req.destroy();
        }
      });
      req.on("end", () => {
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch {
          const error = new Error("Invalid JSON");
          error.statusCode = 400;
          reject(error);
        }
      });
      req.on("error", reject);
    });

  for (const field of Object.keys(body)) {
    if (!allowedFields.includes(field)) throw new Error(`Unknown field: ${field}`);
  }
  return body;
}

async function handleRoute(req, res, { route, methods, fields = [], action }) {
  try {
    setSecurityHeaders(res);
    if (!methods.includes(req.method)) {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    await applyRateLimit(req, route);
    if (req.method === "POST") validateOrigin(req);
    const body = await parseBody(req, fields);
    sendJson(res, 200, await action({ body, store }));
  } catch (error) {
    sendJson(res, error.statusCode || 400, { error: error.message });
  }
}

module.exports = {
  handleRoute,
  selectCardAction,
  startDraftAction,
  store,
  useLifelineAction,
};
