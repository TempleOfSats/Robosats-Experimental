import { describe, expect, it } from "vitest";
import {
  clampMapCenter,
  clampMapPosition,
  MAP_DEFAULT_CENTER,
  MAP_MIN_LATITUDE
} from "@/domains/location/f2fMapViewport";

describe("F2F map viewport", () => {
  it("frames the inhabited world above the Antarctic boundary", () => {
    expect(MAP_MIN_LATITUDE).toBe(-60);
    expect(MAP_DEFAULT_CENTER).toEqual([15, 0]);
    expect(clampMapPosition([-90, 0])).toEqual([-60, 0]);
  });

  it("keeps a zoomed viewport inside the supported map extent", () => {
    expect(clampMapCenter([-90, 200], 2)).toEqual([-22.5, 90]);
    expect(clampMapCenter([90, -200], 2)).toEqual([52.5, -90]);
  });
});
