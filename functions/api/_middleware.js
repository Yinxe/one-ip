import { json } from "../../public/worker/http.js";

/**
 * Request limiting for the Pages target.
 *
 * `main` declares the Rate Limiting binding in wrangler.toml, which Pages
 * Functions cannot use. Rather than edit the shared Worker handler, the same
 * limits are enforced here in a middleware that runs before it. The counters
 * live in the isolate, so they hold per Cloudflare location and are a best-effort
 * fallback rather than an edge-wide limit.
 */
const WINDOW_MS = 60_000;
const LIMITS = { GET: 180, POST: 5 };
const MAX_TRACKED_KEYS = 10_000;

/** @type {Map<string, { count: number, resetAt: number }>} */
const buckets = new Map();

function forgetExpired(now) {
  for (const [key, bucket] of buckets)
    if (now >= bucket.resetAt) buckets.delete(key);
}

function consume(key, method, now) {
  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    if (buckets.size >= MAX_TRACKED_KEYS) {
      forgetExpired(now);
      // Still full after pruning: drop everything rather than grow without bound.
      if (buckets.size >= MAX_TRACKED_KEYS) buckets.clear();
    }
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= (LIMITS[method] ?? LIMITS.GET);
}

export async function onRequest({ request, env, next }) {
  const key = request.headers.get("CF-Connecting-IP") ?? "local";
  const binding =
    request.method === "POST" ? env.ACTION_LIMITER : env.API_LIMITER;
  const allowed = binding
    ? (await binding.limit({ key })).success
    : consume(`${request.method}:${key}`, request.method, Date.now());
  if (!allowed) return json({ error: "请求过于频繁，请一分钟后重试" }, 429);
  return next();
}
