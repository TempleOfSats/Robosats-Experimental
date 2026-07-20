import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Landmark,
  LoaderCircle,
  Lock,
  Info,
  PlusCircle,
  ReceiptText,
  Repeat2,
  ShieldCheck
} from "lucide-react";
import { type CSSProperties, type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { InfoHint } from "@/components/ui/infoHint";
import { VisualSelect } from "@/components/ui/visualSelect";
import { CoordinatorDetailDialog } from "@/domains/coordinators/CoordinatorsPage";
import { fetchCoordinatorRatings, type CoordinatorRating } from "@/domains/coordinators/coordinatorRatings";
import { federationLottery } from "@/domains/coordinators/federationLottery";
import { useFederationStore } from "@/domains/coordinators/federationStore";
import { toUserMessage } from "@/lib/userError";
import { getRobotAuthForCoordinator, selectCurrentSlot, useGarageStore } from "@/domains/garage/garageStore";
import { RobotAvatar } from "@/domains/identity/RobotAvatar";
import { buildCreateOrderPayload, createOrder, validateCreateOrderPayload } from "@/domains/maker/makerApi";
import {
  ESCROW_DURATION_MAX_SECONDS,
  ESCROW_DURATION_MIN_SECONDS,
  PUBLIC_DURATION_MAX_SECONDS,
  PUBLIC_DURATION_MIN_SECONDS
} from "@/domains/maker/makerDurations";
import type { CreateOrderDraft } from "@/domains/maker/maker.types";
import { currencyOptions } from "@/domains/orderbook/currencies";
import { CurrencyFlag, CurrencyPicker, PaymentMethodIcons, PaymentMethodPicker } from "@/domains/orderbook/OfferMeta";
import { normalPaymentMethodOptions, swapPaymentMethodOptions } from "@/domains/orderbook/paymentMethods";
import { roleBuysBitcoin, roleIntentLabel } from "@/domains/orders/orderRole";
import { formatFiat } from "@/lib/format";

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
  const renewal = location.state as { renewDraft?: CreateOrderDraft; shortAlias?: string } | null;
  const { coordinators, refreshCoordinators } = useFederationStore();
  const slots = useGarageStore((state) => state.slots);
  const currentToken = useGarageStore((state) => state.currentToken);
  const hydrateGarage = useGarageStore((state) => state.hydrate);
  const setActiveOrder = useGarageStore((state) => state.setActiveOrder);
  const activeSlot = selectCurrentSlot(slots, currentToken);
  const [draft, setDraft] = useState<CreateOrderDraft>(() => renewal?.renewDraft ?? initialDraft);
  const [selectedShortAlias, setSelectedShortAlias] = useState(() => renewal?.shortAlias ?? "");
  const [currentStep, setCurrentStep] = useState(0);
  const [reviewReady, setReviewReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const selectableCoordinators = useMemo(() => coordinators.filter((coordinator) => coordinator.shortAlias !== "local"), [coordinators]);

  useEffect(() => {
    hydrateGarage();
    void refreshCoordinators();
  }, [hydrateGarage, refreshCoordinators]);

  const selectedCoordinator =
    selectableCoordinators.find((coordinator) => coordinator.shortAlias === selectedShortAlias) ??
    selectableCoordinators.find((coordinator) => coordinator.enabled && coordinator.url && coordinator.online) ??
    selectableCoordinators.find((coordinator) => coordinator.enabled && coordinator.url) ??
    selectableCoordinators[0];
  const selectedAlias = selectedCoordinator?.shortAlias ?? selectedShortAlias;
  const selectedCurrency = currencyLabel(draft.currency);
  const auth = getRobotAuthForCoordinator(activeSlot, selectedAlias);
  const payload = useMemo(() => buildCreateOrderPayload(draft), [draft]);
  const validationErrors = useMemo(() => validateCreateOrderPayload(payload), [payload]);
  const canSubmit = Boolean(activeSlot && auth && selectedCoordinator?.url && validationErrors.length === 0);

  useEffect(() => {
    if (selectedShortAlias || selectableCoordinators.length === 0) return;
    const selectableAliases = new Set(selectableCoordinators.map((coordinator) => coordinator.shortAlias));
    const lotteryAlias = federationLottery(selectableCoordinators).find((shortAlias) => selectableAliases.has(shortAlias));
    const fallbackAlias =
      selectableCoordinators.find((coordinator) => coordinator.enabled && coordinator.url && coordinator.online)?.shortAlias ??
      selectableCoordinators.find((coordinator) => coordinator.enabled && coordinator.url)?.shortAlias ??
      selectableCoordinators[0]?.shortAlias;
    if (lotteryAlias ?? fallbackAlias) {
      setSelectedShortAlias(lotteryAlias ?? fallbackAlias ?? "");
    }
  }, [selectableCoordinators, selectedShortAlias]);

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

  function stepErrors(step: number): string[] {
    if (step === 0) {
      const errors: string[] = [];
      if (!activeSlot) errors.push("Create or recover a robot before publishing an offer.");
      if (!selectedCoordinator?.url) errors.push("Choose an available coordinator.");
      if (activeSlot && selectedCoordinator && !auth) errors.push("This robot has no credentials for the selected coordinator.");
      return errors;
    }

    if (step === 1) {
      if (draft.hasRange && (!draft.minAmount.trim() || !draft.maxAmount.trim())) {
        return ["Enter both a minimum and maximum amount."];
      }
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
    if (!activeSlot || !auth || !selectedCoordinator?.url) {
      setSubmitError("Create or recover a robot before publishing an offer.");
      return;
    }
    if (validationErrors.length > 0) {
      setSubmitError(validationErrors[0]);
      return;
    }

    setSubmitting(true);
    setSubmitError("");

    try {
      const response = await createOrder(selectedCoordinator.url, payload, auth);
      const backendError = response.bad_request ?? response.bad_amount ?? response.bad_payment_method ?? response.bad_password;
      if (backendError) {
        setSubmitError(backendError);
        return;
      }
      if (!response.id) {
        setSubmitError("Coordinator did not return an order id.");
        return;
      }
      setActiveOrder(activeSlot.token, selectedAlias, response.id);
      navigate(`/order/${selectedAlias}/${response.id}`);
    } catch (error) {
      setSubmitError(toUserMessage(error, "Could not create order."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page page-narrow maker-page">
      <div className="page-heading">
        <div>
          <p className="app-eyebrow">Create</p>
          <h2>Publish a new offer</h2>
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
              {!activeSlot ? (
                <div className="status-panel status-panel-warning maker-inline-warning">
                  <AlertCircle size={18} />
                  <span>Create or recover a robot before publishing an offer.</span>
                  <Link className="text-command" to="/garage">
                    Garage
                  </Link>
                </div>
              ) : null}

              {currentStep === 0 ? (
                <SideStep
                  coordinators={selectableCoordinators}
                  draft={draft}
                  selectedShortAlias={selectedAlias}
                  updateDraft={updateDraft}
                  onCoordinatorChange={setSelectedShortAlias}
                />
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
                <Button type="button" variant="secondary" onClick={previousStep} disabled={currentStep === 0 || submitting}>
                  <ArrowLeft size={16} />
                  Back
                </Button>

                {currentStep < wizardSteps.length - 1 ? (
                  <Button type="button" onClick={() => nextStep()}>
                    {currentStep === wizardSteps.length - 2 ? "Review offer" : "Continue"}
                    <ArrowRight size={16} />
                  </Button>
                ) : (
                  <Button type="submit" size="lg" loading={submitting} disabled={!canSubmit || !reviewReady}>
                    <PlusCircle size={18} />
                    Create offer
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

function SideStep({
  coordinators,
  draft,
  selectedShortAlias,
  updateDraft,
  onCoordinatorChange
}: {
  coordinators: ReturnType<typeof useFederationStore.getState>["coordinators"];
  draft: CreateOrderDraft;
  selectedShortAlias: string;
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
            onClick={() => updateDraft({ isSwap: false, currency: 1, paymentMethod: "" })}
          >
            Fiat Trade
          </Button>
          <Button
            type="button"
            variant={draft.isSwap ? "primary" : "outline"}
            onClick={() => updateDraft({ isSwap: true, currency: BTC_CURRENCY_ID, paymentMethod: "" })}
          >
            Bitcoin Swap
          </Button>
        </div>
      </details>

      <CoordinatorPicker
        coordinators={coordinators}
        selectedShortAlias={selectedShortAlias}
        onChange={onCoordinatorChange}
      />
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
  const [methodQuery, setMethodQuery] = useState("");

  function addPaymentMethod(method: string) {
    const cleanMethod = method.trim();
    if (!cleanMethod) return;
    const nextMethods = selectedMethods.some((selected) => selected.toLowerCase() === cleanMethod.toLowerCase())
      ? selectedMethods
      : [...selectedMethods, cleanMethod];
    updateDraft({ paymentMethod: paymentMethodText(nextMethods) });
    setMethodQuery("");
  }

  function removePaymentMethod(method: string) {
    updateDraft({ paymentMethod: paymentMethodText(selectedMethods.filter((selected) => selected !== method)) });
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
            {selectedMethods.map((method) => (
              <button className="chip-button chip-button-active" type="button" key={method} onClick={() => removePaymentMethod(method)}>
                <PaymentMethodIcons text={method} size={17} />
                <span>{method}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

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
              presetSeconds={[3 * 60 * 60, 6 * 60 * 60, 8 * 60 * 60, 12 * 60 * 60, PUBLIC_DURATION_MAX_SECONDS]}
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
  validationErrors
}: {
  coordinator?: ReturnType<typeof useFederationStore.getState>["coordinators"][number];
  currency: string;
  draft: CreateOrderDraft;
  robotHashId?: string | null;
  robotName?: string;
  validationErrors: string[];
}) {
  return (
    <div className="maker-step-panel">
      <div className="maker-review-identity">
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
      </div>
      <div className="maker-review-hero">
        <Badge tone={roleBuysBitcoin(draft.type, "maker") ? "buy" : "sell"}>
          {roleIntentLabel(draft.type, draft.isSwap, "maker")}
        </Badge>
        <strong>
          <CurrencyFlag code={currency} size={22} />
          {draft.hasRange ? `${draft.minAmount} - ${draft.maxAmount} ${currency}` : formatFiat(Number(draft.amount), currency)}
        </strong>
        <span>{draft.paymentMethod || (draft.isSwap ? "Swap destination not set" : "Payment method not set")}</span>
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
  const attempted = useRef(new Set<string>());
  const [localRetryAlias, setLocalRetryAlias] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [rating, setRating] = useState<CoordinatorRating>({ score: 0, count: 0 });
  const selected = coordinators.find((coordinator) => coordinator.shortAlias === selectedShortAlias) ?? coordinators[0];
  const lastRefreshed = useFederationStore((state) => state.lastRefreshed);
  const network = useFederationStore((state) => state.network);
  const shouldAutoRetry = Boolean(selected && !selected.online && !selected.loading && !attempted.current.has(selected.shortAlias));
  const connecting = Boolean(selected?.loading || localRetryAlias === selected?.shortAlias || shouldAutoRetry || (selected && !selected.online && !selected.error));
  const connected = Boolean(selected?.online);
  const statusClassName = connecting
    ? "maker-coordinator-status maker-coordinator-status-loading"
    : connected
      ? "maker-coordinator-status maker-coordinator-status-success"
      : "maker-coordinator-status maker-coordinator-status-warning";
  const statusCopy = connecting
    ? `Connecting to ${selected?.longAlias ?? "coordinator"}...`
    : !connected
      ? "Coordinator unavailable."
      : !selected?.info
        ? "Coordinator connected."
        : selected.info.swap_enabled
          ? "Connected. On-chain swaps are available."
          : "Connected. Fiat trades only.";

  useEffect(() => {
    if (!selected || selected.online || selected.loading || attempted.current.has(selected.shortAlias)) return;
    const alias = selected.shortAlias;
    attempted.current.add(alias);
    setLocalRetryAlias(alias);
    void refreshCoordinator(alias).finally(() => setLocalRetryAlias((current) => current === alias ? "" : current));
  }, [refreshCoordinator, selected]);

  async function retrySelectedCoordinator() {
    if (!selected) return;
    setLocalRetryAlias(selected.shortAlias);
    try {
      await refreshCoordinator(selected.shortAlias, { force: true });
    } finally {
      setLocalRetryAlias("");
    }
  }

  function openCoordinatorDetails() {
    if (!selected) return;
    setShowDetails(true);
    setRating({ score: 0, count: 0 });
    void fetchCoordinatorRatings([selected])
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
          options={coordinators.map((coordinator) => ({
            value: coordinator.shortAlias,
            label: coordinator.longAlias,
            description: coordinator.loading ? "Connecting" : coordinator.online ? "Connected" : "Unavailable",
            icon: <img className="coordinator-avatar coordinator-avatar-lg" src={coordinator.smallAvatarUrl} alt="" />
          }))}
          triggerCaption="Order host"
          value={selectedShortAlias}
        />
      </div>
      <div className={statusClassName} aria-live="polite">
        {connecting ? <LoaderCircle className="maker-coordinator-spinner" size={17} /> : connected ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}
        <span>{statusCopy}</span>
        {!connecting && !connected ? <button type="button" onClick={() => void retrySelectedCoordinator()}>Retry</button> : null}
      </div>
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
        <CoordinatorDetailDialog
          compact
          coordinator={selected}
          lastRefreshed={lastRefreshed}
          network={network}
          rating={rating}
          onClose={() => setShowDetails(false)}
        />
      ) : null}
    </div>
  );
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
        <div className="maker-time-dialog-overlay" onClick={() => setOpen(false)}>
          <section className="maker-time-dialog" role="dialog" aria-modal="true" aria-label={label} onClick={(event) => event.stopPropagation()}>
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
          </section>
        </div>
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
  return Array.from(unique).map((value) => ({ label: formatClockDuration(value), value: String(value) }));
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

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0m";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}
