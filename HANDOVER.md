# Developer handover: orderbook filter selectors

## Branch

Open a pull request from:

```text
fix/orderbook-filter-selectors
```

The branch is based on `main` at `v0.1.4-alpha.1` and intentionally contains
one focused orderbook commit.

## User-facing changes

### Currency ordering

The public-offers currency dropdown now follows the same canonical currency
ordering used by the offer-creation flow.

The selector still contains only currencies represented in the currently
loaded public offers. It does not add unavailable currencies merely to match
the create form. `ANY` remains the first option.

For example, available codes such as:

```text
BRL, USD, ARS, EUR, BTC
```

are displayed as:

```text
ANY, USD, EUR, BRL, ARS, BTC
```

Unknown future currency codes are preserved. They appear after known
currencies and are ordered alphabetically, avoiding data loss when a
coordinator introduces a code before this frontend is updated.

### Mutually exclusive dropdowns

The three public-offer filters now share one open-menu state:

- I want to
- Currency
- Method, or Destination for swaps

Opening one selector closes the previously open selector. At most one filter
menu can therefore cover the orderbook at a time.

Selection, outside pointer interaction, blur, and Escape continue to close the
relevant menu.

## Implementation

### `src/domains/orderbook/currencies.ts`

`orderCurrencyCodes()`:

1. normalizes codes to uppercase;
2. removes duplicates;
3. obtains canonical ranks from the same `currencyOptions()` source used by
   `CreateOrderPage`;
4. orders known codes by canonical rank;
5. places unknown codes afterward in alphabetical order.

Keeping the ordering helper beside the canonical currency mapping prevents
the orderbook and create form from developing separate hard-coded lists.

### `src/domains/orderbook/OffersPage.tsx`

The page now:

- uses `orderCurrencyCodes()` for currencies represented in public orders;
- owns one `OpenFilter` state with the possible values `intent`, `currency`,
  `method`, or `null`;
- passes controlled `open` and `onOpenChange` properties to each picker;
- ignores a stale close event from a previously open picker unless that
  picker is still the active one.

The guarded close handling is important because native `<details>` toggle
events can arrive after another filter has already opened.

### `src/domains/orderbook/OfferMeta.tsx`

`CurrencyPicker`, `IntentPicker`, and `PaymentMethodPicker` now accept optional
controlled-state properties:

```ts
open?: boolean;
onOpenChange?: (open: boolean) => void;
```

When these properties are omitted, each component retains its prior local
state behavior. This keeps the create flow and other consumers unchanged.

The orderbook provides the controlled properties because its three adjacent
filters require coordination.

### `src/domains/orderbook/currencies.test.ts`

Tests cover:

- canonical create-form ordering;
- duplicate removal;
- placement and alphabetical ordering of unknown currency codes.

## Review considerations

Confirm that:

1. The orderbook shows `ANY` first.
2. Known currencies follow the create-form sequence rather than alphabetical
   order.
3. Only currencies present in public offers are shown.
4. Opening Currency closes I want to.
5. Opening Method closes Currency.
6. Selecting an option closes its menu and applies the filter.
7. Clicking outside closes the current menu.
8. Escape closes the current menu.
9. The create-order currency and payment-method controls retain their
   existing behavior.
10. Swap intent still changes Method to Destination and resets an
    incompatible method filter.

## Verification

Completed locally:

```text
npm run typecheck
npm test
```

Result:

```text
87 test files passed
455 tests passed
```

A headless Chromium interaction also confirmed that the number of open
orderbook filter menus remains exactly one while switching from intent to
currency to method.

## PR summary

Suggested title:

```text
Refine orderbook filter selectors
```

Suggested description:

```text
Aligns the public-offer currency filter with the canonical create-order
currency sequence and coordinates the adjacent orderbook selectors so only
one menu can remain open at a time.

Unknown currency codes remain supported and are placed after known codes.
Picker components remain uncontrolled by default, preserving existing create
flow behavior.
```
