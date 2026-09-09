import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  fetchOrderMock,
  resumeNostrOrderbookSessionMock,
  resumeOrderChangeHintRuntimeMock,
  startOrderChangeHintRuntimeMock,
  suspendNostrOrderbookSessionMock,
  suspendOrderChangeHintRuntimeMock
} = vi.hoisted(() => ({
  fetchOrderMock: vi.fn(),
  resumeNostrOrderbookSessionMock: vi.fn(),
  resumeOrderChangeHintRuntimeMock: vi.fn(),
  startOrderChangeHintRuntimeMock: vi.fn(),
  suspendNostrOrderbookSessionMock: vi.fn(),
  suspendOrderChangeHintRuntimeMock: vi.fn()
}));

vi.mock("@/domains/nostr/orderChangeHints", () => ({
  resumeOrderChangeHintRuntime: resumeOrderChangeHintRuntimeMock,
  startOrderChangeHintRuntime: startOrderChangeHintRuntimeMock,
  suspendOrderChangeHintRuntime: suspendOrderChangeHintRuntimeMock
}));

vi.mock("@/domains/orderbook/nostrOrderbook", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/domains/orderbook/nostrOrderbook")>()),
  resumeNostrOrderbookSession: resumeNostrOrderbookSessionMock,
  suspendNostrOrderbookSession: suspendNostrOrderbookSessionMock
}));

vi.mock("@/domains/orders/orderActivity", () => ({
  ingestCoordinatorOrder: vi.fn()
}));

vi.mock("@/domains/orders/orderApi", () => ({
  fetchOrder: fetchOrderMock
}));

import {
  coordinatorNeedsHealthRecovery,
  mergeStandardRefreshScopes,
  scheduleAppPrewarm,
  standardRobotRefreshScope
} from "@/app/prewarm";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import { useFederationStore } from "@/domains/coordinators/federationStore";
import {
  type RefreshRobotSlotOptions,
  type RefreshRobotSlotResult,
  type RobotSlot,
  useGarageStore
} from "@/domains/garage/garageStore";
import {
  publishOrderChangeNotification,
  resetOrderChangeNotificationsForTests
} from "@/domains/orders/orderChangeNotifications";
import { publishRefreshIntent } from "@/domains/transport/refreshIntents";
import { useOrderbookStore } from "@/domains/orderbook/orderbookStore";

const slot: RobotSlot = {
  token: "robot-token",
  hashId: "hash",
  tokenSHA256: "token-sha",
  nostrPubKey: "nostr-public",
  nostrSecKey: new Uint8Array(),
  entropyBits: 100,
  hasEnoughEntropy: true,
  shannonEntropy: 4,
  nickname: "Robot",
  earnedRewards: 0,
  robots: {
    lake: {
      token: "robot-token",
      shortAlias: "lake",
      activeOrderId: 42
    },
    temple: {
      token: "robot-token",
      shortAlias: "temple",
      renewableOrderId: 43
    }
  }
};

const coordinator: CoordinatorSummary = {
  shortAlias: "lake",
  longAlias: "Lake",
  color: "#123456",
  url: "https://coordinator.invalid",
  avatarUrl: "",
  smallAvatarUrl: "",
  badgeIcons: [],
  enabled: true,
  online: true
};

const originalRefreshRobotSlot = useGarageStore.getState().refreshRobotSlot;
const originalCoordinators = useFederationStore.getState().coordinators;
const originalConnection = useFederationStore.getState().connection;
const originalNetwork = useFederationStore.getState().network;
const originalOrigin = useFederationStore.getState().origin;
const originalRefreshCoordinator = useFederationStore.getState().refreshCoordinator;
const originalRefreshCoordinators = useFederationStore.getState().refreshCoordinators;
const originalRefreshOrderbook = useOrderbookStore.getState().refreshOrderbook;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  fetchOrderMock.mockReset();
  fetchOrderMock.mockImplementation(async (_url: string, orderId: number) => ({
    id: orderId,
    status: 1,
    is_maker: false,
    is_taker: true
  }));
  startOrderChangeHintRuntimeMock.mockReset();
  startOrderChangeHintRuntimeMock.mockReturnValue(() => undefined);
  resumeNostrOrderbookSessionMock.mockReset();
  suspendNostrOrderbookSessionMock.mockReset();
  resumeOrderChangeHintRuntimeMock.mockReset();
  suspendOrderChangeHintRuntimeMock.mockReset();
  resetOrderChangeNotificationsForTests();
  useGarageStore.setState({
    slots: [slot],
    currentToken: slot.token,
    hydrated: true
  });
});

afterEach(() => {
  useGarageStore.setState({
    slots: [],
    currentToken: undefined,
    hydrated: false,
    refreshRobotSlot: originalRefreshRobotSlot
  });
  useFederationStore.setState({
    coordinators: originalCoordinators,
    connection: originalConnection,
    network: originalNetwork,
    origin: originalOrigin,
    refreshCoordinator: originalRefreshCoordinator,
    refreshCoordinators: originalRefreshCoordinators
  });
  useOrderbookStore.setState({ refreshOrderbook: originalRefreshOrderbook });
  resetOrderChangeNotificationsForTests();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("standard robot order notification targeting", () => {
  it("targets a matching Nostr recipient, coordinator, and order", () => {
    const scope = standardRobotRefreshScope({
      source: "nostr",
      recipientPubkey: "NOSTR-PUBLIC",
      coordinatorPubkey: "coordinator",
      shortAlias: "lake",
      orderId: 42,
      eventId: "event",
      createdAt: 1
    });

    expect([...scope!.orderIdsByAlias!]).toEqual([["lake", new Set([42])]]);
  });

  it("ignores Nostr and native hints that identify another robot or order", () => {
    expect(
      standardRobotRefreshScope({
        source: "nostr",
        recipientPubkey: "another-robot",
        coordinatorPubkey: "coordinator",
        shortAlias: "lake",
        orderId: 42,
        eventId: "event",
        createdAt: 1
      })
    ).toBeUndefined();
    expect(
      standardRobotRefreshScope({
        source: "native",
        orderId: 999
      })
    ).toBeUndefined();
  });

  it("targets a known native order and keeps a missing id as a broad fallback", () => {
    const targeted = standardRobotRefreshScope({
      source: "native",
      shortAlias: "temple",
      orderId: 43
    });
    const broad = standardRobotRefreshScope({ source: "native" });

    expect([...targeted!.orderIdsByAlias!]).toEqual([["temple", new Set([43])]]);
    expect(broad).toEqual({});
  });

  it("does not route a native alias/order pair to another coordinator", () => {
    expect(
      standardRobotRefreshScope({
        source: "native",
        shortAlias: "temple",
        orderId: 42
      })
    ).toBeUndefined();
  });
});

describe("standard robot pending notification scope", () => {
  it("preserves every order queued for the same coordinator during an active refresh", () => {
    const first = standardRobotRefreshScope({
      source: "nostr",
      recipientPubkey: "nostr-public",
      coordinatorPubkey: "coordinator",
      shortAlias: "lake",
      orderId: 42,
      eventId: "first",
      createdAt: 1
    })!;
    const second = standardRobotRefreshScope({
      source: "nostr",
      recipientPubkey: "nostr-public",
      coordinatorPubkey: "coordinator",
      shortAlias: "lake",
      orderId: 44,
      eventId: "second",
      createdAt: 2
    })!;

    const pending = mergeStandardRefreshScopes(first, second);

    expect(pending.orderIdsByAlias?.get("lake")).toEqual(new Set([42, 44]));
  });

  it("keeps queued coordinator scopes separate and lets a broad fallback win", () => {
    const targeted = mergeStandardRefreshScopes(
      {
        orderIdsByAlias: new Map([["lake", new Set([42])]])
      },
      {
        orderIdsByAlias: new Map([["temple", new Set([43])]])
      }
    );

    expect([...targeted.orderIdsByAlias!]).toEqual([
      ["lake", new Set([42])],
      ["temple", new Set([43])]
    ]);
    expect(mergeStandardRefreshScopes(targeted, {})).toEqual({});
  });

  it("fetches every same-coordinator order queued behind an active refresh", async () => {
    const robotResult = { shortAlias: "lake" };
    let releaseFirstRefresh: (() => void) | undefined;
    let refreshCount = 0;
    const refreshRobotSlot = vi.fn(
      (
        _token: string,
        _coordinators: CoordinatorSummary[],
        options?: RefreshRobotSlotOptions
      ): Promise<RefreshRobotSlotResult> => {
        refreshCount += 1;
        if (refreshCount === 1) {
          return new Promise((resolve) => {
            releaseFirstRefresh = () => {
              options?.onCoordinatorResult?.(robotResult);
              resolve({
                slotId: slot.tokenSHA256,
                coordinators: [robotResult]
              });
            };
          });
        }
        options?.onCoordinatorResult?.(robotResult);
        return Promise.resolve({
          slotId: slot.tokenSHA256,
          coordinators: [robotResult]
        });
      }
    );
    useGarageStore.setState({ refreshRobotSlot });
    useFederationStore.setState({
      coordinators: [coordinator],
      refreshCoordinators: vi.fn(async () => undefined)
    });
    vi.stubGlobal(
      "window",
      Object.assign(new EventTarget(), {
        location: {
          pathname: "/",
          host: "client.invalid",
          hostname: "client.invalid"
        },
        setTimeout: globalThis.setTimeout.bind(globalThis),
        clearTimeout: globalThis.clearTimeout.bind(globalThis),
        setInterval: globalThis.setInterval.bind(globalThis),
        clearInterval: globalThis.clearInterval.bind(globalThis)
      })
    );
    vi.stubGlobal("document", { visibilityState: "hidden" });

    const stop = scheduleAppPrewarm();
    try {
      publishNostrOrderChange(42, "first");
      expect(refreshRobotSlot).toHaveBeenCalledOnce();

      publishNostrOrderChange(44, "second");
      publishNostrOrderChange(45, "third");
      expect(refreshRobotSlot).toHaveBeenCalledOnce();

      releaseFirstRefresh!();

      await vi.waitFor(() => expect(refreshRobotSlot).toHaveBeenCalledTimes(2));
      await vi.waitFor(() => {
        expect(fetchOrderMock.mock.calls.map((call) => call[1]).sort()).toEqual([42, 44, 45]);
      });
    } finally {
      stop();
    }
  });
});

describe("Tor recovery prewarm", () => {
  it("recognizes cached offline coordinators as needing a startup health refresh", () => {
    expect(coordinatorNeedsHealthRecovery({ ...coordinator, online: false })).toBe(true);
    expect(coordinatorNeedsHealthRecovery({ ...coordinator, loading: true })).toBe(true);
    expect(coordinatorNeedsHealthRecovery(coordinator)).toBe(false);
  });

  it("forces stale coordinator health through the background lane", async () => {
    vi.useFakeTimers();
    const refreshCoordinators = vi.fn(async () => undefined);
    useFederationStore.setState({
      coordinators: [{ ...coordinator, online: false }],
      refreshCoordinators
    });
    stubRecoveryBrowser();

    const stop = scheduleAppPrewarm();
    try {
      publishRefreshIntent("tor-reconnected");
      await vi.advanceTimersByTimeAsync(1_000);

      expect(refreshCoordinators).toHaveBeenCalledWith({
        force: true,
        priority: "background"
      });
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it("forces all cached coordinator health on Tor startup", async () => {
    vi.useFakeTimers();
    const refreshCoordinators = vi.fn(async () => undefined);
    const refreshCoordinator = vi.fn(async (shortAlias: string) => {
      if (refreshCoordinator.mock.calls.length === 2) {
        useFederationStore.setState((state) => ({
          coordinators: state.coordinators.map((item) =>
            item.shortAlias === shortAlias ? { ...item, online: true, error: undefined } : item
          )
        }));
      }
      return true;
    });
    useFederationStore.setState({
      coordinators: [
        { ...coordinator, online: true, error: "Coordinator unavailable." },
        {
          ...coordinator,
          shortAlias: "temple",
          longAlias: "Temple",
          url: "https://temple.invalid"
        }
      ],
      refreshCoordinator,
      refreshCoordinators
    });
    stubRecoveryBrowser();

    const stop = scheduleAppPrewarm();
    try {
      publishRefreshIntent("tor-ready");
      await vi.advanceTimersByTimeAsync(1_000);

      expect(refreshCoordinators).toHaveBeenCalledWith({
        force: true,
        priority: "background"
      });
      expect(refreshCoordinator).toHaveBeenCalledWith("lake", {
        force: true,
        priority: "background"
      });
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it("stops after two retries when a coordinator remains unavailable", async () => {
    vi.useFakeTimers();
    const refreshCoordinator = vi.fn(async () => true);
    useFederationStore.setState({
      coordinators: [{ ...coordinator, online: false, error: "Coordinator unavailable." }],
      refreshCoordinator,
      refreshCoordinators: vi.fn(async () => undefined)
    });
    stubRecoveryBrowser();

    const stop = scheduleAppPrewarm();
    try {
      publishRefreshIntent("tor-reconnected");
      await vi.advanceTimersByTimeAsync(1_000 + 15_000 + 45_000 + 5 * 60_000);

      expect(refreshCoordinator).toHaveBeenCalledTimes(2);
    } finally {
      stop();
      vi.useRealTimers();
    }
  });

  it("prevents an older in-flight recovery from scheduling retries after a newer Tor event", async () => {
    vi.useFakeTimers();
    let finishInitialRefresh: (() => void) | undefined;
    const refreshCoordinator = vi.fn(async () => true);
    const refreshCoordinators = vi.fn(() => {
      if (finishInitialRefresh) return Promise.resolve();
      return new Promise<void>((resolve) => {
        finishInitialRefresh = resolve;
      });
    });
    useFederationStore.setState({
      coordinators: [{ ...coordinator, online: false, error: "Coordinator unavailable." }],
      refreshCoordinator,
      refreshCoordinators
    });
    stubRecoveryBrowser();

    const stop = scheduleAppPrewarm();
    try {
      publishRefreshIntent("tor-reconnected");
      await vi.advanceTimersByTimeAsync(1_000);
      useFederationStore.setState({
        coordinators: [{ ...coordinator, online: true, error: undefined }]
      });

      publishRefreshIntent("tor-ready");
      finishInitialRefresh!();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(15_000);

      expect(refreshCoordinator).not.toHaveBeenCalled();
    } finally {
      stop();
      vi.useRealTimers();
    }
  });
});

describe("native Nostr lifecycle", () => {
  it("stops hidden retry owners and restarts them only after a foreground refresh intent", () => {
    const stopHints = vi.fn();
    startOrderChangeHintRuntimeMock.mockReturnValue(stopHints);
    const { documentTarget } = stubNativePrewarmBrowser("visible");

    const stop = scheduleAppPrewarm();
    try {
      expect(startOrderChangeHintRuntimeMock).toHaveBeenCalledOnce();
      expect(startOrderChangeHintRuntimeMock).toHaveBeenCalledWith({ suspended: false });
      expect(resumeNostrOrderbookSessionMock).toHaveBeenCalledOnce();

      documentTarget.visibilityState = "hidden";
      documentTarget.dispatchEvent(new Event("visibilitychange"));

      expect(stopHints).not.toHaveBeenCalled();
      expect(suspendOrderChangeHintRuntimeMock).toHaveBeenCalledOnce();
      expect(suspendNostrOrderbookSessionMock).toHaveBeenCalledOnce();

      documentTarget.visibilityState = "visible";
      documentTarget.dispatchEvent(new Event("visibilitychange"));
      expect(resumeOrderChangeHintRuntimeMock).not.toHaveBeenCalled();

      publishRefreshIntent("resume");
      expect(resumeNostrOrderbookSessionMock).toHaveBeenCalledTimes(2);
      expect(startOrderChangeHintRuntimeMock).toHaveBeenCalledOnce();
      expect(resumeOrderChangeHintRuntimeMock).toHaveBeenCalledOnce();
    } finally {
      stop();
    }
  });

  it("starts suspended when the native app is already hidden", () => {
    stubNativePrewarmBrowser("hidden");

    const stop = scheduleAppPrewarm();
    try {
      expect(startOrderChangeHintRuntimeMock).toHaveBeenCalledWith({ suspended: true });
      expect(suspendNostrOrderbookSessionMock).toHaveBeenCalledOnce();
    } finally {
      stop();
    }
  });
});

describe("API orderbook prewarm", () => {
  const secondCoordinator: CoordinatorSummary = {
    ...coordinator,
    shortAlias: "temple",
    longAlias: "Temple",
    url: "https://temple.invalid"
  };

  const idleRobotResult: RefreshRobotSlotResult = {
    slotId: slot.tokenSHA256,
    coordinators: []
  };

  function stubApiPrewarm(coordinators: CoordinatorSummary[]) {
    // The selected standard robot refreshes beside coordinator health, exactly as in
    // the app. Tests settle the two independently so neither hides the other's
    // timing.
    const robotStatus = deferred<RefreshRobotSlotResult>();
    useGarageStore.setState({
      slots: [slot],
      currentToken: slot.token,
      hydrated: true,
      refreshRobotSlot: vi.fn(() => robotStatus.promise)
    });
    useFederationStore.setState({
      connection: "api",
      network: "mainnet",
      origin: "clearnet",
      coordinators,
      refreshCoordinators: vi.fn(async () => undefined)
    });
    const refreshOrderbook = vi.fn<typeof originalRefreshOrderbook>(async () => undefined);
    useOrderbookStore.setState({ refreshOrderbook });
    // Without requestIdleCallback the prewarm scheduler falls through to the
    // plain timer, so advancing the clock runs prewarmData.
    vi.stubGlobal(
      "window",
      Object.assign(new EventTarget(), {
        location: { pathname: "/settings", host: "client.invalid", hostname: "client.invalid" },
        setTimeout: globalThis.setTimeout.bind(globalThis),
        clearTimeout: globalThis.clearTimeout.bind(globalThis),
        setInterval: globalThis.setInterval.bind(globalThis),
        clearInterval: globalThis.clearInterval.bind(globalThis)
      })
    );
    vi.stubGlobal("document", { visibilityState: "visible" });
    return { refreshOrderbook, robotStatus };
  }

  it("starts the known-source book while health and robot refresh are pending", async () => {
    vi.useFakeTimers();
    const health = deferred<void>();
    const { refreshOrderbook, robotStatus } = stubApiPrewarm([coordinator]);
    useFederationStore.setState({ refreshCoordinators: vi.fn(() => health.promise) });

    const stop = scheduleAppPrewarm();
    try {
      await vi.advanceTimersByTimeAsync(500);

      expect(refreshOrderbook).toHaveBeenCalledWith([coordinator], {
        connection: "api",
        network: "mainnet",
        origin: "clearnet",
        priority: "background"
      });

      health.resolve();
      robotStatus.resolve(idleRobotResult);
      await vi.advanceTimersByTimeAsync(0);
      // Both refreshes came back with the same sources, so no second request follows.
      expect(refreshOrderbook).toHaveBeenCalledOnce();
    } finally {
      health.resolve();
      robotStatus.resolve(idleRobotResult);
      stop();
      vi.useRealTimers();
    }
  });

  it("keeps useful book loading when coordinator health rejects", async () => {
    vi.useFakeTimers();
    const health = deferred<void>();
    const { refreshOrderbook, robotStatus } = stubApiPrewarm([coordinator]);
    useFederationStore.setState({ refreshCoordinators: vi.fn(() => health.promise) });

    const stop = scheduleAppPrewarm();
    try {
      await vi.advanceTimersByTimeAsync(500);
      expect(refreshOrderbook).toHaveBeenCalledOnce();

      health.reject(new Error("health check failed"));
      robotStatus.resolve(idleRobotResult);
      await vi.advanceTimersByTimeAsync(0);

      expect(refreshOrderbook).toHaveBeenCalledOnce();
    } finally {
      await health.promise.catch(() => undefined);
      robotStatus.resolve(idleRobotResult);
      stop();
      vi.useRealTimers();
    }
  });

  it("still waits for discovery when the robot refresh fails", async () => {
    // A robot status failure used to end the wait early. The follow-up then read a
    // registry that was still mid-discovery, decided nothing had changed, and the
    // coordinators arriving afterwards never got a book request.
    vi.useFakeTimers();
    const discovery = deferred<void>();
    const { refreshOrderbook, robotStatus } = stubApiPrewarm([coordinator]);
    useFederationStore.setState({
      refreshCoordinators: vi.fn(() =>
        discovery.promise.then(() => {
          useFederationStore.setState({ coordinators: [coordinator, secondCoordinator] });
        })
      )
    });

    const stop = scheduleAppPrewarm();
    try {
      await vi.advanceTimersByTimeAsync(500);
      expect(refreshOrderbook).toHaveBeenCalledOnce();

      robotStatus.reject(new Error("robot status unavailable"));
      await vi.advanceTimersByTimeAsync(0);
      // Discovery is still in flight, so no follow-up has been attempted yet.
      expect(refreshOrderbook).toHaveBeenCalledOnce();

      discovery.resolve();
      await vi.advanceTimersByTimeAsync(0);

      expect(refreshOrderbook).toHaveBeenCalledTimes(2);
      expect(refreshOrderbook.mock.calls[1]?.[0]).toEqual([coordinator, secondCoordinator]);
    } finally {
      robotStatus.resolve(idleRobotResult);
      discovery.resolve();
      stop();
      vi.useRealTimers();
    }
  });

  it("loads the book once discovery provides the first coordinator", async () => {
    vi.useFakeTimers();
    const discovery = deferred<void>();
    const { refreshOrderbook, robotStatus } = stubApiPrewarm([]);
    useFederationStore.setState({
      refreshCoordinators: vi.fn(() =>
        discovery.promise.then(() => {
          useFederationStore.setState({ coordinators: [coordinator] });
        })
      )
    });

    const stop = scheduleAppPrewarm();
    try {
      await vi.advanceTimersByTimeAsync(500);
      expect(refreshOrderbook).not.toHaveBeenCalled();

      robotStatus.resolve(idleRobotResult);
      discovery.resolve();
      await vi.advanceTimersByTimeAsync(0);

      expect(refreshOrderbook).toHaveBeenCalledOnce();
      expect(refreshOrderbook).toHaveBeenCalledWith([coordinator], expect.objectContaining({ priority: "background" }));
    } finally {
      robotStatus.resolve(idleRobotResult);
      discovery.resolve();
      stop();
      vi.useRealTimers();
    }
  });

  it("requests one follow-up refresh when discovery changes the sources", async () => {
    vi.useFakeTimers();
    const discovery = deferred<void>();
    const { refreshOrderbook, robotStatus } = stubApiPrewarm([coordinator]);
    useFederationStore.setState({
      refreshCoordinators: vi.fn(() =>
        discovery.promise.then(() => {
          useFederationStore.setState({ coordinators: [coordinator, secondCoordinator] });
        })
      )
    });

    const stop = scheduleAppPrewarm();
    try {
      await vi.advanceTimersByTimeAsync(500);
      expect(refreshOrderbook).toHaveBeenCalledOnce();

      robotStatus.resolve(idleRobotResult);
      discovery.resolve();
      await vi.advanceTimersByTimeAsync(0);

      expect(refreshOrderbook).toHaveBeenCalledTimes(2);
      expect(refreshOrderbook.mock.calls[1]?.[0]).toEqual([coordinator, secondCoordinator]);
    } finally {
      robotStatus.resolve(idleRobotResult);
      discovery.resolve();
      stop();
      vi.useRealTimers();
    }
  });

  it("drops the follow-up after the connection context changes", async () => {
    vi.useFakeTimers();
    const discovery = deferred<void>();
    const { refreshOrderbook, robotStatus } = stubApiPrewarm([coordinator]);
    useFederationStore.setState({
      refreshCoordinators: vi.fn(() =>
        discovery.promise.then(() => {
          useFederationStore.setState({
            connection: "nostr",
            coordinators: [coordinator, secondCoordinator]
          });
        })
      )
    });

    const stop = scheduleAppPrewarm();
    try {
      await vi.advanceTimersByTimeAsync(500);
      expect(refreshOrderbook).toHaveBeenCalledOnce();

      robotStatus.resolve(idleRobotResult);
      discovery.resolve();
      await vi.advanceTimersByTimeAsync(0);

      expect(refreshOrderbook).toHaveBeenCalledOnce();
    } finally {
      robotStatus.resolve(idleRobotResult);
      discovery.resolve();
      stop();
      vi.useRealTimers();
    }
  });

  it("drops the follow-up when the native app is suspended meanwhile", async () => {
    vi.useFakeTimers();
    const discovery = deferred<void>();
    const { refreshOrderbook, robotStatus } = stubApiPrewarm([coordinator]);
    const { documentTarget, windowTarget } = stubNativePrewarmBrowser("visible");
    windowTarget.requestIdleCallback = vi.fn((callback?: () => void) => {
      callback?.();
      return 1;
    });
    useFederationStore.setState({
      refreshCoordinators: vi.fn(() =>
        discovery.promise.then(() => {
          useFederationStore.setState({ coordinators: [coordinator, secondCoordinator] });
        })
      )
    });

    const stop = scheduleAppPrewarm();
    try {
      await vi.advanceTimersByTimeAsync(500);
      expect(refreshOrderbook).toHaveBeenCalledOnce();

      documentTarget.visibilityState = "hidden";
      robotStatus.resolve(idleRobotResult);
      discovery.resolve();
      await vi.advanceTimersByTimeAsync(0);

      expect(refreshOrderbook).toHaveBeenCalledOnce();
    } finally {
      robotStatus.resolve(idleRobotResult);
      discovery.resolve();
      stop();
      vi.useRealTimers();
    }
  });

  it("keeps the Nostr path ahead of coordinator health", async () => {
    vi.useFakeTimers();
    const book = deferred<void>();
    const { robotStatus } = stubApiPrewarm([coordinator]);
    useFederationStore.setState({
      connection: "nostr",
      refreshCoordinators: vi.fn(async () => undefined)
    });
    const refreshOrderbook = vi.fn<typeof originalRefreshOrderbook>(() => book.promise);
    useOrderbookStore.setState({ refreshOrderbook });

    const stop = scheduleAppPrewarm();
    try {
      await vi.advanceTimersByTimeAsync(500);

      expect(refreshOrderbook).toHaveBeenCalledWith([coordinator], expect.objectContaining({ connection: "nostr" }));
      expect(useFederationStore.getState().refreshCoordinators).not.toHaveBeenCalled();

      book.resolve();
      robotStatus.resolve(idleRobotResult);
      await vi.advanceTimersByTimeAsync(0);

      expect(useFederationStore.getState().refreshCoordinators).toHaveBeenCalledOnce();
    } finally {
      book.resolve();
      robotStatus.resolve(idleRobotResult);
      stop();
      vi.useRealTimers();
    }
  });
});

function stubRecoveryBrowser(): void {
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), {
      location: {
        pathname: "/settings",
        host: "client.invalid",
        hostname: "client.invalid"
      },
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      setInterval: globalThis.setInterval.bind(globalThis),
      clearInterval: globalThis.clearInterval.bind(globalThis),
      requestIdleCallback: vi.fn(() => 1),
      cancelIdleCallback: vi.fn()
    })
  );
  vi.stubGlobal("document", { visibilityState: "hidden" });
}

function stubNativePrewarmBrowser(initialVisibility: DocumentVisibilityState) {
  const windowTarget = Object.assign(new EventTarget(), {
    location: {
      pathname: "/settings",
      host: "client.invalid",
      hostname: "client.invalid"
    },
    AndroidAppRobosats: {
      httpRequest: vi.fn(),
      getTorStatus: vi.fn(() => JSON.stringify({ connected: true })),
      getTorDiagnostics: vi.fn(() => JSON.stringify({ connected: true, state: "connected" }))
    },
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
    requestIdleCallback: vi.fn(() => 1),
    cancelIdleCallback: vi.fn()
  });
  const documentTarget = Object.assign(new EventTarget(), {
    visibilityState: initialVisibility
  });
  vi.stubGlobal("window", windowTarget);
  vi.stubGlobal("document", documentTarget);
  return { documentTarget, windowTarget };
}

function publishNostrOrderChange(orderId: number, eventId: string): void {
  publishOrderChangeNotification({
    source: "nostr",
    recipientPubkey: "nostr-public",
    coordinatorPubkey: "coordinator",
    shortAlias: "lake",
    orderId,
    eventId,
    createdAt: orderId
  });
}
