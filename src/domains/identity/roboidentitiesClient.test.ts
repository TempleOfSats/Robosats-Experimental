import { describe, expect, it } from "vitest";
import { generateRoboname } from "@/domains/identity/roboidentitiesClient";

describe("roboidentitiesClient", () => {
  it("generates stable current robonames", () => {
    const hashId = "8a08288cd13b6d9ee9bf26fa13f37d968f7e7c281939fc4221c09e4e70a625a0";
    expect(generateRoboname(hashId)).toBe(generateRoboname(hashId));
    expect(generateRoboname(hashId).length).toBeGreaterThan(4);
  });
});
