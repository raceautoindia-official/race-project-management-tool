// Small client-side fetch wrapper. Throws an Error with the server's message
// on non-2xx responses so callers can show it directly.
export async function apiFetch<T = unknown>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : "") || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}
