import { describe, expect, it, vi } from "vitest";
import { federationLottery } from "@/domains/coordinators/federationLottery";

describe("federationLottery", () => {
  it("returns coordinator aliases using the current weighted shuffle shape", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    expect(
      federationLottery([
        {
          shortAlias: "a",
          longAlias: "A",
          color: "#000",
          badges: { donatesToDevFund: 10 }
        },
        {
          shortAlias: "b",
          longAlias: "B",
          color: "#000",
          badges: { donatesToDevFund: 80 }
        }
      ])
    ).toEqual(["b", "a"]);

    vi.restoreAllMocks();
  });
});
