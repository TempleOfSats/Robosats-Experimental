export type MapPosition = [number, number];

export const MAP_MIN_LATITUDE = -60;
export const MAP_MAX_LATITUDE = 90;
export const MAP_LATITUDE_SPAN = MAP_MAX_LATITUDE - MAP_MIN_LATITUDE;
export const MAP_DEFAULT_CENTER: MapPosition = [
  (MAP_MIN_LATITUDE + MAP_MAX_LATITUDE) / 2,
  0
];

export function clampMapCenter(position: MapPosition, zoom: number): MapPosition {
  const halfHeight = MAP_LATITUDE_SPAN / 2 / zoom;
  const halfWidth = 180 / zoom;
  return [
    Math.min(
      MAP_MAX_LATITUDE - halfHeight,
      Math.max(MAP_MIN_LATITUDE + halfHeight, position[0])
    ),
    Math.min(180 - halfWidth, Math.max(-180 + halfWidth, position[1]))
  ];
}

export function clampMapPosition(position: MapPosition): MapPosition {
  return [
    Math.min(MAP_MAX_LATITUDE, Math.max(MAP_MIN_LATITUDE, position[0])),
    Math.min(180, Math.max(-180, position[1]))
  ];
}
