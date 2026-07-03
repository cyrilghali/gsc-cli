---
title: "feat: Make gtrends audit-grade (low-volume guard + multi-geo compare)"
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
plan_type: feat
depth: standard
created: 2026-07-03
---

# feat: Make gtrends audit-grade — low-volume guard + multi-geo compare

## Summary

Two tight improvements to the `gtrends interest` command, both surfaced as real gaps while running the ClimRadar market audit in this session:

1. **Low-volume honesty guard** — when an interest series is essentially empty (mostly zeros with one late spike), the current output prints a clean `NOW 100`, which reads as "popular" when it actually means "the highest point of a near-noise signal". The audit on the literal term `climradar` produced `MIN 0 / AVG 0 / MAX 100` — indistinguishable in the table from a genuine trend. Annotate these series honestly.
2. **Multi-geo comparison** — ClimRadar operates across FR/BE/CH/LU, but `gtrends interest` accepts a single `--geo`. Google Trends jointly normalizes all `comparisonItem`s in one `explore` request, so a single keyword across several geos comes back on one shared 0–100 scale (genuinely cross-comparable). Support `--geo FR,BE,CH,LU` in one shot.

Both changes are additive and backward compatible: existing single-geo, multi-keyword invocations behave exactly as today.

**Product Contract preservation:** N/A — solo `ce-plan-bootstrap` run, no upstream brainstorm.

---

## Problem Frame

`gtrends interest` (in `src/trends/commands/interest.ts`, backed by `interestOverTime()` in `src/trends/api.ts`) has two honesty/coverage gaps that the ClimRadar audit exposed firsthand:

- **Noise presented as signal.** Google Trends normalizes every series to its own peak (100). For a term with almost no volume, a handful of recent searches becomes `100`. The table's `NOW`/`MAX` columns then look identical to a real trend. A reader (and any downstream decision) can be misled. The CLI should detect the near-empty shape and say so.
- **One geo per call.** The command builds `comparisonItem`s from the keyword list against a single `geo` string. Comparing a term across countries — the exact shape of a FR/BE/CH/LU product audit — requires four separate calls, four separate 0–100 scales, and no valid cross-country comparison. The underlying `explore()` already accepts an arbitrary `ComparisonItem[]`; only the command layer hard-codes one geo.

**In scope:** the `interest` command and the `interestOverTime()` API helper. **Out of scope:** `related` and `trending` commands, any new top-level command, and any change to the network/cookie/retry layer.

---

## Requirements

- **R1** — `interest` flags a series as low-volume when it is dominated by zeros, without suppressing the data. The flag appears in `table` output and does not alter `json`/`csv` payloads.
- **R2** — `interest` accepts a comma-separated `--geo` (e.g. `FR,BE,CH,LU`); each distinct geo becomes its own jointly-normalized series, cross-comparable on one 0–100 scale.
- **R3** — the total number of compared series (keywords × geos) respects Google's 5-`comparisonItem` cap, failing with a clear `CliError` when exceeded rather than silently truncating.
- **R4** — existing behavior is preserved: a single geo with one or more keywords produces the same rows, labels, and footer as today.
- **R5** — `table` rows carry an unambiguous label when more than one geo is in play (keyword and geo both visible); JSON/CSV keys are unique and machine-parseable within a single invocation (cross-invocation key shifts when the geo axis changes are an accepted tradeoff — see Open Questions).

---

## Key Technical Decisions

- **KTD1 — Reuse the existing two-hop `explore → multiline` flow; generalize the API helper's input, not the network layer.** `explore(items, category)` already takes `ComparisonItem[]`. Change `interestOverTime()` to accept a prepared `ComparisonItem[]` (each `{ keyword, geo }`) plus `time`/`category`, and return `{ points }` (one `value[]` index per item, in input order). **Labels live entirely in the command layer** — `interestOverTime` stays display-agnostic, matching its current role of mapping `ComparisonItem[]` → `TimelinePoint[]`. The command builds items *and* their labels together via `buildComparison` (KTD4) and zips `labels[i]` to `points[].value[i]` by index. When calling `widgetData('multiline', …)`, pass `items[0]?.geo ?? ''` for the geo argument — it only feeds the already-cached cookie, so any item's geo is equivalent, mirroring the existing fallback in `explore`. Rationale: joint normalization only holds *within one `explore` request*, so multi-geo comparison must be a single request with multiple items — exactly what the current flow already does for multi-keyword (empirically confirmed — see R-risk1). This also resolves the item-shape question decisively: `interestOverTime` never sees labels.
- **KTD2 — Low-volume detection is a pure function scored on the raw series, decoupled from rendering.** `assessVolume(series): { low: boolean; zeroFraction: number; shape: 'ok' | 'seasonal' | 'noise' }` in `src/trends/sparkline.ts` (already the home of series math) keeps it unit-testable with no network. The threshold is a heuristic (default: ≥ 70% of points equal to zero marks the series low-volume); document it as tunable, not authoritative. When `low`, `shape` distinguishes a periodic pattern (`seasonal` — non-zero points form ≥ 2 contiguous runs separated by zero gaps) from `noise` (≤ 1 run or scattered singletons), so a high-volume seasonal term (`climatiseur mobile` over 5 years) is not mislabeled as noise. Rationale: honesty annotation must be testable and must not entangle with table formatting.
- **KTD3 — Cross-comparison is capped, not truncated.** `keywords.length × distinctGeos.length` must be ≤ 5. On overflow, throw `CliError` with a hint naming the offending count. Rationale: silent truncation would drop series the user asked for and quietly change which peak defines 100.
- **KTD4 — Labels are geo-aware only when needed.** One geo → label is the keyword (unchanged, satisfies R4). Multiple geos, one keyword → label is the geo code. Multiple geos and multiple keywords → label is `keyword (GEO)`. Rationale: keep the common single-geo output untouched; add disambiguation only when the comparison axis grows.

---

## Implementation Units

### U1. Low-volume / noise guard for `interest`

**Goal:** Detect near-empty interest series and annotate them in `table` output so a normalized `NOW 100` is not misread as real popularity — distinguishing a genuinely seasonal term from actual noise.

**Requirements:** R1.

**Dependencies:** none.

**Files:**
- `src/trends/sparkline.ts` — add `assessVolume(series: number[])` returning `{ low: boolean; zeroFraction: number; shape: 'ok' | 'seasonal' | 'noise' }`.
- `src/trends/commands/interest.ts` — call `assessVolume` per series; when low, mark the row per `shape` (`⚠ noise` vs `~ seasonal`) and print a one-line stderr footnote explaining that low-volume series are normalized off a tiny base.
- `test/trends.test.ts` — add cases for `assessVolume`.
- `README.md` — one sentence in the `gtrends` section noting the low-volume / seasonal annotation.

**Approach:** Compute `zeroFraction = count(v === 0) / length`; mark `low` when `zeroFraction >= 0.7` (name the constant, comment it as a heuristic). When `low`, classify `shape` by counting maximal contiguous non-zero runs: `≥ 2` runs → `seasonal` (a periodic term dormant between peaks); `≤ 1` run or scattered singletons → `noise` (a nascent or negligible signal). Not low → `shape: 'ok'`. Rendering: keep the existing sparkline/MIN/AVG/MAX/NOW row; append a compact marker per `shape` and a single dim stderr footnote when any row is low. Do not touch the `json`/`csv` branches — R1 requires payloads stay clean.

**Patterns to follow:** existing pure-series helpers in `src/trends/sparkline.ts` (`sparkline`, `resample`); stderr `pc.dim(...)` footer already used at the end of the `interest` action.

**Test scenarios:**
- `assessVolume` returns `low: true, shape: 'noise'` for a mostly-zero series with one trailing run (e.g. 88 zeros then `[11,59,100,85]`) — mirrors the real `climradar` 3-month shape (nascent, not seasonal).
- `assessVolume` returns `low: true, shape: 'seasonal'` for a mostly-zero series with ≥ 2 separated non-zero blocks (e.g. `[...40 zeros, 30, 80, ...40 zeros, 25, 90, ...]`) — mirrors a seasonal term like `climatiseur mobile` over 5 years.
- `assessVolume` returns `low: false, shape: 'ok'` for a healthy sustained series (the `chatgpt` shape: values 54–100 throughout).
- `assessVolume` on an all-zero series returns `low: true`, `zeroFraction === 1`, and `shape: 'noise'` without dividing by zero.
- `assessVolume` on an empty array returns `low: false` (or a defined sentinel) without throwing.
- Boundary: a series exactly at the 70% zero threshold resolves deterministically to `low` (the cutoff is inclusive, `>= 0.7`).

**Verification:** `gtrends interest climradar --time "today 5-y"` flags the row as `noise`; `gtrends interest "climatiseur mobile" --time "today 5-y"` flags it as `seasonal` (not noise); `gtrends interest chatgpt` shows no flag. `--output json`/`--output csv` for the same query are byte-identical to pre-change output.

---

### U2. Multi-geo comparison for `interest`

**Goal:** Let one (or few) keyword(s) be compared across several geos in a single jointly-normalized request, so a FR/BE/CH/LU audit is one command.

**Requirements:** R2, R3, R4, R5.

**Dependencies:** none (independent of U1; both edit `interest.ts` and should be sequenced to avoid a merge conflict in that file, but carry no logical dependency).

**Files:**
- `src/trends/api.ts` — generalize `interestOverTime()` to accept prepared comparison items (`{ keyword, geo }[]`, i.e. `ComparisonItem[]`) plus `time`/`category`, returning `{ points }` (labels are not the API's concern — KTD1). Existing single-geo/multi-keyword callers pass items built the same way.
- `src/trends/commands/interest.ts` — parse `--geo` as comma-separated; dedupe/normalize geo codes; build the keyword × geo item list *and labels* via `buildComparison`; enforce the ≤ 5 cap; label rows per KTD4; keep the footer honest about which geos were compared.
- `test/trends.test.ts` — add cases for the item/label builder and the cap.
- `README.md` — document `--geo FR,BE,CH,LU` with a short example in the `gtrends` section.

**Approach:** Add an **exported** `buildComparison(keywords: string[], geos: string[])` in `src/trends/commands/interest.ts` (exported so `test/trends.test.ts` can import it) that returns `{ items, labels }` where `items` are `{ keyword, geo }` pairs and `labels` follow KTD4. Validate `keywords.length * geos.length <= 5` before any network call; on overflow throw `CliError` naming the count and the cap. Feed `items` into the generalized `interestOverTime`; render one row per item, zipping `labels[i]` to `points[].value[i]`. For `json`/`csv`, key each series by its label (unique within an invocation — see Open Questions). Empty/whitespace geo entries collapse to worldwide as today.

**Patterns to follow:** existing comma-splitting of `--dimensions` in `src/commands/query.ts` (`split(',').map(trim).filter(Boolean)`); `pickCanonical` usage for validated option values; `CliError` construction with a `hint` (see `src/cli-util.ts`, `src/config.ts`).

**Test scenarios:**
- `buildComparison(['climatiseur mobile'], ['FR','BE','CH','LU'])` yields 4 items and 4 geo-code labels (`FR`, `BE`, …).
- `buildComparison(['pizza','sushi'], [''])` (single worldwide geo, two keywords) yields 2 items with keyword labels — proves R4, the unchanged path.
- `buildComparison(['a','b'], ['FR','BE'])` yields 4 items with `keyword (GEO)` labels — proves the mixed-axis label rule (KTD4).
- Cap: `buildComparison(['a','b','c'], ['FR','BE'])` (6 items) throws `CliError` mentioning the count and the 5-item cap (R3).
- Duplicate geos (`FR,FR`) are deduped so the cap and rows count distinct geos only.
- Whitespace/empty geo token resolves to worldwide, matching current single-`--geo` empty behavior.

**Verification:** `gtrends interest "climatiseur mobile" --geo FR,BE,CH,LU` prints four cross-comparable rows on one 0–100 scale with a footer naming the four geos; `gtrends interest pizza sushi --geo US` is unchanged vs. today; `gtrends interest a b c --geo FR,BE` fails with the cap error and no network call.

---

## Scope Boundaries

**In scope:** `src/trends/commands/interest.ts`, `src/trends/api.ts` (`interestOverTime` only), `src/trends/sparkline.ts`, `test/trends.test.ts`, and the `gtrends` section of `README.md`.

### Deferred to Follow-Up Work
- A dedicated `gtrends market <seed...>` command that runs `interest` + `related` across a seed set and prints a combined demand report (the audit was done by hand across several commands — worth automating later).
- Applying multi-geo comparison to `related` (related-queries widgets are per-single-request too, but the UX and value are different).
- Absolute-volume estimation or blending with another data source to counter the relative-scale limitation beyond the honesty annotation.

**Out of scope (non-goals):** changes to `related`/`trending`, the cookie/retry/network layer in `src/trends/api.ts`, and the `gsc` (Search Console) binary.

---

## System-Wide Impact

- **CLI contract change (additive):** `--geo` gains comma-separated semantics. Single-value usage is unchanged, so no existing invocation breaks. Document in `README.md` and the command's `--help` text.
- **Output stability:** `json`/`csv` payloads for existing single-geo queries must remain identical (verified in U1/U2 scenarios). Multi-geo adds rows/keys but does not change the shape of single-geo output.

---

## Open Questions

- **JSON/CSV key stability across invocation modes (accepted, deferred).** Per KTD4 a single-keyword series is keyed by the keyword when one geo is given but by the geo code when several are given, so a script doing `jq '.[].pizza'` after switching `gtrends interest pizza --geo US` to `--geo US,FR` would see `US`/`FR` keys and get nulls. Keys are unique and stable *within* one invocation — the contract R5 actually targets. If cross-mode stability is needed, the follow-up is a dedicated `--geos` flag leaving `--geo` single-valued. Not blocking; noted so R5 is not read as a stronger promise than intended.

---

## Risks & Dependencies

- **R-risk1 — Cross-geo normalization must stay in one request.** Joint normalization holds only because all geos ride in one `explore` request. **Confirmed empirically (2026-07-03):** `thanksgiving` across `US,FR` in a single request returns peaks `US=100, FR=4` (jointly scaled — FR dwarfed by the US peak), whereas each geo requested alone returns `100` (independently scaled). So a single request is genuinely cross-comparable and separate requests are not. If a future refactor splits the request per geo, cross-comparison silently becomes invalid. Mitigation: keep multi-geo as a single `explore` call and record this invariant (with the US/FR data point) as a code comment in `interestOverTime`.
- **R-risk2 — Seasonal terms must not be mislabeled as noise.** 70% zeros is a heuristic, and a genuinely high-volume seasonal term (`climatiseur mobile` over `today 5-y`, dormant 8–9 months) trips it. A market audit cares about exactly these terms, so a flat "may be noise" label would erode trust. Mitigation (built into U1 via `shape`): distinguish *clumped* non-zero points (≥ 2 contiguous runs → `seasonal`) from *scattered/single-run* ones (→ `noise`), and cover a seasonal term in verification. The threshold constant stays named and tunable.
- **R-risk3 — Rate limits during manual verification.** `explore` throttles (429) under repeated calls; the existing backoff/cookie-refresh handles it. Verification may need spacing between runs — not a code risk.

---

## Verification Contract

- `npm run build` is clean (tsc).
- `npm test` passes, including the new `assessVolume` and `buildComparison` cases in `test/trends.test.ts`.
- Manual (network, space calls to avoid 429): `gtrends interest climradar --time "today 5-y"` flags `noise`; `gtrends interest "climatiseur mobile" --time "today 5-y"` flags `seasonal`; `gtrends interest "climatiseur mobile" --geo FR,BE,CH,LU` returns four cross-comparable rows; `gtrends interest pizza sushi --geo US` matches pre-change output; the over-cap case errors before any request.
- Cross-geo joint-normalization invariant confirmed empirically during planning (`thanksgiving` `US,FR` → `US=100, FR=4` in one request vs `100` each separately); the implementer should re-confirm with a raw-value check when wiring U2 and leave the invariant as a code comment, rather than trusting CLI row counts alone.

## Definition of Done

- R1–R5 satisfied.
- U1 and U2 landed with their test scenarios green.
- `README.md` `gtrends` section documents the low-volume annotation and comma-separated `--geo` with an example.
- Build and test suite green; single-geo `json`/`csv` output confirmed unchanged.
