# Color system

The interface uses five chromatic families plus neutrals:

- Brand and warning: amber
- Secondary, swap, and selected: reddish purple
- Success: bluish green
- Danger: vermilion
- Information and network guidance: blue
- Offline and cancelled: neutral gray

Structural colors are limited to three surfaces, one input surface, two interactive surfaces, three text levels, and three border levels. Short names such as `--card`, `--muted`, and `--primary` alias the structural and semantic tokens in `globals.css`.

## Component rules

- Bright amber is a background or decorative accent. Use `--brand-amber-ink` for amber foreground content on light surfaces.
- Semantic states must include wording and an icon or shape. Color alone is not state communication.
- Pending uses reddish purple or blue with written status and a spinner or clock.
- Offline and cancelled remain neutral.
- Inputs keep persistent labels. Invalid controls use `aria-invalid`, a danger boundary, and a connected text explanation.
- Irreversible payment actions use a clear verb, show the amount, and require confirmation.
- Focus uses `--focus-ring` plus `--focus-inner` so it remains visible against both themes.

## Validation

`npm test -- src/styles/palette.test.ts` checks actual token combinations for:

- Normal text at 4.5:1 or higher
- Essential boundaries and focus indicators at 3:1 or higher
- Approved chromatic family anchors

Before release, inspect representative payment tasks in light and dark themes, grayscale, and protanopia, deuteranopia, and tritanopia simulation. Confirm that failed, pending, complete, buy, sell, connection, and invalid-form states remain understandable without color.
