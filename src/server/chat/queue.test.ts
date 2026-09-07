import { beforeEach, describe, expect, it } from "vitest";
import {
  ASKER_COOLDOWN_MS,
  checkCooldown,
  concurrencyFor,
  queueDepth,
  runQueued,
  _resetQueuesForTests,
} from "./queue";

beforeEach(() => {
  _resetQueuesForTests();
});

/** A promise plus the handle to settle it, so a test can hold a queued call
 *  open and inspect the queue while it is in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("concurrencyFor", () => {
  it("allows one at a time on Claude Code", () => {
    // Not a rate limit — each answer is a spawned CLI process drawing on one
    // shared subscription window.
    expect(concurrencyFor("claudeCode")).toBe(1);
  });

  it("allows two elsewhere", () => {
    expect(concurrencyFor("openrouter")).toBe(2);
    expect(concurrencyFor("gemini")).toBe(2);
  });
});

describe("runQueued", () => {
  it("runs immediately when a slot is free", async () => {
    const ran = await runQueued("foundry", 1, async () => "done");
    expect(ran).toBe("done");
  });

  it("holds a second call until the first finishes", async () => {
    const first = deferred<string>();
    const order: string[] = [];

    const a = runQueued("foundry", 1, async () => {
      order.push("a:start");
      const value = await first.promise;
      order.push("a:end");
      return value;
    });
    const b = runQueued("foundry", 1, async () => {
      order.push("b:start");
      return "b";
    });

    // Let both calls get as far as they can. B must not have started.
    await Promise.resolve();
    expect(order).toEqual(["a:start"]);
    expect(queueDepth("foundry")).toBe(1);

    first.resolve("a");
    expect(await a).toBe("a");
    expect(await b).toBe("b");
    expect(order).toEqual(["a:start", "a:end", "b:start"]);
  });

  it("never exceeds the limit, even when a call arrives during the hand-off", async () => {
    // The regression this pins: releasing a slot by decrementing and letting
    // the waiter re-increment leaves a window — resolve() only schedules a
    // microtask — in which a newly arriving call sees a free slot and takes it.
    // The surface then runs two generations where the limit said one.
    let active = 0;
    let peak = 0;
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()];

    const run = (i: number) =>
      runQueued("foundry", 1, async () => {
        active += 1;
        peak = Math.max(peak, active);
        await gates[i].promise;
        active -= 1;
      });

    const a = run(0);
    const b = run(1);
    await Promise.resolve();

    // Release the first and enqueue a third in the same tick.
    gates[0].resolve();
    const c = run(2);

    gates[1].resolve();
    gates[2].resolve();
    await Promise.all([a, b, c]);

    expect(peak).toBe(1);
  });

  it("gives the slot back when the call throws", async () => {
    await expect(
      runQueued("foundry", 1, async () => {
        throw new Error("provider exploded");
      })
    ).rejects.toThrow("provider exploded");

    // Without the `finally`, one provider error would narrow the queue for good
    // and the surface would degrade until restart.
    expect(await runQueued("foundry", 1, async () => "still works")).toBe("still works");
    expect(queueDepth("foundry")).toBe(0);
  });

  it("queues each surface independently", async () => {
    const held = deferred<void>();
    const busy = runQueued("foundry", 1, async () => {
      await held.promise;
    });
    await Promise.resolve();

    // A table mid-answer must not stall a Discord thread.
    expect(await runQueued("discord", 1, async () => "discord ran")).toBe("discord ran");

    held.resolve();
    await busy;
  });

  it("tracks a limit that changed since the queue was created", async () => {
    // The user can switch a surface from Claude Code to OpenRouter between
    // questions; the queue must follow rather than keep the old limit.
    const held = deferred<void>();
    const a = runQueued("foundry", 2, async () => {
      await held.promise;
    });
    const b = runQueued("foundry", 2, async () => "b");
    await Promise.resolve();

    expect(queueDepth("foundry")).toBe(0);
    held.resolve();
    await Promise.all([a, b]);
  });
});

describe("checkCooldown", () => {
  it("allows the first question", () => {
    expect(checkCooldown("foundry", "player-1").allowed).toBe(true);
  });

  it("refuses an immediate repeat and says how long to wait", () => {
    checkCooldown("foundry", "player-1");
    const second = checkCooldown("foundry", "player-1");
    expect(second.allowed).toBe(false);
    expect(second.retryInMs).toBeGreaterThan(0);
    expect(second.retryInMs).toBeLessThanOrEqual(ASKER_COOLDOWN_MS);
  });

  it("does not let one person's cooldown affect another", () => {
    checkCooldown("foundry", "player-1");
    expect(checkCooldown("foundry", "player-2").allowed).toBe(true);
  });

  it("treats the same person on two surfaces as two askers", () => {
    // The same human asking in Foundry and in Discord is not spamming, and
    // being rate-limited in one place because of the other would be baffling.
    checkCooldown("foundry", "same-human");
    expect(checkCooldown("discord", "same-human").allowed).toBe(true);
  });
});
