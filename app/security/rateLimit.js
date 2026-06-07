const WINDOWS = {
  start: { limit: 120, windowMs: 60 * 60 * 1000 },
  select: { limit: 600, windowMs: 60 * 1000 },
  lifeline: { limit: 240, windowMs: 60 * 1000 },
  health: { limit: 120, windowMs: 60 * 1000 },
};

const memoryBuckets = new Map();

const VERCEL_RATE_LIMIT_IDS = {
  start: "draft-start",
  select: "draft-select",
  lifeline: "draft-lifeline",
  health: "draft-health",
};

function provider() {
  return process.env.RATE_LIMIT_PROVIDER || (process.env.NODE_ENV === "production" ? "" : "memory");
}

function assertRateLimitConfigured() {
  const selected = provider();
  if (process.env.NODE_ENV === "production" && !["upstash", "vercel"].includes(selected)) {
    throw new Error("Production rate limiting must use vercel or upstash");
  }
  if (selected === "upstash" && (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN)) {
    throw new Error("Upstash rate limiting is not configured");
  }
  if (selected === "vercel") {
    for (const route of Object.keys(VERCEL_RATE_LIMIT_IDS)) {
      rateLimitIdForRoute(route);
    }
  }
}

async function checkUpstashRateLimit({ key, route, now = Date.now() }) {
  const config = WINDOWS[route] || WINDOWS.select;
  const windowId = Math.floor(now / config.windowMs);
  const redisKey = `rate:${route}:${windowId}:${key}`;
  const url = `${process.env.UPSTASH_REDIS_REST_URL}/pipeline`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify([
      ["INCR", redisKey],
      ["PEXPIRE", redisKey, String(config.windowMs)],
    ]),
  });
  if (!response.ok) throw new Error("Rate limit provider failed");
  const body = await response.json();
  const count = Number(body?.[0]?.result);
  return {
    allowed: count <= config.limit,
    limit: config.limit,
    remaining: Math.max(0, config.limit - count),
  };
}

function checkMemoryRateLimit({ key, route, now = Date.now() }) {
  const config = WINDOWS[route] || WINDOWS.select;
  const bucketKey = `${route}:${key}`;
  const existing = memoryBuckets.get(bucketKey);
  if (!existing || now >= existing.resetAt) {
    memoryBuckets.set(bucketKey, { count: 1, resetAt: now + config.windowMs });
    return { allowed: true, limit: config.limit, remaining: config.limit - 1 };
  }
  existing.count += 1;
  return {
    allowed: existing.count <= config.limit,
    limit: config.limit,
    remaining: Math.max(0, config.limit - existing.count),
  };
}

function rateLimitIdForRoute(route) {
  const envName = `VERCEL_RATE_LIMIT_ID_${String(route).toUpperCase()}`;
  const id = process.env[envName] || VERCEL_RATE_LIMIT_IDS[route];
  if (!id) throw new Error(`Missing Vercel rate limit id for ${route}`);
  return id;
}

async function checkVercelRateLimit({ request, route, key }) {
  if (!request) {
    if (process.env.NODE_ENV === "production") throw new Error("Vercel rate limiting requires request context");
    return { allowed: true, provider: "vercel", skipped: true };
  }
  const { checkRateLimit: vercelCheckRateLimit } = await import("@vercel/firewall");
  const result = await vercelCheckRateLimit(rateLimitIdForRoute(route), {
    headers: request.headers,
    rateLimitKey: key,
    firewallHostForDevelopment: process.env.VERCEL_FIREWALL_HOST_FOR_DEVELOPMENT,
  });
  if (result.error === "not-found" && process.env.NODE_ENV === "production") {
    throw new Error(`Vercel rate limit id is not configured for ${route}`);
  }
  return {
    allowed: !result.rateLimited,
    provider: "vercel",
    error: result.error,
  };
}

async function checkRateLimit({ key, route, now = Date.now(), request = null }) {
  assertRateLimitConfigured();
  const selected = provider();
  if (selected === "memory") return checkMemoryRateLimit({ key, route, now });
  if (selected === "upstash") return checkUpstashRateLimit({ key, route, now });
  if (selected === "vercel") return checkVercelRateLimit({ request, route, key });
  throw new Error("Rate limiting is not configured");
}

function resetMemoryRateLimit() {
  memoryBuckets.clear();
}

module.exports = {
  VERCEL_RATE_LIMIT_IDS,
  WINDOWS,
  assertRateLimitConfigured,
  checkRateLimit,
  rateLimitIdForRoute,
  resetMemoryRateLimit,
};
