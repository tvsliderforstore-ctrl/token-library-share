# Classification Rules

Deterministic matching runs **before** any fuzzy/semantic attempt.

## Matching order (first hit wins)

1. Confirmed external SKU-ID mapping — conf 1.0
2. Confirmed barcode mapping — conf 1.0
3. Confirmed exact normalized SKU-name mapping — conf 1.0
4. Confirmed exact Product Key alias — conf 1.0
5. Exact approved Product Token alias (whole base title == alias) — conf 1.0
6. Longest approved Product Token alias found inside the base title
7. Approved brand + Product Key component matching
8. Approved regular-expression rule
9. Group-constrained candidate scoring
10. Fuzzy candidate — **requires human review**, never auto-approved
11. Unmatched

## Alias priority (when several match)

1. Confirmed mapping
2. Exact match
3. Highest rule priority
4. **Longest matching alias** (specific beats generic)
5. Most complete Product Key component match
6. Strongest Large Group evidence

Generic words never override specific aliases. If `一口牛柳粒` is an approved alias for
`一口牛`, it beats a generic term like `牛肉粒`.

## Confidence bands

- `0.95 – 1.00` → automatically accepted
- `0.75 – 0.95` → human review required
- `< 0.75` → unmatched / fuzzy (always review)

An exact SKU ID, barcode, or approved exact alias may receive `1.0`.
A fuzzy match is never auto-approved merely for being the best candidate.

## Token vs Product Key

- Identify the **Product Token** even when the **Product Key** cannot be determined.
- Resolve a Product Key only with structured evidence (brand + variant and/or pack).
- Do **not** force a SKU into a Product Key without evidence — token-only is valid.

## Negative aliases

A negative alias vetoes a token match for the containing text.

## Review routing

Ambiguous results include: proposed group/token/key, confidence, matched evidence,
conflicting evidence, alternative candidates, explanation, and the required review action.
Only human-confirmed corrections become permanent rules (audit-logged).
