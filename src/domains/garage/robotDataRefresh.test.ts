import { afterEach, describe, expect, it, vi } from "vitest";
import { requestRobotDataRefresh, subscribeRobotDataRefresh } from "@/domains/garage/robotDataRefresh";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("robot data refresh intent", () => {
  it("notifies subscribers and removes them cleanly", () => {
    vi.stubGlobal("window", new EventTarget());
    const listener = vi.fn();
    const unsubscribe = subscribeRobotDataRefresh(listener);

    requestRobotDataRefresh();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    requestRobotDataRefresh();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
