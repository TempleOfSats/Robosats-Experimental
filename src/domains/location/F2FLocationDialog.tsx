import {
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent as ReactWheelEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { MapPin, Minus, Plus, Search, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  approximateF2FLocation,
  formatApproximateF2FLocation,
  hasApproximateF2FLocation
} from "@/domains/location/f2fLocation";
import {
  clampMapCenter,
  clampMapPosition,
  MAP_DEFAULT_CENTER,
  MAP_LATITUDE_SPAN,
  MAP_MIN_LATITUDE
} from "@/domains/location/f2fMapViewport";

type Position = [number, number];
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
type F2FCity = {
  n: string;
  c: string;
  a: string;
  r: string;
  y: number;
  x: number;
  p: number;
};

type F2FLocationDialogProps = {
  latitude?: number | string | null;
  longitude?: number | string | null;
  onClose: () => void;
  onConfirm?: (position: Position) => void;
  readOnly?: boolean;
};

const WORLD_MAP_URL = "/static/assets/geo/f2f-world.geo.json";
const CITY_INDEX_URL = "/static/assets/geo/f2f-cities.json";
const MIN_ZOOM = 1;
const MAX_ZOOM = 32;
let worldMapRequest: Promise<WorldFeatureCollection> | undefined;
let cityIndexRequest: Promise<F2FCity[]> | undefined;

export function F2FLocationDialog({
  latitude,
  longitude,
  onClose,
  onConfirm,
  readOnly = false
}: F2FLocationDialogProps) {
  const initialPosition = hasApproximateF2FLocation(latitude, longitude)
    ? clampMapPosition(approximateF2FLocation(Number(latitude), Number(longitude)))
    : undefined;
  const [worldMap, setWorldMap] = useState<WorldFeatureCollection>();
  const [mapError, setMapError] = useState(false);
  const [selected, setSelected] = useState<Position | undefined>(initialPosition);
  const [center, setCenter] = useState<Position>(initialPosition ?? MAP_DEFAULT_CENTER);
  const [zoom, setZoom] = useState(initialPosition ? 8 : 1);
  const [cities, setCities] = useState<F2FCity[]>([]);
  const [cityQuery, setCityQuery] = useState("");
  const [citySearchOpen, setCitySearchOpen] = useState(false);
  const [activeCityIndex, setActiveCityIndex] = useState(0);
  const [cityIndexError, setCityIndexError] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{
    center: Position;
    clientX: number;
    clientY: number;
    moved: boolean;
    pointerId: number;
  } | undefined>(undefined);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{
    anchor: Position;
    distance: number;
    ratioX: number;
    ratioY: number;
    zoom: number;
  } | undefined>(undefined);

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

  useEffect(() => {
    if (readOnly) return;
    let active = true;
    cityIndexRequest ??= fetch(CITY_INDEX_URL, { cache: "force-cache" }).then(async (response) => {
      if (!response.ok) throw new Error(`City index request failed with ${response.status}`);
      return response.json() as Promise<F2FCity[]>;
    });
    void cityIndexRequest
      .then((data) => {
        if (active) setCities(data);
      })
      .catch(() => {
        cityIndexRequest = undefined;
        if (active) setCityIndexError(true);
      });
    return () => {
      active = false;
    };
  }, [readOnly]);

  const mapPath = useMemo(() => worldMap ? featureCollectionPath(worldMap) : "", [worldMap]);
  const cityMatches = useMemo(() => {
    const query = normalizeSearch(cityQuery);
    if (query.length < 2) return [];
    return cities
      .map((city) => ({
        city,
        searchable: normalizeSearch(`${city.n} ${city.r} ${city.c} ${city.a}`)
      }))
      .filter(({ searchable }) => searchable.includes(query))
      .sort((left, right) => {
        const leftStarts = normalizeSearch(left.city.n).startsWith(query);
        const rightStarts = normalizeSearch(right.city.n).startsWith(query);
        if (leftStarts !== rightStarts) return leftStarts ? -1 : 1;
        return right.city.p - left.city.p || left.city.n.localeCompare(right.city.n);
      })
      .slice(0, 8)
      .map(({ city }) => city);
  }, [cities, cityQuery]);
  const viewWidth = 360 / zoom;
  const viewHeight = MAP_LATITUDE_SPAN / zoom;
  const viewCenterX = center[1] + 180;
  const viewCenterY = 90 - center[0];
  const viewBox = `${viewCenterX - viewWidth / 2} ${viewCenterY - viewHeight / 2} ${viewWidth} ${viewHeight}`;
  const selectedX = selected ? selected[1] + 180 : 0;
  const selectedY = selected ? 90 - selected[0] : 0;

  function updateZoom(nextZoom: number) {
    const boundedZoom = boundZoom(nextZoom);
    setZoom(boundedZoom);
    setCenter((current) => clampMapCenter(current, boundedZoom));
  }

  function selectPosition(position: Position) {
    if (readOnly) return;
    const approximate = approximateF2FLocation(...clampMapPosition(position));
    setSelected(approximate);
    setCenter(approximate);
    if (zoom < 8) setZoom(8);
  }

  function positionFromPointer(event: PointerEvent<SVGSVGElement>): Position | undefined {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return undefined;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return [90 - point.y, point.x - 180];
  }

  function mapPointAtClient(clientX: number, clientY: number) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return undefined;
    const ratioX = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const ratioY = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    return {
      position: clampMapPosition([
        center[0] - (ratioY - 0.5) * viewHeight,
        center[1] + (ratioX - 0.5) * viewWidth
      ]),
      ratioX,
      ratioY
    };
  }

  function zoomAroundPoint(
    anchor: Position,
    ratioX: number,
    ratioY: number,
    nextZoom: number
  ) {
    const boundedZoom = boundZoom(nextZoom);
    setZoom(boundedZoom);
    setCenter(clampMapCenter([
      anchor[0] + (ratioY - 0.5) * (MAP_LATITUDE_SPAN / boundedZoom),
      anchor[1] - (ratioX - 0.5) * (360 / boundedZoom)
    ], boundedZoom));
  }

  function handleWheel(event: ReactWheelEvent<SVGSVGElement>) {
    event.preventDefault();
    const point = mapPointAtClient(event.clientX, event.clientY);
    if (!point) return;
    const factor = event.deltaY < 0 ? 1.35 : 1 / 1.35;
    zoomAroundPoint(point.position, point.ratioX, point.ratioY, zoom * factor);
  }

  function handlePointerDown(event: PointerEvent<SVGSVGElement>) {
    setCitySearchOpen(false);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pointersRef.current.size >= 2) {
      const [first, second] = [...pointersRef.current.values()];
      const midpointX = (first.x + second.x) / 2;
      const midpointY = (first.y + second.y) / 2;
      const point = mapPointAtClient(midpointX, midpointY);
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
          pinch.anchor,
          pinch.ratioX,
          pinch.ratioY,
          pinch.zoom * (distance / pinch.distance)
        );
      }
      return;
    }
    const drag = dragRef.current;
    const svg = svgRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !svg) return;
    const rect = svg.getBoundingClientRect();
    const deltaX = event.clientX - drag.clientX;
    const deltaY = event.clientY - drag.clientY;
    if (Math.abs(deltaX) + Math.abs(deltaY) > 5) drag.moved = true;
    if (!drag.moved) return;
    setCenter(clampMapCenter([
      drag.center[0] + (deltaY / rect.height) * viewHeight,
      drag.center[1] - (deltaX / rect.width) * viewWidth
    ], zoom));
  }

  function handlePointerUp(event: PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    const wasPinching = Boolean(pinchRef.current);
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = undefined;
    dragRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!wasPinching && drag && drag.pointerId === event.pointerId && !drag.moved) {
      const position = positionFromPointer(event);
      if (position) selectPosition(position);
    }
  }

  function handlePointerCancel(event: PointerEvent<SVGSVGElement>) {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = undefined;
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = undefined;
  }

  function handleMapKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (readOnly) return;
    const step = zoom >= 16 ? 0.1 : zoom >= 8 ? 0.5 : 2;
    const current = selected ?? center;
    let next: Position | undefined;
    if (event.key === "ArrowUp") next = [current[0] + step, current[1]];
    if (event.key === "ArrowDown") next = [current[0] - step, current[1]];
    if (event.key === "ArrowLeft") next = [current[0], current[1] - step];
    if (event.key === "ArrowRight") next = [current[0], current[1] + step];
    if (event.key === "Enter" || event.key === " ") next = current;
    if (!next) return;
    event.preventDefault();
    selectPosition(clampMapPosition(next));
  }

  function selectCity(city: F2FCity) {
    const position = approximateF2FLocation(city.y, city.x);
    setSelected(position);
    setCenter(clampMapCenter(position, 8));
    setZoom(8);
    setCityQuery(cityLabel(city));
    setCitySearchOpen(false);
  }

  function handleCitySearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && cityMatches.length > 0) {
      event.preventDefault();
      setCitySearchOpen(true);
      setActiveCityIndex((current) => (current + 1) % cityMatches.length);
    } else if (event.key === "ArrowUp" && cityMatches.length > 0) {
      event.preventDefault();
      setCitySearchOpen(true);
      setActiveCityIndex((current) => (current - 1 + cityMatches.length) % cityMatches.length);
    } else if (event.key === "Enter" && citySearchOpen && cityMatches[activeCityIndex]) {
      event.preventDefault();
      selectCity(cityMatches[activeCityIndex]);
    } else if (event.key === "Escape") {
      setCitySearchOpen(false);
    }
  }

  return (
    <Dialog
      ariaDescribedby="f2f-location-description"
      ariaLabelledby="f2f-location-title"
      onClose={onClose}
      overlayClassName="confirm-overlay f2f-location-overlay"
      panelClassName="confirm-sheet f2f-location-sheet"
    >
      <header className="f2f-location-header">
        <span className="f2f-location-mark" aria-hidden="true"><MapPin size={21} /></span>
        <div>
          <h3 id="f2f-location-title">{readOnly ? "Approximate meeting area" : "Where would you meet?"}</h3>
          <p id="f2f-location-description">
            {readOnly
              ? "The exact meeting place should be exchanged later in encrypted chat."
              : "Choose a public approximate area. Share the exact place later in encrypted chat."}
          </p>
        </div>
        <button className="icon-button" onClick={onClose} type="button" aria-label="Close meeting area">
          <X size={18} />
        </button>
      </header>

      {!readOnly ? (
        <div className="f2f-city-search">
          <Search size={18} aria-hidden="true" />
          <input
            aria-activedescendant={
              citySearchOpen && cityMatches[activeCityIndex]
                ? `f2f-city-option-${activeCityIndex}`
                : undefined
            }
            aria-autocomplete="list"
            aria-controls="f2f-city-results"
            aria-expanded={citySearchOpen && cityQuery.trim().length >= 2}
            aria-label="Search for a city"
            autoComplete="off"
            onChange={(event) => {
              setCityQuery(event.target.value);
              setActiveCityIndex(0);
              setCitySearchOpen(true);
            }}
            onFocus={() => setCitySearchOpen(true)}
            onKeyDown={handleCitySearchKeyDown}
            placeholder="Search city or country"
            role="combobox"
            spellCheck={false}
            type="search"
            value={cityQuery}
          />
          {citySearchOpen && cityQuery.trim().length >= 2 ? (
            <div className="f2f-city-results" id="f2f-city-results" role="listbox">
              {cities.length === 0 && !cityIndexError ? (
                <div className="f2f-city-result-state" role="status">
                  <span className="ui-spinner" aria-hidden="true" />
                  Loading cities…
                </div>
              ) : null}
              {cityIndexError ? (
                <div className="f2f-city-result-state" role="alert">
                  City search is unavailable. Choose an area on the map.
                </div>
              ) : null}
              {cities.length > 0 && cityMatches.length === 0 ? (
                <div className="f2f-city-result-state">
                  No city found. Choose an area on the map.
                </div>
              ) : null}
              {cityMatches.map((city, index) => (
                <button
                  aria-selected={index === activeCityIndex}
                  className={index === activeCityIndex ? "f2f-city-result f2f-city-result-active" : "f2f-city-result"}
                  id={`f2f-city-option-${index}`}
                  key={`${city.a}-${city.r}-${city.n}-${city.x}-${city.y}`}
                  onClick={() => selectCity(city)}
                  onMouseDown={(event) => event.preventDefault()}
                  role="option"
                  type="button"
                >
                  <MapPin size={16} aria-hidden="true" />
                  <span>
                    <strong>{city.n}</strong>
                    <small>{citySecondaryLabel(city)}</small>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="f2f-map-shell">
        {!worldMap && !mapError ? (
          <div className="f2f-map-loading" role="status">
            <span className="ui-spinner" aria-hidden="true" />
            <span>Loading private map…</span>
          </div>
        ) : null}
        {mapError ? (
          <div className="f2f-map-loading status-panel status-panel-warning" role="alert">
            The map could not be loaded. Close this panel and try again.
          </div>
        ) : null}
        {worldMap ? (
          <svg
            aria-label={readOnly
              ? "Map showing the approximate public meeting area"
              : "Interactive world map. Drag to move, use the zoom buttons, and select an approximate area."}
            className={readOnly ? "f2f-map f2f-map-readonly" : "f2f-map"}
            onKeyDown={handleMapKeyDown}
            onPointerCancel={handlePointerCancel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onWheel={handleWheel}
            preserveAspectRatio="xMidYMid meet"
            ref={svgRef}
            role={readOnly ? "img" : "application"}
            tabIndex={readOnly ? -1 : 0}
            viewBox={viewBox}
          >
            <rect className="f2f-map-ocean" height="180" width="360" x="0" y="0" />
            <path className="f2f-map-land" d={mapPath} fillRule="evenodd" />
            {selected ? (
              <g className="f2f-map-selection" aria-hidden="true">
                <circle className="f2f-map-selection-area" cx={selectedX} cy={selectedY} r={7 / zoom} />
                <circle className="f2f-map-selection-point" cx={selectedX} cy={selectedY} r={2.4 / zoom} />
              </g>
            ) : null}
          </svg>
        ) : null}

        {worldMap ? (
          <div className="f2f-map-controls" aria-label="Map controls">
            <Button
              aria-label="Zoom in"
              disabled={zoom >= MAX_ZOOM}
              onClick={() => updateZoom(zoom * 2)}
              size="icon"
              type="button"
              variant="secondary"
            >
              <Plus size={17} />
            </Button>
            <Button
              aria-label="Zoom out"
              disabled={zoom <= MIN_ZOOM}
              onClick={() => updateZoom(zoom / 2)}
              size="icon"
              type="button"
              variant="secondary"
            >
              <Minus size={17} />
            </Button>
          </div>
        ) : null}
      </div>

      <div className="f2f-location-status" aria-live="polite">
        <ShieldCheck size={18} aria-hidden="true" />
        <span>
          <strong>{selected ? "Approximate public area" : "No area selected"}</strong>
          <small>{selected ? formatApproximateF2FLocation(selected[0], selected[1]) : "Tap near your city, then refine the position."}</small>
        </span>
      </div>

      <div className="confirm-actions">
        <Button onClick={onClose} type="button" variant="secondary">{readOnly ? "Close" : "Cancel"}</Button>
        {!readOnly ? (
          <Button
            disabled={!selected || mapError}
            onClick={() => selected && onConfirm?.(selected)}
            type="button"
          >
            <MapPin size={17} />
            Use this area
          </Button>
        ) : null}
      </div>
    </Dialog>
  );
}

function featureCollectionPath(collection: WorldFeatureCollection): string {
  return collection.features
    .flatMap((feature) => {
      if (!feature.geometry) return [];
      const polygons = feature.geometry.type === "Polygon"
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;
      return polygons
        .filter((polygon) => polygon.some((ring) => (
          ring.some(([, latitude]) => latitude >= MAP_MIN_LATITUDE)
        )))
        .map((polygon) => polygonPath(polygon));
    })
    .join(" ");
}

function polygonPath(polygon: Coordinate[][]): string {
  return polygon
    .map((ring) => ring
      .map(([longitude, latitude], index) => `${index === 0 ? "M" : "L"}${longitude + 180} ${90 - latitude}`)
      .join(" ")
      .concat(" Z"))
    .join(" ");
}

function boundZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

function pointerDistance(
  first: { x: number; y: number },
  second: { x: number; y: number }
): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function normalizeSearch(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLocaleLowerCase();
}

function cityLabel(city: F2FCity): string {
  return `${city.n}, ${city.c}`;
}

function citySecondaryLabel(city: F2FCity): string {
  return city.r && city.r !== city.n && city.r !== city.c
    ? `${city.r}, ${city.c}`
    : city.c;
}
