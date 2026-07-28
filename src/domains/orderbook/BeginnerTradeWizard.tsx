import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  PlusCircle,
  X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { CoordinatorSummary } from "@/domains/coordinators/coordinator.types";
import { currencyOptions } from "@/domains/orderbook/currencies";
import {
  findGuidedTradeMatches,
  guidedCurrencyCodes,
  guidedPaymentMethods,
  type GuidedTradeCriteria,
  type GuidedTradeIntent
} from "@/domains/orderbook/guidedTrade";
import {
  CurrencyFlag,
  CurrencyPicker,
  PaymentMethodIcons,
  PaymentMethodPicker
} from "@/domains/orderbook/OfferMeta";
import type { PublicOrder } from "@/domains/orderbook/orderbook.types";
import { normalPaymentMethodOptions } from "@/domains/orderbook/paymentMethods";
import { formatFiat } from "@/lib/format";

const steps = ["Trade", "Currency", "Amount", "Method", "Offers"];
const allCurrencies = currencyOptions().filter((currency) => currency.code !== 1000);
const allMethods = normalPaymentMethodOptions();

export function BeginnerTradeWizard({
  coordinators,
  initialCriteria,
  loading,
  onClose,
  onCreateOffer,
  onSelectOffer,
  orders,
  reviewOpen = false
}: {
  coordinators: CoordinatorSummary[];
  initialCriteria?: GuidedTradeCriteria;
  loading: boolean;
  onClose: () => void;
  onCreateOffer: (criteria: GuidedTradeCriteria) => void;
  onSelectOffer: (order: PublicOrder, criteria: GuidedTradeCriteria) => void;
  orders: PublicOrder[];
  reviewOpen?: boolean;
}) {
  const [step, setStep] = useState(initialCriteria ? steps.length - 1 : 0);
  const [intent, setIntent] = useState<GuidedTradeIntent | undefined>(initialCriteria?.intent);
  const [currency, setCurrency] = useState(initialCriteria?.currency ?? "USD");
  const [amount, setAmount] = useState(initialCriteria ? String(initialCriteria.amount) : "");
  const [paymentMethod, setPaymentMethod] = useState(initialCriteria?.paymentMethod ?? "");
  const [error, setError] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const numericAmount = Number(amount);
  const availableCurrencies = useMemo(
    () => intent ? guidedCurrencyCodes(orders, intent).slice(0, 6) : [],
    [intent, orders]
  );
  const availableMethods = useMemo(
    () => intent && currency && numericAmount > 0
      ? guidedPaymentMethods(orders, { intent, currency, amount: numericAmount }).slice(0, 6)
      : [],
    [currency, intent, numericAmount, orders]
  );
  const criteria = useMemo(
    () => intent && currency && numericAmount > 0 && paymentMethod
      ? { intent, currency, amount: numericAmount, paymentMethod }
      : undefined,
    [currency, intent, numericAmount, paymentMethod]
  );
  const matches = useMemo(
    () => criteria ? findGuidedTradeMatches(orders, criteria) : [],
    [criteria, orders]
  );

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  function continueForward() {
    const validationError = stepError(step, { amount, currency, intent, paymentMethod });
    if (validationError) {
      setError(validationError);
      return;
    }
    setError("");
    setStep((current) => Math.min(steps.length - 1, current + 1));
  }

  function goBack() {
    setError("");
    setStep((current) => Math.max(0, current - 1));
  }

  return (
    <Dialog
      ariaLabelledby="guided-trade-title"
      initialFocusRef={headingRef}
      onClose={onClose}
      overlayClassName={reviewOpen
        ? "confirm-overlay guided-trade-overlay guided-trade-overlay-backgrounded"
        : "confirm-overlay guided-trade-overlay"}
      panelClassName="guided-trade-dialog"
      panelProps={reviewOpen ? { "aria-hidden": true, inert: true } : undefined}
    >
        <header className="guided-trade-header">
          <div>
            <p className="app-eyebrow">Guided trade</p>
            <h2 id="guided-trade-title">Find the right trade</h2>
          </div>
          <button className="icon-button" onClick={onClose} type="button" aria-label="Close guided trade">
            <X size={19} />
          </button>
        </header>

        <ol className="guided-trade-progress" aria-label={`Step ${step + 1} of ${steps.length}`}>
          {steps.map((label, index) => (
            <li className={progressClassName(index, step)} key={label}>
              <span>{index < step ? <Check size={13} /> : index + 1}</span>
              <small>{label}</small>
            </li>
          ))}
        </ol>

        <div className="guided-trade-content">
          {step === 0 ? (
            <WizardStep
              heading="Would you like to buy or sell bitcoin?"
              subheading="Choose what you want this trade to accomplish."
              headingRef={headingRef}
            >
              <div className="guided-intent-grid">
                <button
                  className={intentChoiceClass("buy", intent)}
                  onClick={() => { setIntent("buy"); setError(""); }}
                  type="button"
                >
                  <span className="guided-intent-icon guided-intent-icon-buy"><ArrowDownLeft size={21} /></span>
                  <span><strong>Buy bitcoin</strong><small>Pay fiat and receive bitcoin</small></span>
                  {intent === "buy" ? <Check size={18} /> : null}
                </button>
                <button
                  className={intentChoiceClass("sell", intent)}
                  onClick={() => { setIntent("sell"); setError(""); }}
                  type="button"
                >
                  <span className="guided-intent-icon guided-intent-icon-sell"><ArrowUpRight size={21} /></span>
                  <span><strong>Sell bitcoin</strong><small>Send bitcoin and receive fiat</small></span>
                  {intent === "sell" ? <Check size={18} /> : null}
                </button>
              </div>
            </WizardStep>
          ) : null}

          {step === 1 ? (
            <WizardStep
              heading={intent === "buy" ? "Which currency will you pay with?" : "Which currency would you like to receive?"}
              subheading="This is the fiat currency used for the trade."
              headingRef={headingRef}
            >
              <label className="field-block guided-trade-field">
                <span>Currency</span>
                <CurrencyPicker
                  label="Select fiat currency"
                  options={allCurrencies.map((option) => ({ label: option.label, value: option.label }))}
                  value={currency}
                  onChange={(value) => { setCurrency(value); setError(""); }}
                />
              </label>
              {availableCurrencies.length > 0 ? (
                <QuickChoices
                  label="Available now"
                  options={availableCurrencies}
                  selected={currency}
                  onSelect={(value) => { setCurrency(value); setError(""); }}
                  renderIcon={(value) => <CurrencyFlag code={value} size={16} />}
                />
              ) : null}
            </WizardStep>
          ) : null}

          {step === 2 ? (
            <WizardStep
              heading="How much would you like to trade?"
              subheading="Enter the exact fiat amount. We will only show offers that accept it."
              headingRef={headingRef}
            >
              <label className="guided-amount-field">
                <span>Amount</span>
                <div>
                  <input
                    aria-describedby={error ? "guided-trade-error" : undefined}
                    aria-invalid={Boolean(error)}
                    autoFocus
                    inputMode="decimal"
                    min="0"
                    placeholder="0"
                    value={amount}
                    onChange={(event) => { setAmount(event.target.value); setError(""); }}
                  />
                  <strong>{currency}</strong>
                </div>
              </label>
            </WizardStep>
          ) : null}

          {step === 3 ? (
            <WizardStep
              heading={intent === "buy" ? "How would you like to pay?" : "How would you like to be paid?"}
              subheading="Choose one payment method you can use promptly."
              headingRef={headingRef}
            >
              <label className="field-block guided-trade-field">
                <span>Payment method</span>
                <PaymentMethodPicker
                  allowAny={false}
                  ariaDescribedby={error ? "guided-trade-error" : undefined}
                  ariaInvalid={Boolean(error)}
                  label="Select payment method"
                  options={allMethods}
                  value={paymentMethod}
                  onChange={(value) => {
                    setPaymentMethod(value);
                    setError("");
                  }}
                />
              </label>
              {availableMethods.length > 0 ? (
                <QuickChoices
                  label="Matches available now"
                  options={availableMethods}
                  selected={paymentMethod}
                  onSelect={(value) => { setPaymentMethod(value); setError(""); }}
                  renderIcon={(value) => <PaymentMethodIcons text={value} size={17} />}
                />
              ) : null}
            </WizardStep>
          ) : null}

          {step === 4 && criteria ? (
            <WizardStep
              heading={loading ? "Checking public offers" : matches.length > 0 ? `${matches.length} matching ${matches.length === 1 ? "offer" : "offers"}` : "No exact match right now"}
              subheading={loading
                ? "The public orderbook is still loading."
                : matches.length > 0
                  ? "Review an existing offer, or publish your own terms."
                  : "Publish your own offer and wait for another trader to take it."}
              headingRef={headingRef}
            >
              {loading ? (
                <div className="guided-results-loading" role="status">
                  <span className="ui-spinner" aria-hidden />
                  <span>Searching enabled coordinators…</span>
                </div>
              ) : matches.length > 0 ? (
                <div className="guided-match-list">
                  {matches.slice(0, 4).map((order, index) => (
                    <GuidedOffer
                      coordinator={coordinators.find((item) => item.shortAlias === order.coordinatorShortAlias)}
                      criteria={criteria}
                      featured={index === 0}
                      key={`${order.coordinatorShortAlias}:${order.id}`}
                      onSelect={() => onSelectOffer(order, criteria)}
                      order={order}
                    />
                  ))}
                  {matches.length > 4 ? <small className="guided-more-matches">+{matches.length - 4} more matching offers in the orderbook</small> : null}
                </div>
              ) : (
                null
              )}

              <div className="guided-create-choice">
                <div>
                  <strong>Didn't find what you were looking for?</strong>
                  <span>Set your own terms!</span>
                </div>
                <Button
                  onClick={() => onCreateOffer(criteria)}
                  variant={matches.length > 0 ? "outline" : "primary"}
                  type="button"
                >
                  <PlusCircle size={17} />
                  Create offer
                </Button>
              </div>
            </WizardStep>
          ) : null}

          {error ? <p className="guided-trade-error" id="guided-trade-error" role="alert">{error}</p> : null}
        </div>

        <footer className="guided-trade-footer">
          {step === 0 ? (
            <Button onClick={onClose} type="button" variant="ghost">Cancel</Button>
          ) : (
            <Button onClick={goBack} type="button" variant="secondary"><ArrowLeft size={16} /> Back</Button>
          )}
          {step < steps.length - 1 ? (
            <Button onClick={continueForward} type="button">
              Continue <ArrowRight size={16} />
            </Button>
          ) : (
            <Button onClick={onClose} type="button" variant="ghost">Back to offers</Button>
          )}
        </footer>
    </Dialog>
  );
}

function WizardStep({
  children,
  heading,
  headingRef,
  subheading
}: {
  children: ReactNode;
  heading: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  subheading: string;
}) {
  return (
    <section className="guided-trade-step">
      <header>
        <h3 ref={headingRef} tabIndex={-1}>{heading}</h3>
        <p>{subheading}</p>
      </header>
      {children}
    </section>
  );
}

function QuickChoices({
  label,
  onSelect,
  options,
  renderIcon,
  selected
}: {
  label: string;
  onSelect: (value: string) => void;
  options: string[];
  renderIcon: (value: string) => ReactNode;
  selected: string;
}) {
  return (
    <div className="guided-quick-choices">
      <span>{label}</span>
      <div>
        {options.map((option) => (
          <button
            className={option === selected ? "guided-quick-choice guided-quick-choice-active" : "guided-quick-choice"}
            key={option}
            onClick={() => onSelect(option)}
            type="button"
          >
            {renderIcon(option)}
            <span>{option}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function GuidedOffer({
  coordinator,
  criteria,
  featured,
  onSelect,
  order
}: {
  coordinator?: CoordinatorSummary;
  criteria: GuidedTradeCriteria;
  featured: boolean;
  onSelect: () => void;
  order: PublicOrder;
}) {
  return (
    <button className={featured ? "guided-match guided-match-featured" : "guided-match"} onClick={onSelect} type="button">
      <span className="guided-match-amount">
        <CurrencyFlag code={criteria.currency} size={18} />
        <strong>{formatFiat(criteria.amount, criteria.currency)}</strong>
        {featured ? <small>Best match</small> : null}
      </span>
      <span className="guided-match-terms">
        <strong className={order.premium > 0 ? "offer-premium-positive" : order.premium < 0 ? "offer-premium-negative" : ""}>
          {order.premium > 0 ? "+" : ""}{order.premium.toFixed(2)}%
        </strong>
        <span><PaymentMethodIcons text={order.payment_method} size={18} /> {order.payment_method}</span>
      </span>
      <span className="guided-match-host">
        {coordinator ? <img className="coordinator-avatar coordinator-avatar-sm" alt="" src={coordinator.smallAvatarUrl} /> : null}
        <small>{coordinator?.longAlias ?? order.coordinatorShortAlias}</small>
      </span>
      <span className="guided-match-action">Review <ArrowRight size={16} /></span>
    </button>
  );
}

function stepError(
  step: number,
  values: { amount: string; currency: string; intent?: GuidedTradeIntent; paymentMethod: string }
): string | undefined {
  if (step === 0 && !values.intent) return "Choose whether you want to buy or sell bitcoin.";
  if (step === 1 && !values.currency) return "Choose a fiat currency.";
  if (step === 2 && (!Number.isFinite(Number(values.amount)) || Number(values.amount) <= 0)) return "Enter a valid amount greater than zero.";
  if (step === 3 && !allMethods.some((method) => method.name === values.paymentMethod)) {
    return "Select a payment method from the list.";
  }
}

function progressClassName(index: number, current: number): string {
  if (index < current) return "guided-trade-progress-complete";
  if (index === current) return "guided-trade-progress-active";
  return "";
}

function intentChoiceClass(value: GuidedTradeIntent, selected?: GuidedTradeIntent): string {
  return value === selected ? `guided-intent-choice guided-intent-choice-${value} guided-intent-choice-active` : `guided-intent-choice guided-intent-choice-${value}`;
}
