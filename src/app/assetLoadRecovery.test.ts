// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installAssetLoadRecovery } from "@/app/assetLoadRecovery";

let uninstall: () => void = () => undefined;

describe("asset load recovery", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    uninstall();
    vi.restoreAllMocks();
  });

  it("reloads once when a lazy chunk from the running generation is unavailable", () => {
    const reload = vi.spyOn(window.location, "reload").mockImplementation(() => undefined);
    uninstall = installAssetLoadRecovery("http://example.test/assets/d718862720c9/robosats-exp.index.js");

    const firstFailure = new Event("vite:preloadError", { cancelable: true });
    window.dispatchEvent(firstFailure);
    const repeatedFailure = new Event("vite:preloadError", { cancelable: true });
    window.dispatchEvent(repeatedFailure);

    expect(firstFailure.defaultPrevented).toBe(true);
    expect(repeatedFailure.defaultPrevented).toBe(false);
    expect(window.sessionStorage.getItem("robosats:asset-load-retry-generation")).toBe("d718862720c9");
    expect(reload).toHaveBeenCalledOnce();
  });

  it("lets the error boundary handle a generation that already retried", () => {
    window.sessionStorage.setItem("robosats:asset-load-retry-generation", "d718862720c9");
    const reload = vi.spyOn(window.location, "reload").mockImplementation(() => undefined);
    uninstall = installAssetLoadRecovery("http://example.test/assets/d718862720c9/robosats-exp.index.js");

    const failure = new Event("vite:preloadError", { cancelable: true });
    window.dispatchEvent(failure);

    expect(failure.defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it.each(["getItem", "setItem"] as const)(
    "uses the error boundary when session storage %s is unavailable",
    (operation) => {
      vi.spyOn(window.sessionStorage, operation).mockImplementation(() => {
        throw new Error("Storage unavailable");
      });
      const reload = vi.spyOn(window.location, "reload").mockImplementation(() => undefined);
      uninstall = installAssetLoadRecovery("http://example.test/assets/d718862720c9/robosats-exp.index.js");

      const failure = new Event("vite:preloadError", { cancelable: true });
      window.dispatchEvent(failure);

      expect(failure.defaultPrevented).toBe(false);
      expect(reload).not.toHaveBeenCalled();
    }
  );
});
