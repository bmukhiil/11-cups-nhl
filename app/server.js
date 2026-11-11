const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { loadCardStore } = require("./cardStore");
const {
  selectCardAction,
  startDraftAction,
  useLifelineAction,
} = require("./statelessApi");
const { checkRateLimit } = require("./security/rateLimit");

const PORT = Number(process.env.PORT || 3000);
const ROOT = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_BODY_BYTES = 32 * 1024;
const ALLOWED_POST_FIELDS = {
  "/api/draft/start": ["friendCode"],
  "/api/draft/select": ["draftToken", "cardId"],
  "/api/draft/lifeline": ["draftToken", "type", "position"],
};

const store = loadCardStore();

function securityHeaders(extra = {}) {
  return {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    ...extra,
  };
}

function staticHeaders(extra = {}) {
  return {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' https:; base-uri 'none'; frame-ancestors 'none'",
    ...extra,
  };
}

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, securityHeaders({
    "content-type": "application/json; charset=utf-8",
    ...headers,
  }));
  res.end(JSON.stringify(payload));
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function clientKey(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

function validateOrigin(req) {
  if (process.env.NODE_ENV !== "production") return;
  const allowed = process.env.ALLOWED_ORIGIN;
  if (!allowed) throw new Error("ALLOWED_ORIGIN is required in production");
  const origin = req.headers.origin;
  if (origin && origin !== allowed) throw new Error("Origin is not allowed");
}

function routeLimitName(pathname) {
  if (pathname === "/api/health") return "health";
  if (pathname === "/api/draft/start") return "start";
  if (pathname === "/api/draft/select") return "select";
  if (pathname === "/api/draft/lifeline") return "lifeline";
  return "select";
}

async function applyRateLimit(req, pathname) {
  const result = await checkRateLimit({
    key: clientKey(req),
    route: routeLimitName(pathname),
    request: req,
  });
  if (!result.allowed) {
    const error = new Error("Rate limit exceeded");
    error.statusCode = 429;
    throw error;
  }
}

function validateFields(pathname, body) {
  const allowed = ALLOWED_POST_FIELDS[pathname];
  if (!allowed) return;
  for (const field of Object.keys(body)) {
    if (!allowed.includes(field)) throw new Error(`Unknown field: ${field}`);
  }
}

function readBody(req, pathname) {
  return new Promise((resolve, reject) => {
    if (req.method !== "POST") {
      resolve({});
      return;
    }
    const contentType = String(req.headers["content-type"] || "");
    if (!contentType.toLowerCase().startsWith("application/json")) {
      const error = new Error("Content-Type must be application/json");
      error.statusCode = 415;
      reject(error);
      return;
    }
    let body = "";
    let tooLarge = false;
    req.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        tooLarge = true;
        req.destroy();
      }
    });
    req.on("end", () => {
      if (tooLarge) {
        const error = new Error("Request body too large");
        error.statusCode = 413;
        reject(error);
        return;
      }
      if (!body) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(body);
        validateFields(pathname, parsed);
        resolve(parsed);
      } catch (error) {
        if (!error.statusCode) error.statusCode = 400;
        reject(error);
      }
    });
    req.on("error", () => {
      const error = new Error(tooLarge ? "Request body too large" : "Request failed");
      error.statusCode = tooLarge ? 413 : 400;
      reject(error);
    });
  });
}

function serveStatic(req, res) {
  const urlPath = new URL(req.url, `http://${req.headers.host}`).pathname;
  const relativePath = urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "");
  const filePath = path.normalize(path.join(PUBLIC_DIR, relativePath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendError(res, 403, "Forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendError(res, 404, "Not found");
    return;
  }
  const ext = path.extname(filePath);
  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
  };
  res.writeHead(200, staticHeaders({
    "content-type": contentTypes[ext] || "application/octet-stream",
  }));
  fs.createReadStream(filePath).pipe(res);
}

async function handleApi(req, res, pathname) {
  await applyRateLimit(req, pathname);

  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      cards: store.cards.length,
      teams: store.teams.length,
      mode: "stateless",
      source: store.source,
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/franchises") {
    sendJson(res, 200, store.teams.map((franchiseKey) => ({
      franchiseKey,
      cardCount: (store.byTeam.get(franchiseKey) || []).length,
    })));
    return;
  }

  if (req.method !== "POST") {
    sendError(res, 405, "Method not allowed");
    return;
  }

  validateOrigin(req);
  const body = await readBody(req, pathname);

  if (pathname === "/api/draft/start") {
    sendJson(res, 200, startDraftAction({ store, friendCode: body.friendCode }));
    return;
  }

  if (pathname === "/api/draft/select") {
    sendJson(res, 200, selectCardAction({
      store,
      draftToken: body.draftToken,
      cardId: body.cardId,
    }));
    return;
  }

  if (pathname === "/api/draft/lifeline") {
    sendJson(res, 200, useLifelineAction({
      store,
      draftToken: body.draftToken,
      type: body.type,
      position: body.position,
    }));
    return;
  }

  sendError(res, 404, "API route not found");
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname);
      return;
    }
    serveStatic(req, res);
  } catch (error) {
    sendError(res, error.statusCode || 400, error.message);
  }
});

server.listen(PORT, () => {
  console.log(`11 Cups NHL draft app running at http://localhost:${PORT}`);
  console.log(`Card source: ${store.source}`);
  console.log(`Loaded ${store.cards.length} cards across ${store.teams.length} franchises`);
  console.log("API mode: stateless");
});
