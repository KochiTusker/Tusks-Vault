import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { withRetry, statusOf, isRateLimit, isTransient, retryAfterMs, clearHolds } from "./retry";

// Fake timers everywhere: the backoff waits are seconds long, and a test
// suite that actually sleeps them would be the reason nobody runs it.
beforeEach(() => {
  vi.useFakeTimers();
  clearHolds();
});
afterEach(() => {
  vi.useRealTimers();
});

function httpError(status: number, extra: Record<string, unknown> = {}): Error {
  const err = new Error(`upstream failed`) as Error & Record<string, unknown>;
  err.status = status;
  Object.assign(err, extra);
  return err;
}

async function run<T>(p: Promise<T>): Promise<T> {
  // Flush every pending timer/promise cycle until the promise settles.
  await vi.runAllTimersAsync();
  return p;
}

describe("statusOf / classification", () => {
  it("reads .status, nested response.status, and HTTP fragments in messages", () => {
    expect(statusOf(httpError(429))).toBe(429);
    expect(statusOf({ response: { status: 503 } })).toBe(503);
    expect(statusOf(new Error("Gemini models list returned HTTP 500: boom"))).toBe(500);
    expect(statusOf(new Error('{"error":{"code": 429,"status":"RESOURCE_EXHAUSTED"}}'))).toBe(429);
    expect(statusOf(new Error("model-429b is great"))).toBeNull();
    expect(statusOf(null)).toBeNull();
  });

  it("classifies rate limits and transients; 400s are neither", () => {
    expect(isRateLimit(httpError(429))).toBe(true);
    expect(isRateLimit(new Error("RESOURCE_EXHAUSTED: quota"))).toBe(true);
    expect(isTransient(httpError(502))).toBe(true);
    expect(isTransient(httpError(400))).toBe(false);
    expect(isRateLimit(httpError(400))).toBe(false);
  });

  it("parses Retry-After from Headers and plain objects, in ms", () => {
    expect(retryAfterMs(httpError(429, { headers: { "retry-after": "12" } }))).toBe(12_000);
    expect(retryAfterMs(httpError(429, { headers: new Headers({ "Retry-After": "3" }) }))).toBe(3_000);
    expect(retryAfterMs(httpError(429))).toBeNull();
  });
});

describe("withRetry", () => {
  it("passes through a success untouched", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(withRetry(fn, { scope: "t1" })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("never retries a non-transient error — wrong now is wrong in eight seconds", async () => {
    const fn = vi.fn().mockRejectedValue(httpError(400));
    await expect(withRetry(fn, { scope: "t2" })).rejects.toMatchObject({ status: 400 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a transient failure and succeeds", async () => {
    const fn = vi.fn().mockRejectedValueOnce(httpError(503)).mockResolvedValueOnce("recovered");
    await expect(run(withRetry(fn, { scope: "t3" }))).resolves.toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("gives up after maxRetries and rethrows the LAST error untouched", async () => {
    const fn = vi.fn().mockRejectedValue(httpError(429));
    const p = withRetry(fn, { scope: "t4", maxRetries: 2 }).catch(e => e as Error & { status?: number });
    await vi.runAllTimersAsync();
    const err = await p;
    expect((err as { status?: number }).status).toBe(429);
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("honours Retry-After precisely instead of the computed backoff", async () => {
    const onRetry = vi.fn();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(httpError(429, { headers: { "retry-after": "7" } }))
      .mockResolvedValueOnce("ok");
    await run(withRetry(fn, { scope: "t5", onRetry }));
    expect(onRetry).toHaveBeenCalledWith(1, 7_000, "rate limit");
  });

  it("a 429 holds the whole SCOPE — a second call waits even though it never errored", async () => {
    const order: string[] = [];
    const limited = vi
      .fn()
      .mockImplementationOnce(() => Promise.reject(httpError(429, { headers: { "retry-after": "10" } })))
      .mockImplementation(async () => {
        order.push("limited-done");
        return "a";
      });
    const p1 = withRetry(limited, { scope: "openrouter" });
    // Let the 429 land and set the hold.
    await vi.advanceTimersByTimeAsync(5);

    const innocent = vi.fn().mockImplementation(async () => {
      order.push("innocent-done");
      return "b";
    });
    const p2 = withRetry(innocent, { scope: "openrouter" });
    // 5s in: still inside the 10s hold — the innocent call must not have run.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(innocent).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    await expect(p1).resolves.toBe("a");
    await expect(p2).resolves.toBe("b");
  });

  it("scopes are independent — a hold on one provider doesn't slow another", async () => {
    const limited = vi.fn().mockRejectedValue(httpError(429, { headers: { "retry-after": "30" } }));
    const p1 = withRetry(limited, { scope: "openrouter", maxRetries: 1 }).catch(() => "limited-failed");
    await vi.advanceTimersByTimeAsync(5);

    const other = vi.fn().mockResolvedValue("fast");
    await expect(withRetry(other, { scope: "gemini" })).resolves.toBe("fast");
    expect(other).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
    await p1;
  });
});
