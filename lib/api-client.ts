/** A failed API call: the server's message plus the HTTP status. */
export class ApiRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

/** True when the data changed underneath us (409) — reload before retrying. */
export function isConflict(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 409;
}

// Small client-side fetch wrapper. Throws an ApiRequestError with the server's
// message on non-2xx responses so callers can show it directly.
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
    throw new ApiRequestError(msg, res.status);
  }
  return data as T;
}
