import type { CSSProperties, ReactNode } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ChevronDown, CircleDollarSign, Repeat2 } from "lucide-react";
import { matchedPaymentMethods, paymentIconSrc, type PaymentMethodOption } from "@/domains/orderbook/paymentMethods";
import { isNativeApp } from "@/domains/transport/androidBridge";

export type IntentPickerOption = {
  label: string;
  value: string;
  tone: "any" | "buy" | "sell" | "swap-in" | "swap-out";
};

const FILTER_ANY_BUY_SELL_ICON = "/static/assets/vector/filter-any-buy-sell.svg";
const FILTER_ANY_CURRENCY_ICON = "/static/assets/vector/filter-any-currency.svg";
const FILTER_ANY_PAYMENT_METHOD_ICON = "/static/assets/vector/filter-any-payment-method.svg";

const filterAnyIconMaskStyle = (url: string) => ({ "--filter-any-icon-mask": `url(${url})` }) as CSSProperties;

export function FilterAnyMonochromeIcon({ kind }: { kind: "currency" | "payment-method" }) {
  const iconUrl = kind === "currency" ? FILTER_ANY_CURRENCY_ICON : FILTER_ANY_PAYMENT_METHOD_ICON;
  return (
    <span
      aria-hidden="true"
      className={`filter-any-icon filter-any-icon-monochrome filter-any-icon-${kind}`}
      style={filterAnyIconMaskStyle(iconUrl)}
    />
  );
}

const flagCodeByCurrency: Record<string, string> = {
  AED: "AE",
  AUD: "AU",
  ARS: "AR",
  BRL: "BR",
  BYN: "BY",
  CAD: "CA",
  CHF: "CH",
  CLP: "CL",
  CNY: "CN",
  EGP: "EG",
  EUR: "EU",
  HRK: "HR",
  CZK: "CZ",
  DKK: "DK",
  GBP: "GB",
  HKD: "HK",
  HUF: "HU",
  INR: "IN",
  ISK: "IS",
  JPY: "JP",
  KRW: "KR",
  LKR: "LK",
  MAD: "MA",
  MXN: "MX",
  NOK: "NO",
  NZD: "NZ",
  PLN: "PL",
  RON: "RO",
  RUB: "RU",
  SEK: "SE",
  SGD: "SG",
  VES: "VE",
  TRY: "TR",
  USD: "US",
  ZAR: "ZA",
  COP: "CO",
  PEN: "PE",
  UYU: "UY",
  PYG: "PY",
  BOB: "BO",
  IDR: "ID",
  ANG: "CW",
  CRC: "CR",
  CUP: "CU",
  DOP: "DO",
  GHS: "GH",
  GTQ: "GT",
  ILS: "IL",
  JMD: "JM",
  KES: "KE",
  KZT: "KZ",
  MYR: "MY",
  NAD: "NA",
  NGN: "NG",
  AZN: "AZ",
  PAB: "PA",
  PHP: "PH",
  PKR: "PK",
  QAR: "QA",
  SAR: "SA",
  THB: "TH",
  TTD: "TT",
  VND: "VN",
  XOF: "BJ",
  TWD: "TW",
  TZS: "TZ",
  XAF: "CM",
  UAH: "UA",
  TND: "TN",
  ETB: "ET",
  GEL: "GE",
  UGX: "UG",
  RSD: "RS",
  IRT: "IR",
  BDT: "BD",
  ALL: "AL",
  DZD: "DZ",
  UZS: "UZ"
};

function BitcoinMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="currentColor"
    >
      <path d="M504 256c0 136.967-111.033 248-248 248S8 392.967 8 256 119.033 8 256 8s248 111.033 248 248zm-141.651-35.33c4.937-32.999-20.191-50.739-54.55-62.573l11.146-44.702-27.213-6.781-10.851 43.524c-7.154-1.783-14.502-3.464-21.803-5.13l10.929-43.81-27.198-6.781-11.153 44.686c-5.922-1.349-11.735-2.682-17.377-4.084l.031-.14-37.53-9.37-7.239 29.062s20.191 4.627 19.765 4.913c11.022 2.751 13.014 10.044 12.68 15.825l-12.696 50.925c.76.194 1.744.473 2.829.907-.907-.225-1.876-.473-2.876-.713l-17.796 71.338c-1.349 3.348-4.767 8.37-12.471 6.464.271.395-19.78-4.937-19.78-4.937l-13.51 31.147 35.414 8.827c6.588 1.651 13.045 3.379 19.4 5.006l-11.262 45.213 27.182 6.781 11.153-44.733a1038.209 1038.209 0 0 0 21.687 5.627l-11.115 44.523 27.213 6.781 11.262-45.128c46.404 8.781 81.299 5.239 95.986-36.727 11.836-33.79-.589-53.281-25.004-65.991 17.78-4.098 31.174-15.792 34.747-39.949zm-62.177 87.179c-8.41 33.79-65.308 15.523-83.755 10.943l14.944-59.899c18.446 4.603 77.6 13.717 68.811 48.956zm8.417-87.667c-7.673 30.736-55.031 15.12-70.393 11.292l13.548-54.327c15.363 3.828 64.836 10.973 56.845 43.035z" />
    </svg>
  );
}

export function CurrencyFlag({ code, size = 20 }: { code?: string; size?: number }) {
  const normalizedCode = code?.toUpperCase() ?? "";

  if (normalizedCode === "ANY") {
    return <FilterAnyMonochromeIcon kind="currency" />;
  }

  if (normalizedCode === "BTC") {
    return (
      <span className="currency-flag currency-flag-symbol" title="BTC swap">
        <BitcoinMark size={size - 2} />
      </span>
    );
  }

  if (normalizedCode === "XAU") {
    return (
      <span className="currency-flag currency-flag-symbol" title="Gold">
        <CircleDollarSign size={size - 2} />
      </span>
    );
  }

  const flagCode = flagCodeByCurrency[normalizedCode];
  const flagEmoji = flagCode ? countryFlagEmoji(flagCode) : "";
  const style = { "--currency-flag-size": `${size}px` } as CSSProperties;

  return (
    <span className="currency-flag currency-flag-emoji" title={normalizedCode || "Currency"} style={style}>
      {flagEmoji || <span>{normalizedCode.slice(0, 2) || "--"}</span>}
    </span>
  );
}

function countryFlagEmoji(countryCode: string): string {
  if (!/^[A-Z]{2}$/.test(countryCode)) return "";
  return String.fromCodePoint(...[...countryCode].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
}

export function PaymentMethodIcons({ text, size = 23 }: { text: string; size?: number }) {
  const methods = matchedPaymentMethods(text);

  return (
    <span className="payment-method-icons" aria-label={text || "Payment method"} title={text || "Payment method"}>
      {methods.map((method, index) => {
        const style = { "--payment-icon-size": `${size}px` } as CSSProperties;
        return (
          <img
            alt={method.name}
            className="payment-method-icon"
            key={`${method.icon}-${index}`}
            loading="lazy"
            src={paymentIconSrc(method.icon)}
            style={style}
          />
        );
      })}
    </span>
  );
}

export function CurrencyPicker({
  label,
  open: controlledOpen,
  options,
  value,
  onChange,
  onOpenChange
}: {
  label: string;
  open?: boolean;
  options: Array<{ label: string; value: number | string }>;
  value: number | string;
  onChange: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const selected = options.find((option) => String(option.value) === String(value)) ?? options[0];
  const selectedCode = selected?.label === "ANY" ? "ANY" : selected?.label;

  return (
    <details
      className={open ? "image-select image-select-open" : "image-select"}
      open={open}
      ref={detailsRef}
      onToggle={(event) => {
        if (event.currentTarget.open !== open) setOpen(event.currentTarget.open);
      }}
    >
      <summary className="image-select-button" aria-label={label}>
        <span className="image-select-icon">
          <CurrencyFlag code={selectedCode} size={18} />
        </span>
        <span className="image-select-value">{selected?.label ?? "ANY"}</span>
      </summary>
      <div className="image-select-menu">
        {options.map((option) => (
          <button
            className={String(option.value) === String(value) ? "image-select-option image-select-option-active" : "image-select-option"}
            key={String(option.value)}
            type="button"
            onClick={() => {
              onChange(String(option.value));
              setOpen(false);
            }}
          >
            <CurrencyFlag code={option.label === "ANY" ? "ANY" : option.label} size={18} />
            <span>{option.label}</span>
          </button>
        ))}
      </div>
    </details>
  );
}

export function IntentPicker({
  label,
  open: controlledOpen,
  options,
  value,
  onChange,
  onOpenChange
}: {
  label: string;
  open?: boolean;
  options: IntentPickerOption[];
  value: string;
  onChange: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const selected = options.find((option) => option.value === value) ?? options[0];

  return (
    <details
      className={open ? "image-select image-select-open" : "image-select"}
      open={open}
      ref={detailsRef}
      onToggle={(event) => {
        if (event.currentTarget.open !== open) setOpen(event.currentTarget.open);
      }}
    >
      <summary className="image-select-button" aria-label={label}>
        <span className="image-select-icon">
          <IntentIcon tone={selected?.tone ?? "any"} size={16} />
        </span>
        <span className="image-select-value">{selected?.label ?? "ANY"}</span>
      </summary>
      <div className="image-select-menu">
        {options.map((option) => (
          <button
            className={option.value === value ? "image-select-option image-select-option-active" : "image-select-option"}
            key={option.value}
            type="button"
            onClick={() => {
              onChange(option.value);
              setOpen(false);
            }}
          >
            <IntentIcon tone={option.tone} size={16} />
            <span>{option.label}</span>
          </button>
        ))}
      </div>
    </details>
  );
}

export function PaymentMethodPicker({
  allowCustom = false,
  allowAny = true,
  ariaDescribedby,
  ariaInvalid,
  defaultIcon,
  label,
  open: controlledOpen,
  options,
  value,
  onChange,
  onOpenChange,
  onSelect
}: {
  allowCustom?: boolean;
  allowAny?: boolean;
  ariaDescribedby?: string;
  ariaInvalid?: boolean;
  defaultIcon?: ReactNode;
  label: string;
  open?: boolean;
  options: Array<PaymentMethodOption | { name: string; icon?: string }>;
  value: string;
  onChange: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
  onSelect?: (value: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const [internalOpen, setInternalOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.name === value);
  const selectedIcon = selected?.icon
    ? <PaymentMethodImage icon={selected.icon} name={selected.name} size={18} />
    : allowAny && value === "all" ? defaultIcon : undefined;
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return options;
    return options.filter((option) => option.name.toLowerCase().includes(normalizedQuery));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const selectedIndex = filteredOptions.findIndex((option) => option.name === value);
    setActiveIndex(Math.max(0, selectedIndex));

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const container = containerRef.current;
      if (container && !container.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  }, [filteredOptions, open, setOpen, value]);

  useEffect(() => {
    if (value === "all" || !value) {
      setQuery("");
      return;
    }

    setQuery(selected?.name ?? value);
  }, [selected?.name, value]);

  function updateQuery(nextQuery: string) {
    setQuery(nextQuery);
    setOpen(true);

    if (allowCustom) {
      onChange(nextQuery);
      return;
    }

    onChange(nextQuery.trim() ? nextQuery : allowAny ? "all" : "");
  }

  function selectOption(nextValue: string) {
    onChange(nextValue);
    setQuery(allowCustom && onSelect ? "" : nextValue === "all" ? "" : nextValue);
    setOpen(false);
    onSelect?.(nextValue);
  }

  function moveActiveOption(direction: 1 | -1) {
    if (!open) setOpen(true);
    setActiveIndex((current) => {
      if (filteredOptions.length === 0) return 0;
      return (current + direction + filteredOptions.length) % filteredOptions.length;
    });
  }

  return (
    <div
      className={open ? "image-select image-select-open" : "image-select"}
      ref={containerRef}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget as Node | null;
        if (nextTarget && !event.currentTarget.contains(nextTarget)) {
          setOpen(false);
        }
      }}
    >
      <div className={selectedIcon ? "image-select-combo" : "image-select-combo image-select-combo-no-icon"}>
        {selectedIcon ? <span className="image-select-icon">{selectedIcon}</span> : null}
        <input
          aria-activedescendant={open && filteredOptions[activeIndex]
            ? `${listboxId}-option-${activeIndex}`
            : undefined}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-describedby={ariaDescribedby}
          aria-expanded={open}
          aria-invalid={ariaInvalid}
          aria-label={label}
          className="image-select-input"
          ref={inputRef}
          placeholder={allowCustom ? "Type Method" : allowAny ? "ANY" : "Select a method"}
          value={query}
          onChange={(event) => updateQuery(event.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
              return;
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              moveActiveOption(event.key === "ArrowDown" ? 1 : -1);
              return;
            }
            if (event.key === "Home" && open && filteredOptions.length > 0) {
              event.preventDefault();
              setActiveIndex(0);
              return;
            }
            if (event.key === "End" && open && filteredOptions.length > 0) {
              event.preventDefault();
              setActiveIndex(filteredOptions.length - 1);
              return;
            }
            if (event.key === "Enter" && open && filteredOptions[activeIndex]) {
              event.preventDefault();
              selectOption(filteredOptions[activeIndex].name);
              return;
            }
            if (allowCustom && event.key === "Enter" && query.trim()) {
              event.preventDefault();
              selectOption(query.trim());
            }
          }}
          role="combobox"
        />
        <button
          aria-controls={listboxId}
          aria-expanded={open}
          aria-label="Browse payment methods"
          className="image-select-browse"
          type="button"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            inputRef.current?.blur();
            setOpen(!open);
          }}
        >
          <ChevronDown size={17} aria-hidden="true" />
          <span className="image-select-browse-label">Browse</span>
        </button>
      </div>
      {open ? (
        <div aria-label={label} className="image-select-menu" id={listboxId} role="listbox">
          {allowCustom && query.trim() && !options.some((option) => option.name.toLowerCase() === query.trim().toLowerCase()) ? (
            <ImageSelectOption
              highlighted
              icon={null}
              label={`Add "${query.trim()}"`}
              onClick={() => {
                selectOption(query.trim());
              }}
            />
          ) : !allowCustom && allowAny ? (
            <ImageSelectOption
              highlighted={value === "all"}
              icon={defaultIcon ?? null}
              label="ANY"
              selected={value === "all"}
              onClick={() => {
                selectOption("all");
              }}
            />
          ) : null}
          {filteredOptions.map((option, index) => (
            <ImageSelectOption
              highlighted={index === activeIndex}
              id={`${listboxId}-option-${index}`}
              icon={option.icon ? <PaymentMethodImage icon={option.icon} name={option.name} size={20} /> : null}
              key={option.name}
              label={option.name}
              selected={option.name === value}
              onClick={() => {
                selectOption(option.name);
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ImageSelectOption({
  highlighted,
  id,
  icon,
  label,
  selected = false,
  onClick
}: {
  highlighted: boolean;
  id?: string;
  icon: ReactNode;
  label: string;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-selected={selected}
      className={optionClassName(icon, highlighted || selected)}
      id={id}
      role="option"
      type="button"
      onClick={onClick}
    >
      {icon ? <span className="image-select-icon">{icon}</span> : null}
      <span>{label}</span>
    </button>
  );
}

function optionClassName(icon: ReactNode, active: boolean): string {
  const classNames = ["image-select-option"];
  if (!icon) classNames.push("image-select-option-no-icon");
  if (active) classNames.push("image-select-option-active");
  return classNames.join(" ");
}

function PaymentMethodImage({ icon, name, size }: { icon: string; name: string; size: number }) {
  const style = { "--payment-icon-size": `${size}px` } as CSSProperties;
  return (
    <img
      alt={name}
      className="payment-method-icon"
      decoding="async"
      loading={isNativeApp() ? "eager" : "lazy"}
      src={paymentIconSrc(icon)}
      style={style}
    />
  );
}

function IntentIcon({ tone, size }: { tone: IntentPickerOption["tone"]; size: number }) {
  const className = `intent-icon intent-icon-${tone}`;
  if (tone === "buy") {
    return (
      <span className={className}>
        <ArrowDownLeft size={size} />
      </span>
    );
  }
  if (tone === "sell") {
    return (
      <span className={className}>
        <ArrowUpRight size={size} />
      </span>
    );
  }
  if (tone === "swap-in" || tone === "swap-out") {
    return (
      <span className={className}>
        <Repeat2 size={size} />
      </span>
    );
  }
  return <img alt="" className="filter-any-icon" src={FILTER_ANY_BUY_SELL_ICON} />;
}
