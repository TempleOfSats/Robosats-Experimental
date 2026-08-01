import { describe, expect, it } from "vitest";
import {
  boundMapZoom,
  featureCollectionPath,
  F2F_WHEEL_ZOOM_FACTOR,
  hasDraggedBeyondThreshold,
  mapPointAtClient,
  mapViewBox,
  pannedMapCenter,
  zoomedMapView
} from "@/domains/location/useF2FWorldMap";

describe("F2F world map", () => {
  it("projects polygon and multipolygon geometry while omitting Antarctica", () => {
    expect(
      featureCollectionPath({
        features: [
          { geometry: null },
          {
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [0, 0],
                  [10, 0],
                  [10, 10],
                  [0, 0]
                ]
              ]
            }
          },
          {
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [0, -80],
                  [10, -80],
                  [0, -70],
                  [0, -80]
                ]
              ]
            }
          },
          {
            geometry: {
              type: "MultiPolygon",
              coordinates: [
                [
                  [
                    [20, -60],
                    [30, -50],
                    [20, -60]
                  ]
                ]
              ]
            }
          }
        ]
      })
    ).toBe("M180 90 L190 90 L190 80 L180 90 Z M200 150 L210 140 L200 150 Z");
  });

  it("retains the existing world and zoomed view boxes", () => {
    expect(mapViewBox([15, 0], 1)).toBe("0 0 360 150");
    expect(mapViewBox([40, -74], 8)).toBe("83.5 40.625 45 18.75");
  });

  it("keeps the client-space anchor fixed while zooming", () => {
    const rect = { height: 200, left: 100, top: 50, width: 400 };
    const point = mapPointAtClient([15, 0], 2, rect, 400, 100);

    expect(point).toEqual({
      position: [33.75, 45],
      ratioX: 0.75,
      ratioY: 0.25
    });

    const view = zoomedMapView(point!, 4, 1, 16);
    expect(view).toEqual({ center: [24.375, 22.5], zoom: 4 });
    expect(mapPointAtClient(view.center, view.zoom, rect, 400, 100)?.position).toEqual(point?.position);
  });

  it("clamps zoom, anchored centers, and dragged centers to the map extent", () => {
    expect(F2F_WHEEL_ZOOM_FACTOR).toBe(1.35);
    expect(boundMapZoom(100, 1, 16)).toBe(16);
    expect(boundMapZoom(0.1, 1, 32)).toBe(1);
    expect(
      zoomedMapView(
        {
          position: [90, 180],
          ratioX: 1,
          ratioY: 0
        },
        100,
        1,
        16
      )
    ).toEqual({
      center: [85.3125, 168.75],
      zoom: 16
    });
    expect(pannedMapCenter([50, 100], 2, { height: 200, width: 400 }, 800, 800)).toEqual([52.5, -90]);
  });

  it("preserves the location click threshold and immediate offers-map drag", () => {
    expect(hasDraggedBeyondThreshold(3, 2, 5)).toBe(false);
    expect(hasDraggedBeyondThreshold(3, 3, 5)).toBe(true);
    expect(hasDraggedBeyondThreshold(0.1, 0, 0)).toBe(true);
  });

  it("ignores client coordinates when the map has no rendered size", () => {
    expect(
      mapPointAtClient(
        [15, 0],
        1,
        {
          height: 0,
          left: 0,
          top: 0,
          width: 360
        },
        10,
        10
      )
    ).toBeUndefined();
  });
});
