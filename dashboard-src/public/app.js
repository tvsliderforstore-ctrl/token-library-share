const { useState, useEffect, useMemo } = React;

// ---------- tiny helpers ----------
const api = {
  async get(u){ const r=await fetch(u); if(!r.ok) throw new Error((await r.json().catch(()=>({error:r.statusText}))).error||r.statusText); return r.json(); },
  async send(u,method,body){ const r=await fetch(u,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})}); const j=await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.error||r.statusText); return j; },
  post(u,b){return this.send(u,'POST',b)}, patch(u,b){return this.send(u,'PATCH',b)},
};
const fmt$ = (v)=> v==null? '—' : '$'+(Number(v).toFixed(1));
const fmtTime = (iso)=>{ if(!iso) return '—'; const d=new Date(iso); const h=(Date.now()-d.getTime())/36e5; if(h<1) return Math.max(1,Math.round(h*60))+' 分鐘前'; if(h<48) return Math.round(h)+' 小時前'; return d.toLocaleDateString('zh-HK'); };
const Fresh = ({f})=> f==='FRESH'? <span className="badge b-green">最新</span> : f==='STALE'? <span className="badge b-amber">過期</span> : <span className="badge b-grey">未有數據</span>;
const Conf = ({c})=> c==null? null : <span className={"badge "+(c>=0.95?'b-green':c>=0.75?'b-amber':'b-red')}>{(c*100).toFixed(0)}%</span>;
const ReviewBadge = ({s})=> s==='PENDING'? <span className="badge b-amber">待覆核</span> : s==='CONFIRMED'? <span className="badge b-green">已確認</span> : <span className="badge b-grey">{s||'—'}</span>;
const Null = ()=> <span className="muted">待確認</span>;

function useData(url, deps){
  const [data,setData]=useState(null),[err,setErr]=useState(null),[loading,setLoading]=useState(!!url);
  const load=()=>{ if(!url){setLoading(false);return;} setLoading(true);api.get(url).then(d=>{setData(d);setErr(null)}).catch(e=>setErr(e.message)).finally(()=>setLoading(false));};
  useEffect(load, deps||[url]);
  return {data,err,loading,reload:load};
}
function Copy({text}){ return <span className="copy" title="複製" onClick={()=>navigator.clipboard.writeText(text)}>⧉</span>; }

// ---------- layout ----------
const NAV = [
  ['#/','總覽'], ['#/categories','分類瀏覽'], ['#/groups','Main Cat'], ['#/tokens','產品符號庫'], ['#/keys','Product Key 庫'],
  ['#/skus','SKU 記錄'], ['#/tester','分類測試器'], ['#/review','覆核佇列'],
  ['#/import-export','匯入/匯出'], ['#/audit','審計歷史'], ['#/settings','設定'],
];
function Layout({children, route}){
  return <div className="layout">
    <div className="side"><h1>產品符號庫</h1>{NAV.map(([h,l])=> <a key={h} href={h} className={route===h?'active':''}>{l}</a>)}</div>
    <div className="main">{children}</div>
  </div>;
}
function Page({title, sub, children}){ return <div><h2 className="page-title">{title}</h2><div className="page-sub">{sub}</div>{children}</div>; }
const Loading = ()=> <div className="empty">載入中…</div>;
const Err = ({m})=> m? <div className="err">錯誤：{m}</div> : null;

// ---------- Stock drill-down (總覽 有貨/缺貨) ----------
// status -> Main Cat -> Sub Cat -> Product Token -> SKU (rank-1 = cheapest in its Product Key).
function DrillRows({url, renderRow, deps}){
  const {data,err,loading}=useData(url, deps||[url]);
  if(!url) return null;
  if(loading) return <div className="empty small">載入中…</div>;
  if(err) return <Err m={err}/>;
  if(!data||!data.length) return <div className="empty small">無資料</div>;
  return <div className="drill-list">{data.map(renderRow)}</div>;
}
function DrillRow({name, cnt, open, onToggle, children}){
  return <div className="drill-row-wrap">
    <button className="sub-row drill-row" onClick={onToggle}>
      <span className="sub-name">{name}</span>
      <span className="small muted">{cnt} SKUs</span>
      <span className="cat-caret">{open?'▾':'▸'}</span>
    </button>
    {open && <div className="drill-children">{children}</div>}
  </div>;
}
function StockDrill({status}){
  const [openMain,setOpenMain]=useState(null);   // main code
  const [openSub,setOpenSub]=useState(null);     // sub code
  const [openTok,setOpenTok]=useState(null);     // token id
  useEffect(()=>{ setOpenMain(null); setOpenSub(null); setOpenTok(null); },[status]);
  const isOOS = status==='OUT_OF_STOCK';
  const label = status==='OUT_OF_STOCK'?'缺貨': status==='LOW_STOCK'?'少貨':'有貨';
  return <div className="panel" style={{marginTop:14}}>
    <h3>{label} 明細（Main Cat → Sub Cat → 產品符號 → SKU）</h3>
    <DrillRows url={'/api/stock-drill/'+status+'/main'} deps={[status]} renderRow={m=>
      <DrillRow key={m.code} name={m.name} cnt={m.cnt} open={openMain===m.code}
        onToggle={()=>{setOpenMain(openMain===m.code?null:m.code); setOpenSub(null); setOpenTok(null);}}>
        {openMain===m.code && <DrillRows url={'/api/stock-drill/'+status+'/main/'+m.code} deps={[status,m.code]} renderRow={s=>
          <DrillRow key={s.code} name={s.name} cnt={s.cnt} open={openSub===s.code}
            onToggle={()=>{setOpenSub(openSub===s.code?null:s.code); setOpenTok(null);}}>
            {openSub===s.code && <DrillRows url={'/api/stock-drill/'+status+'/sub/'+s.code} deps={[status,s.code]} renderRow={t=>
              <DrillRow key={t.id} name={t.name} cnt={t.cnt} open={openTok===t.id}
                onToggle={()=>setOpenTok(openTok===t.id?null:t.id)}>
                {openTok===t.id && <DrillSkus status={status} tokenId={t.id}/>}
              </DrillRow>}/>
            }
          </DrillRow>}/>
        }
      </DrillRow>}/>
  </div>;
}
function DrillSkus({status, tokenId}){
  const {data,err,loading}=useData('/api/stock-drill/'+status+'/token/'+tokenId, [status,tokenId]);
  if(loading) return <div className="empty small">載入中…</div>;
  if(err) return <Err m={err}/>;
  if(!data||!data.length) return <div className="empty small">無 SKU</div>;
  const showRank = status==='OUT_OF_STOCK' || status==='LOW_STOCK';
  const rankHdr = status==='OUT_OF_STOCK' ? '缺貨且 Key 內最平（Rank 1）' : 'Key 內最平（Rank 1）';
  return <div className="table-wrap"><table>
    <thead><tr><th>來源</th><th>SKU</th><th>產品名稱</th><th>Product Key</th><th style={{textAlign:'right'}}>售價</th>{showRank && <th>{rankHdr}</th>}<th>有貨 Top1</th></tr></thead>
    <tbody>{data.map(s=> <tr key={s.id}>
      <td><ChanBadge sku={s.sku_id}/></td>
      <td className="mono small">{s.sku_id}</td>
      <td className="small">{s.product_name}</td>
      <td className="small muted">{s.display_key||'—'}</td>
      <td style={{textAlign:'right'}}>{fmt$(s.discount_price)}</td>
      {showRank && <td>{s.is_cheapest? <span className="badge b-red">是 · Rank 1 / {s.key_group_size}</span> : <span className="badge b-grey">否 · Rank {s.key_rank} / {s.key_group_size}</span>}</td>}
      <td>{s.is_real_top1? (s.real_top1_offset>0? <span className="badge b-amber">有貨Top1 ↑{s.real_top1_offset}</span> : <span className="badge b-green">有貨Top1</span>) : <span className="muted small">—</span>}</td>
    </tr>)}</tbody></table></div>;
}
// H = HKTVmall 自家 (sku starts with H); M = merchant / 非 HKTVmall.
function ChanBadge({sku}){ const isH = /^H/.test(String(sku||'')); return <span className={"chan-badge "+(isH?"chan-h":"chan-m")} title={isH?"HKTVmall 自家產品":"非 HKTVmall（商家）產品"}>{isH?'H':'M'}</span>; }

// Per-Key cheapest ranking badge. cheapest_rank 1 = 最平 (normal logic).
// is_real_top1 = the buyable top-1 (cheapest IN-STOCK). When the cheapest is OOS,
// the real top-1 falls to the next in-stock SKU (real_top1_offset = how many cheaper are OOS above it).
function RankBadge({s}){
  if(!s || s.cheapest_rank==null) return <span className="muted small">—</span>;
  const size = s.cheapest_group_size;
  const cheap = s.is_cheapest
    ? <span className="badge b-blue" title={`Key 內最平（共 ${size} 個）`}>最平 #1/{size}</span>
    : <span className="badge b-grey" title={`Key 內第 ${s.cheapest_rank} 平（共 ${size} 個）`}>#{s.cheapest_rank}/{size}</span>;
  let real = null;
  if(s.is_real_top1){
    real = s.real_top1_offset>0
      ? <span className="badge b-amber" title={`最平 ${s.real_top1_offset} 個缺貨，呢個先係而家有貨最平`}>有貨Top1 ↑{s.real_top1_offset}</span>
      : <span className="badge b-green" title="呢個就係 Key 內有貨最平">有貨Top1</span>;
  }
  return <span style={{whiteSpace:'nowrap'}}>{cheap}{real && <span style={{marginLeft:4}}>{real}</span>}</span>;
}

// 總覽 panel: how many Product Keys' "cheapest" (rank-1) SKU is ALSO the real top-1 (in stock).
// Cards are pressable — they drill into the representative SKU per key.
function CheapestRealPanel(){
  const {data,err,loading}=useData('/api/cheapest-real-overview');
  const [drill,setDrill]=useState(null);   // 'is-real' | 'not-real' | 'substituted' | null
  if(loading) return <Loading/>;
  if(err) return <Err m={err}/>;
  if(!data) return null;
  const pct = data.cheapest_total? Math.round(data.cheapest_is_real/data.cheapest_total*100) : 0;
  return <>
    <div className="cards">
      <button className="card card-btn" onClick={()=>setDrill(drill==='is-real'?null:'is-real')}><div className="num" style={{color:'var(--green,#16a34a)'}}>{data.cheapest_is_real}</div><div className="lbl">最平＝有貨Top1（最平有貨）→</div></button>
      <button className="card card-btn" onClick={()=>setDrill(drill==='not-real'?null:'not-real')}><div className="num" style={{color:'var(--amber,#d97706)'}}>{data.cheapest_not_real}</div><div className="lbl">最平缺貨（非有貨Top1）→</div></button>
      <button className="card card-btn" onClick={()=>setDrill(drill==='substituted'?null:'substituted')}><div className="num">{data.real_substituted}</div><div className="lbl">有貨Top1係次平/更後 →</div></button>
      <div className="card"><div className="num">{pct}%</div><div className="lbl">最平有貨比例（共 {data.cheapest_total} Keys）</div></div>
    </div>
    {drill && <CheapestRealDrill kind={drill} key={drill} onClose={()=>setDrill(null)}/>}
  </>;
}

// Drill table for one 最平/有貨 Top1 bucket. One representative SKU per Product Key.
const CR_DRILL_META = {
  'is-real':     {title:'最平＝有貨Top1（最平嗰個有貨）', note:'每個 Key 最平嗰個 SKU 而家有貨，所以佢就係有貨 Top1。'},
  'not-real':    {title:'最平缺貨（非有貨Top1）', note:'每個 Key 最平嗰個 SKU 而家缺貨；下面列出呢個最平（缺貨）嘅 SKU。'},
  'substituted': {title:'有貨Top1係次平/更後', note:'最平嗰個缺貨，所以有貨 Top1 落到次平（或更後）。下面列出而家嘅有貨 Top1（唔係最平嗰個）。'},
};
function CheapestRealDrill({kind, onClose}){
  const meta = CR_DRILL_META[kind] || {title:kind, note:''};
  const [page,setPage]=useState(1);
  const pageSize=50;
  useEffect(()=>setPage(1),[kind]);
  const {data,err,loading}=useData('/api/cheapest-real-drill/'+kind+'?limit='+pageSize+'&offset='+((page-1)*pageSize),[kind,page]);
  const total = data?data.total:0;
  const pg = data? { page, page_size:pageSize, total_rows:total, total_pages:Math.max(1,Math.ceil(total/pageSize)) } : null;
  return <div className="panel" style={{marginTop:14}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
      <h3>{meta.title} 明細</h3>
      <button className="ghost small" onClick={onClose}>收合 ✕</button>
    </div>
    <div className="small muted" style={{marginBottom:8}}>{meta.note}</div>
    {loading? <Loading/> : err? <Err m={err}/> :
      !data||!data.rows||!data.rows.length? <div className="empty small">無資料</div> :
      <>
      <div className="table-wrap"><table className="sku-table">
        <thead><tr><th>SKU ID</th><th>品牌</th><th>產品名稱</th><th>Product Key</th><th>Main Cat</th><th>Sub Cat</th><th style={{textAlign:'right'}}>折後價</th><th>庫存</th><th>Key 排名</th></tr></thead>
        <tbody>{data.rows.map(s=> <tr key={s.sku_id}>
          <td className="mono small">{s.sku_id}</td>
          <td className="small">{s.brand||'—'}</td>
          <td className="small">{s.product_name}</td>
          <td className="small muted">{s.display_key||'—'}</td>
          <td className="small">{s.main_cat||'—'}</td>
          <td className="small">{s.sub_cat||'—'}</td>
          <td style={{textAlign:'right'}} className="small">{s.discount_price!=null?('$'+s.discount_price):'—'}</td>
          <td><StockBadge2 s={s.stock_status}/></td>
          <td><RankBadge s={s}/></td>
        </tr>)}</tbody>
      </table></div>
      {pg && pg.total_pages>1 && <Pagination pg={pg} onPage={setPage}/>}
      </>}
  </div>;
}

function Overview(){
  const {data,err,loading}=useData('/api/overview');
  const {data:skill}=useData('/api/system/skill-status');
  const {data:cat}=useData('/api/categories/overview');
  const [stockDrill,setStockDrill]=useState(null);   // 'IN_STOCK' | 'OUT_OF_STOCK' | null
  const [visDrill,setVisDrill]=useState(null);       // 'visible' | 'invisible' | null
  const [statDrill,setStatDrill]=useState(null);     // top-card drill key | null
  if(loading) return <Loading/>;
  const cards = [
    ['Main Cat', data.large_groups, 'large-groups'],['產品符號', data.product_tokens, 'tokens'],['Product Keys', data.product_keys, 'keys'],['SKUs', data.skus, 'skus'],
    ['自動匹配', data.skus_auto_matched, 'auto-matched'],['待覆核', data.skus_review, 'review'],
    ['無 Key 的符號', data.tokens_without_keys, 'tokens-no-keys'],['無 SKU 的 Key', data.keys_without_skus, 'keys-no-skus'],
    ['缺價格', data.missing_price, 'missing-price'],
  ];
  return <Page title="總覽" sub="產品庫整體狀況與數據新鮮度">
    <Err m={err}/>
    <div className="cards">{cards.map(([l,v,k])=> <button className="card card-btn" key={l} onClick={()=>setStatDrill(statDrill===k?null:k)}><div className="num">{v??0}</div><div className="lbl">{l} →</div></button>)}</div>
    {statDrill && <StatDrill kind={statDrill} key={statDrill} onClose={()=>setStatDrill(null)}/>}
    <div className="panel"><h3>價格與庫存總覽</h3>
      <div className="small muted" style={{marginBottom:8}}>SKU 層級的價格與庫存觀測。摘要按 Key / 符號 / Main Cat 計算，觀測永在 SKU 層。</div>
      <PriceStockSummary onPick={setStockDrill}/>
    </div>
    {stockDrill && <StockDrill status={stockDrill} key={stockDrill}/>}
    <div className="panel"><h3>可見 / 隱藏 總覽</h3>
      <div className="small muted" style={{marginBottom:8}}>根據 Tableau is_invisible。按下可見 / 隱藏 查看產品明細。</div>
      <div className="cards">
        <button className="card card-btn" onClick={()=>setVisDrill(visDrill==='visible'?null:'visible')}><div className="num" style={{color:'var(--green,#16a34a)'}}>{data.online_count??0}</div><div className="lbl">可見（線上）→</div></button>
        <button className="card card-btn" onClick={()=>setVisDrill(visDrill==='invisible'?null:'invisible')}><div className="num" style={{color:'var(--muted,#6b7280)'}}>{data.offline_count??0}</div><div className="lbl">隱藏（離線）→</div></button>
        <div className="card"><div className="num">{data.visibility_unknown_count??0}</div><div className="lbl">未知</div></div>
      </div>
    </div>
    {visDrill && <VisDrill state={visDrill} key={visDrill} onClose={()=>setVisDrill(null)}/>}
    <div className="panel"><h3>最平 / 有貨 Top1 總覽</h3>
      <div className="small muted" style={{marginBottom:8}}>每個 Product Key 的「最平」第 1 名，而家有幾多個同時係「有貨 Top1」（最平嗰個有貨）。最平缺貨時，有貨 Top1 會落到次平、第三平…</div>
      <CheapestRealPanel/>
    </div>
    <div className="grid2">
      <div className="panel"><h3>數據更新狀態</h3>
        <dl className="kv">
          <dt>最後線上狀態更新</dt><dd>{fmtTime(data.last_visibility_refresh)}</dd>
          <dt>最後價格更新</dt><dd>{fmtTime(data.last_price_refresh)}</dd>
          <dt>最後庫存更新</dt><dd>{fmtTime(data.last_stock_refresh)}</dd>
          <dt>價格技能</dt><dd>{skill? <span className={"badge "+(skill.price_skill.connected?'b-green':'b-red')}>{skill.price_skill.name}</span>:'…'}</dd>
          <dt>庫存技能</dt><dd>{skill? <span className={"badge "+(skill.stock_skill.connected?'b-green':'b-red')}>{skill.stock_skill.name}{skill.stock_skill.connected?'':' (not connected)'}</span>:'…'}</dd>
        </dl>
      </div>
      <div className="panel"><h3>最近修正</h3>
        {data.recent_corrections && data.recent_corrections.length? <table><tbody>
          {data.recent_corrections.slice(0,8).map(c=> <tr key={c.id}><td className="small">{c.entity_type}</td><td className="small">{c.action}</td><td className="small muted">{fmtTime(c.created_at)}</td></tr>)}
        </tbody></table> : <div className="empty small">暫無修正記錄</div>}
      </div>
    </div>
    {cat && <div className="panel" style={{marginTop:14}}><h3>分類概況（Main Cat / Sub Cat）</h3>
      <div className="cards" style={{marginBottom:12}}>
        <div className="card"><div className="num">{cat.skus_missing_subcat}</div><div className="lbl">SKUs 缺 Sub Cat</div></div>
        <div className="card"><div className="num">{cat.subcat_conflicts}</div><div className="lbl">Main/Sub 衝突</div></div>
        <div className="card"><div className="num">{cat.largest_subcat?cat.largest_subcat.cnt:0}</div><div className="lbl">最大 Sub Cat{cat.largest_subcat?('：'+cat.largest_subcat.name):''}</div></div>
        <div className="card"><div className="num">{cat.subcats_with_missing_price}</div><div className="lbl">缺價 Sub Cats</div></div>
        <div className="card"><div className="num">{cat.subcats_with_missing_stock}</div><div className="lbl">缺庫存 Sub Cats</div></div>
        <div className="card"><div className="num">{cat.subcats_requiring_review}</div><div className="lbl">待覆核 Sub Cats</div></div>
      </div>
      <table><thead><tr><th>Main Cat</th><th>Sub Cat</th><th style={{textAlign:'right'}}>SKU 數</th></tr></thead>
        <tbody>{(cat.sku_count_by_cat||[]).map((r,i)=> <tr key={i}><td className="small">{r.main_cat}</td><td className="small">{r.sub_cat}</td><td style={{textAlign:'right'}}>{r.cnt}</td></tr>)}</tbody></table>
    </div>}
  </Page>;
}

// Visibility drill panel: lists SKUs that are 可見 (online) or 隱藏 (offline).
function VisDrill({state, onClose}){
  const [page,setPage]=useState(1);
  const pageSize=50;
  const {data,err,loading}=useData('/api/visibility-drill/'+state+'?limit='+pageSize+'&offset='+((page-1)*pageSize),[state,page]);
  const title = state==='invisible' ? '隱藏（離線）產品' : '可見（線上）產品';
  const pg = data? { page, page_size:pageSize, total_rows:data.total, total_pages:Math.max(1,Math.ceil(data.total/pageSize)) } : null;
  return <div className="panel" style={{marginTop:14}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
      <h3 style={{margin:0}}>{title} 明細</h3>
      <button className="ghost small" onClick={onClose}>收合 ✕</button>
    </div>
    {loading? <Loading/> : err? <Err m={err}/> :
      !data||!data.rows.length? <div className="empty small">無資料</div> :
      <>
      <div className="table-wrap"><table className="sku-table">
        <thead><tr><th>SKU ID</th><th>品牌</th><th>產品名稱</th><th>規格</th><th>Main Cat</th><th>Sub Cat</th><th style={{textAlign:'right'}}>折後價</th><th>Key 排名</th><th>顯示狀態</th></tr></thead>
        <tbody>{data.rows.map(s=> <tr key={s.id}>
          <td className="mono small">{s.sku_id}</td>
          <td className="small">{s.brand||'—'}</td>
          <td className="small">{s.product_name}</td>
          <td className="small muted">{s.packing_spec||'—'}</td>
          <td className="small">{s.main_cat||'—'}</td>
          <td className="small">{s.sub_cat||'—'}</td>
          <td style={{textAlign:'right'}} className="small">{s.discount_price!=null?('$'+s.discount_price):'—'}</td>
          <td><RankBadge s={s}/></td>
          <td><VisBadge v={s.is_invisible}/></td>
        </tr>)}</tbody>
      </table></div>
      {pg && pg.total_pages>1 && <Pagination pg={pg} onPage={setPage}/>}
      </>}
  </div>;
}

// Stat drill panel: shows what each top-card count includes.
const STAT_DRILL_META = {
  'large-groups':  {title:'Main Cat',            cols:[['group_code','代碼'],['name_zh','名稱'],['token_count','符號數'],['key_count','Key 數'],['sku_count','SKU 數']]},
  'tokens':        {title:'產品符號',            cols:[['token_code','符號代碼'],['name','名稱'],['group_name','Main Cat'],['key_count','Key 數'],['sku_count','SKU 數']]},
  'keys':          {title:'Product Keys',        cols:[['product_key_code','Key 代碼'],['display','內容'],['token_name','產品符號'],['sku_count','SKU 數']]},
  'skus':          {title:'SKUs',                cols:[['external_sku_id','SKU ID'],['raw_sku_name','產品名稱'],['group_name','Main Cat'],['token_name','產品符號'],['review_status','覆核']]},
  'auto-matched':  {title:'自動匹配 SKU',        cols:[['external_sku_id','SKU ID'],['raw_sku_name','產品名稱'],['group_name','Main Cat'],['token_name','產品符號'],['mapping_status','匹配']]},
  'review':        {title:'待覆核 SKU',          cols:[['external_sku_id','SKU ID'],['raw_sku_name','產品名稱'],['group_name','Main Cat'],['token_name','產品符號'],['mapping_confidence','信心']]},
  'tokens-no-keys':{title:'無 Key 的符號',       cols:[['token_code','符號代碼'],['name','名稱'],['group_name','Main Cat'],['sku_count','SKU 數']]},
  'keys-no-skus':  {title:'無 SKU 的 Key',       cols:[['product_key_code','Key 代碼'],['display','內容'],['token_name','產品符號']]},
  'missing-price': {title:'缺價格 SKU',          cols:[['external_sku_id','SKU ID'],['raw_sku_name','產品名稱'],['group_name','Main Cat'],['token_name','產品符號']]},
};
function StatDrill({kind, onClose}){
  const meta = STAT_DRILL_META[kind] || {title:kind, cols:[]};
  const [page,setPage]=useState(1);
  const pageSize=50;
  useEffect(()=>setPage(1),[kind]);
  const {data,err,loading}=useData('/api/stat-drill/'+kind+'?limit='+pageSize+'&offset='+((page-1)*pageSize),[kind,page]);
  const total = data?data.total:0;
  const pg = data? { page, page_size:pageSize, total_rows:total, total_pages:Math.max(1,Math.ceil(total/pageSize)) } : null;
  return <div className="panel" style={{marginTop:14}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
      <h3>{meta.title} 明細</h3>
      <button className="ghost small" onClick={onClose}>收合 ✕</button>
    </div>
    {loading? <Loading/> : err? <Err m={err}/> :
      !data||!data.rows||!data.rows.length? <div className="empty small">無資料</div> :
      <>
      <div className="table-wrap"><table className="sku-table">
        <thead><tr>{meta.cols.map(([k,l])=> <th key={k}>{l}</th>)}</tr></thead>
        <tbody>{data.rows.map((r,i)=> <tr key={i}>{meta.cols.map(([k])=> <td key={k} className="small">{r[k]==null?'—':String(r[k])}</td>)}</tr>)}</tbody>
      </table></div>
      {pg && pg.total_pages>1 && <Pagination pg={pg} onPage={setPage}/>}
      </>}
  </div>;
}

// ---------- Large Groups ----------
function Groups(){
  const {data,err,loading,reload}=useData('/api/large-groups');
  const [edit,setEdit]=useState(null),[form,setForm]=useState({});
  if(loading) return <Loading/>;
  const save=async()=>{ await api.patch('/api/large-groups/'+edit, form); setEdit(null); reload(); };
  return <Page title="Main Cat" sub="10 個最高級業務類別。含符號的 Main Cat 不可隨意刪除。">
    <Err m={err}/>
    <div className="panel"><div className="table-wrap"><table>
      <thead><tr><th>代碼</th><th>名稱</th><th>描述</th><th>順序</th><th>狀態</th><th></th></tr></thead>
      <tbody>{(data||[]).map(g=> <tr key={g.id}>
        <td className="mono">{g.group_code}</td>
        <td><b>{g.name_zh}</b></td>
        <td className="small muted">{g.description||'—'}</td>
        <td>{g.display_order}</td>
        <td>{g.active? <span className="badge b-green">啟用</span> : <span className="badge b-grey">停用</span>}</td>
        <td><button className="ghost" onClick={()=>{setEdit(g.id); setForm({name_en:g.name_en,description:g.description,display_order:g.display_order,active:g.active});}}>編輯</button></td>
      </tr>)}</tbody></table></div></div>
    {edit && <div className="panel"><h3>編輯 Main Cat</h3>
      <div className="toolbar"><input style={{flex:2}} placeholder="描述" value={form.description||''} onChange={e=>setForm({...form,description:e.target.value})}/>
      <input style={{width:80}} type="number" placeholder="順序" value={form.display_order||0} onChange={e=>setForm({...form,display_order:+e.target.value})}/>
      <label className="small"><input type="checkbox" checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})}/> 啟用</label>
      <button onClick={save}>儲存</button><button className="ghost" onClick={()=>setEdit(null)}>取消</button></div>
    </div>}
  </Page>;
}

// ---------- Tokens ----------
function Tokens(){
  const {data:groups}=useData('/api/large-groups');
  const [gid,setGid]=useState('');
  const {data,err,loading,reload}=useData('/api/tokens'+(gid?('?group_id='+gid):''),[gid]);
  const [sel,setSel]=useState(null);
  const [alias,setAlias]=useState('');
  if(loading&&!data) return <Loading/>;
  const detail=sel?data.find(t=>t.id===sel):null;
  return <Page title="產品符號庫" sub="受控的產品概念（非完整可售產品）。一個符號可有多個別名與多個 Product Key。">
    <Err m={err}/>
    <div className="toolbar"><select value={gid} onChange={e=>setGid(e.target.value)}><option value="">全部 Main Cat</option>{groups&&groups.map(g=> <option key={g.id} value={g.id}>{g.name_zh}</option>)}</select></div>
    <div className="panel"><table>
      <thead><tr><th>符號代碼</th><th>名稱</th><th>Main Cat</th><th>別名</th><th>Key 數</th><th>SKU 數</th><th>狀態</th><th></th></tr></thead>
      <tbody>{data&&data.map(t=> <tr key={t.id}>
        <td className="mono small">{t.token_code}</td><td><b>{t.name_zh}</b></td><td>{t.group_name}</td>
        <td className="small"><Aliases id={t.id}/></td><td>{t.key_count}</td><td>{t.sku_count}</td>
        <td>{t.active? <span className="badge b-green">啟用</span>:<span className="badge b-grey">停用</span>}</td>
        <td><button className="ghost" onClick={()=>setSel(sel===t.id?null:t.id)}>{sel===t.id?'收合':'管理'}</button></td>
      </tr>)}</tbody></table></div>
    {detail && <TokenDetail token={detail} onDone={()=>{reload();}} alias={alias} setAlias={setAlias}/>}
  </Page>;
}
function Aliases({id}){ const {data}=useData('/api/tokens/'+id,[id]); if(!data) return '…'; return (data.aliases||[]).map(a=> <span className="tag" key={a.id}>{a.alias}</span>); }
function TokenDetail({token,onDone,alias,setAlias}){
  const {data,reload}=useData('/api/tokens/'+token.id,[token.id]);
  const add=async(kind)=>{ if(!alias) return; await api.post('/api/tokens/'+token.id+(kind==='neg'?'/negative-aliases':'/aliases'),{alias}); setAlias(''); reload(); onDone(); };
  if(!data) return null;
  return <div className="panel"><h3>{data.name_zh} — 別名管理</h3>
    <div className="small" style={{marginBottom:8}}>核准別名：{(data.aliases||[]).map(a=> <span className="tag" key={a.id}>{a.alias}</span>)}</div>
    <div className="small" style={{marginBottom:8}}>負面別名：{(data.negative_aliases||[]).map(a=> <span className="tag" key={a.id} style={{background:'#fbe2e2'}}>{a.alias}</span>)}</div>
    <div className="toolbar"><input placeholder="新增別名" value={alias} onChange={e=>setAlias(e.target.value)}/>
      <button onClick={()=>add('pos')}>加核准別名</button><button className="sec" onClick={()=>add('neg')}>加負面別名</button></div>
  </div>;
}

// ---------- Product Keys ----------
function Keys(){
  const [q,setQ]=useState('');
  const {data,err,loading}=useData('/api/product-keys'+(q?('?q='+encodeURIComponent(q)):''),[q]);
  const [summaries,setSummaries]=useState({});
  useEffect(()=>{ if(data) data.forEach(k=> api.get('/api/product-keys/'+k.id+'/summary').then(s=> setSummaries(p=>({...p,[k.id]:s}))).catch(()=>{})); },[data]);
  if(loading&&!data) return <Loading/>;
  return <Page title="Product Key 庫" sub="結構化商品配置：品牌 | 產品符號 | 產地 | 款式 | 規格。不同款式/規格保持獨立。">
    <Err m={err}/>
    <div className="toolbar"><input style={{flex:1}} placeholder="搜尋 無糖 / 250ml / 鈣思寶 / 豆奶 / 中國 …" value={q} onChange={e=>setQ(e.target.value)}/></div>
    <div className="panel"><table>
      <thead><tr><th>Key 代碼</th><th>顯示鍵</th><th>品牌</th><th>符號</th><th>產地</th><th>款式</th><th>規格</th><th>SKU</th><th>價格</th><th>庫存</th></tr></thead>
      <tbody>{data&&data.map(k=>{ const s=summaries[k.id]; return <tr key={k.id}>
        <td className="mono small">{k.product_key_code}</td>
        <td className="small"><b>{k.display_key}</b><Copy text={k.display_key}/></td>
        <td>{k.brand_name||<Null/>}</td><td>{k.token_name}</td><td>{k.origin_name||<Null/>}</td>
        <td>{k.variant||<Null/>}</td><td className="small">{k.display_pack_format||<Null/>}</td>
        <td>{k.sku_count}</td>
        <td className="small">{s&&s.price? (s.price.type==='single'? fmt$(s.price.value) : <span title="範圍">{fmt$(s.price.min)}–{fmt$(s.price.max)}</span>) : '—'}</td>
        <td className="small">{s&&s.stock? <StockMini st={s.stock}/>:'—'}</td>
      </tr>;})}</tbody></table></div>
  </Page>;
}
function StockMini({st}){ return <span>{st.IN_STOCK? <span className="badge b-green">{st.IN_STOCK} 有貨</span>:null}{st.LOW_STOCK? <span className="badge b-amber"> {st.LOW_STOCK} 少</span>:null}{st.OUT_OF_STOCK? <span className="badge b-red"> {st.OUT_OF_STOCK} 缺</span>:null}{(!st.IN_STOCK&&!st.LOW_STOCK&&!st.OUT_OF_STOCK)? <span className="badge b-grey">離線</span>:null}</span>; }

// ---------- SKUs ----------
function StockBadge({status}){
  const map = { IN_STOCK:['b-green','有貨'], LOW_STOCK:['b-amber','少貨'], OUT_OF_STOCK:['b-red','缺貨'],
    PREORDER:['b-blue','預購'], DISCONTINUED:['b-grey','已下架'], UNKNOWN:['b-grey','離線'] };
  const [cls,label] = map[status] || ['b-grey', status||'未知'];
  return <span className={"badge "+cls}>{label}</span>;
}
function SkuDetail({sku}){
  const {data:stock, loading:sl} = useData('/api/skus/'+sku.id+'/stock',[sku.id]);
  const {data:price} = useData('/api/skus/'+sku.id+'/price',[sku.id]);
  const {data:op} = useData('/api/skus/'+sku.id+'/operational',[sku.id]);
  const st = stock && stock[0];
  const vis = op? (op.current_is_invisible===true? <span className="badge b-grey">隱藏</span> : op.current_is_invisible===false? <span className="badge b-green">可見</span> : <span className="badge b-grey">未知</span>) : '—';
  return <tr><td colSpan="8" style={{background:'#fafbfc',padding:'10px 14px'}}>
    <div style={{display:'flex',gap:28,flexWrap:'wrap',alignItems:'center'}}>
      <div><div className="lbl">庫存狀態</div>
        {sl? '…' : st? <span><StockBadge status={st.stock_status}/> <Fresh f={st.freshness}/></span> : <span className="badge b-grey">未有數據</span>}</div>
      <div><div className="lbl">特價 (Tableau)</div><div className="small">{op&&op.current_discount_price!=null? fmt$(op.current_discount_price):'—'}</div></div>
      <div><div className="lbl">可見性</div><div className="small">{vis}</div></div>
      <div><div className="lbl">觀察時間</div><div className="small">{st? fmtTime(st.observed_at):'—'}</div></div>
      <div><div className="lbl">銷售渠道</div><div className="small">{st&&st.sales_channel||'—'}</div></div>
      <div><div className="lbl">現價</div><div className="small">{price&&price.effective_price!=null? fmt$(price.effective_price):'—'}</div></div>
      <div className="small muted mono" style={{marginLeft:'auto'}}>{sku.external_sku_id}</div>
    </div>
  </td></tr>;
}
function Skus(){
  const [q,setQ]=useState('');
  const [open,setOpen]=useState(null);
  const {data,err,loading}=useData('/api/skus?limit=300'+(q?('&q='+encodeURIComponent(q)):'') ,[q]);
  if(loading&&!data) return <Loading/>;
  return <Page title="SKU 記錄" sub="來源系統的確切可售記錄。完整原始名稱永不被覆寫。點擊列查看庫存詳情。">
    <Err m={err}/>
    <div className="toolbar"><input style={{flex:1}} placeholder="搜尋名稱 / SKU ID / 條碼" value={q} onChange={e=>setQ(e.target.value)}/></div>
    <div className="panel">{data&&data.length? <table>
      <thead><tr><th>SKU ID</th><th>原始名稱</th><th>Main Cat</th><th>符號</th><th>Product Key</th><th>信心</th><th>覆核</th><th></th></tr></thead>
      <tbody>{data.map(s=> <React.Fragment key={s.id}>
        <tr onClick={()=>setOpen(open===s.id?null:s.id)} style={{cursor:'pointer',background:open===s.id?'#f0f6ff':'inherit'}}>
        <td className="mono small"><ChanBadge sku={s.external_sku_id}/> {s.external_sku_id||s.id}</td><td className="sku-name small" title={s.raw_sku_name}>{s.raw_sku_name}<Copy text={s.raw_sku_name}/></td>
        <td className="small">{s.group_name||<Null/>}</td><td className="small">{s.token_name||<Null/>}</td>
        <td className="small">{s.key_display||<span className="muted">未解析</span>}</td>
        <td><Conf c={s.mapping_confidence}/></td><td><ReviewBadge s={s.review_status}/></td>
        <td className="small muted">{open===s.id?'▲':'▼'}</td>
        </tr>
        {open===s.id && <SkuDetail sku={s}/>}
      </React.Fragment>)}</tbody></table> : <div className="empty">暫無 SKU。請用「匯入/匯出」匯入，或用分類測試器。</div>}</div>
  </Page>;
}

// ---------- Classification Tester ----------
function Tester(){
  const [input,setInput]=useState('一口牛柳粒(急凍)#牛肉粒#淋滑#韓燒烤#家常小菜');
  const [batch,setBatch]=useState('');
  const [res,setRes]=useState(null),[batchRes,setBatchRes]=useState(null),[err,setErr]=useState(null),[busy,setBusy]=useState(false);
  const run=async()=>{ setBusy(true);setErr(null); try{ setRes(await api.post('/api/classify',{raw_sku_name:input})); }catch(e){setErr(e.message)} finally{setBusy(false)} };
  const runBatch=async()=>{ setBusy(true);setErr(null); try{ const items=batch.split('\n').map(x=>x.trim()).filter(Boolean); const r=await api.post('/api/classify',{items}); setBatchRes(r.results);}catch(e){setErr(e.message)} finally{setBusy(false)} };
  return <Page title="分類測試器" sub="貼上 SKU 名稱即時測試正規化與分類結果。支援單條與批次。">
    <Err m={err}/>
    <div className="panel"><h3>單條測試</h3>
      <div className="toolbar"><input style={{flex:1}} value={input} onChange={e=>setInput(e.target.value)}/><button onClick={run} disabled={busy}>分類</button></div>
      {res && <div className="result-box">
        <dl className="kv">
          <dt>正規化文字</dt><dd className="mono">{res.normalized_sku_name}</dd>
          <dt>基本標題</dt><dd>{res.base_title}</dd>
          <dt>Hashtag</dt><dd>{res.extracted_hashtags.length? res.extracted_hashtags.map(x=><span className="tag" key={x}>{x}</span>):'—'}</dd>
          <dt>括號屬性</dt><dd>{res.extracted_brackets.length? res.extracted_brackets.map(x=><span className="tag" key={x}>{x}</span>):'—'}</dd>
          <dt>Main Cat</dt><dd><b>{res.large_group_name||<Null/>}</b></dd>
          <dt>產品符號</dt><dd><b>{res.product_token_name||<Null/>}</b> {res.product_token_code&&<span className="mono small muted">{res.product_token_code}</span>}</dd>
          <dt>Product Key</dt><dd>{res.product_key_display||<span className="muted">未解析（token-only）</span>}</dd>
          <dt>命中別名</dt><dd>{res.matched_alias||'—'}</dd>
          <dt>方法</dt><dd><span className="badge b-blue">{res.match_method}</span></dd>
          <dt>信心</dt><dd><Conf c={res.confidence}/></dd>
          <dt>需覆核</dt><dd>{res.requires_review? <span className="badge b-amber">是</span>:<span className="badge b-green">否</span>}</dd>
          <dt>說明</dt><dd className="small">{res.explanation}</dd>
        </dl>
        {res.alternative_candidates && res.alternative_candidates.length>0 && <div className="small" style={{marginTop:8}}><b>其他候選：</b>{res.alternative_candidates.map((c,i)=> <div key={i} className="muted">· {c.token_name||c.reason} (score {c.score})</div>)}</div>}
      </div>}
    </div>
    <div className="panel"><h3>批次測試（每行一個）</h3>
      <textarea className="code" rows="5" style={{width:'100%'}} placeholder={'一口牛柳粒(急凍)\n鈣思寶無糖豆奶250毫升24支'} value={batch} onChange={e=>setBatch(e.target.value)}></textarea>
      <div style={{marginTop:8}}><button onClick={runBatch} disabled={busy}>批次分類</button></div>
      {batchRes && <table style={{marginTop:12}}><thead><tr><th>輸入</th><th>符號</th><th>Product Key</th><th>信心</th><th>覆核</th></tr></thead>
        <tbody>{batchRes.map((r,i)=> <tr key={i}><td className="small">{r.raw_sku_name}</td><td>{r.product_token_name||'—'}</td><td className="small">{r.product_key_display||'—'}</td><td><Conf c={r.confidence}/></td><td>{r.requires_review? <span className="badge b-amber">是</span>:<span className="badge b-green">否</span>}</td></tr>)}</tbody></table>}
    </div>
  </Page>;
}

// ---------- Review Queue ----------
function Review(){
  const {data,err,loading,reload}=useData('/api/review/queue');
  const [note,setNote]=useState({});
  if(loading) return <Loading/>;
  const confirm=async(sku)=>{ await api.post('/api/review/submit',{sku_id:sku.id, product_token_id:sku.product_token_id, product_key_id:sku.product_key_id, large_group_id:sku.large_group_id, action:'CONFIRM', reason:note[sku.id]||'confirmed via dashboard'}); reload(); };
  return <Page title="覆核佇列" sub="模糊/低信心分類與操作記錄映射需人工確認。只有人工確認才會成為永久規則。">
    <Err m={err}/>
    <div className="panel"><h3>待覆核 SKU（{(data.pending_skus||[]).length}）</h3>
      {data.pending_skus && data.pending_skus.length? <table>
        <thead><tr><th>原始名稱</th><th>建議符號</th><th>建議 Key</th><th>信心</th><th>備註</th><th></th></tr></thead>
        <tbody>{data.pending_skus.map(s=> <tr key={s.id}>
          <td className="sku-name small">{s.raw_sku_name}</td><td className="small">{s.token_name||<Null/>}</td>
          <td className="small">{s.key_display||<span className="muted">未解析</span>}</td><td><Conf c={s.mapping_confidence}/></td>
          <td><input className="small" placeholder="覆核備註" value={note[s.id]||''} onChange={e=>setNote({...note,[s.id]:e.target.value})}/></td>
          <td><button onClick={()=>confirm(s)}>確認</button></td>
        </tr>)}</tbody></table> : <div className="empty small">佇列已清空 🎉</div>}
    </div>
    <div className="panel"><h3>價格/庫存映射覆核（{(data.mapping||[]).length}）</h3>
      {data.mapping && data.mapping.length? <table><thead><tr><th>類型</th><th>來源記錄</th><th>原因</th><th>時間</th></tr></thead>
        <tbody>{data.mapping.map(m=> <tr key={m.id}><td><span className="badge b-blue">{m.record_type}</span></td><td className="small mono">{m.source_record}</td><td className="small">{m.reason}</td><td className="small muted">{fmtTime(m.created_at)}</td></tr>)}</tbody></table>
      : <div className="empty small">無待處理映射</div>}
    </div>
  </Page>;
}

// ---------- Price & Stock ----------
// Shared summary cards (also embedded in 總覽). LOW_STOCK removed; UNKNOWN renamed to 離線.
function PriceStockSummary({onPick}){
  const {data,err,loading}=useData('/api/price-stock/overview');
  if(loading) return <Loading/>;
  if(err) return <Err m={err}/>;
  if(!data) return null;
  const Card = ({status, color, val, lbl}) => onPick
    ? <button className="card card-btn" onClick={()=>onPick(status)}><div className="num" style={{color}}>{val}</div><div className="lbl">{lbl} →</div></button>
    : <div className="card"><div className="num" style={{color}}>{val}</div><div className="lbl">{lbl}</div></div>;
  return <div className="cards">
    <Card status="IN_STOCK" color="var(--green)" val={data.in_stock} lbl="有貨"/>
    <Card status="OUT_OF_STOCK" color="var(--red)" val={data.out_of_stock} lbl="缺貨"/>
    <Card status="LOW_STOCK" color="var(--amber)" val={data.low_stock} lbl="少貨"/>
    <div className="card"><div className="num">{data.unknown_stock}</div><div className="lbl">離線</div></div>
    <div className="card"><div className="num">{data.active_promotions}</div><div className="lbl">進行中推廣</div></div>
    <div className="card"><div className="num">{data.missing_price}</div><div className="lbl">缺價格</div></div>
    <div className="card"><div className="num" style={{color:'var(--amber)'}}>{data.stale_price+data.stale_stock}</div><div className="lbl">過期數據</div></div>
  </div>;
}

// ---------- Import / Export ----------
function ImportExport(){
  const [csv,setCsv]=useState(''); const [result,setResult]=useState(null); const [err,setErr]=useState(null); const [validOnly,setValidOnly]=useState(false);
  const validate=async(commit)=>{ setErr(null); try{
      const rows = csv.split('\n').filter(Boolean).map(line=>{ const c=line.split(','); const o={}; ['external_sku_id','barcode','raw_sku_name','large_group_code','product_token_code','product_key_code','brand','origin','variant','unit_size','unit_measurement','pack_count','pack_unit','sales_channel','active'].forEach((h,i)=>o[h]=(c[i]||'').trim()); return o; }).filter(o=>o.raw_sku_name);
      if(commit){ const r=await api.post('/api/import/commit',{rows, importValidOnly:validOnly}); setResult(r); }
      else { const r=await api.post('/api/import/validate',{rows}); setResult(r); }
    }catch(e){ setErr(e.message); if(e.details) setResult(e.details);} };
  return <Page title="匯入 / 匯出" sub="支援 CSV / XLSX / JSON。匯入前逐行驗證；除非選擇「只匯入有效行」，否則不作部分匯入。">
    <Err m={err}/>
    <div className="panel"><h3>下載範本與備份</h3>
      <div className="toolbar">
        <a href="/api/import/template?format=csv"><button className="ghost">CSV 範本</button></a>
        <a href="/api/import/template?format=xlsx"><button className="ghost">XLSX 範本</button></a>
        <a href="/api/export/skus?format=csv"><button className="ghost">匯出 SKU (CSV)</button></a>
        <a href="/api/export/skus?format=xlsx"><button className="ghost">匯出 SKU (XLSX)</button></a>
        <a href="/api/export/taxonomy"><button className="ghost">匯出分類 (JSON)</button></a>
        <a href="/api/export/backup"><button className="sec">完整資料庫備份</button></a>
      </div>
    </div>
    <div className="panel"><h3>匯入 SKU（貼上 CSV）</h3>
      <textarea className="code" rows="6" style={{width:'100%'}} placeholder="external_sku_id,barcode,raw_sku_name,..." value={csv} onChange={e=>setCsv(e.target.value)}></textarea>
      <div className="toolbar" style={{marginTop:8}}>
        <button className="ghost" onClick={()=>validate(false)}>驗證</button>
        <label className="small"><input type="checkbox" checked={validOnly} onChange={e=>setValidOnly(e.target.checked)}/> 只匯入有效行</label>
        <button onClick={()=>validate(true)}>匯入</button>
      </div>
      {result && <div className="result-box small">
        {result.imported!=null && <div className="ok">已匯入 {result.imported} 行{result.skipped_invalid? `，略過 ${result.skipped_invalid} 無效行`:''}</div>}
        {result.valid && <div>有效：{result.valid.length} 行　無效：{result.invalid.length} 行</div>}
        {result.invalid && result.invalid.length>0 && <div style={{marginTop:6}}><b>無效行：</b>{result.invalid.map((v,i)=> <div key={i} className="err" style={{margin:'4px 0'}}>第 {v.row} 行：{v.errors.join('；')}</div>)}</div>}
        {result.warnings && result.warnings.length>0 && <div style={{marginTop:6}}><b>警告：</b>{result.warnings.map((w,i)=> <div key={i} className="muted">第 {w.row} 行：{w.msg}</div>)}</div>}
      </div>}
    </div>
  </Page>;
}

// ---------- Audit ----------
function Audit(){
  const {data,err,loading}=useData('/api/audit?limit=300');
  if(loading) return <Loading/>;
  return <Page title="審計歷史" sub="分類變更、別名增刪、Product Key 變更、擷取與手動操作全記錄。">
    <Err m={err}/>
    <div className="panel">{data&&data.length? <table>
      <thead><tr><th>時間</th><th>實體</th><th>動作</th><th>覆核者</th><th>原因</th></tr></thead>
      <tbody>{data.map(a=> <tr key={a.id}><td className="small muted">{fmtTime(a.created_at)}</td>
        <td className="small">{a.entity_type}#{a.entity_id}</td><td><span className="badge b-blue">{a.action}</span></td>
        <td className="small">{a.reviewer||'—'}</td><td className="small">{a.reason||'—'}</td></tr>)}</tbody></table>
    : <div className="empty">暫無審計記錄</div>}</div>
  </Page>;
}

// ---------- Settings ----------
function Settings(){
  const {data:skill}=useData('/api/system/skill-status');
  const {data:ver}=useData('/api/system/taxonomy-version');
  return <Page title="設定" sub="重新整理排程、新鮮度門檻、技能整合、信心門檻與備份。">
    <div className="grid2">
      <div className="panel"><h3>技能整合</h3>
        {skill? <dl className="kv">
          <dt>價格技能</dt><dd>{skill.price_skill.name} <span className={"badge "+(skill.price_skill.connected?'b-green':'b-red')}>{skill.price_skill.connected?'已連接':'未連接'}</span></dd>
          <dt>庫存技能</dt><dd>{skill.stock_skill.name} <span className={"badge "+(skill.stock_skill.connected?'b-green':'b-red')}>{skill.stock_skill.connected?'已連接':'not connected'}</span></dd>
          <dt>庫存腳本</dt><dd className="mono small" style={{wordBreak:'break-all'}}>{skill.stock_skill.script}</dd>
        </dl> : <Loading/>}
        <div className="small muted" style={{marginTop:8}}>適配層包裝現有技能；不重新實作收集邏輯。多個候選時於此選擇正確技能。</div>
      </div>
      <div className="panel"><h3>分類與新鮮度</h3>
        <dl className="kv">
          <dt>分類版本</dt><dd>{ver? ver.version : '…'}</dd>
          <dt>自動接受門檻</dt><dd>0.95</dd>
          <dt>覆核下限</dt><dd>0.75</dd>
          <dt>新鮮度門檻</dt><dd>30 小時內為最新</dd>
          <dt>貨幣</dt><dd>HKD</dd>
          <dt>時區</dt><dd>Asia/Hong_Kong</dd>
        </dl>
      </div>
    </div>
    <div className="panel"><h3>重新整理排程（可設定）</h3>
      <div className="small muted">預設每日一次；價格與庫存獨立執行，互不染污。可於「總覽」頁查看。排程時間不寫死，由環境變數 / 未來 cron 設定控制。</div>
      <div className="toolbar" style={{marginTop:8}}><input placeholder="價格 cron（如 0 9 * * *）"/><input placeholder="庫存 cron（如 0 9 * * *）"/><button className="ghost">儲存排程</button></div>
    </div>
    <div className="panel"><h3>備份</h3><a href="/api/export/backup"><button className="sec">下載完整資料庫備份</button></a></div>
  </Page>;
}

// ---------- Categories (分類瀏覽: Main Cat -> Sub Cat -> SKU list) ----------
const STOCK_LABEL = { IN_STOCK:['b-green','有貨'], LOW_STOCK:['b-amber','少貨'], OUT_OF_STOCK:['b-red','缺貨'], PREORDER:['b-blue','預購'],
   DISCONTINUED:['b-grey','已下架'], UNKNOWN:['b-grey','離線'] };
const StockBadge2 = ({s})=>{ const m=STOCK_LABEL[s]||['b-grey',s||'離線']; return <span className={"badge "+m[0]}>{m[1]}</span>; };
const VisBadge = ({v})=> v==null? <span className="muted small">—</span> : v? <span className="badge b-amber">隱藏</span> : <span className="badge b-green">顯示</span>;

// Accordion of the 10 Main Cats; expanding one shows its Sub Cats (approved order).
function Categories(){
  const {data:mains,err,loading,reload}=useData('/api/main-categories');
  const [open,setOpen]=useState(null);        // open Main Cat code
  const [sub,setSub]=useState(null);          // selected Sub Cat code
  const [sort,setSort]=useState('order');
  if(loading&&!mains) return <Loading/>;
  if(sub) return <SubCatTokens code={sub} onBack={()=>setSub(null)} onBackAll={()=>{setSub(null);setOpen(null);}}/>;
  return <Page title="分類瀏覽" sub="Main Cat → Sub Cat → 產品符號 → SKU。點擊 Main Cat 展開其子類，再點子類查看產品符號。">
    <Err m={err}/>
    {err && <button className="ghost" onClick={reload}>重試</button>}
    <div className="cat-accordion" role="list">
      {(mains||[]).map(m=> <MainCatCard key={m.code} m={m} open={open===m.code} sort={sort} setSort={setSort}
        onToggle={()=>setOpen(open===m.code?null:m.code)} onPickSub={(code)=>setSub(code)}/>)}
    </div>
  </Page>;
}

function MainCatCard({m,open,sort,setSort,onToggle,onPickSub}){
  const {data,err,loading}=useData(open?('/api/main-categories/'+m.code+'/sub-categories?sort='+sort):null,[open,sort]);
  return <div className={"cat-card"+(open?' open':'')} role="listitem">
    <button className="cat-head" aria-expanded={open} onClick={onToggle}>
      <span className="cat-name">{m.name}</span>
      <span className="cat-meta small muted">
        {m.subcat_count} Sub Cats · {m.sku_count} SKUs
        {m.in_stock_count? ` · 有貨 ${m.in_stock_count}`:''}
        {m.out_of_stock_count? ` · 缺貨 ${m.out_of_stock_count}`:''}
        {m.review_count? ` · 待覆核 ${m.review_count}`:''}
      </span>
      <span className="cat-caret" aria-hidden="true">{open?'▾':'▸'}</span>
    </button>
    {open && <div className="cat-body">
      <div className="toolbar">
        <label className="small muted">排序：</label>
        <select value={sort} onChange={e=>setSort(e.target.value)} aria-label="Sub Cat 排序">
          <option value="order">核准順序</option>
          <option value="count_desc">SKU 數（多→少）</option>
          <option value="count_asc">SKU 數（少→多）</option>
          <option value="name">名稱 A–Z</option>
        </select>
      </div>
      {loading? <Loading/> : err? <Err m={err}/> :
        (data && data.sub_cats && data.sub_cats.length? <div className="sub-list">
          {data.sub_cats.map(s=> <button key={s.code} className="sub-row" onClick={()=>onPickSub(s.code)}>
            <span className="sub-name">{s.name}</span>
            <span className="small muted">
              {s.sku_count} SKUs
              {s.missing_price_count? ` · 缺價 ${s.missing_price_count}`:''}
              {s.missing_stock_count? ` · 缺庫存 ${s.missing_stock_count}`:''}
              {s.review_count? ` · 待覆核 ${s.review_count}`:''}
            </span>
          </button>)}
        </div> : <div className="empty">No Sub Cat configured（分類設定問題）</div>)}
    </div>}
  </div>;
}

// Product Token list for one Sub Cat: drill-down level between Sub Cat and SKUs.
function SubCatTokens({code,onBack,onBackAll}){
  const {data,err,loading}=useData('/api/sub-categories/'+code+'/tokens',[code]);
  const [pick,setPick]=useState(null);   // {id,name} | {all:true}
  if(pick) return <SubCatSkus code={code} tokenId={pick.all?null:pick.id} tokenName={pick.all?null:pick.name} onBack={()=>setPick(null)} onBackAll={onBackAll}/>;
  return <Page title="分類瀏覽" sub="">
    <nav className="crumb small" aria-label="breadcrumb">
      <button className="linklike" onClick={onBackAll}>分類瀏覽</button>
      {data&&<> <span className="muted">›</span> <button className="linklike" onClick={onBack}>{data.main_cat.name}</button>
        <span className="muted">›</span> <b>{data.sub_cat.name}</b></>}
    </nav>
    {loading? <Loading/> : err? <div><Err m={err}/></div> :
      !data||!data.tokens||!data.tokens.length? <div className="empty">此 Sub Cat 暫時沒有產品符號</div> :
      <div className="panel">
        <div className="toolbar" style={{marginBottom:10}}>
          <span className="small muted">{data.tokens.length} 個產品符號 · 點擊查看其 SKU，或</span>
          <button className="ghost" onClick={()=>setPick({all:true})}>查看所有 SKU →</button>
        </div>
        <div className="sub-list">
          {data.tokens.map(t=> <button key={t.id} className="sub-row" onClick={()=>setPick({id:t.id,name:t.name})}>
            <span className="sub-name">{t.name}</span>
            <span className="small muted">
              {t.sku_count} SKUs
              {t.in_stock_count? ` · 有貨 ${t.in_stock_count}`:''}
              {t.low_stock_count? ` · 少貨 ${t.low_stock_count}`:''}
              {t.out_of_stock_count? ` · 缺貨 ${t.out_of_stock_count}`:''}
            </span>
          </button>)}
        </div>
      </div>}
  </Page>;
}

// SKU list for one Sub Cat: server-side pagination + filters + search.
function SubCatSkus({code,tokenId,tokenName,onBack,onBackAll}){
  const [page,setPage]=useState(1);
  const [pageSize]=useState(30);
  const [f,setF]=useState({brand:'',product_token:'',visibility:'',stock_status:'',review_status:'',missing_price:'',missing_stock:'',keyword:'',sku_id:''});
  const qs = new URLSearchParams({page:String(page),page_size:String(pageSize)});
  if(tokenId) qs.set('token_id',String(tokenId));
  Object.entries(f).forEach(([k,v])=>{ if(v) qs.set(k,v); });
  const {data,err,loading}=useData('/api/sub-categories/'+code+'/skus?'+qs.toString(),[code,tokenId,page,JSON.stringify(f)]);
  const {data:brands}=useData('/api/sub-categories/'+code+'/brands',[code]);
  const set=(k,v)=>{ setPage(1); setF(prev=>({...prev,[k]:v})); };
  const reset=()=>{ setPage(1); setF({brand:'',product_token:'',visibility:'',stock_status:'',review_status:'',missing_price:'',missing_stock:'',keyword:'',sku_id:''}); };
  const pg = data&&data.pagination;
  return <Page title="分類瀏覽" sub="">
    <nav className="crumb small" aria-label="breadcrumb">
      <button className="linklike" onClick={onBackAll}>分類瀏覽</button>
      {data&&<> <span className="muted">›</span> <button className="linklike" onClick={onBackAll}>{data.main_cat.name}</button>
        <span className="muted">›</span> <button className="linklike" onClick={onBack}>{data.sub_cat.name}</button>
        {tokenName&&<> <span className="muted">›</span> <b>{tokenName}</b></>}
        {!tokenName&&<> <span className="muted">›</span> <b>所有 SKU</b></>}</>}
    </nav>
    <div className="panel">
      {tokenName&&<div className="toolbar" style={{marginBottom:8}}>
        <span className="tag">產品符號：{tokenName}</span>
        <button className="linklike small" onClick={onBack}>← 返回產品符號</button>
      </div>}
      <div className="toolbar filters">
        <input placeholder="關鍵字（名稱/SKU/品牌/規格）" value={f.keyword} onChange={e=>set('keyword',e.target.value)} aria-label="關鍵字"/>
        <input placeholder="SKU ID" value={f.sku_id} onChange={e=>set('sku_id',e.target.value)} aria-label="SKU ID"/>
        <select value={f.brand} onChange={e=>set('brand',e.target.value)} aria-label="品牌">
          <option value="">全部品牌</option>
          {(brands||[]).map(b=> <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={f.visibility} onChange={e=>set('visibility',e.target.value)} aria-label="顯示狀態">
          <option value="">顯示/隱藏</option><option value="visible">顯示</option><option value="invisible">隱藏</option>
        </select>
        <select value={f.stock_status} onChange={e=>set('stock_status',e.target.value)} aria-label="庫存狀態">
          <option value="">全部庫存</option><option value="IN_STOCK">有貨</option><option value="LOW_STOCK">少貨</option>
          <option value="OUT_OF_STOCK">缺貨</option><option value="PREORDER">預購</option><option value="UNKNOWN">離線</option>
        </select>
        <select value={f.review_status} onChange={e=>set('review_status',e.target.value)} aria-label="覆核狀態">
          <option value="">全部覆核</option><option value="PENDING">待覆核</option><option value="CONFIRMED">已確認</option><option value="NONE">無</option>
        </select>
        <label className="small"><input type="checkbox" checked={!!f.missing_price} onChange={e=>set('missing_price',e.target.checked?'1':'')}/> 缺價</label>
        <label className="small"><input type="checkbox" checked={!!f.missing_stock} onChange={e=>set('missing_stock',e.target.checked?'1':'')}/> 缺庫存</label>
        <button className="ghost" onClick={reset}>重設</button>
      </div>
      {loading? <Loading/> : err? <div><Err m={err}/></div> :
        !data || !data.rows.length? <div className="empty">{Object.values(f).some(v=>v)?'沒有符合條件的 SKU':'此 Sub Cat 暫時沒有 SKU'} {Object.values(f).some(v=>v) && <button className="ghost" onClick={reset}>清除篩選</button>}</div> :
        <>
        <div className="table-wrap"><table className="sku-table">
          <thead><tr>
            <th>SKU ID</th><th>品牌</th><th>產品名稱</th><th>規格</th><th>Product Token</th>
            <th>折後價</th><th>Key 排名</th><th>顯示狀態</th><th>庫存狀態</th><th>價格更新</th><th>庫存更新</th><th>覆核</th>
          </tr></thead>
          <tbody>{data.rows.map(s=> <React.Fragment key={s.id}>
            <CatSkuRow s={s}/>
          </React.Fragment>)}</tbody>
        </table></div>
        <Pagination pg={pg} onPage={setPage}/>
        </>}
    </div>
  </Page>;
}

function CatSkuRow({s}){
  const [open,setOpen]=useState(false);
  return <>
    <tr onClick={()=>setOpen(!open)} style={{cursor:'pointer',background:open?'#f0f6ff':'inherit'}}
        tabIndex={0} onKeyDown={e=>{if(e.key==='Enter')setOpen(!open);}} aria-expanded={open}>
      <td className="mono small"><ChanBadge sku={s.sku_id}/> {s.sku_id}</td>
      <td className="small">{s.brand||<Null/>}</td>
      <td className="sku-name small" title={s.product_name}>{s.product_name}</td>
      <td className="small">{s.packing_spec||'—'}</td>
      <td className="small">{s.product_token||<Null/>}</td>
      <td>{fmt$(s.discount_price)}</td>
      <td><RankBadge s={s}/></td>
      <td><VisBadge v={s.is_invisible}/></td>
      <td><StockBadge2 s={s.stock_status}/></td>
      <td className="small muted">{fmtTime(s.price_updated_at)}</td>
      <td className="small muted">{fmtTime(s.stock_updated_at)}</td>
      <td><ReviewBadge s={s.review_status}/></td>
    </tr>
    {open && <SkuDetail sku={{id:s.id, external_sku_id:s.sku_id, raw_sku_name:s.product_name}}/>}
  </>;
}

function Pagination({pg,onPage}){
  if(!pg) return null;
  const {page,total_pages,total_rows,page_size}=pg;
  const start=(page-1)*page_size+1, end=Math.min(total_rows,page*page_size);
  const pages=[]; for(let i=1;i<=total_pages;i++) pages.push(i);
  const win = pages.filter(p=> p===1||p===total_pages||Math.abs(p-page)<=2);
  const seq=[]; let last=0; for(const p of win){ if(p-last>1) seq.push('…'); seq.push(p); last=p; }
  return <div className="pagination" role="navigation" aria-label="分頁">
    <span className="small muted">顯示 {total_rows? start:0}–{end}，共 {total_rows} SKUs · 第 {page}/{total_pages} 頁</span>
    <span className="pg-btns">
      <button className="ghost" disabled={page<=1} onClick={()=>onPage(page-1)} aria-label="上一頁">‹ 上一頁</button>
      {seq.map((p,i)=> p==='…'? <span key={'e'+i} className="muted">…</span> :
        <button key={p} className={"ghost"+(p===page?' active-pg':'')} onClick={()=>onPage(p)} aria-current={p===page?'page':undefined}>{p}</button>)}
      <button className="ghost" disabled={page>=total_pages} onClick={()=>onPage(page+1)} aria-label="下一頁">下一頁 ›</button>
    </span>
  </div>;
}

// ---------- router ----------
function App(){
  const [route,setRoute]=useState(location.hash||'#/');
  useEffect(()=>{ const h=()=>setRoute(location.hash||'#/'); window.addEventListener('hashchange',h); return ()=>window.removeEventListener('hashchange',h); },[]);
  const pages = { '#/':Overview, '#/categories':Categories, '#/groups':Groups, '#/tokens':Tokens, '#/keys':Keys, '#/skus':Skus, '#/tester':Tester, '#/review':Review, '#/import-export':ImportExport, '#/audit':Audit, '#/settings':Settings };
  const C = pages[route]||Overview;
  return <Layout route={route}><C/></Layout>;
}
ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
