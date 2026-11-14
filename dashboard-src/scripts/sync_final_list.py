#!/usr/bin/env python3
"""Surgical sync: replace DB SKU set with the Final list file.
- deactivate SKUs in DB but not in file (342)
- add SKUs in file but not DB (2,236), trusting file's Product token + group_key where filled
- set large_group_id / sub_category_id / sales_channel from file for ALL file SKUs
- idempotent (dedupe by external_sku_id)
Runs against a STOPPED server's .db file directly. Checkpointed.
"""
import openpyxl, sqlite3, re, sys, json, os
from datetime import datetime, timezone, timedelta

HK = timezone(timedelta(hours=8))
def NOW(): return datetime.now(HK).isoformat()

DB = r"C:\Users\chlam\data\product-token-library.db"
XLSX = r"C:\Users\chlam\Downloads\Final list 17 Aug_v1_Final.xlsx"

def norm(s):
    if s is None: return ''
    s = str(s)
    s = s.replace('／','/').replace('（','(').replace('）',')').replace('　',' ')
    s = re.sub(r'\s+', '', s)  # remove all whitespace
    s = s.replace('(', '').replace(')','')
    return s.strip().lower()

# Explicit map from the file's non-canonical sub-cat labels -> the canonical sub-cat name_zh
# in the DB (closed list; no new sub-cats invented). Keys are (main_norm, file_sub_norm).
FILE_SUB_MAP = {
    ('乾貨食品', '調味品/醬料'): '調味品/醬料/雞湯',
    ('乾貨食品', '雞湯/罐頭/腌製食品'): '罐頭/腌製食品',
    ('乾貨食品', '粟米油花生油橄欖油'): '粟米油/花生油/橄欖油',
    ('乾貨食品', '蔘茸海味+南北貨/湯類'): '蔘茸海味/南北貨/湯類',
    ('個人護理', '面部/身體護理'): '身體/手腳護理',
    ('個人護理', '面霜防曬/眼部護理'): '面霜/防曬/眼部精華/護理',
    ('個人護理', '面部精華/面膜'): '面部精華/護理',
    ('個人護理', '廁紙/濕廁紙'): '濕紙巾/厠紙',
    ('個人護理', '沐浴/潤膚露'): '身體/手腳護理',
    ('個人護理', '紙巾/濕紙巾'): '紙巾',
    ('個人護理', '眼部精華/護理'): '面霜/防曬/眼部精華/護理',
    ('個人護理', '面霜/精華'): '面霜/防曬/眼部精華/護理',
    ('個人護理', '面霜/防曬'): '面霜/防曬/眼部精華/護理',
    ('街市貨品', '新鮮麵包'): '蔬菜水果',
    ('街市貨品', 'others'): '鮮肉海鮮(0-4度)/雞蛋',
    ('保健食品', '免疫系統/護肝補肺/保健飲料/保健飲料/保健沖調'): '免疫系統/護肝補肺/保健飲料/保健沖調',
    ('急凍/冷凍', '急凍小食/乳製品/豆製品'): '急凍小食/芝士乳酪/豆製品',
    ('急凍/冷凍', '雞/鴨/羊/其他肉類'): '鴨/羊',
    ('家居清潔', '洗衣球/衣物護理'): '洗衣珠/粉',
    ('家居清潔', '洗衣液/洗衣粉'): '洗衣珠/粉',
    ('家居清潔', '消毒用品/滅蟲驅蚊'): '家居清潔/浴室清潔/消毒用品/空氣清新',
    ('家居清潔', '浴室清潔/家居用品'): '家居清潔/浴室清潔/消毒用品/空氣清新',
    ('家居清潔', '家居清潔/消毒用品'): '家居清潔/浴室清潔/消毒用品/空氣清新',
}

def load_file():
    wb = openpyxl.load_workbook(XLSX, read_only=True)
    ws = wb['Final data']
    best = {}
    for r in ws.iter_rows(min_row=2, values_only=True):
        if not (r[0] and str(r[0]).strip()): continue
        sku = str(r[0]).strip()
        score = (1 if (r[30] and str(r[30]).strip()) else 0) + (1 if (r[24] and str(r[24]).strip()) else 0)
        if sku not in best or score > best[sku][0]:
            best[sku] = (score, r)
    wb.close()
    return {k: v[1] for k, v in best.items()}

def main():
    file_skus = load_file()
    print(f"[sync] file unique SKUs: {len(file_skus)}", flush=True)

    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    c = con.cursor()

    # lookups
    groups = {r['name_zh']: r['id'] for r in c.execute("SELECT id,name_zh FROM large_groups WHERE active=1")}
    subs = {}  # (main_name_norm, sub_name_norm) -> id ; also sub_name_norm -> id (fallback)
    sub_by_name = {}
    for r in c.execute("""SELECT sc.id, sc.name_zh, g.name_zh AS main FROM sub_categories sc
                          JOIN large_groups g ON g.id=sc.large_group_id WHERE sc.active=1"""):
        key = (norm(r['main']), norm(r['name_zh']))
        subs[key] = r['id']
        sub_by_name.setdefault(norm(r['name_zh']), r['id'])

    # token lookup by normalized name -> (id, large_group_id, sub_category_id)
    tokens = {}
    for r in c.execute("SELECT id,name_zh,large_group_id,sub_category_id FROM product_tokens WHERE active=1"):
        tokens.setdefault(norm(r['name_zh']), (r['id'], r['large_group_id'], r['sub_category_id']))

    db_skus = {r['external_sku_id']: dict(r) for r in c.execute("SELECT * FROM sku_records WHERE active=1")}
    all_db_skus = {r['external_sku_id']: dict(r) for r in c.execute("SELECT * FROM sku_records")}

    file_set = set(file_skus)
    db_set = set(db_skus)
    to_remove = db_set - file_set
    to_add = file_set - db_set
    to_keep = file_set & db_set
    print(f"[sync] add={len(to_add)} remove={len(to_remove)} keep={len(to_keep)}", flush=True)

    stats = dict(deactivated=0, added=0, kept_updated=0, reactivated=0,
                 cat_set=0, cat_missing_sub=0, token_from_file=0, token_blank=0)

    # 1. deactivate removed
    for sku in to_remove:
        c.execute("UPDATE sku_records SET active=0, updated_at=? WHERE external_sku_id=?", (NOW(), sku))
        stats['deactivated'] += 1

    # helper: resolve category ids from file row
    def resolve_cat(r):
        main_name = str(r[23]).strip() if r[23] else ''
        sub_name = str(r[22]).strip() if r[22] else ''
        gid = groups.get(main_name)
        sid = None
        if sub_name:
            mn, sn = norm(main_name), norm(sub_name)
            sid = subs.get((mn, sn)) or sub_by_name.get(sn)
            # try the explicit file-label -> canonical map
            if not sid and (mn, sn) in FILE_SUB_MAP:
                canon = FILE_SUB_MAP[(mn, sn)]
                sid = sub_by_name.get(norm(canon))
            if sid: stats['cat_set'] += 1
            else: stats['cat_missing_sub'] += 1
        return gid, sid

    # 2. add new SKUs
    for sku in to_add:
        r = file_skus[sku]
        name = str(r[5]).strip() if r[5] else sku
        brand = str(r[8]).strip() if r[8] else None
        token_name = str(r[30]).strip() if r[30] else ''
        gid, sid = resolve_cat(r)
        chan = 'HKTVmall' if sku.startswith('H') else 'merchant'
        token_id = None; mapping_status = 'UNMAPPED'; review = 'PENDING'
        if token_name and norm(token_name) in tokens:
            token_id = tokens[norm(token_name)][0]
            mapping_status = 'TOKEN_ONLY'
            stats['token_from_file'] += 1
        else:
            stats['token_blank'] += 1
        if sku in all_db_skus:
            # previously deactivated -> reactivate + update
            c.execute("""UPDATE sku_records SET active=1, raw_sku_name=?, large_group_id=?, sub_category_id=?,
                         product_token_id=?, sales_channel=?, mapping_status=?, review_status=?, updated_at=?
                         WHERE external_sku_id=?""",
                      (name, gid, sid, token_id, chan, mapping_status, review, NOW(), sku))
            stats['reactivated'] += 1
        else:
            c.execute("""INSERT INTO sku_records
                         (external_sku_id, raw_sku_name, normalized_sku_name, product_token_id, large_group_id,
                          sub_category_id, sales_channel, active, mapping_status, review_status,
                          first_seen_at, last_seen_at, created_at, updated_at)
                         VALUES (?,?,?,?,?,?,?,1,?,?,?,?,?,?)""",
                      (sku, name, name, token_id, gid, sid, chan, mapping_status, review,
                       NOW(), NOW(), NOW(), NOW()))
            stats['added'] += 1

    # 3. update kept SKUs' categories/channel (trust file)
    for sku in to_keep:
        r = file_skus[sku]
        gid, sid = resolve_cat(r)
        chan = 'HKTVmall' if sku.startswith('H') else 'merchant'
        token_name = str(r[30]).strip() if r[30] else ''
        token_id = None
        if token_name and norm(token_name) in tokens:
            token_id = tokens[norm(token_name)][0]
        # update categories + channel; only set token if file provides one (don't clobber existing confirmed token with null)
        if token_id:
            c.execute("""UPDATE sku_records SET large_group_id=?, sub_category_id=?, sales_channel=?,
                         product_token_id=?, updated_at=? WHERE external_sku_id=?""",
                      (gid, sid, chan, token_id, NOW(), sku))
        else:
            c.execute("""UPDATE sku_records SET large_group_id=?, sub_category_id=?, sales_channel=?, updated_at=?
                         WHERE external_sku_id=?""",
                      (gid, sid, chan, NOW(), sku))
        stats['kept_updated'] += 1

    con.commit()

    # report
    total_active = c.execute("SELECT COUNT(*) FROM sku_records WHERE active=1").fetchone()[0]
    null_gid = c.execute("SELECT COUNT(*) FROM sku_records WHERE active=1 AND large_group_id IS NULL").fetchone()[0]
    null_sid = c.execute("SELECT COUNT(*) FROM sku_records WHERE active=1 AND sub_category_id IS NULL").fetchone()[0]
    with_token = c.execute("SELECT COUNT(*) FROM sku_records WHERE active=1 AND product_token_id IS NOT NULL").fetchone()[0]
    con.close()

    print("\n=== SYNC REPORT ===", flush=True)
    for k, v in stats.items(): print(f"  {k}: {v}", flush=True)
    print(f"  ---", flush=True)
    print(f"  total active SKUs now: {total_active}", flush=True)
    print(f"  active with NULL large_group_id: {null_gid}", flush=True)
    print(f"  active with NULL sub_category_id: {null_sid}", flush=True)
    print(f"  active with a product_token: {with_token}", flush=True)
    print(f"  expected active (file): {len(file_set)}", flush=True)

if __name__ == '__main__':
    main()
