export type RefreshRobotCoordinatorResult = {
  shortAlias: string;
  cached?: boolean;
  found?: boolean;
  activeOrderId?: number;
  lastOrderId?: number;
  renewableOrderId?: number;
  releasedOrderId?: number;
  error?: string;
  transportFailed?: boolean;
};

export type RefreshRobotSlotResult = {
  slotId: string;
  coordinators: RefreshRobotCoordinatorResult[];
};

type RobotRefreshListener = (result: RefreshRobotSlotResult) => void;

const listeners = new Set<RobotRefreshListener>();

export function publishRobotRefreshResult(result: RefreshRobotSlotResult): RefreshRobotSlotResult {
  for (const listener of listeners) {
    try {
      listener(result);
    } catch {
      // Refresh observers must not turn a completed coordinator request into a failure.
    }
  }
  return result;
}

export function subscribeRobotRefreshResults(listener: RobotRefreshListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
