const ROBOT_DATA_REFRESH_EVENT = "robosats:robot-data-refresh";

export function requestRobotDataRefresh(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ROBOT_DATA_REFRESH_EVENT));
}

export function subscribeRobotDataRefresh(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(ROBOT_DATA_REFRESH_EVENT, listener);
  return () => window.removeEventListener(ROBOT_DATA_REFRESH_EVENT, listener);
}
