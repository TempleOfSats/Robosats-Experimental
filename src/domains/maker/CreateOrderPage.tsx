import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  CheckCircle2,
  Clock,
  Landmark,
  LoaderCircle,
  Lock,
  MapPin,
  Info,
  PlusCircle,
  ReceiptText,
  Repeat2,
  Save,
  ShieldCheck,
  X
} from "lucide-react";
import { lazy, Suspense, type CSSProperties, type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AppTransitionDialog, AppTransitionFeedback } from "@/domains/navigation/AppTransitionFeedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { InfoHint } from "@/components/ui/infoHint";
import { VisualSelect } from "@/components/ui/visualSelect";
import type { CoordinatorRating } from "@/domains/coordinators/coordinatorRatings";
import { coordinatorNeedsRefresh, selectCoordinatorAvailability } from "@/domains/coordinators/coordinatorAvailability";
import { federationLottery } from "@/domains/coordinators/federationLottery";
import { useFederationStore } from "@/domains/coordinators/federationStore";
import { toUserMessage } from "@/lib/userError";
import { getRobotAuthForCoordinator, selectCurrentSlot, selectStandardGarageSlots, useGarageStore, type RobotSlot } from "@/domains/garage/garageStore";
import { getRobotOrderAvailability } from "@/domains/garage/robotAvailability";
import { RobotAvatar } from "@/domains/identity/RobotAvatar";
import {
  buildCreateOrderPayload,
  buildProvisionalMakerOrder,
  createOrder,
  validateCreateOrderPayload
} from "@/domains/maker/makerApi";
import {
  ESCROW_DURATION_MAX_SECONDS,
  ESCROW_DURATION_MIN_SECONDS,
  PUBLIC_DURATION_MAX_SECONDS,
  PUBLIC_DURATION_MIN_SECONDS
} from "@/domains/maker/makerDurations";
import type { CreateOrderDraft } from "@/domains/maker/maker.types";
import { currencyIdFromCode, currencyOptions } from "@/domains/orderbook/currencies";
import { CurrencyFlag, CurrencyPicker, PaymentMethodIcons, PaymentMethodPicker } from "@/domains/orderbook/OfferMeta";
import { normalPaymentMethodOptions, swapPaymentMethodOptions } from "@/domains/orderbook/paymentMethods";
import { ingestCoordinatorOrder } from "@/domains/orders/orderActivity";
import { openConfirmedOrder } from "@/domains/orders/confirmedOrderNavigation";
import { preloadOrderRoute } from "@/domains/orders/orderRoute";
import { reserveRobotOrderAction, revalidateRobotForNewOrder } from "@/domains/orders/robotOrderGuard";
import { roleBuysBitcoin, roleIntentLabel } from "@/domains/orders/orderRole";
import { activeOfferPresets, type OfferPreset } from "@/domains/pro/portableSettings";
import { usePortableSettingsStore } from "@/domains/pro/portableSettingsStore";
import { useProPreferencesStore } from "@/domains/pro/proPreferencesStore";
import { deriveProRobotLifecycle } from "@/domains/pro/proRobotLifecycle";
import { useProTradeIndexStore } from "@/domains/pro/proTradeIndexStore";
import { formatFiat } from "@/lib/format";
import {
  CASH_F2F_METHOD,
  hasApproximateF2FLocation,
  isCashF2FMethod,
  paymentMethodHasF2F
} from "@/domains/location/f2fLocation";

const LazyCoordinatorDetailDialog = lazy(() =>
  import("@/domains/coordinators/CoordinatorsPage").then((module) => ({ default: module.CoordinatorDetailDialog }))
);
const LazyF2FLocationDialog = lazy(() =>
  import("@/domains/location/F2FLocationDialog").then((module) => ({ default: module.F2FLocationDialog }))
);
const NORMAL_PAYMENT_METHODS = normalPaymentMethodOptions();
const SWAP_PAYMENT_METHODS = swapPaymentMethodOptions();

const CURRENCIES = currencyOptions();
const BTC_CURRENCY_ID = 1000;
const METHOD_SEPARATOR = ", ";
const wizardSteps = [
  { title: "Side", icon: ReceiptText },
  { title: "Amount", icon: Landmark },
  { title: "Review", icon: ShieldCheck }
];

type CreateOrderRouteState = {
  renewDraft?: CreateOrderDraft;
  prefillDraft?: Pick<CreateOrderDraft, "amount" | "currency" | "paymentMethod" | "type">;
  shortAlias?: string;
  creatingOfferAs?: { hashId: string; nickname: string };
  presetId?: string;
  presetEditor?: { id?: string };
  robotSlotId?: string;
};

const initialDraft: CreateOrderDraft = {
  type: 0,
  currency: 1,
  amount: "",
  hasRange: false,
  minAmount: "",
  maxAmount: "",
  paymentMethod: "",
  isSwap: false,
  isExplicit: false,
  premium: "0",
  satoshis: "0",
  publicDuration: "86340",
  escrowDuration: "10800",
  bondSize: "3",
  latitude: "0",
  longitude: "0",
  password: "",
  description: ""
};

export function CreateOrderPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const renewal = location.state as CreateOrderRouteState | null;
  const coordinators = useFederationStore((state) => state.coordinators);
  const slots = useGarageStore((state) => state.slots);
  const currentToken = useGarageStore((state) => state.currentToken);
  const setCurrentToken = useGarageStore((state) => state.setCurrentToken);
  const hydrateGarage = useGarageStore((state) => state.hydrate);
  const proEnabled = useProPreferencesStore((state) => state.enabled);
  const tradeSnapshots = useProTradeIndexStore((state) => state.snapshots);
  const tradeSyncBySlot = useProTradeIndexStore((state) => state.syncBySlot);
  const standardSlots = useMemo(() => selectStandardGarageSlots(slots), [slots]);
  const activeSlot = proEnabled && !renewal?.presetEditor
    ? renewal?.robotSlotId
      ? slots.find((slot) => slot.tokenSHA256 === renewal.robotSlotId)
      : undefined
    : selectCurrentSlot(standardSlots, currentToken);
  const setProLastView = useProPreferencesStore((state) => state.setLastView);
  const portableManifest = usePortableSettingsStore((state) => state.manifest);
  const savePreset = usePortableSettingsStore((state) => state.savePreset);
  const [draft, setDraft] = useState<CreateOrderDraft>(() => renewal?.renewDraft ?? {
    ...initialDraft,
    ...renewal?.prefillDraft
  });
  const [selectedShortAlias, setSelectedShortAlias] = useState(() => renewal?.shortAlias ?? "");
  const [currentStep, setCurrentStep] = useState(() => renewal?.prefillDraft ? wizardSteps.length - 1 : 0);
  const [reviewReady, setReviewReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [creatingOfferNotice, setCreatingOfferNotice] = useState(() => renewal?.creatingOfferAs);
  const [presetName, setPresetName] = useState("");
  const presetNameInput = useRef<HTMLInputElement>(null);
  const loadedPresetId = useRef("");
  const selectableCoordinators = useMemo(() => coordinators.filter((coordinator) => coordinator.shortAlias !== "local" && coordinator.enabled), [coordinators]);
  const offerPresets = useMemo(() => activeOfferPresets(portableManifest), [portableManifest]);
  const presetEditor = proEnabled && Boolean(renewal?.presetEditor);
  const requestedPresetId = renewal?.presetEditor?.id ?? renewal?.presetId;

  useEffect(() => {
    hydrateGarage();
  }, [hydrateGarage]);

  useEffect(() => {
    if (!proEnabled || renewal?.presetEditor || renewal?.robotSlotId) return;
    navigate("/pro", { replace: true, state: { openCreate: true } });
  }, [navigate, proEnabled, renewal?.presetEditor, renewal?.robotSlotId]);

  useEffect(() => {
    if (!creatingOfferNotice) return;
    const timeout = window.setTimeout(() => setCreatingOfferNotice(undefined), 2600);
    return () => window.clearTimeout(timeout);
  }, [creatingOfferNotice]);

  const selectedCoordinator = selectedShortAlias
    ? selectableCoordinators.find((coordinator) => coordinator.shortAlias === selectedShortAlias)
    : presetEditor
      ? undefined
      : selectableCoordinators.find((coordinator) => coordinator.enabled && coordinator.url && coordinator.online) ??
        selectableCoordinators.find((coordinator) => coordinator.enabled && coordinator.url) ??
        selectableCoordinators[0];
  const selectedAlias = selectedCoordinator?.shortAlias ?? "";
  const selectedCurrency = currencyLabel(draft.currency);
  const auth = getRobotAuthForCoordinator(activeSlot, selectedAlias);
  const robotAvailability = proEnabled && activeSlot
    ? deriveProRobotLifecycle(
        activeSlot,
        tradeSnapshots,
        tradeSyncBySlot[activeSlot.tokenSHA256]
      ).availability
    : getRobotOrderAvailability(activeSlot, tradeSnapshots);
  const payload = useMemo(() => buildCreateOrderPayload(draft), [draft]);
  const validationErrors = useMemo(() => validateCreateOrderPayload(payload), [payload]);
  const canSubmit = presetEditor
    ? Boolean(presetName.trim() && validationErrors.length === 0)
    : Boolean(activeSlot && robotAvailability.available && auth && selectedCoordinator?.url && validationErrors.length === 0);

  useEffect(() => {
    if (presetEditor || selectedShortAlias || selectableCoordinators.length === 0) return;
    const selectableAliases = new Set(selectableCoordinators.map((coordinator) => coordinator.shortAlias));
    const lotteryAlias = federationLottery(selectableCoordinators).find((shortAlias) => selectableAliases.has(shortAlias));
    const fallbackAlias =
      selectableCoordinators.find((coordinator) => coordinator.enabled && coordinator.url && coordinator.online)?.shortAlias ??
      selectableCoordinators.find((coordinator) => coordinator.enabled && coordinator.url)?.shortAlias ??
      selectableCoordinators[0]?.shortAlias;
    if (lotteryAlias ?? fallbackAlias) {
      setSelectedShortAlias(lotteryAlias ?? fallbackAlias ?? "");
    }
  }, [presetEditor, selectableCoordinators, selectedShortAlias]);

  useEffect(() => {
    if (!requestedPresetId || loadedPresetId.current === requestedPresetId) return;
    const preset = offerPresets.find((candidate) => candidate.id === requestedPresetId);
    if (!preset) return;
    loadedPresetId.current = requestedPresetId;
    setPresetName(preset.name);
    applyOfferPreset(preset);
  }, [offerPresets, requestedPresetId]);

  useEffect(() => {
    if (draft.isSwap && draft.currency !== BTC_CURRENCY_ID) {
      updateDraft({ currency: BTC_CURRENCY_ID });
    }
  }, [draft.currency, draft.isSwap]);

  useEffect(() => {
    if (currentStep !== wizardSteps.length - 1) {
      setReviewReady(false);
      return;
    }

    // Keep a rapid second click on Continue from activating the newly mounted
    // Create button in the same screen position.
    const timer = window.setTimeout(() => setReviewReady(true), 650);
    return () => window.clearTimeout(timer);
  }, [currentStep]);

  function updateDraft(patch: Partial<CreateOrderDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setSubmitError("");
  }

  function applyOfferPreset(preset: OfferPreset) {
    const currency = currencyIdFromCode(preset.currency);
    if (!currency) {
      setSubmitError("This preset uses a currency that is no longer available.");
      return;
    }
    const limitError = offerPresetLimitError(preset, currency, selectedCoordinator);
    if (limitError) {
      setSubmitError(limitError);
      return;
    }
    const hasRange = Boolean(preset.minAmount && preset.maxAmount);
    setDraft((current) => ({
      ...current,
      type: preset.direction,
      currency,
      amount: preset.amount ?? "",
      hasRange,
      minAmount: preset.minAmount ?? "",
      maxAmount: preset.maxAmount ?? "",
      paymentMethod: paymentMethodText(preset.paymentMethods),
      isSwap: preset.isSwap,
      isExplicit: false,
      premium: String(preset.premium),
      publicDuration: String(preset.publicDuration),
      escrowDuration: String(preset.escrowDuration),
      bondSize: String(preset.bond),
      description: preset.description,
      password: preset.password
    }));
    setSubmitError("");
  }

  function saveCurrentPreset(name: string, id?: string) {
    if (validationErrors.length > 0) {
      setSubmitError(validationErrors[0]);
      return false;
    }
    savePreset({
      id,
      name,
      direction: draft.type,
      isSwap: draft.isSwap,
      currency: selectedCurrency,
      amount: draft.hasRange ? undefined : draft.amount,
      minAmount: draft.hasRange ? draft.minAmount : undefined,
      maxAmount: draft.hasRange ? draft.maxAmount : undefined,
      paymentMethods: paymentMethodList(draft.paymentMethod),
      premium: Number(draft.premium),
      bond: Number(draft.bondSize),
      publicDuration: Number(draft.publicDuration),
      escrowDuration: Number(draft.escrowDuration),
      description: draft.description,
      password: draft.password
    });
    return true;
  }

  function stepErrors(step: number): string[] {
    if (step === 0) {
      if (presetEditor) return presetName.trim() ? [] : ["Give this preset a name before continuing."];
      const errors: string[] = [];
      if (!activeSlot) errors.push(proEnabled
        ? "Choose an available Fleet robot from the Pro Desk."
        : "Create or recover a robot before publishing an offer.");
      else if (!robotAvailability.available) errors.push(robotAvailability.message ?? "This robot is not available for another order.");
      if (!selectedCoordinator?.url) errors.push("Choose an available coordinator.");
      if (activeSlot && selectedCoordinator && !auth) errors.push("This robot has no credentials for the selected coordinator.");
      return errors;
    }

    if (step === 1) {
      if (draft.hasRange && (!draft.minAmount.trim() || !draft.maxAmount.trim())) {
        return ["Enter both a minimum and maximum amount."];
      }
      const limitError = draftCoordinatorLimitError(draft, selectedCoordinator);
      if (limitError) return [limitError];
      return validationErrors.map((error) =>
        draft.isSwap && error === "Add a payment method." ? "Add a swap destination." : error
      );
    }

    return [...stepErrors(0), ...validationErrors];
  }

  function nextStep() {
    const errors = stepErrors(currentStep);
    if (errors.length > 0) {
      setSubmitError(errors[0]);
      if (currentStep === 0 && presetEditor) presetNameInput.current?.focus();
      return;
    }

    setSubmitError("");
    setCurrentStep((step) => Math.min(wizardSteps.length - 1, step + 1));
  }

  function previousStep() {
    setSubmitError("");
    setCurrentStep((step) => Math.max(0, step - 1));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (currentStep < wizardSteps.length - 1) {
      nextStep();
      return;
    }
    if (!reviewReady) return;
    if (presetEditor) {
      if (!saveCurrentPreset(presetName.trim(), renewal?.presetEditor?.id)) return;
      setProLastView("robots");
      navigate("/pro", { state: { openPresets: true } });
      return;
    }
    if (!activeSlot || !auth || !selectedCoordinator?.url) {
      setSubmitError("Create or recover a robot before publishing an offer.");
      return;
    }
    if (validationErrors.length > 0) {
      setSubmitError(validationErrors[0]);
      return;
    }

    const releaseReservation = reserveRobotOrderAction(activeSlot.tokenSHA256);
    if (!releaseReservation) {
      setSubmitError(`${activeSlot.nickname} is already starting another order.`);
      return;
    }

    setSubmitting(true);
    setSubmitError("");
    preloadOrderRoute();

    try {
      const actionSlot = await revalidateRobotForNewOrder({
        coordinator: selectedCoordinator,
        proEnabled,
        slotId: activeSlot.tokenSHA256
      });
      const actionAuth = getRobotAuthForCoordinator(actionSlot, selectedAlias);
      if (!actionAuth) throw new Error("This robot has no credentials for the selected coordinator.");
      const response = await createOrder(selectedCoordinator.url, payload, actionAuth);
      const backendError = response.bad_request ?? response.bad_amount ?? response.bad_payment_method ?? response.bad_password;
      if (backendError) {
        setSubmitError(backendError);
        return;
      }
      if (!response.id) {
        setSubmitError("Coordinator did not return an order id.");
        return;
      }
      const provisionalOrder = buildProvisionalMakerOrder(response.id, selectedAlias, payload, actionSlot);
      if (proEnabled) setProLastView("trades");
      openConfirmedOrder(navigate, {
        coordinatorEndpoint: selectedCoordinator.url,
        initialOrder: provisionalOrder,
        orderId: response.id,
        shortAlias: selectedAlias,
        slotId: actionSlot.tokenSHA256
      });

      // The successful create must open Trade even if local persistence is
      // unavailable; the first authoritative read repairs this snapshot.
      try {
        setCurrentToken(actionSlot.token);
        ingestCoordinatorOrder({
          authoritative: false,
          order: provisionalOrder,
          shortAlias: selectedAlias,
          slot: actionSlot
        });
      } catch {
        // The Trade page performs the authoritative repair.
      }
    } catch (error) {
      setSubmitError(toUserMessage(error, "Could not create order."));
    } finally {
      releaseReservation();
      setSubmitting(false);
    }
  }

  return (
    <main className="page page-narrow maker-page">
      {creatingOfferNotice ? (
        <aside className="maker-create-identity-notice" role="status" aria-live="polite">
          <RobotAvatar hashId={creatingOfferNotice.hashId} label={creatingOfferNotice.nickname} size="sm" />
          <span>Creating offer as <strong>{creatingOfferNotice.nickname}</strong></span>
        </aside>
      ) : null}
      <div className="page-heading">
        <div>
          <p className="app-eyebrow">{presetEditor ? "Offer Preset" : "Create"}</p>
          <h2>{presetEditor ? (renewal?.presetEditor?.id ? "Edit offer preset" : "Create offer preset") : "Publish a new offer"}</h2>
        </div>
      </div>

      <section className="maker-layout">
        <form className="maker-form" onSubmit={(event) => void submit(event)}>
          <Card className="maker-wizard-card">
            <CardHeader className="maker-wizard-card-header">
              <div className="maker-stepper" aria-label="Create order progress">
                {wizardSteps.map((step, index) => {
                  const Icon = step.icon;
                  return (
                    <button
                      className={stepClassName(index, currentStep)}
                      key={step.title}
                      type="button"
                      onClick={() => {
                        if (index <= currentStep) {
                          setSubmitError("");
                          setCurrentStep(index);
                        }
                      }}
                    >
                      <span className="maker-step-index">{index < currentStep ? <Check size={14} /> : <Icon size={14} />}</span>
                      <span>{step.title}</span>
                    </button>
                  );
                })}
              </div>
            </CardHeader>

            <CardContent>
              {proEnabled && portableManifest && !presetEditor ? (
                <OfferPresetPanel
                  appliedPresetId={renewal?.presetId}
                  onApply={applyOfferPreset}
                  onManage={() => navigate("/pro", { state: { openPresets: true } })}
                  onSave={saveCurrentPreset}
                  presets={offerPresets}
                />
              ) : null}
              {!presetEditor && !activeSlot ? (
                <div className="status-panel status-panel-warning maker-inline-warning">
                  <AlertCircle size={18} />
                  <span>{proEnabled ? "Choose an available Fleet robot before publishing an offer." : "Create or recover a robot before publishing an offer."}</span>
                  <Link className="text-command" to={proEnabled ? "/pro" : "/garage"}>
                    {proEnabled ? "Pro Desk" : "Garage"}
                  </Link>
                </div>
              ) : null}
              <RobotReuseNote hidden={presetEditor} slot={activeSlot} />

              {currentStep === 0 ? (
                <>
                  {presetEditor ? (
                    <label className="maker-preset-name-field maker-preset-name-field-step">
                      <span>Preset name</span>
                      <input
                        ref={presetNameInput}
                        aria-invalid={submitError === "Give this preset a name before continuing."}
                        autoFocus
                        maxLength={64}
                        placeholder="e.g. Weekly EUR buy"
                        value={presetName}
                        onChange={(event) => {
                          setPresetName(event.target.value);
                          setSubmitError("");
                        }}
                      />
                    </label>
                  ) : null}
                  <SideStep
                    coordinators={selectableCoordinators}
                    draft={draft}
                    selectedShortAlias={selectedAlias}
                    showCoordinator={!presetEditor}
                    updateDraft={updateDraft}
                    onCoordinatorChange={setSelectedShortAlias}
                  />
                </>
              ) : null}

              {currentStep === 1 ? (
                <AmountStep draft={draft} updateDraft={updateDraft} />
              ) : null}

              {currentStep === 2 ? (
                <ReviewStep
                  coordinator={selectedCoordinator}
                  currency={selectedCurrency}
                  draft={draft}
                  robotHashId={activeSlot?.hashId}
                  robotName={activeSlot?.nickname}
                  presetMode={presetEditor}
                  validationErrors={validationErrors}
                />
              ) : null}

              {submitError ? (
                <div className="status-panel status-panel-warning maker-step-error">
                  <AlertCircle size={18} />
                  <span>{submitError}</span>
                </div>
              ) : null}

              <div className="maker-wizard-footer">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={currentStep === 0 && presetEditor ? () => navigate("/pro", { state: { openPresets: true } }) : previousStep}
                  disabled={currentStep === 0 && !presetEditor || submitting}
                >
                  <ArrowLeft size={16} />
                  {currentStep === 0 && presetEditor ? "Cancel" : "Back"}
                </Button>

                {currentStep < wizardSteps.length - 1 ? (
                  <Button type="button" onClick={() => nextStep()}>
                    {currentStep === wizardSteps.length - 2 ? "Review offer" : "Continue"}
                    <ArrowRight size={16} />
                  </Button>
                ) : (
                  <Button type="submit" size="lg" loading={submitting} disabled={!canSubmit || !reviewReady}>
                    {presetEditor ? <Save size={18} /> : <PlusCircle size={18} />}
                    {presetEditor ? "Save preset" : "Create offer"}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </form>
      </section>
    </main>
  );
}

function RobotReuseNote({
  hidden,
  slot
}: {
  hidden: boolean;
  slot?: RobotSlot;
}) {
  if (hidden || !slot || !hasPreviousOrder(slot)) return null;
  return (
    <div className="token-reuse-note" role="note">
      <AlertTriangle size={16} aria-hidden="true" />
      <span>
        This robot identity was used for an earlier order. You can continue, or choose a fresh robot for stronger privacy separation.
      </span>
    </div>
  );
}

function hasPreviousOrder(slot: RobotSlot): boolean {
  return Boolean(slot.lastOrderId || Object.values(slot.robots).some((robot) => robot.lastOrderId));
}

function OfferPresetPanel({
  appliedPresetId,
  onApply,
  onManage,
  onSave,
  presets
}: {
  appliedPresetId?: string;
  onApply: (preset: OfferPreset) => void;
  onManage: () => void;
  onSave: (name: string) => boolean;
  presets: OfferPreset[];
}) {
  const [selectedId, setSelectedId] = useState(appliedPresetId ?? "");
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    setSelectedId(appliedPresetId ?? "");
  }, [appliedPresetId]);

  function save() {
    if (!name.trim() || !onSave(name.trim())) return;
    setName("");
    setSaving(false);
  }

  return (
    <section className="maker-preset-panel" aria-label="Offer presets">
      <div className="maker-preset-main">
        <div className="maker-preset-control">
          <span className="maker-preset-label">
            <Bookmark size={16} aria-hidden="true" />
            <span>Offer preset</span>
            <InfoHint title="A preset saves reusable offer terms so you can fill this form faster. You still choose the coordinator for each new offer." />
          </span>
          <VisualSelect
            ariaLabel="Offer preset"
            className="maker-preset-select"
            disabled={presets.length === 0}
            options={[
              {
                value: "",
                label: presets.length ? "Choose preset" : "No saved presets"
              },
              ...presets.map((preset) => ({
                value: preset.id,
                label: preset.name
              }))
            ]}
            value={selectedId}
            onChange={(value) => {
              const next = presets.find((preset) => preset.id === value);
              setSelectedId(value);
              if (next) onApply(next);
            }}
          />
        </div>
        <div className="maker-preset-actions">
          <Button type="button" size="sm" variant="outline" onClick={() => setSaving((current) => !current)}><Save size={16} /> Save preset</Button>
          <Button type="button" size="sm" variant="ghost" onClick={onManage}>Manage</Button>
        </div>
      </div>
      {saving ? (
        <div className="maker-preset-save">
          <label><span>Preset name</span><input maxLength={64} value={name} onChange={(event) => setName(event.target.value)} /></label>
          <Button type="button" size="sm" disabled={!name.trim()} onClick={save}>Save</Button>
        </div>
      ) : null}
    </section>
  );
}

function SideStep({
  coordinators,
  draft,
  selectedShortAlias,
  showCoordinator,
  updateDraft,
  onCoordinatorChange
}: {
  coordinators: ReturnType<typeof useFederationStore.getState>["coordinators"];
  draft: CreateOrderDraft;
  selectedShortAlias: string;
  showCoordinator: boolean;
  updateDraft: (patch: Partial<CreateOrderDraft>) => void;
  onCoordinatorChange: (shortAlias: string) => void;
}) {
  return (
    <div className="maker-step-panel">
      <div className="maker-choice-grid">
        <button className={choiceCardClassName(draft.type === 0, draft.isSwap ? "swap-in" : "buy")} type="button" onClick={() => updateDraft({ type: 0 })}>
          <span className={draft.isSwap ? "maker-choice-icon maker-choice-icon-swap-in" : "maker-choice-icon maker-choice-icon-buy"}>
            {draft.isSwap ? <Repeat2 size={20} /> : <ReceiptText size={20} />}
          </span>
          <strong>{draft.isSwap ? "Swap In" : "Buy BTC"}</strong>
          <small>{draft.isSwap ? "Send bitcoin on-chain and receive Lightning." : "You pay fiat to receive bitcoin."}</small>
        </button>
        <button className={choiceCardClassName(draft.type === 1, draft.isSwap ? "swap-out" : "sell")} type="button" onClick={() => updateDraft({ type: 1 })}>
          <span className={draft.isSwap ? "maker-choice-icon maker-choice-icon-swap-out" : "maker-choice-icon maker-choice-icon-sell"}>
            {draft.isSwap ? <Repeat2 size={20} /> : <ReceiptText size={20} />}
          </span>
          <strong>{draft.isSwap ? "Swap Out" : "Sell BTC"}</strong>
          <small>{draft.isSwap ? "Send Lightning and receive bitcoin on-chain." : "You lock bitcoin and receive fiat."}</small>
        </button>
      </div>

      <details className="details-panel maker-sub-advanced">
        <summary>
          <span>Advanced</span>
          <InfoHint title="Bitcoin swaps are advanced offers for moving between on-chain bitcoin and Lightning. Normal fiat trades stay selected by default." />
        </summary>
        <div className="segmented wide-segmented maker-settlement-toggle">
          <Button
            type="button"
            variant={!draft.isSwap ? "primary" : "outline"}
            onClick={() => updateDraft({ isSwap: false, currency: 1, paymentMethod: "", latitude: "0", longitude: "0" })}
          >
            Fiat Trade
          </Button>
          <Button
            type="button"
            variant={draft.isSwap ? "primary" : "outline"}
            onClick={() => updateDraft({ isSwap: true, currency: BTC_CURRENCY_ID, paymentMethod: "", latitude: "0", longitude: "0" })}
          >
            Bitcoin Swap
          </Button>
        </div>
      </details>

      {showCoordinator ? (
        <CoordinatorPicker
          coordinators={coordinators}
          selectedShortAlias={selectedShortAlias}
          onChange={onCoordinatorChange}
        />
      ) : null}
    </div>
  );
}

function AmountStep({
  draft,
  updateDraft
}: {
  draft: CreateOrderDraft;
  updateDraft: (patch: Partial<CreateOrderDraft>) => void;
}) {
  const paymentMethods = draft.isSwap ? SWAP_PAYMENT_METHODS : NORMAL_PAYMENT_METHODS;
  const selectedMethods = paymentMethodList(draft.paymentMethod);
  const hasSelectedF2FLocation = hasApproximateF2FLocation(draft.latitude, draft.longitude);
  const [methodQuery, setMethodQuery] = useState("");
  const [showF2FMap, setShowF2FMap] = useState(false);

  function addPaymentMethod(method: string) {
    const cleanMethod = method.trim();
    if (!cleanMethod) return;
    if (!draft.isSwap && isCashF2FMethod(cleanMethod)) {
      setMethodQuery("");
      setShowF2FMap(true);
      return;
    }
    const nextMethods = selectedMethods.some((selected) => selected.toLowerCase() === cleanMethod.toLowerCase())
      ? selectedMethods
      : [...selectedMethods, cleanMethod];
    updateDraft({ paymentMethod: paymentMethodText(nextMethods) });
    setMethodQuery("");
  }

  function removePaymentMethod(method: string) {
    updateDraft({
      paymentMethod: paymentMethodText(selectedMethods.filter((selected) => selected !== method)),
      ...(isCashF2FMethod(method) ? { latitude: "0", longitude: "0" } : {})
    });
  }

  function confirmF2FLocation([latitude, longitude]: [number, number]) {
    const nextMethods = selectedMethods.some(isCashF2FMethod)
      ? selectedMethods
      : [...selectedMethods, CASH_F2F_METHOD];
    updateDraft({
      paymentMethod: paymentMethodText(nextMethods),
      latitude: String(latitude),
      longitude: String(longitude)
    });
    setShowF2FMap(false);
  }

  return (
    <div className="maker-step-panel">
      <div className={`maker-grid maker-premium-grid${draft.isSwap ? " maker-swap-amount-grid" : ""}`}>
        {!draft.isSwap ? (
          <label className="field-block">
            <span>Currency</span>
            <CurrencyPicker
              label="Select payment currency"
              options={CURRENCIES.map((currency) => ({ label: currency.label, value: currency.code }))}
              value={draft.currency}
              onChange={(value) => updateDraft({ currency: Number(value) })}
            />
          </label>
        ) : null}
        <label className="field-block">
          <span>{draft.isSwap ? "BTC amount" : draft.hasRange ? "Amount" : "Fiat amount"}</span>
          <input
            inputMode="decimal"
            value={draft.amount}
            disabled={draft.hasRange}
            placeholder={draft.isSwap ? "Type the BTC amount" : "Type the amount"}
            onChange={(event) => updateDraft({ amount: event.target.value })}
          />
        </label>
      </div>

      <label className="check-row maker-range-toggle">
        <input
          type="checkbox"
          checked={draft.hasRange}
          onChange={(event) => updateDraft({
            hasRange: event.target.checked,
            ...(event.target.checked ? { minAmount: "", maxAmount: "" } : {})
          })}
        />
        <span>Use amount range</span>
        <InfoHint title="Set a minimum and maximum trade size. The taker chooses the exact amount within this range." />
      </label>

      {draft.hasRange ? (
        <div className="maker-grid">
          <label className="field-block">
            <span>Minimum</span>
            <input
              inputMode="decimal"
              placeholder="Type minimum amount"
              required
              value={draft.minAmount}
              onChange={(event) => updateDraft({ minAmount: event.target.value })}
            />
          </label>
          <label className="field-block">
            <span>Maximum</span>
            <input
              inputMode="decimal"
              placeholder="Type maximum amount"
              required
              value={draft.maxAmount}
              onChange={(event) => updateDraft({ maxAmount: event.target.value })}
            />
          </label>
        </div>
      ) : null}

      <div className="maker-payment-method">
        <div className="field-block maker-method-field">
          <span>
            {draft.isSwap ? "Swap destination" : "Payment methods"}
            <InfoHint title={draft.isSwap ? "Choose where the Lightning swap settles." : "Pick one or more fast fiat payment methods, or type your own."} />
          </span>
          <PaymentMethodPicker
            allowCustom
            label={draft.isSwap ? "Select swap destination" : "Select payment method"}
            options={paymentMethods}
            value={methodQuery}
            onChange={setMethodQuery}
            onSelect={(value) => {
              if (value && value !== "all") {
                addPaymentMethod(value);
              }
            }}
          />
        </div>
        {selectedMethods.length > 0 ? (
          <div className="chip-set maker-selected-methods" aria-label="Selected payment methods">
            {selectedMethods.map((method) => isCashF2FMethod(method) ? (
              <span className="maker-f2f-chip" key={method}>
                <button
                  aria-label="Edit approximate Cash F2F meeting area"
                  className="maker-f2f-chip-main"
                  onClick={() => setShowF2FMap(true)}
                  type="button"
                >
                  <PaymentMethodIcons text={method} size={17} />
                  <span>{method}</span>
                  <small>{hasSelectedF2FLocation ? "Area selected" : "Choose area"}</small>
                  <MapPin size={14} aria-hidden="true" />
                </button>
                <button
                  aria-label="Remove Cash F2F payment method"
                  className="maker-f2f-chip-remove"
                  onClick={() => removePaymentMethod(method)}
                  type="button"
                >
                  <X size={14} />
                </button>
              </span>
            ) : (
              <button className="chip-button chip-button-active" type="button" key={method} onClick={() => removePaymentMethod(method)}>
                <PaymentMethodIcons text={method} size={17} />
                <span>{method}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {showF2FMap ? (
        <Suspense fallback={<AppTransitionDialog title="Preparing meeting map" message="Loading the private location picker..." />}>
          <LazyF2FLocationDialog
            latitude={draft.latitude}
            longitude={draft.longitude}
            onClose={() => setShowF2FMap(false)}
            onConfirm={confirmF2FLocation}
          />
        </Suspense>
      ) : null}

      <div className="maker-grid">
        <label className="field-block">
          <span>
            Premium over market (%)
            <InfoHint title="Premium adjusts your offer relative to the coordinator market price. Negative values are discounts." />
          </span>
          <input inputMode="decimal" value={draft.premium} onChange={(event) => updateDraft({ premium: event.target.value, isExplicit: false })} />
        </label>
      </div>

      <details className="details-panel maker-amount-advanced">
        <summary>
          <span>Advanced settings</span>
          <InfoHint title="Optional trade instructions, privacy controls, bond size, and order timers." />
        </summary>
        <div className="maker-advanced-body">
          <div className="maker-advanced-timers">
            <TimeClockField
              label="Public Duration (HH:mm)"
              help="Public order length."
              value={draft.publicDuration}
              minSeconds={PUBLIC_DURATION_MIN_SECONDS}
              maxSeconds={PUBLIC_DURATION_MAX_SECONDS}
              presetSeconds={[3 * 60 * 60, 6 * 60 * 60, 12 * 60 * 60, PUBLIC_DURATION_MAX_SECONDS]}
              onChange={(value) => updateDraft({ publicDuration: value })}
            />
            <TimeClockField
              label="Escrow/Invoice Timer (HH:mm)"
              help="Escrow/invoice step length."
              value={draft.escrowDuration}
              minSeconds={ESCROW_DURATION_MIN_SECONDS}
              maxSeconds={ESCROW_DURATION_MAX_SECONDS}
              onChange={(value) => updateDraft({ escrowDuration: value })}
            />
          </div>
          <label className="field-block">
            <span>
              Description
              <InfoHint title="Instructions the taker must read before locking a bond. Do not include personal information." />
            </span>
            <textarea
              rows={3}
              value={draft.description}
              placeholder="Optional instructions for the peer"
              onChange={(event) => updateDraft({ description: event.target.value })}
            />
          </label>
          <label className="field-block">
            <span>
              Password for private orders
              <InfoHint title="When set, the offer is hidden from the public book and can only be taken with this password." />
            </span>
            <input
              type="password"
              autoComplete="new-password"
              value={draft.password}
              placeholder="Leave empty for a public offer"
              onChange={(event) => updateDraft({ password: event.target.value })}
            />
          </label>
          <label className="field-block">
            <span>
              Fidelity bond (%)
              <InfoHint title="The Lightning hold invoice each peer locks as a good-behavior bond. The default is 3%." />
            </span>
            <input inputMode="decimal" value={draft.bondSize} onChange={(event) => updateDraft({ bondSize: event.target.value })} />
          </label>
        </div>
      </details>
    </div>
  );
}

function ReviewStep({
  coordinator,
  currency,
  draft,
  robotHashId,
  robotName,
  presetMode,
  validationErrors
}: {
  coordinator?: ReturnType<typeof useFederationStore.getState>["coordinators"][number];
  currency: string;
  draft: CreateOrderDraft;
  robotHashId?: string | null;
  robotName?: string;
  presetMode?: boolean;
  validationErrors: string[];
}) {
  const [showF2FMap, setShowF2FMap] = useState(false);
  const showF2FLocation = paymentMethodHasF2F(draft.paymentMethod)
    && hasApproximateF2FLocation(draft.latitude, draft.longitude);

  return (
    <div className="maker-step-panel">
      {!presetMode ? <div className="maker-review-identity">
        <div>
          <RobotAvatar hashId={robotHashId} label={robotName} size="md" />
          <span>
            <small>Maker</small>
            <strong>{robotName ?? "Your robot"}</strong>
          </span>
        </div>
        {coordinator ? (
          <div className="maker-review-coordinator">
            <img className="coordinator-avatar coordinator-avatar-md" src={coordinator.smallAvatarUrl} alt="" />
            <span>
              <small>Coordinator <InfoHint title="The order host provides the Lightning and communication infrastructure and handles disputes." /></small>
              <strong>{coordinator.longAlias}</strong>
            </span>
          </div>
        ) : null}
      </div> : null}
      <div className="maker-review-hero">
        <Badge tone={roleBuysBitcoin(draft.type, "maker") ? "buy" : "sell"}>
          {roleIntentLabel(draft.type, draft.isSwap, "maker")}
        </Badge>
        <strong>
          <CurrencyFlag code={currency} size={22} />
          {draft.hasRange ? `${draft.minAmount} - ${draft.maxAmount} ${currency}` : formatFiat(Number(draft.amount), currency)}
        </strong>
        <span>{draft.paymentMethod || (draft.isSwap ? "Swap destination not set" : "Payment method not set")}</span>
        {showF2FLocation ? (
          <Button
            className="maker-review-f2f-map"
            onClick={() => setShowF2FMap(true)}
            size="sm"
            type="button"
            variant="outline"
          >
            <MapPin size={15} />
            View approximate area
          </Button>
        ) : null}
      </div>

      <dl className="maker-review-grid">
        <ReviewItem label="Premium" value={`${draft.premium || 0}%`} />
        <ReviewItem label="Bond" help="The fidelity bond both peers lock to discourage contract violations." value={`${draft.bondSize}%`} icon={<Lock size={14} />} />
        <ReviewItem label="Public" help="How long this offer can remain in the public orderbook." value={formatDuration(Number(draft.publicDuration))} icon={<Clock size={14} />} />
        <ReviewItem label="Escrow" help="The deadline for the peer's next invoice or collateral action." value={formatDuration(Number(draft.escrowDuration))} />
      </dl>

      {validationErrors.length > 0 ? (
        <div className="validation-list">
          {validationErrors.map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>
      ) : null}
      {showF2FMap ? (
        <Suspense fallback={<AppTransitionDialog title="Preparing meeting map" message="Loading the approximate meeting area..." />}>
          <LazyF2FLocationDialog
            latitude={draft.latitude}
            longitude={draft.longitude}
            onClose={() => setShowF2FMap(false)}
            readOnly
          />
        </Suspense>
      ) : null}
    </div>
  );
}

function CoordinatorPicker({
  coordinators,
  selectedShortAlias,
  onChange
}: {
  coordinators: ReturnType<typeof useFederationStore.getState>["coordinators"];
  selectedShortAlias: string;
  onChange: (shortAlias: string) => void;
}) {
  const refreshCoordinator = useFederationStore((state) => state.refreshCoordinator);
  const refreshCoordinatorLimits = useFederationStore((state) => state.refreshCoordinatorLimits);
  const attempted = useRef(new Set<string>());
  const [localRetryAlias, setLocalRetryAlias] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [rating, setRating] = useState<CoordinatorRating>({ score: 0, count: 0 });
  const selected = coordinators.find((coordinator) => coordinator.shortAlias === selectedShortAlias);
  const lastRefreshed = useFederationStore((state) => state.lastRefreshed);
  const network = useFederationStore((state) => state.network);
  const needsHealthRefresh = Boolean(selected && coordinatorNeedsVisibleRefresh(selected));
  const needsLimitsRefresh = Boolean(selected && !selected.limits);
  const shouldAutoRetry = Boolean(
    selected
    && (needsHealthRefresh || needsLimitsRefresh)
    && !selected.loading
    && !attempted.current.has(selected.shortAlias)
  );
  const checking = Boolean(selected?.loading || localRetryAlias === selected?.shortAlias || shouldAutoRetry);
  const connecting = Boolean(checking && !selected?.online);
  const connected = Boolean(selected?.online);
  const statusClassName = connecting
    ? "maker-coordinator-status maker-coordinator-status-loading"
    : connected
      ? "maker-coordinator-status maker-coordinator-status-success"
      : "maker-coordinator-status maker-coordinator-status-warning";
  const statusCopy = connected && checking
    ? `Using ${selected?.longAlias ?? "coordinator"}. Refreshing details...`
    : connecting
    ? `Connecting to ${selected?.longAlias ?? "coordinator"}...`
    : !connected
      ? selected?.error ? "Coordinator unavailable." : "Coordinator will be checked before use."
      : !selected?.info
        ? "Coordinator connected."
        : selected.info.swap_enabled
          ? "Connected. On-chain swaps are available."
          : "Connected. Fiat trades only.";

  useEffect(() => {
    if (!selected || (!needsHealthRefresh && !needsLimitsRefresh) || selected.loading || attempted.current.has(selected.shortAlias)) return;
    const alias = selected.shortAlias;
    attempted.current.add(alias);
    setLocalRetryAlias(alias);
    const refreshHealth = needsHealthRefresh
      ? refreshCoordinator(alias, { priority: "visible" })
      : Promise.resolve(true);
    void refreshHealth
      .then(() => refreshCoordinatorLimits(alias, { priority: "visible" }))
      .finally(() => setLocalRetryAlias((current) => current === alias ? "" : current));
  }, [needsHealthRefresh, needsLimitsRefresh, refreshCoordinator, refreshCoordinatorLimits, selected]);

  async function retrySelectedCoordinator() {
    if (!selected) return;
    setLocalRetryAlias(selected.shortAlias);
    try {
      await refreshCoordinator(selected.shortAlias, { force: true });
      await refreshCoordinatorLimits(selected.shortAlias, { force: true, priority: "visible" });
    } finally {
      setLocalRetryAlias("");
    }
  }

  function openCoordinatorDetails() {
    if (!selected) return;
    setShowDetails(true);
    setRating({ score: 0, count: 0 });
    void import("@/domains/coordinators/coordinatorRatings")
      .then(({ fetchCoordinatorRatings }) => fetchCoordinatorRatings([selected]))
      .then((ratings) => setRating(ratings[selected.shortAlias] ?? { score: 0, count: 0 }))
      .catch(() => undefined);
  }

  return (
    <div className="maker-coordinator-picker">
      <div className="maker-coordinator-heading">
        <span>
          Coordinator
          <InfoHint title="The order host provides Lightning and communication infrastructure, sets trade fees, and handles disputes." />
        </span>
        <button
          className="maker-coordinator-detail-button"
          type="button"
          onClick={openCoordinatorDetails}
          disabled={!selected}
          aria-label={selected ? `View ${selected.longAlias} details` : "View coordinator details"}
        >
          <Info size={16} />
          <span>Details</span>
        </button>
      </div>
      <div className="maker-coordinator-box" aria-label="The provider of the Lightning and communication infrastructure. Choose only coordinators you trust.">
        <VisualSelect
          ariaLabel="Select order coordinator"
          iconActionLabel={selected ? `View ${selected.longAlias} details` : "View coordinator details"}
          onChange={onChange}
          onIconClick={selected ? openCoordinatorDetails : undefined}
          options={[
            ...(!selectedShortAlias ? [{ value: "", label: "Choose coordinator", description: "Required for every offer" }] : []),
            ...coordinators.map((coordinator) => ({
              value: coordinator.shortAlias,
              label: coordinator.longAlias,
              description: coordinatorOptionStatus(coordinator),
              icon: <img className="coordinator-avatar coordinator-avatar-lg" src={coordinator.smallAvatarUrl} alt="" />
            }))
          ]}
          triggerCaption="Order host"
          value={selectedShortAlias}
        />
      </div>
      {selected ? <div className={statusClassName} aria-live="polite">
        {checking ? <LoaderCircle className="maker-coordinator-spinner" size={17} /> : connected ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}
        <span>{statusCopy}</span>
        {!checking && !connected && selected.error ? <button type="button" onClick={() => void retrySelectedCoordinator()}>Retry</button> : null}
      </div> : <div className="maker-coordinator-status maker-coordinator-status-warning"><Info size={17} /><span>Choose the coordinator that will host this offer.</span></div>}
      {selected ? (
        <div className="maker-coordinator-fees" aria-label="Coordinator fees">
          <span title="Fee paid when your offer is taken"><small>Maker fee</small><strong>{formatCoordinatorFee(selected.info?.maker_fee)}</strong></span>
          <span title="Fee paid when taking another robot's offer"><small>Taker fee</small><strong>{formatCoordinatorFee(selected.info?.taker_fee)}</strong></span>
          <span title={!selected.info ? "On-chain fee loads with coordinator details" : selected.info.swap_enabled ? "Current on-chain swap fee" : "On-chain swaps unavailable"}>
            <small><LinkIcon /> On-chain fee</small>
            <strong>{!selected.info ? "—" : selected.info.swap_enabled ? `${formatOptionalRate(selected.info.current_swap_fee_rate)}%` : "Unavailable"}</strong>
          </span>
        </div>
      ) : null}
      {showDetails && selected ? (
        <Suspense
          fallback={(
            <Dialog
              ariaLabel="Preparing coordinator details"
              onClose={() => setShowDetails(false)}
              overlayClassName="confirm-overlay app-transition-overlay"
              panelClassName="confirm-sheet app-transition-dialog"
            >
              <button className="take-modal-close" onClick={() => setShowDetails(false)} type="button" aria-label="Close coordinator details">
                <X size={18} />
              </button>
              <AppTransitionFeedback title="Preparing coordinator details" message={`Loading ${selected.longAlias}...`} />
            </Dialog>
          )}
        >
          <LazyCoordinatorDetailDialog
            compact
            coordinator={selected}
            lastRefreshed={lastRefreshed}
            network={network}
            rating={rating}
            onClose={() => setShowDetails(false)}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

const SELECTED_COORDINATOR_REFRESH_MS = 5 * 60 * 1000;

function coordinatorNeedsVisibleRefresh(coordinator: ReturnType<typeof useFederationStore.getState>["coordinators"][number]): boolean {
  return coordinatorNeedsRefresh(coordinator, SELECTED_COORDINATOR_REFRESH_MS);
}

function coordinatorOptionStatus(coordinator: ReturnType<typeof useFederationStore.getState>["coordinators"][number]): string {
  return selectCoordinatorAvailability(coordinator).label;
}

function LinkIcon() {
  return (
    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1M8 13h8v-2H8zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5" />
    </svg>
  );
}

function formatCoordinatorFee(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${(number * 100).toFixed(3)}%`;
}

function formatOptionalRate(value: unknown): string {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(1) : "—";
}

function TimeClockField({
  help,
  label,
  maxSeconds,
  minSeconds,
  onChange,
  presetSeconds,
  value
}: {
  help: string;
  label: string;
  maxSeconds: number;
  minSeconds: number;
  onChange: (value: string) => void;
  presetSeconds?: number[];
  value: string;
}) {
  const seconds = clampDuration(parseInteger(value), minSeconds, maxSeconds);
  const [open, setOpen] = useState(false);
  const [draftSeconds, setDraftSeconds] = useState(seconds);
  const { hours, minutes } = secondsToClockParts(draftSeconds);
  const { hours: minHours, minutes: minBoundaryMinutes } = secondsToClockParts(minSeconds);
  const { hours: maxHours, minutes: maxBoundaryMinutes } = secondsToClockParts(maxSeconds);
  const minimumMinute = hours === minHours ? minBoundaryMinutes : 0;
  const maximumMinute = hours === maxHours ? maxBoundaryMinutes : 59;
  const handAngle = ((hours % 12) + minutes / 60) * 30;

  function updateParts(nextHours: number, nextMinutes: number) {
    const nextSeconds = clampDuration(nextHours * 60 * 60 + nextMinutes * 60, minSeconds, maxSeconds);
    setDraftSeconds(nextSeconds);
  }

  return (
    <section className="maker-time-section">
      <div className="maker-field-label">
        {label}
        <InfoHint title={help} />
      </div>
      <button className="maker-clock-summary" type="button" onClick={() => { setDraftSeconds(seconds); setOpen(true); }}>
          <Clock size={18} />
          <strong>{formatClockDuration(seconds)}</strong>
      </button>
      {open ? (
        <Dialog
          ariaLabel={label}
          dismissOnBackdrop
          onClose={() => setOpen(false)}
          overlayClassName="maker-time-dialog-overlay"
          panelClassName="maker-time-dialog"
        >
            <header>
              <span className="maker-time-dialog-heading">
                <span className="app-eyebrow">{label}</span>
                <small>Allowed {formatClockDuration(minSeconds)} - {formatClockDuration(maxSeconds)}</small>
              </span>
              <strong>{formatClockDuration(draftSeconds)}</strong>
            </header>
            <div className="maker-clock-panel">
          <div className="maker-clock-face" style={{ "--clock-hand-angle": `${handAngle}deg` } as CSSProperties}>
            {Array.from({ length: 24 }, (_, hour) => {
              const angle = (hour % 12) * 30;
              const radius = hour >= 13 || hour === 0 ? "3.9rem" : "5.85rem";
              const disabled = hour < minHours || hour > maxHours;
              return (
                <button
                  className={hour === hours ? "maker-clock-hour maker-clock-hour-active" : "maker-clock-hour"}
                  disabled={disabled}
                  key={hour}
                  style={{ "--clock-hour-angle": `${angle}deg`, "--clock-hour-radius": radius } as CSSProperties}
                  type="button"
                  onClick={() => updateParts(hour, minutes)}
                >
                  {String(hour).padStart(2, "0")}
                </button>
              );
            })}
            <span className="maker-clock-hand" />
            <span className="maker-clock-pin" />
          </div>

          <div className="maker-clock-controls">
            <label className="field-block">
              <span>Hours</span>
              <input
                inputMode="numeric"
                max={maxHours}
                min={minHours}
                type="number"
                value={hours}
                onChange={(event) => updateParts(Number(event.target.value), minutes)}
              />
            </label>
            <label className="field-block">
              <span>Minutes</span>
              <input
                inputMode="numeric"
                max={maximumMinute}
                min={minimumMinute}
                step={1}
                type="number"
                value={minutes}
                onChange={(event) => updateParts(hours, Number(event.target.value))}
              />
            </label>
            <div className="maker-clock-minute-grid" aria-label={`${label} minute shortcuts`}>
              {[0, 15, 30, 45].map((minute) => (
                <button
                  className={minute === minutes ? "maker-clock-minute maker-clock-minute-active" : "maker-clock-minute"}
                  disabled={minute < minimumMinute || minute > maximumMinute}
                  key={minute}
                  type="button"
                  onClick={() => updateParts(hours, minute)}
                >
                  {String(minute).padStart(2, "0")}
                </button>
              ))}
            </div>
          </div>
            </div>
            <div className="maker-time-dialog-actions">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="button" onClick={() => { onChange(String(draftSeconds)); setOpen(false); }}>OK</Button>
            </div>
        </Dialog>
      ) : null}
      <div className="maker-clock-presets">
        {durationPresets(minSeconds, maxSeconds, presetSeconds).map((option) => (
          <button
            className={option.value === String(seconds) ? "maker-clock-preset maker-clock-preset-active" : "maker-clock-preset"}
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function parseInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampDuration(value: number, minSeconds: number, maxSeconds: number): number {
  return Math.min(maxSeconds, Math.max(minSeconds, value));
}

function secondsToClockParts(seconds: number): { hours: number; minutes: number } {
  return {
    hours: Math.floor(seconds / 3600),
    minutes: Math.floor((seconds % 3600) / 60)
  };
}

function formatClockDuration(seconds: number): string {
  const { hours, minutes } = secondsToClockParts(seconds);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function durationPresets(minSeconds: number, maxSeconds: number, requested?: number[]): Array<{ label: string; value: string }> {
  const candidates = requested ?? [15 * 60, 60 * 60, 3 * 60 * 60, 6 * 60 * 60, 8 * 60 * 60, 12 * 60 * 60, PUBLIC_DURATION_MAX_SECONDS];
  const unique = new Set(candidates.filter((value) => value >= minSeconds && value <= maxSeconds));
  return Array.from(unique).map((value) => ({
    label: value === PUBLIC_DURATION_MAX_SECONDS ? "24:00" : formatClockDuration(value),
    value: String(value)
  }));
}

function ReviewItem({ help, icon, label, value }: { help?: string; icon?: ReactNode; label: string; value: string }) {
  return (
    <div>
      <dt>{label}{help ? <InfoHint title={help} /> : null}</dt>
      <dd>
        {icon}
        {value}
      </dd>
    </div>
  );
}

function stepClassName(index: number, currentStep: number): string {
  if (index < currentStep) return "maker-step-pill maker-step-pill-complete";
  if (index === currentStep) return "maker-step-pill maker-step-pill-active";
  return "maker-step-pill";
}

function choiceCardClassName(active: boolean, intent: "buy" | "sell" | "swap-in" | "swap-out"): string {
  return `maker-choice-card maker-choice-card-${intent}${active ? " maker-choice-card-active" : ""}`;
}

function currencyLabel(code: number): string {
  return CURRENCIES.find((item) => item.code === code)?.label ?? String(code);
}

function paymentMethodList(text: string): string[] {
  return text
    .split(METHOD_SEPARATOR)
    .map((method) => method.trim())
    .filter(Boolean);
}

function paymentMethodText(methods: string[]): string {
  return methods.join(METHOD_SEPARATOR);
}

function offerPresetLimitError(
  preset: OfferPreset,
  currency: number,
  coordinator: ReturnType<typeof useFederationStore.getState>["coordinators"][number] | undefined
): string | undefined {
  if (!coordinator?.limits) return;
  const limit = coordinator.limits[String(currency)]
    ?? Object.values(coordinator.limits).find((candidate) => candidate.code.toUpperCase() === preset.currency);
  if (!limit) return;
  const amounts = preset.minAmount && preset.maxAmount
    ? [Number(preset.minAmount), Number(preset.maxAmount)]
    : [Number(preset.amount)];
  if (amounts.some((amount) => !Number.isFinite(amount) || amount < limit.min_amount || amount > limit.max_amount)) {
    return `This preset is outside ${coordinator.longAlias}'s current amount limits.`;
  }
}

function draftCoordinatorLimitError(
  draft: CreateOrderDraft,
  coordinator: ReturnType<typeof useFederationStore.getState>["coordinators"][number] | undefined
): string | undefined {
  if (!coordinator?.limits) return;
  const currency = currencyLabel(draft.currency);
  const limit = coordinator.limits[String(draft.currency)]
    ?? Object.values(coordinator.limits).find((candidate) => candidate.code.toUpperCase() === currency);
  if (!limit) return;
  const amounts = draft.hasRange ? [Number(draft.minAmount), Number(draft.maxAmount)] : [Number(draft.amount)];
  if (amounts.some((amount) => !Number.isFinite(amount) || amount < limit.min_amount || amount > limit.max_amount)) {
    return `This amount is outside ${coordinator.longAlias}'s current limits.`;
  }
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0m";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}
