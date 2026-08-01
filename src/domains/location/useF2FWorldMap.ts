import {
  type Dispatch,
  type PointerEvent,
  type RefObject,
  type SetStateAction,
  type WheelEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  clampMapCenter,
  clampMapPosition,
  MAP_LATITUDE_SPAN,
  MAP_MIN_LATITUDE,
  type MapPosition
} from "@/domains/location/f2fMapViewport";

type Coordinate = [number, number];
type PolygonGeometry = {
  type: "Polygon";
  coordinates: Coordinate[][];
};
type MultiPolygonGeometry = {
  type: "MultiPolygon";
  coordinates: Coordinate[][][];
};
type WorldFeatureCollection = {
  features: Array<{ geometry: PolygonGeometry | MultiPolygonGeometry | null }>;
};
type PointerCoordinates = { x: number; y: number };
type MapRect = Pick<DOMRect, "height" | "left" | "top" | "width">;
type MapPoint = {
  position: MapPosition;
  ratioX: number;
  ratioY: number;
};

type UseF2FWorldMapOptions = {
  dragThreshold: number;
  initialCenter: MapPosition;
  initialZoom: number;
  maxZoom: number;
  minZoom: number;
  onMapClick?: (position: MapPosition) => void;
  onPointerStart?: () => void;
};

type UseF2FWorldMapResult = {
  center: MapPosition;
  changeZoom: (nextZoom: number) => void;
  handlePointerCancel: (event: PointerEvent<SVGSVGElement>) => void;
  handlePointerDown: (event: PointerEvent<SVGSVGElement>) => void;
  handlePointerMove: (event: PointerEvent<SVGSVGElement>) => void;
  handlePointerUp: (event: PointerEvent<SVGSVGElement>) => void;
  handleWheel: (event: WheelEvent<SVGSVGElement>) => void;
  mapError: boolean;
  mapLoaded: boolean;
  mapPath: string;
  setCenter: Dispatch<SetStateAction<MapPosition>>;
  setZoom: Dispatch<SetStateAction<number>>;
  svgRef: RefObject<SVGSVGElement | null>;
  viewBox: string;
  zoom: number;
};

const WORLD_MAP_URL = "/static/assets/geo/f2f-world.geo.json";
export const F2F_WHEEL_ZOOM_FACTOR = 1.35;

let worldMapRequest: Promise<WorldFeatureCollection> | undefined;

export function useF2FWorldMap({
  dragThreshold,
  initialCenter,
  initialZoom,
  maxZoom,
  minZoom,
  onMapClick,
  onPointerStart
}: UseF2FWorldMapOptions): UseF2FWorldMapResult {
  const [worldMap, setWorldMap] = useState<WorldFeatureCollection>();
  const [mapError, setMapError] = useState(false);
  const [center, setCenter] = useState<MapPosition>(initialCenter);
  const [zoom, setZoom] = useState(initialZoom);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<
    | {
        center: MapPosition;
        clientX: number;
        clientY: number;
        moved: boolean;
        pointerId: number;
      }
    | undefined
  >(undefined);
  const pointersRef = useRef(new Map<number, PointerCoordinates>());
  const pinchRef = useRef<
    | {
        anchor: MapPosition;
        distance: number;
        ratioX: number;
        ratioY: number;
        zoom: number;
      }
    | undefined
  >(undefined);

  useEffect(() => {
    let active = true;
    worldMapRequest ??= fetch(WORLD_MAP_URL, { cache: "force-cache" }).then(async (response) => {
      if (!response.ok) throw new Error(`Map request failed with ${response.status}`);
      return response.json() as Promise<WorldFeatureCollection>;
    });
    void worldMapRequest
      .then((data) => {
        if (active) setWorldMap(data);
      })
      .catch(() => {
        worldMapRequest = undefined;
        if (active) setMapError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const mapPath = useMemo(() => (worldMap ? featureCollectionPath(worldMap) : ""), [worldMap]);
  const viewBox = mapViewBox(center, zoom);

  function changeZoom(nextZoom: number) {
    const boundedZoom = boundMapZoom(nextZoom, minZoom, maxZoom);
    setZoom(boundedZoom);
    setCenter((current) => clampMapCenter(current, boundedZoom));
  }

  function zoomAroundPoint(point: MapPoint, nextZoom: number) {
    const view = zoomedMapView(point, nextZoom, minZoom, maxZoom);
    setZoom(view.zoom);
    setCenter(view.center);
  }

  function pointAtClient(clientX: number, clientY: number): MapPoint | undefined {
    const rect = svgRef.current?.getBoundingClientRect();
    return rect ? mapPointAtClient(center, zoom, rect, clientX, clientY) : undefined;
  }

  function handleWheel(event: WheelEvent<SVGSVGElement>) {
    event.preventDefault();
    const point = pointAtClient(event.clientX, event.clientY);
    if (!point) return;
    const factor = event.deltaY < 0 ? F2F_WHEEL_ZOOM_FACTOR : 1 / F2F_WHEEL_ZOOM_FACTOR;
    zoomAroundPoint(point, zoom * factor);
  }

  function handlePointerDown(event: PointerEvent<SVGSVGElement>) {
    onPointerStart?.();
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pointersRef.current.size >= 2) {
      const [first, second] = [...pointersRef.current.values()];
      const point = pointAtClient((first.x + second.x) / 2, (first.y + second.y) / 2);
      if (point) {
        pinchRef.current = {
          anchor: point.position,
          distance: pointerDistance(first, second),
          ratioX: point.ratioX,
          ratioY: point.ratioY,
          zoom
        };
      }
      dragRef.current = undefined;
      return;
    }
    dragRef.current = {
      center,
      clientX: event.clientX,
      clientY: event.clientY,
      moved: false,
      pointerId: event.pointerId
    };
  }

  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    if (pointersRef.current.has(event.pointerId)) {
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (pointersRef.current.size >= 2 && pinchRef.current) {
      const [first, second] = [...pointersRef.current.values()];
      const pinch = pinchRef.current;
      const distance = pointerDistance(first, second);
      if (pinch.distance > 0) {
        zoomAroundPoint(
          {
            position: pinch.anchor,
            ratioX: pinch.ratioX,
            ratioY: pinch.ratioY
          },
          pinch.zoom * (distance / pinch.distance)
        );
      }
      return;
    }
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const deltaX = event.clientX - drag.clientX;
    const deltaY = event.clientY - drag.clientY;
    if (hasDraggedBeyondThreshold(deltaX, deltaY, dragThreshold)) drag.moved = true;
    if (!drag.moved) return;
    setCenter(pannedMapCenter(drag.center, zoom, rect, deltaX, deltaY));
  }

  function handlePointerUp(event: PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    const wasPinching = Boolean(pinchRef.current);
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = undefined;
    if (drag?.pointerId === event.pointerId) dragRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!wasPinching && drag?.pointerId === event.pointerId && !drag.moved && onMapClick) {
      const position = positionFromPointer(event.currentTarget, event.clientX, event.clientY);
      if (position) onMapClick(position);
    }
  }

  function handlePointerCancel(event: PointerEvent<SVGSVGElement>) {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = undefined;
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = undefined;
  }

  return {
    center,
    changeZoom,
    handlePointerCancel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleWheel,
    mapError,
    mapLoaded: worldMap !== undefined,
    mapPath,
    setCenter,
    setZoom,
    svgRef,
    viewBox,
    zoom
  };
}

export function featureCollectionPath(collection: WorldFeatureCollection): string {
  return collection.features
    .flatMap((feature) => {
      if (!feature.geometry) return [];
      const polygons =
        feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
      return polygons
        .filter((polygon) => polygon.some((ring) => ring.some(([, latitude]) => latitude >= MAP_MIN_LATITUDE)))
        .map((polygon) => polygonPath(polygon));
    })
    .join(" ");
}

export function mapViewBox(center: MapPosition, zoom: number): string {
  const viewWidth = 360 / zoom;
  const viewHeight = MAP_LATITUDE_SPAN / zoom;
  return `${center[1] + 180 - viewWidth / 2} ${90 - center[0] - viewHeight / 2} ${viewWidth} ${viewHeight}`;
}

export function mapPointAtClient(
  center: MapPosition,
  zoom: number,
  rect: MapRect,
  clientX: number,
  clientY: number
): MapPoint | undefined {
  if (rect.width === 0 || rect.height === 0) return undefined;
  const ratioX = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  const ratioY = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
  return {
    position: clampMapPosition([
      center[0] - (ratioY - 0.5) * (MAP_LATITUDE_SPAN / zoom),
      center[1] + (ratioX - 0.5) * (360 / zoom)
    ]),
    ratioX,
    ratioY
  };
}

export function zoomedMapView(
  point: MapPoint,
  nextZoom: number,
  minZoom: number,
  maxZoom: number
): { center: MapPosition; zoom: number } {
  const zoom = boundMapZoom(nextZoom, minZoom, maxZoom);
  return {
    center: clampMapCenter(
      [
        point.position[0] + (point.ratioY - 0.5) * (MAP_LATITUDE_SPAN / zoom),
        point.position[1] - (point.ratioX - 0.5) * (360 / zoom)
      ],
      zoom
    ),
    zoom
  };
}

export function pannedMapCenter(
  center: MapPosition,
  zoom: number,
  rect: Pick<MapRect, "height" | "width">,
  deltaX: number,
  deltaY: number
): MapPosition {
  return clampMapCenter(
    [center[0] + (deltaY / rect.height) * (MAP_LATITUDE_SPAN / zoom), center[1] - (deltaX / rect.width) * (360 / zoom)],
    zoom
  );
}

export function boundMapZoom(zoom: number, minZoom: number, maxZoom: number): number {
  return Math.min(maxZoom, Math.max(minZoom, zoom));
}

export function hasDraggedBeyondThreshold(deltaX: number, deltaY: number, threshold: number): boolean {
  return Math.abs(deltaX) + Math.abs(deltaY) > threshold;
}

function positionFromPointer(svg: SVGSVGElement, clientX: number, clientY: number): MapPosition | undefined {
  const matrix = svg.getScreenCTM();
  if (!matrix) return undefined;
  const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
  return [90 - point.y, point.x - 180];
}

function polygonPath(polygon: Coordinate[][]): string {
  return polygon
    .map((ring) =>
      ring
        .map(([longitude, latitude], index) => `${index === 0 ? "M" : "L"}${longitude + 180} ${90 - latitude}`)
        .join(" ")
        .concat(" Z")
    )
    .join(" ");
}

function pointerDistance(first: PointerCoordinates, second: PointerCoordinates): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}
