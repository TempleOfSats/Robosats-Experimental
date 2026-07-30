import { describe, expect, it, vi } from "vitest";
import type { Event, Filter } from "nostr-tools";
import type { SubCloser, SubscribeManyParams } from "nostr-tools/pool";
import { LiveRelaySubscriptionManager } from "@/domains/nostr/liveRelaySubscriptions";

describe("live relay subscription manager", () => {
  it("replaces independent live REQs with one multi-filter REQ per relay", async () => {
    const harness = poolHarness();
    const manager = new LiveRelaySubscriptionManager(harness.pool);
    manager.subscribeMany(["wss://relay.example"], { kinds: [38383] }, {});
    manager.subscribeMany(["wss://relay.example"], { kinds: [28383] }, {});
    manager.subscribeMany(["wss://relay.example"], { kinds: [30078] }, {});

    await vi.waitFor(() => expect(harness.requests.at(-1)?.requests).toHaveLength(3));

    expect(harness.maximumActive).toBe(1);
    expect(harness.requests.at(-1)?.requests).toEqual([
      { url: "wss://relay.example", filter: { kinds: [38383] } },
      { url: "wss://relay.example", filter: { kinds: [28383] } },
      { url: "wss://relay.example", filter: { kinds: [30078] } }
    ]);
  });

  it("dispatches multiplexed events only to matching logical consumers", async () => {
    const harness = poolHarness();
    const manager = new LiveRelaySubscriptionManager(harness.pool);
    const onOrder = vi.fn();
    const onHint = vi.fn();
    manager.subscribeMany(["wss://relay.example"], { kinds: [38383] }, { onevent: onOrder });
    manager.subscribeMany(["wss://relay.example"], { kinds: [28383] }, { onevent: onHint });
    await vi.waitFor(() => expect(harness.requests.at(-1)?.requests).toHaveLength(2));
    const request = harness.requests.at(-1)!;
    request.params.onevent?.(event(38383));
    request.params.onevent?.(event(28383));
    request.params.onevent?.(event(30078));

    expect(onOrder).toHaveBeenCalledOnce();
    expect(onHint).toHaveBeenCalledOnce();
  });

  it("removes logical subscriptions without overlapping physical REQs", async () => {
    const harness = poolHarness();
    const manager = new LiveRelaySubscriptionManager(harness.pool);
    const order = manager.subscribeMany(["wss://relay.example"], { kinds: [38383] }, {});
    manager.subscribeMany(["wss://relay.example"], { kinds: [30078] }, {});
    await vi.waitFor(() => expect(harness.requests).toHaveLength(1));

    order.close("orderbook-idle");
    await vi.waitFor(() => expect(harness.requests).toHaveLength(2));

    expect(harness.maximumActive).toBe(1);
    expect(harness.requests.at(-1)?.requests).toEqual([
      { url: "wss://relay.example", filter: { kinds: [30078] } }
    ]);
  });

  it("notifies logical consumers once when the physical relay request closes", () => {
    const harness = poolHarness();
    const manager = new LiveRelaySubscriptionManager(harness.pool, { rebuildDelayMs: 0 });
    const firstClose = vi.fn();
    const secondClose = vi.fn();
    manager.subscribeMany(["wss://relay.example"], { kinds: [38383] }, { onclose: firstClose });
    manager.subscribeMany(["wss://other.example"], { kinds: [30078] }, { onclose: secondClose });

    harness.requests[0].params.onclose?.(["network-error"]);

    expect(firstClose).toHaveBeenCalledWith(["network-error"]);
    expect(secondClose).not.toHaveBeenCalled();
  });

  it("does not reopen a retired relay state after reset during an asynchronous close", async () => {
    let releaseClose: () => void = () => undefined;
    const closePending = new Promise<void>((resolve) => { releaseClose = resolve; });
    const subscribeMap = vi.fn()
      .mockReturnValueOnce({ close: () => closePending })
      .mockReturnValue({ close: () => undefined });
    const manager = new LiveRelaySubscriptionManager({ subscribeMap }, { rebuildDelayMs: 0 });
    manager.subscribeMany(["wss://relay.example"], { kinds: [38383] }, {});
    manager.subscribeMany(["wss://relay.example"], { kinds: [30078] }, {});

    manager.reset();
    releaseClose();
    await Promise.resolve();
    await Promise.resolve();

    expect(subscribeMap).toHaveBeenCalledOnce();
  });

  it("coalesces a burst of filter changes into one physical relay request", async () => {
    vi.useFakeTimers();
    const harness = poolHarness();
    const manager = new LiveRelaySubscriptionManager(harness.pool, { rebuildDelayMs: 50 });
    const discarded = manager.subscribeMany(["wss://relay.example"], { kinds: [1] }, {});
    manager.subscribeMany(["wss://relay.example"], { kinds: [38383] }, {});
    manager.subscribeMany(["wss://relay.example"], { kinds: [30078] }, {});
    discarded.close();

    expect(harness.requests).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(50);

    expect(harness.requests).toHaveLength(1);
    expect(harness.requests[0].requests).toEqual([
      { url: "wss://relay.example", filter: { kinds: [38383] } },
      { url: "wss://relay.example", filter: { kinds: [30078] } }
    ]);
    expect(harness.maximumActive).toBe(1);
    vi.useRealTimers();
  });

  it("delays a removal-only rebuild to absorb short route transitions", async () => {
    vi.useFakeTimers();
    const harness = poolHarness();
    const manager = new LiveRelaySubscriptionManager(harness.pool, {
      rebuildDelayMs: 50,
      removalRebuildDelayMs: 400
    });
    const subscription = manager.subscribeMany(["wss://relay.example"], { kinds: [38383] }, {});
    await vi.advanceTimersByTimeAsync(50);

    subscription.close("route-changed");
    await vi.advanceTimersByTimeAsync(399);
    expect(harness.requests[0].close).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(harness.requests[0].close).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("promotes a pending removal rebuild when a new consumer arrives", async () => {
    vi.useFakeTimers();
    const harness = poolHarness();
    const manager = new LiveRelaySubscriptionManager(harness.pool, {
      rebuildDelayMs: 50,
      removalRebuildDelayMs: 400
    });
    const previous = manager.subscribeMany(["wss://relay.example"], { kinds: [38383] }, {});
    await vi.advanceTimersByTimeAsync(50);

    previous.close("route-changed");
    await vi.advanceTimersByTimeAsync(100);
    manager.subscribeMany(["wss://relay.example"], { kinds: [30078] }, {});
    await vi.advanceTimersByTimeAsync(49);
    expect(harness.requests).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(harness.requests).toHaveLength(2);
    expect(harness.requests[1].requests).toEqual([
      { url: "wss://relay.example", filter: { kinds: [30078] } }
    ]);
    expect(harness.maximumActive).toBe(1);
    vi.useRealTimers();
  });
});

function poolHarness() {
  const requests: Array<{
    requests: Array<{ url: string; filter: Filter }>;
    params: SubscribeManyParams;
    close: ReturnType<typeof vi.fn>;
  }> = [];
  let active = 0;
  let maximumActive = 0;
  const pool = {
    subscribeMap(mapped: Array<{ url: string; filter: Filter }>, params: SubscribeManyParams): SubCloser {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      let closed = false;
      const close = vi.fn(() => {
        if (closed) return;
        closed = true;
        active -= 1;
      });
      requests.push({ requests: mapped, params, close });
      return { close };
    }
  };
  return {
    pool,
    requests,
    get maximumActive() {
      return maximumActive;
    }
  };
}

function event(kind: number): Event {
  return {
    id: `${kind}`.padStart(64, "0"),
    pubkey: "1".repeat(64),
    created_at: 1,
    kind,
    tags: [],
    content: "",
    sig: "2".repeat(128)
  };
}
