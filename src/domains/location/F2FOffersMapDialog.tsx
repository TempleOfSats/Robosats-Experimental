import {
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { ArrowDownLeft, ArrowUpRight, LocateFixed, MapPinned, Minus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import { formatApproximateF2FLocation, hasApproximateF2FLocation } from "@/domains/location/f2fLocation";
import {
  clampMapCenter,
  clampMapPosition,
  MAP_DEFAULT_CENTER,
  MAP_LATITUDE_SPAN,
  MAP_MIN_LATITUDE
} from "@/domains/location/f2fMapViewport";
import { groupCashF2FOffers } from "@/domains/location/f2fOfferMap";
import { CurrencyFlag, PaymentMethodIcons } from "@/domains/orderbook/OfferMeta";
import type { PublicOrder } from "@/domains/orderbook/orderbook.types";
import { roleBuysBitcoin } from "@/domains/orders/orderRole";
import { formatFiat } from "@/lib/format";

type Coordinate = [number, number];
type PolygonGeometry = { type: "Polygon"; coordinates: Coordinate[][] };
type MultiPolygonGeometry = { type: "MultiPolygon"; coordinates: Coordinate[][][] };
type WorldFeatureCollection = {
  features: Array<{ geometry: PolygonGeometry | MultiPolygonGeometry | null }>;
};

type F2FOffersMapDialogProps = {
  coordinators: CoordinatorSummary[];
  offers: PublicOrder[];
  onClose: () => void;
  onSelectOffer: (order: PublicOrder) => void;
};

const WORLD_MAP_URL = "/static/assets/geo/f2f-world.geo.json";
const MIN_ZOOM = 1;
const MAX_ZOOM = 16;
let worldMapRequest: Promise<WorldFeatureCollection> | undefined;

export function F2FOffersMapDialog({
  coordinators,
  offers,
  onClose,
  onSelectOffer
}: F2FOffersMapDialogProps) {
  const [worldMap, setWorldMap] = useState<WorldFeatureCollection>();
  const [mapError, setMapError] = useState(false);
  const [selectedGroupKey, setSelectedGroupKey] = useState<string>();
  const [center, setCenter] = useState<[number, number]>(MAP_DEFAULT_CENTER);
  const [zoom, setZoom] = useState(1);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{
    center: [number, number];
    clientX: number;
    clientY: number;
    pointerId: number;
  } | undefined>(undefined);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{
    anchor: [number, number];
    distance: number;
    ratioX: number;
    ratioY: number;
    zoom: number;
  } | undefined>(undefined);
  const groups = useMemo(() => groupCashF2FOffers(offers), [offers]);
  const selectedGroup = groups.find((group) => group.key === selectedGroupKey);
  const displayedOffers = selectedGroup?.orders ?? offers;
  const unmappedCount = offers.filter((order) => (
    !hasApproximateF2FLocation(order.latitude, order.longitude)
  )).length;

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

  const mapPath = useMemo(() => worldMap ? featureCollectionPath(worldMap) : "", [worldMap]);
  const viewWidth = 360 / zoom;
  const viewHeight = MAP_LATITUDE_SPAN / zoom;
  const viewBox = `${center[1] + 180 - viewWidth / 2} ${90 - center[0] - viewHeight / 2} ${viewWidth} ${viewHeight}`;

  function showAllAreas() {
    setSelectedGroupKey(undefined);
    setCenter(MAP_DEFAULT_CENTER);
    setZoom(1);
  }

  function selectGroup(key: string, latitude: number, longitude: number) {
    setSelectedGroupKey(key);
    setCenter(clampMapCenter([latitude, longitude], 5));
    setZoom(5);
  }

  function changeZoom(nextZoom: number) {
    const bounded = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
    setZoom(bounded);
    setCenter((current) => clampMapCenter(current, bounded));
  }

  function handleWheel(event: WheelEvent<SVGSVGElement>) {
    event.preventDefault();
    const point = mapPointAtClient(event.clientX, event.clientY);
    if (!point) return;
    zoomAroundPoint(
      point.position,
      point.ratioX,
      point.ratioY,
      event.deltaY < 0 ? zoom * 1.35 : zoom / 1.35
    );
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
    anchor: [number, number],
    ratioX: number,
    ratioY: number,
    nextZoom: number
  ) {
    const bounded = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
    setZoom(bounded);
    setCenter(clampMapCenter([
      anchor[0] + (ratioY - 0.5) * (MAP_LATITUDE_SPAN / bounded),
      anchor[1] - (ratioX - 0.5) * (360 / bounded)
    ], bounded));
  }

  function handlePointerDown(event: PointerEvent<SVGSVGElement>) {
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pointersRef.current.size >= 2) {
      const [first, second] = [...pointersRef.current.values()];
      const point = mapPointAtClient((first.x + second.x) / 2, (first.y + second.y) / 2);
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
    const rect = svgRef.current?.getBoundingClientRect();
    if (!drag || drag.pointerId !== event.pointerId || !rect) return;
    setCenter(clampMapCenter([
      drag.center[0] + ((event.clientY - drag.clientY) / rect.height) * viewHeight,
      drag.center[1] - ((event.clientX - drag.clientX) / rect.width) * viewWidth
    ], zoom));
  }

  function handlePointerUp(event: PointerEvent<SVGSVGElement>) {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = undefined;
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handlePointerCancel(event: PointerEvent<SVGSVGElement>) {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = undefined;
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = undefined;
  }

  function handleMarkerKeyDown(
    event: KeyboardEvent<SVGGElement>,
    key: string,
    latitude: number,
    longitude: number
  ) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    selectGroup(key, latitude, longitude);
  }

  return (
    <Dialog
      ariaDescribedby="f2f-offers-map-description"
      ariaLabelledby="f2f-offers-map-title"
      onClose={onClose}
      overlayClassName="confirm-overlay f2f-offers-map-overlay"
      panelClassName="confirm-sheet f2f-offers-map-sheet"
    >
      <header className="f2f-location-header f2f-offers-map-header">
        <span className="f2f-location-mark" aria-hidden="true"><MapPinned size={21} /></span>
        <div>
          <h3 id="f2f-offers-map-title">Cash F2F offers</h3>
          <p id="f2f-offers-map-description">
            {offers.length} {offers.length === 1 ? "offer" : "offers"} in approximate public areas. Exchange the exact meeting place later in encrypted chat.
          </p>
        </div>
        <button className="icon-button" onClick={onClose} type="button" aria-label="Close Cash F2F map">
          <X size={18} />
        </button>
      </header>

      <div className="f2f-offers-map-layout">
        <div className="f2f-map-shell f2f-offers-map-shell">
          {!worldMap && !mapError ? (
            <div className="f2f-map-loading" role="status">
              <span className="ui-spinner" aria-hidden="true" />
              <span>Loading private map…</span>
            </div>
          ) : null}
          {mapError ? (
            <div className="f2f-map-loading status-panel status-panel-warning" role="alert">
              The map could not be loaded. The offer list remains available.
            </div>
          ) : null}
          {worldMap ? (
            <svg
              aria-label={`Map with ${groups.length} approximate Cash F2F meeting ${groups.length === 1 ? "area" : "areas"}`}
              className="f2f-map f2f-offers-map"
              onPointerCancel={handlePointerCancel}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onWheel={handleWheel}
              preserveAspectRatio="xMidYMid meet"
              ref={svgRef}
              role="application"
              tabIndex={0}
              viewBox={viewBox}
            >
              <rect className="f2f-map-ocean" height="180" width="360" x="0" y="0" />
              <path className="f2f-map-land" d={mapPath} fillRule="evenodd" />
              {groups.map((group) => {
                const selected = group.key === selectedGroupKey;
                const markerClass = group.orders.every(isTakerBuying)
                  ? "f2f-offer-marker f2f-offer-marker-buy"
                  : group.orders.every((order) => !isTakerBuying(order))
                    ? "f2f-offer-marker f2f-offer-marker-sell"
                    : "f2f-offer-marker f2f-offer-marker-mixed";
                const x = group.longitude + 180;
                const y = 90 - group.latitude;
                return (
                  <g
                    aria-label={`${group.orders.length} ${group.orders.length === 1 ? "offer" : "offers"} near ${formatApproximateF2FLocation(group.latitude, group.longitude)}`}
                    className={selected ? `${markerClass} f2f-offer-marker-selected` : markerClass}
                    key={group.key}
                    onClick={() => selectGroup(group.key, group.latitude, group.longitude)}
                    onKeyDown={(event) => handleMarkerKeyDown(event, group.key, group.latitude, group.longitude)}
                    onPointerDown={(event) => event.stopPropagation()}
                    role="button"
                    tabIndex={0}
                  >
                    <circle className="f2f-offer-marker-hit" cx={x} cy={y} r={8 / zoom} />
                    <circle className="f2f-offer-marker-dot" cx={x} cy={y} r={4.6 / zoom} />
                    {group.orders.length > 1 ? (
                      <text
                        className="f2f-offer-marker-count"
                        dominantBaseline="central"
                        style={{ fontSize: `${5 / zoom}px` }}
                        textAnchor="middle"
                        x={x}
                        y={y}
                      >
                        {group.orders.length}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </svg>
          ) : null}

          {worldMap ? (
            <div className="f2f-map-controls" aria-label="Map controls">
              <Button aria-label="Zoom in" disabled={zoom >= MAX_ZOOM} onClick={() => changeZoom(zoom * 2)} size="icon" type="button" variant="secondary">
                <Plus size={17} />
              </Button>
              <Button aria-label="Zoom out" disabled={zoom <= MIN_ZOOM} onClick={() => changeZoom(zoom / 2)} size="icon" type="button" variant="secondary">
                <Minus size={17} />
              </Button>
              {selectedGroup ? (
                <Button aria-label="Show all Cash F2F areas" onClick={showAllAreas} size="icon" title="Show all areas" type="button" variant="secondary">
                  <LocateFixed size={17} />
                </Button>
              ) : null}
            </div>
          ) : null}

          <div className="f2f-offers-map-legend" aria-hidden="true">
            <span><i className="f2f-offer-legend-buy" />Buy BTC</span>
            <span><i className="f2f-offer-legend-sell" />Sell BTC</span>
          </div>
        </div>

        <section className="f2f-offers-list" aria-label="Cash F2F offers">
          <div className="f2f-offers-list-heading">
            <div>
              <strong>{selectedGroup ? "Offers in this area" : "All Cash F2F offers"}</strong>
              <small>
                {selectedGroup
                  ? formatApproximateF2FLocation(selectedGroup.latitude, selectedGroup.longitude)
                  : unmappedCount > 0
                    ? `${unmappedCount} ${unmappedCount === 1 ? "offer has" : "offers have"} no public map position`
                    : "Select an area or review an offer"}
              </small>
            </div>
            {selectedGroup ? (
              <Button onClick={showAllAreas} size="sm" type="button" variant="ghost">Show all</Button>
            ) : null}
          </div>

          <div className="f2f-offers-list-scroll">
            {displayedOffers.map((order) => {
              const coordinator = coordinators.find((item) => item.shortAlias === order.coordinatorShortAlias);
              const currency = order.currencyCode ?? String(order.currency);
              const buying = isTakerBuying(order);
              return (
                <button
                  className="f2f-offer-list-item"
                  key={`${order.coordinatorShortAlias}-${order.id}`}
                  onClick={() => onSelectOffer(order)}
                  type="button"
                >
                  <span className={buying ? "offer-direction offer-direction-buy" : "offer-direction offer-direction-sell"}>
                    {buying ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}
                    <small>{buying ? "BUY" : "SELL"}</small>
                  </span>
                  <span className="f2f-offer-list-main">
                    <strong>
                      <span>{formatOfferAmount(order)}</span>
                      <span className="f2f-offer-list-currency">{currency}</span>
                      <CurrencyFlag code={currency} size={16} />
                    </strong>
                    <small><PaymentMethodIcons text={order.payment_method} size={16} />{order.payment_method}</small>
                  </span>
                  <span className={premiumClassName(order.premium)}>{formatPremium(order.premium)}</span>
                  <span className="f2f-offer-list-coordinator">
                    {coordinator ? <img alt="" className="coordinator-avatar coordinator-avatar-xs" src={coordinator.smallAvatarUrl} /> : null}
                    <small>{coordinator?.longAlias ?? order.coordinatorShortAlias}</small>
                  </span>
                  <span className="f2f-offer-list-review">Review</span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </Dialog>
  );
}

function isTakerBuying(order: PublicOrder): boolean {
  return roleBuysBitcoin(order.type, "taker");
}

function formatOfferAmount(order: PublicOrder): string {
  if (order.has_range) return `${formatFiat(order.min_amount)} - ${formatFiat(order.max_amount)}`;
  return formatFiat(order.amount);
}

function formatPremium(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function premiumClassName(value: number): string {
  if (value > 0) return "tabular offer-premium offer-premium-positive";
  if (value < 0) return "tabular offer-premium offer-premium-negative";
  return "tabular offer-premium";
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


function pointerDistance(first: { x: number; y: number }, second: { x: number; y: number }): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}
