import { useFederationStore } from "@/domains/coordinators/federationStore";
import { useGarageStore } from "@/domains/garage/garageStore";
import { didRobotCoordinatorRefreshSucceed } from "@/domains/garage/robotRefreshEvents";
import { subscribeCoordinatorOrderActivity, type CoordinatorOrderObservation } from "@/domains/orders/orderActivity";
import { disputeOutcomeForCurrentRobot } from "@/domains/orders/orderStateMachine";

const MAX_REFRESHED_DISPUTES = 32;

const refreshedDisputes = new Set<string>();
const refreshesInFlight = new Set<string>();
let stopRuntime: (() => void) | undefined;

export function startDisputeRewardRefreshRuntime(): () => void {
  if (stopRuntime) return stopRuntime;
  let stopped = false;
  const unsubscribe = subscribeCoordinatorOrderActivity(
    (observation) => {
      if (stopped) return;
      refreshWinningRobot(observation, () => stopped);
    },
    { replay: true }
  );
  stopRuntime = () => {
    stopped = true;
    unsubscribe();
    refreshesInFlight.clear();
    stopRuntime = undefined;
  };
  return stopRuntime;
}

export function stopDisputeRewardRefreshRuntimeForTests(): void {
  stopRuntime?.();
  refreshedDisputes.clear();
  refreshesInFlight.clear();
}

function refreshWinningRobot(observation: CoordinatorOrderObservation, isStopped: () => boolean): void {
  if (!observation.authoritative || disputeOutcomeForCurrentRobot(observation.order) !== "won") return;
  const key = `${observation.slotId}:${observation.shortAlias}:${observation.order.id}`;
  if (refreshedDisputes.has(key) || refreshesInFlight.has(key)) return;

  const slot = useGarageStore.getState().slots.find((item) => item.tokenSHA256 === observation.slotId);
  const coordinator = useFederationStore
    .getState()
    .coordinators.find((item) => item.shortAlias === observation.shortAlias);
  if (!slot || !coordinator?.enabled || !coordinator.url) return;

  refreshesInFlight.add(key);
  void useGarageStore
    .getState()
    .refreshRobotSlot(slot.token, [coordinator], {
      maxAgeMs: 0,
      preferredAliases: [observation.shortAlias],
      priority: "background",
      source: "robot-refresh",
      supersedeInFlight: true
    })
    .then((result) => {
      if (isStopped()) return;
      if (didRobotCoordinatorRefreshSucceed(result, observation.shortAlias)) {
        rememberRefreshedDispute(key);
      }
    })
    .catch(() => undefined)
    .finally(() => {
      refreshesInFlight.delete(key);
    });
}

function rememberRefreshedDispute(key: string): void {
  refreshedDisputes.add(key);
  while (refreshedDisputes.size > MAX_REFRESHED_DISPUTES) {
    const oldest = refreshedDisputes.values().next().value;
    if (!oldest) return;
    refreshedDisputes.delete(oldest);
  }
}
