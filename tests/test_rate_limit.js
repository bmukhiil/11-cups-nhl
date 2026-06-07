const test = require("node:test");
const assert = require("node:assert/strict");
const {
  WINDOWS,
  assertRateLimitConfigured,
  checkRateLimit,
  rateLimitIdForRoute,
  resetMemoryRateLimit,
} = require("../app/security/rateLimit");

function withEnv(values, fn) {
  const original = {
    NODE_ENV: process.env.NODE_ENV,
    RATE_LIMIT_PROVIDER: process.env.RATE_LIMIT_PROVIDER,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
    VERCEL_RATE_LIMIT_ID_START: process.env.VERCEL_RATE_LIMIT_ID_START,
  };
  Object.assign(process.env, values);
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("memory rate limiter blocks requests over route limit", async () => {
  resetMemoryRateLimit();
  await withEnv({ NODE_ENV: "test", RATE_LIMIT_PROVIDER: "memory" }, async () => {
    let result;
    for (let index = 0; index < WINDOWS.start.limit; index += 1) {
      result = await checkRateLimit({ key: "ip-a", route: "start", now: 1000 });
      assert.equal(result.allowed, true);
    }
    result = await checkRateLimit({ key: "ip-a", route: "start", now: 1000 });
    assert.equal(result.allowed, false);
  });
});

test("memory rate limiter uses separate route and ip buckets", async () => {
  resetMemoryRateLimit();
  await withEnv({ NODE_ENV: "test", RATE_LIMIT_PROVIDER: "memory" }, async () => {
    for (let index = 0; index < WINDOWS.start.limit; index += 1) {
      await checkRateLimit({ key: "ip-a", route: "start", now: 1000 });
    }
    assert.equal((await checkRateLimit({ key: "ip-b", route: "start", now: 1000 })).allowed, true);
    assert.equal((await checkRateLimit({ key: "ip-a", route: "select", now: 1000 })).allowed, true);
  });
});

test("production rate limiting fails closed without upstash", () => {
  withEnv({
    NODE_ENV: "production",
    RATE_LIMIT_PROVIDER: undefined,
    UPSTASH_REDIS_REST_URL: undefined,
    UPSTASH_REDIS_REST_TOKEN: undefined,
  }, () => {
    assert.throws(() => assertRateLimitConfigured(), /must use vercel or upstash/);
  });
});

test("production upstash mode requires complete config", () => {
  withEnv({
    NODE_ENV: "production",
    RATE_LIMIT_PROVIDER: "upstash",
    UPSTASH_REDIS_REST_URL: "https://example.com",
    UPSTASH_REDIS_REST_TOKEN: undefined,
  }, () => {
    assert.throws(() => assertRateLimitConfigured(), /not configured/);
  });
});

test("production vercel mode does not require redis config", () => {
  withEnv({
    NODE_ENV: "production",
    RATE_LIMIT_PROVIDER: "vercel",
    UPSTASH_REDIS_REST_URL: undefined,
    UPSTASH_REDIS_REST_TOKEN: undefined,
  }, () => {
    assert.doesNotThrow(() => assertRateLimitConfigured());
  });
});

test("vercel route ids have defaults and can be overridden", () => {
  withEnv({ VERCEL_RATE_LIMIT_ID_START: undefined }, () => {
    assert.equal(rateLimitIdForRoute("start"), "draft-start");
  });
  withEnv({ VERCEL_RATE_LIMIT_ID_START: "custom-start-id" }, () => {
    assert.equal(rateLimitIdForRoute("start"), "custom-start-id");
  });
});

test("vercel mode fails closed in production without request context", async () => {
  await withEnv({
    NODE_ENV: "production",
    RATE_LIMIT_PROVIDER: "vercel",
  }, async () => {
    await assert.rejects(
      () => checkRateLimit({ key: "ip-a", route: "start" }),
      /requires request context/,
    );
  });
});
