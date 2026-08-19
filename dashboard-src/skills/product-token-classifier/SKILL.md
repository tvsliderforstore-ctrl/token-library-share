---
name: product-token-classifier
description: "Classify SKU names into the Product Token Library hierarchy (Large Group → Product Token → Product Key → SKU) by querying the local dashboard, which is the source of truth. Use when identifying products from inconsistent/long SKU names, mapping to 一口牛/豆奶/牛奶/洗衣液/洗衣珠/洗臉巾 tokens, resolving Product Keys (鈣思寶 | 豆奶 | …), batch-classifying SKU lists, or submitting ambiguous products for human review. Never relies on model memory; never creates/modifies taxonomy without explicit human approval."
triggers:
  - "classify sku"
  - "identify product token"
  - "product token library"
  - "一口牛 classification"
  - "map sku to product key"
  - "batch classify products"
category: productivity
---

# Product Token Classifier

Identify products from messy SKU names and map them into the four-level controlled
hierarchy. **The local dashboard (Product Token Library) is the authoritative product
library.** This skill queries it live on every task. Hermes memory is **never** treated
as the product library.

## Hierarchy (terminology is fixed)

```
Large Group  (e.g. 飲品, 急凍/冷凍, 個人護理, 家居清潔)
└── Product Token  (canonical concept, e.g. 豆奶, 一口牛)   ← not a sellable product
    └── Product Key  (structured config: 品牌 | 符號 | 產地 | 款式 | 規格)
        └── SKU  (exact sellable record from source system)
```

- **Product Token** = shared concept. **Product Key** = full commercial configuration.
  Different Product Keys share one token and must stay separate (variant/pack differ).
- Token-only results are valid when Product Key evidence is incomplete — do **not**
  force a SKU into a Product Key without brand/pack evidence.
- Chinese display names are labels, never DB primary keys. Use stable codes
  (`PT-BEVERAGE-SOY-MILK`, `PK-000003`, `BEVERAGES`).

## Prerequisites

The dashboard must be running (it holds the live taxonomy):

```bash
cd C:\Users\chlam\product-token-library
node src/server.js        # → http://127.0.0.1:4310
```

Set `PTL_API` to override the base URL. All scripts default to `http://127.0.0.1:4310`.

## Core workflows

### 1. Read the latest taxonomy (do this first, every task)

Always read the current taxonomy version + library before classifying — never assume.

```bash
node scripts/query-token-library.js --version     # taxonomy version
node scripts/query-token-library.js               # summary + groups
node scripts/query-token-library.js --tokens      # all product tokens
node scripts/query-token-library.js --keys --q 無糖
```

### 2. Classify one SKU

```bash
node scripts/classify-product.js "一口牛柳粒(急凍)#牛肉粒#淋滑#韓燒烤#家常小菜" --pretty
```

Returns structured JSON: `large_group_*`, `product_token_*`, `product_key_*`,
`matched_alias`, `extracted_attributes`, `match_method`, `confidence`,
`requires_review`, `alternative_candidates`, `explanation`.

### 3. Batch classify

```bash
node scripts/classify-product.js --batch names.txt          # one per line
echo '["一口牛柳粒（急凍）","鈣思寶無糖豆奶250毫升24支"]' | node scripts/classify-product.js --stdin
```

### 4. Normalize / inspect a name

```bash
node scripts/normalize-product-name.js "一口牛柳粒(急凍)#牛肉粒"
node scripts/parse-pack-size.js "250毫升×24支"
```

### 5. Submit an ambiguous record for human review

Low-confidence / ambiguous results must go to review — never guess, never auto-promote
a suggestion into an alias.

```bash
node scripts/submit-review.js --sku 12 --action CONFIRM --token 5 --note "verified on shelf"
node scripts/submit-review.js --sku 12 --action MARK_UNMATCHED --note "not a real product"
```

## Rules (non-negotiable)

1. **Read the dashboard taxonomy fresh each task** — it is the source of truth.
2. **Never treat model memory as authoritative.** If the dashboard is unreachable, say so
   and stop rather than inventing a classification.
3. **Never create or modify taxonomy** (tokens, keys, aliases, groups) without explicit
   human approval. This skill is read + classify + submit-for-review only.
4. **Never auto-convert an unreviewed suggestion into an alias.** Only human-confirmed
   corrections become permanent rules.
5. **Preserve the original SKU name** verbatim in all outputs; never shorten/overwrite it.
6. **Return token-only matches** when Product Key evidence is incomplete.
7. **Explain the matched evidence** and return confidence + alternative candidates.
8. **Ambiguous results → review queue**, never silently accepted.
9. Return structured JSON when called by another system (default output is JSON).

## Reference docs

- `references/taxonomy-schema.md` — entities + four-level model
- `references/classification-rules.md` — matching hierarchy, confidence bands, alias priority
- `references/product-key-format.md` — Product Key structure + fingerprint + pack formats
- `references/api-contract.md` — REST endpoints used by this skill

## Tests

Golden cases live in `tests/golden-cases.json` and `tests/pack-size-cases.json`. Run the
app's suite (`node --test test/` from the project root) to validate the engine these
scripts call.
