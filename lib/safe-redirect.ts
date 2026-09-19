/**
 * Where to go after login: only a same-site path. Rejects protocol-relative
 * ("//evil.example") and backslash ("/\evil.example") forms that browsers
 * treat as another origin.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return fallback;
  }
  return next;
}
