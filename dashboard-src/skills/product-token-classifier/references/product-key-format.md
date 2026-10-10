# Product Key Format

## Display format

```
品牌 | Product Token | 產地 | 款式/功能/口味 | 規格
```

Example: `鈣思寶 | 豆奶 | 中國 | 無糖 | 250ml x 24支`

## Structured storage

A Product Key is stored as discrete fields, not one combined string:

```json
{
  "brand": "鈣思寶",
  "product_token": "豆奶",
  "origin": "中國",
  "variant": "無糖",
  "unit_size": 250,
  "unit_measurement": "ml",
  "pack_count": 24,
  "pack_unit": "支",
  "display_pack_format": "250ml x 24支",
  "display_key": "鈣思寶 | 豆奶 | 中國 | 無糖 | 250ml x 24支"
}
```

Unknown fields are stored as `null` and shown as `待確認`. Never invent brand/origin/variant/pack.

## Fingerprint (dedupe)

The normalized fingerprint identifies duplicate Product Keys. It normalizes:
upper/lowercase English, full/half-width, `x`/`X`/`×`, whitespace, `ml`/`mL`/`ML`/`毫升`,
equivalent punctuation, and Traditional/Simplified Chinese (so 無糖 == 无糖), plus pack-unit
spelling variants. Display values are kept; the fingerprint is a separate matching key.

## Pack-size recognition

Recognized forms (normalized into structured `unit_size`/`unit_measurement`/`pack_count`/`pack_unit`):

```
250ml x 24支   250ML X24   250毫升×24支   250 ml x 24
1000ml         1L          1公升          1000ml x 4支   四支裝 (Chinese number → 4)
```

Not every number is a size: dates, model numbers, percentages and promo text are guarded.
Unit map: `毫升`→ml, `公升`→L, `克`→g, `公斤`→kg.

## Independence

Different Product Keys sharing one token stay separate. Variant and pack-size differences
must not be merged (e.g. 無糖 250ml×24支 vs 無糖 1000ml×12支 are two distinct keys).
