# Agent Note: Upgrade pi-ai to 0.84.3 and keep the catalog drift gates current

Status: implemented

English | [中文](2026-08-26-pi-ai-0-84-3-catalog-drift-gates.zh.md)

## Problem

`dsh-llm-pi-ai` pins `@earendil-works/pi-ai` at `^0.82.1`, whose `opencode-go` catalog predates `ox-alpha-free` (free, "Unlimited", released 2026-08-21) and ships stale model metadata. The model is a real OpenCode Zen Go model, but a deployment could not select it: pi-ai added it to the `opencode-go` catalog only from 0.84.3, and the per-route `models` list that replaces the catalog contained no entry for it either. The harness's own `catalog.ts` compiles against pi-ai's types, so an upgrade is not a bare version bump.

## Decision

Bump `@earendil-works/pi-ai` from `^0.82.1` to `^0.84.3` in `packages/llm/llm-pi-ai/package.json`, and align the compile-time drift gates in `packages/llm/llm-pi-ai/src/catalog.ts` with the types 0.84.3 ships:

- `THINKING_FORMAT_GATE` / `SUPPORTED_THINKING_FORMATS`: add `baseten`.
- `CHAT_TEMPLATE_VAR_GATE` / `CHAT_TEMPLATE_VARS`: add `thinking.budget`.
- `COMPLETIONS_COMPAT_GATE`: add `supportsFinishReason`, `chatTemplateArgs`, `thinkingTokenBudgetField`, `supportsThinkingTokenBudget`, all `withhold`.
- `RESPONSES_COMPAT_GATE`: add `supportsAdditionalTools`, `withhold`.
- `ANTHROPIC_COMPAT_GATE`: add `allowedFallbackModels`, `withhold`.

Each new compat field is classified `withhold` rather than `offer`, because adding an offered field would also require a `PiAiCompatProfile` member, a config-schema entry, and a documented value — none of which these vendor/catalog-owned switches need to be hand-configurable on a gateway. `pnpm-workspace.yaml` `minimumReleaseAgeExclude` updates to `@earendil-works/pi-ai@0.84.3`, which is the release that carries the catalog update the exclusion exists to admit.

The upgrade surfaced two pi-ai behavior changes the harness aligns:

- **Caller abort surfaces as an `error` event, not an `aborted` stop reason.** A pre-aborted signal makes 0.84.3 emit `stopReason: 'error'` with the abort-reason string as `errorMessage`, instead of throwing or emitting `'aborted'`. `PiAiAdapter.streamWithSnapshot` now remaps a terminal `error` finish to `aborted` when the request's own signal is aborted, so a caller-initiated abort is never reported as a model-side error.
- **New `StopReason` members.** pi-ai 0.84.3 widens `StopReason` with `deferred` (terminal tool-deferral) and `pending` (non-terminal). `mapStopReason` maps `deferred` to `tool-calls` — a deferred tool load still runs as tool use — and `pending` to an `EMPTY_RESPONSE` error, since a terminal event must never carry the non-terminal state.

Catalog-content drift from the bump is updated in the package tests: the `deepseek` catalog now offers `low` on `deepseek-v4-flash` (supported levels grow from `off/high/max` to `off/low/high/max`), the wire output-cap field for that model is now `max_tokens`, and `xai` ships only `openai-responses` (no longer a mixed completions+responses catalog), so the mixed-route switch fixtures move to `opencode`.

## Alternatives considered

**Keep pi-ai at 0.82.1 and describe `ox-alpha-free` through a hand-declared single-protocol route.** This adds the model without a dependency bump, and it worked; but it duplicates the route (one more provider the picker shows) and leaves every future catalog addition of the vendor unmapped until the catalog catches in some later bump. Taking the bump now makes the whole installed catalog (including `ox-alpha-free` and any new siblings) serve automatically, resolving at the catalog layer rather than the settings document.

## Consequences

The running deployment must restart dsh to pick up the upgraded catalog and the rebuilt `lib`; once it does, `ox-alpha-free` (and any catalog model 0.84.3 added) appears under `opencode-go` with its catalog endpoint, capacity, and reasoning levels, and the standalone single-protocol route the workaround used is removed from the settings document.

The cost is that the harness now compiles against a newer pi-ai surface: every future pi-ai type addition that the drift gates name (a modality, a thinking format, a compat field) fails compilation until classified, which is the trade the gates already accepted — only the set of names shifted. The abort/stop-reason alignment keeps caller-initiated cancellation reported as `aborted` and deferred tool loads running as tool use, matching the harness vocabulary rather than leaking pi-ai's `error`/`pending`/`deferred` spelling into the seam.
