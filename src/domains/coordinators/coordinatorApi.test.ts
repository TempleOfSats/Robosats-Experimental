import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchCoordinatorBook,
  fetchCoordinatorInfo,
  fetchCoordinatorLimits
} from "@/domains/coordinators/coordinatorApi";
import { apiClient } from "@/domains/transport/apiWebClient";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("coordinator API request priority", () => {
  it("uses the interactive profile for a visible selected-coordinator check", async () => {
    const get = vi.spyOn(apiClient, "get").mockResolvedValue({});

    await fetchCoordinatorInfo("http://coordinator.onion", { priority: "visible" });

    expect(get).toHaveBeenCalledWith("http://coordinator.onion", "/api/info/", undefined, {
      bypassCircuit: undefined,
      priority: "visible",
      source: "federation",
      timeoutProfile: "interactive"
    });
  });

  it("keeps background federation enrichment at maintenance priority", async () => {
    const get = vi.spyOn(apiClient, "get").mockResolvedValue({});

    await fetchCoordinatorLimits("http://coordinator.onion");

    expect(get).toHaveBeenCalledWith("http://coordinator.onion", "/api/limits/", undefined, {
      bypassCircuit: undefined,
      priority: "maintenance",
      source: "federation",
      timeoutProfile: "background"
    });
  });

  it("uses the short background profile for opportunistic orderbook warm-up", async () => {
    const get = vi.spyOn(apiClient, "get").mockResolvedValue([]);

    await fetchCoordinatorBook("http://coordinator.onion", { priority: "background" });

    expect(get).toHaveBeenCalledWith("http://coordinator.onion", "/api/book/", undefined, {
      bypassCircuit: undefined,
      priority: "background",
      source: "prewarm",
      timeoutProfile: "background"
    });
  });

  it("promotes a visible orderbook load to the interactive profile", async () => {
    const get = vi.spyOn(apiClient, "get").mockResolvedValue([]);

    await fetchCoordinatorBook("http://coordinator.onion", { priority: "visible" });

    expect(get).toHaveBeenCalledWith("http://coordinator.onion", "/api/book/", undefined, {
      bypassCircuit: undefined,
      priority: "visible",
      source: "orderbook-fallback",
      timeoutProfile: "interactive"
    });
  });
});
