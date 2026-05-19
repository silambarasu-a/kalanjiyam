/**
 * Single source of truth for SWR fetching. Throws on non-OK responses
 * so SWR caches an error (not the error response body as data).
 *
 * Critical behavior for the idle-lock flow: when the proxy returns 423
 * with `{ code: "REVERIFY_REQUIRED" }`, this fetcher throws an
 * ApiError. SWR records the error in its cache. After the user unlocks
 * and the session-lock-dialog fires `mutate(() => true)`, every key
 * with a cached error is revalidated with the new session cookie —
 * the data populates without manual page reloads.
 *
 * Don't write a one-off `fetch(url).then(r => r.json())` inline. That
 * pattern returns the 423 error body as data; consumers read
 * `data.contacts` or `data.accounts` and see `undefined`, then think
 * "the API is broken after unlock". It's not broken — the fetcher just
 * never told SWR about the failure.
 */
export class ApiError extends Error {
  status: number;
  code?: string;
  body?: unknown;

  constructor(message: string, status: number, code?: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export async function swrFetcher<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      code?: string;
    };
    throw new ApiError(
      body.error ?? `Request failed (${res.status})`,
      res.status,
      body.code,
      body,
    );
  }
  return (await res.json()) as T;
}

/** Backward-compat alias for existing call sites doing `import { fetcher }`. */
export const fetcher = swrFetcher;
