import {
  type KeyboardEvent,
  useEffect,
  useMemo,
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
  MAP_DEFAULT_CENTER
} from "@/domains/location/f2fMapViewport";
import { useF2FWorldMap } from "@/domains/location/useF2FWorldMap";

type Position = [number, number];
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

const CITY_INDEX_URL = "/static/assets/geo/f2f-cities.json";
const MIN_ZOOM = 1;
const MAX_ZOOM = 32;
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
  const [selected, setSelected] = useState<Position | undefined>(initialPosition);
  const [cities, setCities] = useState<F2FCity[]>([]);
  const [cityQuery, setCityQuery] = useState("");
  const [citySearchOpen, setCitySearchOpen] = useState(false);
  const [activeCityIndex, setActiveCityIndex] = useState(0);
  const [cityIndexError, setCityIndexError] = useState(false);
  const {
    center,
    changeZoom,
    handlePointerCancel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleWheel,
    mapError,
    mapLoaded,
    mapPath,
    setCenter,
    setZoom,
    svgRef,
    viewBox,
    zoom
  } = useF2FWorldMap({
    dragThreshold: 5,
    initialCenter: initialPosition ?? MAP_DEFAULT_CENTER,
    initialZoom: initialPosition ? 8 : 1,
    maxZoom: MAX_ZOOM,
    minZoom: MIN_ZOOM,
    onMapClick: selectPosition,
    onPointerStart: () => setCitySearchOpen(false)
  });

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
  const selectedX = selected ? selected[1] + 180 : 0;
  const selectedY = selected ? 90 - selected[0] : 0;

  function selectPosition(position: Position) {
    if (readOnly) return;
    const approximate = approximateF2FLocation(...clampMapPosition(position));
    setSelected(approximate);
    setCenter(approximate);
    if (zoom < 8) setZoom(8);
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
        {!mapLoaded && !mapError ? (
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
        {mapLoaded ? (
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

        {mapLoaded ? (
          <div className="f2f-map-controls" aria-label="Map controls">
            <Button
              aria-label="Zoom in"
              disabled={zoom >= MAX_ZOOM}
              onClick={() => changeZoom(zoom * 2)}
              size="icon"
              type="button"
              variant="secondary"
            >
              <Plus size={17} />
            </Button>
            <Button
              aria-label="Zoom out"
              disabled={zoom <= MIN_ZOOM}
              onClick={() => changeZoom(zoom / 2)}
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
