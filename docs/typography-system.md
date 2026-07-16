# Typography system

RoboSats uses locally bundled Public Sans for product UI and a system
monospace stack only for machine-readable values. No font request leaves the
application at runtime. The complete SIL Open Font License notice is included
in every build at `static/licenses/PublicSans-OFL.txt`.

## Roles

| Role | Mobile | Tablet | Desktop | Weight |
| --- | --- | --- | --- | --- |
| Page title | 32/38 | 36/42 | 40/48 | 600 |
| Section heading | 24/32 | 28/36 | 32/40 | 600 |
| Subsection | 20/28 | 22/30 | 24/32 | 600 |
| Card or dialog title | 18/26 | 20/28 | 20/28 | 600 |
| Body | 16/24 | 16/24 | 16/24 | 400 |
| Compact UI and tables | 14/20 | 14/20 | 14/20 | 400-500 |
| Caption and badge | 12/16 | 12/16 | 12/16 | 500-600 |

The viewport bands are 320-599px, 600-1023px, and 1024px or wider. Sizes use
`rem` and discrete media-query steps. Body and functional controls do not
shrink on wider screens.

Forms use 14/20 semibold persistent labels, 16/24 input text, 14/20 helper
text, and 14/20 medium error text. Buttons use sentence case and 600 weight.
Mobile primary actions use 16/24; ordinary and compact controls use 15/20 and
14/20 respectively.

## Financial data

Amounts, prices, fees, percentages, timestamps, and countdowns use Public Sans
with `tabular-nums lining-nums`. Numeric table columns are right-aligned.
Balances and financial values must not use monospace.

Invoices, addresses, keys, tokens, and raw receipts use the system monospace
stack at 13/18. Interfaces should preserve the meaningful beginning and end of
long identifiers and provide a copy action.

## Reading and accessibility

Running copy is left aligned with a maximum measure of 66 characters. Helper
text is limited to 48 characters where layout permits, and confirmation copy
uses a maximum measure of 55 characters. Long-form copy uses at least 1.5 line
height.

Before merging typography or layout changes, verify:

1. 100% and 200% text enlargement.
2. Reflow at 320 CSS pixels in light and dark themes.
3. WCAG text spacing: 1.5 line height, 2em paragraph spacing, 0.12em letter
   spacing, and 0.16em word spacing.
4. At least 30% text expansion and long payment labels.
5. Large and negative amounts, decimals, currency units, and countdowns.
6. No functional table text below 14px and no body or input text below 16px.

Run `npm run check:typography` to enforce the source-level invariants. The
policy follows the [USWDS typography guidance](https://designsystem.digital.gov/components/typography/)
and the WCAG guidance for [text spacing](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html),
[resize text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html),
and [reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).
