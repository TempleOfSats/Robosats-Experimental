# ADR-0005: Native semantic haptics

- Status: Accepted
- Date: 2026-08-10

## Context

Financial actions over Tor have two distinct moments: the client accepts the
tap, then a coordinator eventually confirms the result. Generic vibration on
every button would obscure that distinction, while browser vibration is
inconsistent and would add behavior outside the owned mobile shells.

## Decision

Expose one optional native bridge operation with four semantic intents:
`selection`, `commit`, `success`, and `reject`. TypeScript UI boundaries choose
the intent; Android and iOS map it to system-provided haptic feedback. Browser
and desktop clients perform no haptic feedback.

Haptics remain limited to visible, user-initiated selections and important
action boundaries. Background synchronization, polling, navigation, chat,
copying, and ordinary buttons do not trigger them. A commit acknowledges that
validated work started; success or rejection is emitted only for a definite
result. Haptics are supplementary and bridge failures are always ignored.

## Consequences

The mobile shells gain tactile feedback without a JavaScript dependency,
custom waveform, permission, network request, or persisted preference. The
platform mapping follows system settings and can vary appropriately by device.
Tests cover semantic dispatch and unsupported runtimes; native platform builds
remain required for the bridge implementation.

## Alternatives

Global button feedback was rejected because it makes frequent and critical
actions feel identical. `navigator.vibrate()` was rejected because browser
support and quality are inconsistent. A third-party haptics package and custom
waveforms were rejected because the existing bridges and system patterns are
sufficient.
