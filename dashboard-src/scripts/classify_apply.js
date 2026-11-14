/* classify_apply.js — classify all UNMAPPED active SKUs and apply results.
 * Kill-resistant: commits each SKU as it goes; re-run resumes (already-tokened SKUs are skipped).
 * Progress every 100. Apply rule (Mode B / safe): set product_token_id (and product_key_id if matched),
 * large_group_id from classification only when currently NULL (we keep file-set main-cat otherwise).
 * review_status: NONE when confidence>=autoAccept else PENDING. UNMATCHED -> stays PENDING, UNMAPPED.
 */
const initSqlJs = require('sql.js');
const fs = require('fs'); const path = require('path');
const { classify } = require('./src/classify/classify');
const config = require('./src/config');

const DBFILE = 'C:/Users/chlam/data/product-token-library.db';
(async () => {
  const SQL = await initSqlJs({ locateFile: f => path.join('node_modules','sql.js','dist',f) });
  const sqldb = new SQL.Database(fs.readFileSync(DBFILE));
  const db = {
    all(s,p=[]){const st=sqldb.prepare(s);st.bind(p);const o=[];while(st.step())o.push(st.getAsObject());st.free();return o;},
    get(s,p=[]){return this.all(s,p)[0];},
    run(s,p=[]){const st=sqldb.prepare(s);st.bind(p);st.step();st.free();return {lastId: sqldb.exec('SELECT last_insert_rowid() AS id')[0].values[0][0], changes: sqldb.getRowsModified()};}
  };
  const now = () => new Date().toISOString();
  const rows = db.all("SELECT id, external_sku_id, raw_sku_name, large_group_id FROM sku_records WHERE active=1 AND product_token_id IS NULL AND mapping_status='UNMAPPED' ORDER BY id");
  const total = rows.length;
  console.log(`[classify] to classify: ${total}`);
  let matched=0, tokened=0, keyed=0, unmatched=0, auto=0, review=0;
  const t0 = Date.now();
  for (let i=0;i<rows.length;i++){
    const r = rows[i];
    const res = classify(db, r.raw_sku_name, {});
    const tok = res.product_token_id || null;
    const key = res.product_key_id || null;
    if (tok) { tokened++; }
    if (key) keyed++;
    if (res.match_method==='UNMATCHED' || !tok) { unmatched++; }
    const gid = r.large_group_id || res.large_group_id || null;  // keep file-set main-cat
    const mstat = key ? 'MAPPED' : (tok ? 'TOKEN_ONLY' : 'UNMAPPED');
    const autoAcc = config.confidence && config.confidence.autoAccept != null ? config.confidence.autoAccept : 0.95;
    const rstat = (tok && (res.confidence||0) >= autoAcc) ? 'NONE' : 'PENDING';
    if (rstat==='NONE') auto++; else review++;
    db.run(`UPDATE sku_records SET product_token_id=?, product_key_id=?, large_group_id=?, mapping_status=?, mapping_confidence=?, mapping_method=?, review_status=?, updated_at=? WHERE id=?`,
      [tok, key, gid, mstat, res.confidence||null, res.match_method||null, rstat, now(), r.id]);
    if ((i+1)%100===0){
      fs.writeFileSync(DBFILE, Buffer.from(sqldb.export()));
      const el=(Date.now()-t0)/1000, rate=(i+1)/el, eta=Math.round((total-i-1)/rate);
      console.log(`[classify] === PROGRESS ${i+1}/${total} | tokened=${tokened} keyed=${keyed} unmatched=${unmatched} | ETA=${eta}s ===`);
    }
  }
  fs.writeFileSync(DBFILE, Buffer.from(sqldb.export()));
  console.log(`[classify] DONE ${total} | tokened=${tokened} keyed=${keyed} unmatched=${unmatched} | autoAccept=${auto} review=${review} | used ${(Date.now()-t0)/1000|0}s`);
})();
