export class NetworkRequestError extends Error {
  constructor() {
    super("Network request failed");
    this.name = "NetworkRequestError";
  }
}

const abortReason = (signal: AbortSignal) =>
  signal.reason ?? new DOMException("Request aborted", "AbortError");

function pause(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      reject(abortReason(signal!));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    }, ms);
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

/** Retry only safe reads. A failed write may already have committed on the server. */
export async function resilientFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const safeRead = ["GET", "HEAD"].includes((options.method ?? "GET").toUpperCase());
  const attempts = safeRead ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (options.signal?.aborted) throw abortReason(options.signal);
    const controller = new AbortController();
    const cancel = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", cancel, { once: true });
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (!safeRead || ![502, 503, 504].includes(response.status) || attempt === attempts - 1)
        return response;
      // Release the failed response before a new attempt.
      await response.body?.cancel().catch(() => undefined);
    } catch (error) {
      if (options.signal?.aborted) throw abortReason(options.signal);
      if (!(error instanceof TypeError) && !controller.signal.aborted) throw error;
      if (attempt === attempts - 1) throw new NetworkRequestError();
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", cancel);
    }
    await pause(750 * 3 ** attempt, options.signal);
  }
  throw new NetworkRequestError();
}
