import { describe, expect, it } from "vitest";
import { compareCoordinatorsByEstablished } from "@/domains/coordinators/coordinatorOrder";

describe("compareCoordinatorsByEstablished", () => {
  it("orders established coordinators from oldest to newest", () => {
    const coordinators = [
      { longAlias: "Newest", established: "2025-05-20" },
      { longAlias: "Oldest", established: "2023-12-02" },
      { longAlias: "Middle", established: "2023-12-30" }
    ];

    expect(coordinators.sort(compareCoordinatorsByEstablished).map((item) => item.longAlias)).toEqual([
      "Oldest",
      "Middle",
      "Newest"
    ]);
  });

  it("places custom coordinators without a date last", () => {
    const coordinators = [
      { longAlias: "Custom" },
      { longAlias: "Federated", established: "2024-01-01" }
    ];

    expect(coordinators.sort(compareCoordinatorsByEstablished).map((item) => item.longAlias)).toEqual([
      "Federated",
      "Custom"
    ]);
  });
});
