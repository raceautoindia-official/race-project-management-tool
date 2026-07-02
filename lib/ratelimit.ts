// Best-effort in-memory rate limiter for the login endpoint. Per-instance and
// resets on restart — adequate as basic brute-force protection for an internal
// tool. Swap for a shared store (Redis) if you run multiple instances.
const attempts = new Map<string, { count: number; first: number }>();

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 8;

export function checkRateLimit(key: string): {
  ok: boolean;
  retryAfter?: number;
} {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now - rec.first > WINDOW_MS) {
    attempts.set(key, { count: 1, first: now });
    return { ok: true };
  }
  rec.count += 1;
  if (rec.count > MAX_ATTEMPTS) {
    return {
      ok: false,
      retryAfter: Math.ceil((WINDOW_MS - (now - rec.first)) / 1000),
    };
  }
  return { ok: true };
}

export function clearRateLimit(key: string): void {
  attempts.delete(key);
}
