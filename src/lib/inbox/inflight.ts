/**
 * Shares one in-flight promise per key across concurrent callers.
 *
 * Built for inbox thread hydration: opening a draft resumes it, and a double
 * activation before the first request completes must not fire a second fetch
 * — the loser would resolve with no data and open a second, body-less
 * composer that the draft-id dedupe in `openComposer` cannot collapse (each
 * carries a different id). Concurrent `run` calls with the same key share the
 * first call's promise instead; once it settles the key is released and the
 * next call starts fresh.
 *
 * Rejections propagate to every waiter sharing the promise — callers that can
 * tolerate failure handle it (resumeDraft degrades to the message-less
 * thread), callers that cannot must not share.
 */
export class InflightRequests {
  private readonly pending = new Map<string, Promise<unknown>>();

  run<T>(key: string, start: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) return existing as Promise<T>;
    const request = start();
    this.pending.set(key, request);
    const release = () => {
      if (this.pending.get(key) === request) this.pending.delete(key);
    };
    request.then(release, release);
    return request;
  }
}
