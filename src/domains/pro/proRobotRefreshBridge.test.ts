import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deriveRobotIdentity } from "@/domains/identity/robotIdentity";
import {
  publishRobotRefreshResult
} from "@/domains/garage/robotRefreshEvents";
import { useGarageStore, type RobotSlot } from "@/domains/garage/garageStore";
import {
  useGarageVaultStore
} from "@/domains/pro/garageVaultStore";
import {
  createGarageManifest,
  garageTokenId
} from "@/domains/pro/garageVault";
import {
  recordProRobotRefreshResult,
  slotsNeedingCoordinatorRetry,
  startProRobotRefreshBridge
} from "@/domains/pro/proRobotRefreshBridge";
import { deriveProRobotLifecycle } from "@/domains/pro/proRobotLifecycle";
import { useProTradeIndexStore } from "@/domains/pro/proTradeIndexStore";

describe("PRO robot refresh bridge", () => {
  beforeEach(() => {
    useGarageStore.setState({ slots: [], currentToken: undefined, hydrated: true });
    useGarageVaultStore.setState({
      status: "ready",
      manifest: undefined,
      envelope: undefined,
      error: undefined
    });
    useProTradeIndexStore.getState().resetRuntimeCache();
  });

  afterEach(() => {
    useGarageStore.setState({ slots: [], currentToken: undefined, hydrated: false });
    useGarageVaultStore.setState({
      status: "idle",
      manifest: undefined,
      envelope: undefined,
      error: undefined
    });
    useProTradeIndexStore.getState().resetRuntimeCache();
  });

  it("turns a Fleet robot ready after any successful Garage refresh", () => {
    const slot = installFleetSlot();
    recordProRobotRefreshResult({
      slotId: slot.tokenSHA256,
      coordinators: [
        { shortAlias: "lake", found: false },
        { shortAlias: "temple", found: false }
      ]
    }, 100);

    const sync = useProTradeIndexStore.getState().syncBySlot[slot.tokenSHA256];
    expect(sync).toMatchObject({
      attemptedCoordinators: 2,
      lastAttemptAt: 100,
      lastSuccessAt: 100
    });
    expect(deriveProRobotLifecycle(slot, {}, sync)).toMatchObject({
      status: "ready",
      verification: "coordinator"
    });
  });

  it("distinguishes no coordinator attempts from failed requests", () => {
    const slot = installFleetSlot();

    recordProRobotRefreshResult({ slotId: slot.tokenSHA256, coordinators: [] }, 100);
    expect(deriveProRobotLifecycle(
      slot,
      {},
      useProTradeIndexStore.getState().syncBySlot[slot.tokenSHA256]
    ).status).toBe("waiting");

    recordProRobotRefreshResult({
      slotId: slot.tokenSHA256,
      coordinators: [{ shortAlias: "lake", error: "offline" }]
    }, 200);
    expect(deriveProRobotLifecycle(
      slot,
      {},
      useProTradeIndexStore.getState().syncBySlot[slot.tokenSHA256]
    ).status).toBe("unavailable");
  });

  it("observes shared refresh results and ignores standard Garage robots", () => {
    const fleetSlot = installFleetSlot();
    const standardSlot = robotSlot("standard-robot-token", undefined);
    useGarageStore.setState((state) => ({ slots: [...state.slots, standardSlot] }));
    const stop = startProRobotRefreshBridge();

    publishRobotRefreshResult({
      slotId: fleetSlot.tokenSHA256,
      coordinators: [{ shortAlias: "lake", found: false }]
    });
    publishRobotRefreshResult({
      slotId: standardSlot.tokenSHA256,
      coordinators: [{ shortAlias: "lake", found: false }]
    });
    stop();

    expect(useProTradeIndexStore.getState().syncBySlot[fleetSlot.tokenSHA256]?.lastSuccessAt)
      .toBeTypeOf("number");
    expect(useProTradeIndexStore.getState().syncBySlot[standardSlot.tokenSHA256]).toBeUndefined();
  });

  it("selects only idle zero-attempt slots for coordinator retry", () => {
    expect(slotsNeedingCoordinatorRetry(["waiting", "ready", "running"], {
      waiting: {
        slotId: "waiting",
        epoch: 0,
        inFlight: false,
        attemptedCoordinators: 0,
        lastAttemptAt: 1
      },
      ready: {
        slotId: "ready",
        epoch: 0,
        inFlight: false,
        attemptedCoordinators: 0,
        lastAttemptAt: 1,
        lastSuccessAt: 2
      },
      running: {
        slotId: "running",
        epoch: 0,
        inFlight: true,
        attemptedCoordinators: 0,
        lastAttemptAt: 1
      }
    })).toEqual(["waiting"]);
  });
});

function installFleetSlot(): RobotSlot {
  const slot = robotSlot("fleet-robot-token", "fleet");
  useGarageStore.setState({ slots: [slot], currentToken: slot.token });
  const manifest = createGarageManifest("ffeeddccbbaa99887766554433221100");
  manifest.entries.push({
    id: "00112233445566778899aabbccddeeff",
    tokenId: garageTokenId(slot.token),
    nickname: slot.nickname,
    revision: 1,
    deviceId: manifest.deviceId,
    deleted: false,
    updatedAt: 1
  });
  useGarageVaultStore.setState({ status: "ready", manifest });
  return slot;
}

function robotSlot(token: string, managedBy: "fleet" | undefined): RobotSlot {
  const identity = deriveRobotIdentity(token.padEnd(40, "x"));
  return {
    ...identity,
    nickname: managedBy ? "FleetRobot" : "StandardRobot",
    managedBy,
    earnedRewards: 0,
    robots: {
      local: {
        token: identity.token,
        shortAlias: "local",
        tokenSHA256: identity.tokenSHA256,
        nostrPubKey: identity.nostrPubKey
      }
    }
  };
}
