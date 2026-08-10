import {
  type KeyboardEvent,
  memo,
  useCallback,
  useMemo,
  useState
} from "react";
import { ArrowDownLeft, ArrowUpRight, LocateFixed, MapPinned, Minus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import { formatApproximateF2FLocation, hasApproximateF2FLocation } from "@/domains/location/f2fLocation";
import {
  clampMapCenter,
  MAP_DEFAULT_CENTER
} from "@/domains/location/f2fMapViewport";
import { groupCashF2FOffers } from "@/domains/location/f2fOfferMap";
import { useF2FWorldMap } from "@/domains/location/useF2FWorldMap";
import { CurrencyFlag, PaymentMethodIcons } from "@/domains/orderbook/OfferMeta";
import type { PublicOrder } from "@/domains/orderbook/orderbook.types";
import { roleBuysBitcoin } from "@/domains/orders/orderRole";
import { formatFiat } from "@/lib/format";

type F2FOffersMapDialogProps = {
  coordinators: CoordinatorSummary[];
  offers: PublicOrder[];
  onClose: () => void;
  onSelectOffer: (order: PublicOrder) => void;
};

const MIN_ZOOM = 1;
const MAX_ZOOM = 16;

export function F2FOffersMapDialog({
  coordinators,
  offers,
  onClose,
  onSelectOffer
}: F2FOffersMapDialogProps) {
  const [selectedGroupKey, setSelectedGroupKey] = useState<string>();
  const {
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
    dragThreshold: 0,
    initialCenter: MAP_DEFAULT_CENTER,
    initialZoom: 1,
    maxZoom: MAX_ZOOM,
    minZoom: MIN_ZOOM
  });
  const groups = useMemo(() => groupCashF2FOffers(offers), [offers]);
  const selectedGroup = groups.find((group) => group.key === selectedGroupKey);
  const displayedOffers = selectedGroup?.orders ?? offers;
  const unmappedCount = useMemo(() => offers.filter((order) => (
    !hasApproximateF2FLocation(order.latitude, order.longitude)
  )).length, [offers]);

  const showAllAreas = useCallback(() => {
    setSelectedGroupKey(undefined);
    setCenter(MAP_DEFAULT_CENTER);
    setZoom(1);
  }, [setCenter, setZoom]);

  function selectGroup(key: string, latitude: number, longitude: number) {
    setSelectedGroupKey(key);
    setCenter(clampMapCenter([latitude, longitude], 5));
    setZoom(5);
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
          {!mapLoaded && !mapError ? (
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
          {mapLoaded ? (
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

          {mapLoaded ? (
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

        <F2FOffersList
          coordinators={coordinators}
          displayedOffers={displayedOffers}
          onSelectOffer={onSelectOffer}
          onShowAll={showAllAreas}
          selectedGroup={selectedGroup}
          unmappedCount={unmappedCount}
        />
      </div>
    </Dialog>
  );
}

const F2FOffersList = memo(function F2FOffersList({
  coordinators,
  displayedOffers,
  onSelectOffer,
  onShowAll,
  selectedGroup,
  unmappedCount
}: {
  coordinators: CoordinatorSummary[];
  displayedOffers: PublicOrder[];
  onSelectOffer: (order: PublicOrder) => void;
  onShowAll: () => void;
  selectedGroup: ReturnType<typeof groupCashF2FOffers>[number] | undefined;
  unmappedCount: number;
}) {
  return (
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
          <Button onClick={onShowAll} size="sm" type="button" variant="ghost">Show all</Button>
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
  );
});

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
