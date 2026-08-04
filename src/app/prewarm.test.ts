import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchOrderMock, startOrderChangeHintRuntimeMock } = vi.hoisted(() => ({
  fetchOrderMock: vi.fn(),
  startOrderChangeHintRuntimeMock: vi.fn()
}));

vi.mock("@/domains/nostr/orderChangeHints", () => ({
  startOrderChangeHintRuntime: startOrderChangeHintRuntimeMock
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
const originalRefreshCoordinator = useFederationStore.getState().refreshCoordinator;
const originalRefreshCoordinators = useFederationStore.getState().refreshCoordinators;

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
    refreshCoordinator: originalRefreshCoordinator,
    refreshCoordinators: originalRefreshCoordinators
  });
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
