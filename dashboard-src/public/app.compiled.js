const {
  useState,
  useEffect,
  useMemo
} = React;

// ---------- tiny helpers ----------
const api = {
  async get(u) {
    const r = await fetch(u);
    if (!r.ok) throw new Error((await r.json().catch(() => ({
      error: r.statusText
    }))).error || r.statusText);
    return r.json();
  },
  async send(u, method, body) {
    const r = await fetch(u, {
      method,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body || {})
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  },
  post(u, b) {
    return this.send(u, 'POST', b);
  },
  patch(u, b) {
    return this.send(u, 'PATCH', b);
  }
};
const fmt$ = v => v == null ? '—' : '$' + Number(v).toFixed(1);
const fmtTime = iso => {
  if (!iso) return '—';
  const d = new Date(iso);
  const h = (Date.now() - d.getTime()) / 36e5;
  if (h < 1) return Math.max(1, Math.round(h * 60)) + ' 分鐘前';
  if (h < 48) return Math.round(h) + ' 小時前';
  return d.toLocaleDateString('zh-HK');
};
const Fresh = ({
  f
}) => f === 'FRESH' ? /*#__PURE__*/React.createElement("span", {
  className: "badge b-green"
}, "最新") : f === 'STALE' ? /*#__PURE__*/React.createElement("span", {
  className: "badge b-amber"
}, "過期") : /*#__PURE__*/React.createElement("span", {
  className: "badge b-grey"
}, "未有數據");
const Conf = ({
  c
}) => c == null ? null : /*#__PURE__*/React.createElement("span", {
  className: "badge " + (c >= 0.95 ? 'b-green' : c >= 0.75 ? 'b-amber' : 'b-red')
}, (c * 100).toFixed(0), "%");
const ReviewBadge = ({
  s
}) => s === 'PENDING' ? /*#__PURE__*/React.createElement("span", {
  className: "badge b-amber"
}, "待覆核") : s === 'CONFIRMED' ? /*#__PURE__*/React.createElement("span", {
  className: "badge b-green"
}, "已確認") : /*#__PURE__*/React.createElement("span", {
  className: "badge b-grey"
}, s || '—');
const Null = () => /*#__PURE__*/React.createElement("span", {
  className: "muted"
}, "待確認");
function useData(url, deps) {
  const [data, setData] = useState(null),
    [err, setErr] = useState(null),
    [loading, setLoading] = useState(!!url);
  const load = () => {
    if (!url) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api.get(url).then(d => {
      setData(d);
      setErr(null);
    }).catch(e => setErr(e.message)).finally(() => setLoading(false));
  };
  useEffect(load, deps || [url]);
  return {
    data,
    err,
    loading,
    reload: load
  };
}
function Copy({
  text
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: "copy",
    title: "複製",
    onClick: () => navigator.clipboard.writeText(text)
  }, "⧉");
}

// ---------- layout ----------
const NAV = [['#/', '總覽'], ['#/categories', '分類瀏覽'], ['#/groups', 'Main Cat'], ['#/tokens', '產品符號庫'], ['#/keys', 'Product Key 庫'], ['#/skus', 'SKU 記錄'], ['#/tester', '分類測試器'], ['#/review', '覆核佇列'], ['#/import-export', '匯入/匯出'], ['#/audit', '審計歷史'], ['#/settings', '設定']];
function Layout({
  children,
  route
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "layout"
  }, /*#__PURE__*/React.createElement("div", {
    className: "side"
  }, /*#__PURE__*/React.createElement("h1", null, "產品符號庫"), NAV.map(([h, l]) => /*#__PURE__*/React.createElement("a", {
    key: h,
    href: h,
    className: route === h ? 'active' : ''
  }, l))), /*#__PURE__*/React.createElement("div", {
    className: "main"
  }, children));
}
function Page({
  title,
  sub,
  subRight,
  children
}) {
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      flexWrap: 'wrap',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h2", {
    className: "page-title"
  }, title), /*#__PURE__*/React.createElement("div", {
    className: "page-sub"
  }, sub)), subRight && /*#__PURE__*/React.createElement("div", {
    className: "small muted",
    style: {
      textAlign: 'right'
    }
  }, subRight)), children);
}
const Loading = () => /*#__PURE__*/React.createElement("div", {
  className: "empty"
}, "載入中…");
const Err = ({
  m
}) => m ? /*#__PURE__*/React.createElement("div", {
  className: "err"
}, "錯誤：", m) : null;

// ---------- Generic tree drill (總覽 press-in cards) ----------
// sel -> /api/tree-drill/:fam/:a/...  Main Cat -> Sub Cat -> 產品符號 -> SKU.
function DrillRows({
  url,
  renderRow,
  deps
}) {
  const {
    data,
    err,
    loading
  } = useData(url, deps || [url]);
  if (!url) return null;
  if (loading) return /*#__PURE__*/React.createElement("div", {
    className: "empty small"
  }, "載入中…");
  if (err) return /*#__PURE__*/React.createElement(Err, {
    m: err
  });
  if (!data || !data.length) return /*#__PURE__*/React.createElement("div", {
    className: "empty small"
  }, "無資料");
  return /*#__PURE__*/React.createElement("div", {
    className: "drill-list"
  }, data.map(renderRow));
}
function DrillRow({
  name,
  cnt,
  open,
  onToggle,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "drill-row-wrap"
  }, /*#__PURE__*/React.createElement("button", {
    className: "sub-row drill-row",
    onClick: onToggle
  }, /*#__PURE__*/React.createElement("span", {
    className: "sub-name"
  }, name), /*#__PURE__*/React.createElement("span", {
    className: "small muted"
  }, cnt, " SKUs"), /*#__PURE__*/React.createElement("span", {
    className: "cat-caret"
  }, open ? '▾' : '▸')), open && /*#__PURE__*/React.createElement("div", {
    className: "drill-children"
  }, children));
}
// sel = {fam:'stock',status} | {fam:'vis',state} | {fam:'cheap',bucket}
function TreeDrillPanel({
  sel,
  title,
  onClose
}) {
  const [openMain, setOpenMain] = useState(null);
  const [openSub, setOpenSub] = useState(null);
  const [openTok, setOpenTok] = useState(null);
  const base = '/api/tree-drill/' + sel.fam + '/' + (sel.status || sel.state || sel.bucket);
  useEffect(() => {
    setOpenMain(null);
    setOpenSub(null);
    setOpenTok(null);
  }, [base]);
  return /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("h3", null, title, " 明細（Main Cat → Sub Cat → 產品符號 → SKU）"), /*#__PURE__*/React.createElement("button", {
    className: "ghost small",
    onClick: onClose
  }, "收合 ✕")), /*#__PURE__*/React.createElement(DrillRows, {
    url: base + '/main',
    deps: [base],
    renderRow: m => /*#__PURE__*/React.createElement(DrillRow, {
      key: m.code,
      name: m.name,
      cnt: m.cnt,
      open: openMain === m.code,
      onToggle: () => {
        setOpenMain(openMain === m.code ? null : m.code);
        setOpenSub(null);
        setOpenTok(null);
      }
    }, openMain === m.code && /*#__PURE__*/React.createElement(DrillRows, {
      url: base + '/main/' + m.code,
      deps: [base, m.code],
      renderRow: s => /*#__PURE__*/React.createElement(DrillRow, {
        key: s.code,
        name: s.name,
        cnt: s.cnt,
        open: openSub === s.code,
        onToggle: () => {
          setOpenSub(openSub === s.code ? null : s.code);
          setOpenTok(null);
        }
      }, openSub === s.code && /*#__PURE__*/React.createElement(DrillRows, {
        url: base + '/sub/' + s.code,
        deps: [base, s.code],
        renderRow: t => /*#__PURE__*/React.createElement(DrillRow, {
          key: t.id,
          name: t.name,
          cnt: t.cnt,
          open: openTok === t.id,
          onToggle: () => setOpenTok(openTok === t.id ? null : t.id)
        }, openTok === t.id && /*#__PURE__*/React.createElement(TreeSkus, {
          base: base,
          tokenId: t.id
        }))
      }))
    }))
  }));
}
function TreeSkus({
  base,
  tokenId
}) {
  const {
    data,
    err,
    loading
  } = useData(base + '/token/' + tokenId, [base, tokenId]);
  if (loading) return /*#__PURE__*/React.createElement("div", {
    className: "empty small"
  }, "載入中…");
  if (err) return /*#__PURE__*/React.createElement(Err, {
    m: err
  });
  if (!data || !data.length) return /*#__PURE__*/React.createElement("div", {
    className: "empty small"
  }, "無 SKU");
  return /*#__PURE__*/React.createElement("div", {
    className: "table-wrap"
  }, /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "來源"), /*#__PURE__*/React.createElement("th", null, "SKU"), /*#__PURE__*/React.createElement("th", null, "產品名稱"), /*#__PURE__*/React.createElement("th", null, "Product Key"), /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'right'
    }
  }, "售價"), /*#__PURE__*/React.createElement("th", null, "庫存"), /*#__PURE__*/React.createElement("th", null, "Key 排名"))), /*#__PURE__*/React.createElement("tbody", null, data.map(s => /*#__PURE__*/React.createElement("tr", {
    key: s.sku_id
  }, /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(ChanBadge, {
    sku: s.sku_id
  })), /*#__PURE__*/React.createElement("td", {
    className: "mono small"
  }, s.sku_id), /*#__PURE__*/React.createElement("td", {
    className: "small"
  }, s.product_name), /*#__PURE__*/React.createElement("td", {
    className: "small muted"
  }, s.display_key || '—'), /*#__PURE__*/React.createElement("td", {
    style: {
      textAlign: 'right'
    }
  }, fmt$(s.discount_price)), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(StockBadge2, {
    s: s.stock_status
  })), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(RankBadge, {
    s: s
  })))))));
}
// H = HKTVmall 自家 (sku starts with H); M = merchant / 非 HKTVmall.
function ChanBadge({
  sku
}) {
  const isH = /^H/.test(String(sku || ''));
  return /*#__PURE__*/React.createElement("span", {
    className: "chan-badge " + (isH ? "chan-h" : "chan-m"),
    title: isH ? "HKTVmall 自家產品" : "非 HKTVmall（商家）產品"
  }, isH ? 'H' : 'M');
}

// Per-Key cheapest ranking badge. cheapest_rank 1 = 最平 (normal logic).
// is_real_top1 = the buyable top-1 (cheapest IN-STOCK). When the cheapest is OOS,
// the real top-1 falls to the next in-stock SKU (real_top1_offset = how many cheaper are OOS above it).
function RankBadge({
  s
}) {
  if (!s || s.cheapest_rank == null) return /*#__PURE__*/React.createElement("span", {
    className: "muted small"
  }, "—");
  const size = s.cheapest_group_size;
  const cheap = s.is_cheapest ? /*#__PURE__*/React.createElement("span", {
    className: "badge b-blue",
    title: `Key 內最平（共 ${size} 個）`
  }, "最平 #1/", size) : /*#__PURE__*/React.createElement("span", {
    className: "badge b-grey",
    title: `Key 內第 ${s.cheapest_rank} 平（共 ${size} 個）`
  }, "#", s.cheapest_rank, "/", size);
  let real = null;
  if (s.is_real_top1) {
    real = s.real_top1_offset > 0 ? /*#__PURE__*/React.createElement("span", {
      className: "badge b-amber",
      title: `最平 ${s.real_top1_offset} 個缺貨，呢個先係而家有貨最平`
    }, "有貨Top1 ↑", s.real_top1_offset) : /*#__PURE__*/React.createElement("span", {
      className: "badge b-green",
      title: "呢個就係 Key 內有貨最平"
    }, "有貨Top1");
  }
  return /*#__PURE__*/React.createElement("span", {
    style: {
      whiteSpace: 'nowrap'
    }
  }, cheap, real && /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 4
    }
  }, real));
}

// 總覽 panel: how many Product Keys' "cheapest" (rank-1) SKU is ALSO the real top-1 (in stock).
// Cards are pressable — they drill into the representative SKU per key.
function CheapestRealPanel() {
  const {
    data,
    err,
    loading
  } = useData('/api/cheapest-real-overview');
  const [drill, setDrill] = useState(null); // 'is-real' | 'not-real' | 'substituted' | null
  if (loading) return /*#__PURE__*/React.createElement(Loading, null);
  if (err) return /*#__PURE__*/React.createElement(Err, {
    m: err
  });
  if (!data) return null;
  const pct = data.cheapest_total ? Math.round(data.cheapest_is_real / data.cheapest_total * 100) : 0;
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "cards"
  }, /*#__PURE__*/React.createElement("button", {
    className: "card card-btn",
    onClick: () => setDrill(drill === 'is-real' ? null : 'is-real')
  }, /*#__PURE__*/React.createElement("div", {
    className: "num",
    style: {
      color: 'var(--green,#16a34a)'
    }
  }, data.cheapest_is_real), /*#__PURE__*/React.createElement("div", {
    className: "lbl"
  }, "最平＝有貨Top1（最平有貨）→")), /*#__PURE__*/React.createElement("button", {
    className: "card card-btn",
    onClick: () => setDrill(drill === 'not-real' ? null : 'not-real')
  }, /*#__PURE__*/React.createElement("div", {
    className: "num",
    style: {
      color: 'var(--amber,#d97706)'
    }
  }, data.cheapest_not_real), /*#__PURE__*/React.createElement("div", {
    className: "lbl"
  }, "最平缺貨（非有貨Top1）→")), /*#__PURE__*/React.createElement("button", {
    className: "card card-btn",
    onClick: () => setDrill(drill === 'substituted' ? null : 'substituted')
  }, /*#__PURE__*/React.createElement("div", {
    className: "num"
  }, data.real_substituted), /*#__PURE__*/React.createElement("div", {
    className: "lbl"
  }, "有貨Top1係次平/更後 →")), /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "num"
  }, pct, "%"), /*#__PURE__*/React.createElement("div", {
    className: "lbl"
  }, "最平有貨比例（共 ", data.cheapest_total, " Keys）"))), drill && /*#__PURE__*/React.createElement(TreeDrillPanel, {
    sel: {
      fam: 'cheap',
      bucket: drill
    },
    key: 'cheap' + drill,
    title: CR_DRILL_TITLE[drill] || drill,
    onClose: () => setDrill(null)
  }));
}
const CR_DRILL_TITLE = {
  'is-real': '最平＝有貨Top1（最平嗰個有貨）',
  'not-real': '最平缺貨（非有貨Top1）',
  'substituted': '有貨Top1係次平/更後'
};
function Overview() {
  const {
    data,
    err,
    loading
  } = useData('/api/overview');
  const {
    data: cat
  } = useData('/api/categories/overview');
  const [stockDrill, setStockDrill] = useState(null); // 'IN_STOCK' | 'OUT_OF_STOCK' | null
  const [visDrill, setVisDrill] = useState(null); // 'visible' | 'invisible' | null
  const [statDrill, setStatDrill] = useState(null); // top-card drill key | null
  if (loading) return /*#__PURE__*/React.createElement(Loading, null);
  const cards = [['Main Cat', data.large_groups, 'large-groups']];
  const freshness = /*#__PURE__*/React.createElement(React.Fragment, null, "最後線上狀態更新：", fmtTime(data.last_visibility_refresh), /*#__PURE__*/React.createElement("br", null), "最後價格更新：", fmtTime(data.last_price_refresh), /*#__PURE__*/React.createElement("br", null), "最後庫存更新：", fmtTime(data.last_stock_refresh));
  return /*#__PURE__*/React.createElement(Page, {
    title: "總覽",
    sub: "產品庫整體狀況",
    subRight: freshness
  }, /*#__PURE__*/React.createElement(Err, {
    m: err
  }), /*#__PURE__*/React.createElement("div", {
    className: "cards"
  }, cards.map(([l, v, k]) => /*#__PURE__*/React.createElement("button", {
    className: "card card-btn",
    key: l,
    onClick: () => setStatDrill(statDrill === k ? null : k)
  }, /*#__PURE__*/React.createElement("div", {
    className: "num"
  }, v ?? 0), /*#__PURE__*/React.createElement("div", {
    className: "lbl"
  }, l, " →"))), /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "num"
  }, data.skus ?? 0), /*#__PURE__*/React.createElement("div", {
    className: "lbl"
  }, "SKUs"))), statDrill && /*#__PURE__*/React.createElement(StatDrill, {
    kind: statDrill,
    key: statDrill,
    onClose: () => setStatDrill(null)
  }), /*#__PURE__*/React.createElement("div", {
    className: "panel"
  }, /*#__PURE__*/React.createElement("h3", null, "價格與庫存總覽"), /*#__PURE__*/React.createElement("div", {
    className: "small muted",
    style: {
      marginBottom: 8
    }
  }, "SKU 層級的價格與庫存觀測。摘要按 Key / 符號 / Main Cat 計算，觀測永在 SKU 層。"), /*#__PURE__*/React.createElement(PriceStockSummary, {
    onPick: setStockDrill
  })), stockDrill && /*#__PURE__*/React.createElement(TreeDrillPanel, {
    sel: {
      fam: 'stock',
      status: stockDrill
    },
    key: 'stock' + stockDrill,
    title: {
      IN_STOCK: '有貨',
      LOW_STOCK: '少貨',
      OUT_OF_STOCK: '缺貨',
      OFFLINE: '離線'
    }[stockDrill] || stockDrill,
    onClose: () => setStockDrill(null)
  }), /*#__PURE__*/React.createElement("div", {
    className: "panel"
  }, /*#__PURE__*/React.createElement("h3", null, "可見 / 隱藏 總覽"), /*#__PURE__*/React.createElement("div", {
    className: "small muted",
    style: {
      marginBottom: 8
    }
  }, "根據 Tableau is_invisible。按下可見 / 隱藏 查看產品明細。"), /*#__PURE__*/React.createElement("div", {
    className: "cards"
  }, /*#__PURE__*/React.createElement("button", {
    className: "card card-btn",
    onClick: () => setVisDrill(visDrill === 'visible' ? null : 'visible')
  }, /*#__PURE__*/React.createElement("div", {
    className: "num",
    style: {
      color: 'var(--green,#16a34a)'
    }
  }, data.online_count ?? 0), /*#__PURE__*/React.createElement("div", {
    className: "lbl"
  }, "可見（線上）→")), /*#__PURE__*/React.createElement("button", {
    className: "card card-btn",
    onClick: () => setVisDrill(visDrill === 'invisible' ? null : 'invisible')
  }, /*#__PURE__*/React.createElement("div", {
    className: "num",
    style: {
      color: 'var(--muted,#6b7280)'
    }
  }, data.offline_count ?? 0), /*#__PURE__*/React.createElement("div", {
    className: "lbl"
  }, "隱藏（離線）→")))), visDrill && /*#__PURE__*/React.createElement(TreeDrillPanel, {
    sel: {
      fam: 'vis',
      state: visDrill
    },
    key: 'vis' + visDrill,
    title: visDrill === 'invisible' ? '隱藏（離線）' : '可見（線上）',
    onClose: () => setVisDrill(null)
  }), /*#__PURE__*/React.createElement("div", {
    className: "panel"
  }, /*#__PURE__*/React.createElement("h3", null, "最平 / 有貨 Top1 總覽"), /*#__PURE__*/React.createElement("div", {
    className: "small muted",
    style: {
      marginBottom: 8
    }
  }, "每個 Product Key 的「最平」第 1 名，而家有幾多個同時係「有貨 Top1」（最平嗰個有貨）。最平缺貨時，有貨 Top1 會落到次平、第三平…"), /*#__PURE__*/React.createElement(CheapestRealPanel, null)), cat && /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("h3", null, "分類概況（Main Cat / Sub Cat）"), /*#__PURE__*/React.createElement("div", {
    className: "cards",
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "num"
  }, cat.skus_missing_subcat), /*#__PURE__*/React.createElement("div", {
    className: "lbl"
  }, "SKUs 缺 Sub Cat")), /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "num"
  }, cat.subcat_conflicts), /*#__PURE__*/React.createElement("div", {
    className: "lbl"
  }, "Main/Sub 衝突")), /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "num"
  }, cat.largest_subcat ? cat.largest_subcat.cnt : 0), /*#__PURE__*/React.createElement("div", {
    className: "lbl"
  }, "最大 Sub Cat", cat.largest_subcat ? '：' + cat.largest_subcat.name : '')), /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "num"
  }, cat.subcats_with_missing_price), /*#__PURE__*/React.createElement("div", {
    className: "lbl"
  }, "缺價 Sub Cats")), /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "num"
  }, cat.subcats_with_missing_stock), /*#__PURE__*/React.createElement("div", {
    className: "lbl"
  }, "缺庫存 Sub Cats")), /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "num"
  }, cat.subcats_requiring_review), /*#__PURE__*/React.createElement("div", {
    className: "lbl"
  }, "待覆核 Sub Cats"))), /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Main Cat"), /*#__PURE__*/React.createElement("th", null, "Sub Cat"), /*#__PURE__*/React.createElement("th", {
    style: {
      textAlign: 'right'
    }
  }, "SKU 數"))), /*#__PURE__*/React.createElement("tbody", null, (cat.sku_count_by_cat || []).map((r, i) => /*#__PURE__*/React.createElement("tr", {
    key: i
  }, /*#__PURE__*/React.createElement("td", {
    className: "small"
  }, r.main_cat), /*#__PURE__*/React.createElement("td", {
    className: "small"
  }, r.sub_cat), /*#__PURE__*/React.createElement("td", {
    style: {
      textAlign: 'right'
    }
  }, r.cnt)))))));
}

// Stat drill panel: shows what each top-card count includes.
const STAT_DRILL_META = {
  'large-groups': {
    title: 'Main Cat',
    cols: [['group_code', '代碼'], ['name_zh', '名稱'], ['token_count', '符號數'], ['key_count', 'Key 數'], ['sku_count', 'SKU 數']]
  },
  'tokens': {
    title: '產品符號',
    cols: [['token_code', '符號代碼'], ['name', '名稱'], ['group_name', 'Main Cat'], ['key_count', 'Key 數'], ['sku_count', 'SKU 數']]
  },
  'keys': {
    title: 'Product Keys',
    cols: [['product_key_code', 'Key 代碼'], ['display', '內容'], ['token_name', '產品符號'], ['sku_count', 'SKU 數']]
  },
  'skus': {
    title: 'SKUs',
    cols: [['external_sku_id', 'SKU ID'], ['raw_sku_name', '產品名稱'], ['group_name', 'Main Cat'], ['token_name', '產品符號'], ['review_status', '覆核']]
  },
  'auto-matched': {
    title: '自動匹配 SKU',
    cols: [['external_sku_id', 'SKU ID'], ['raw_sku_name', '產品名稱'], ['group_name', 'Main Cat'], ['token_name', '產品符號'], ['mapping_status', '匹配']]
  },
  'review': {
    title: '待覆核 SKU',
    cols: [['external_sku_id', 'SKU ID'], ['raw_sku_name', '產品名稱'], ['group_name', 'Main Cat'], ['token_name', '產品符號'], ['mapping_confidence', '信心']]
  },
  'tokens-no-keys': {
    title: '無 Key 的符號',
    cols: [['token_code', '符號代碼'], ['name', '名稱'], ['group_name', 'Main Cat'], ['sku_count', 'SKU 數']]
  },
  'keys-no-skus': {
    title: '無 SKU 的 Key',
    cols: [['product_key_code', 'Key 代碼'], ['display', '內容'], ['token_name', '產品符號']]
  },
  'missing-price': {
    title: '缺價格 SKU',
    cols: [['external_sku_id', 'SKU ID'], ['raw_sku_name', '產品名稱'], ['group_name', 'Main Cat'], ['token_name', '產品符號']]
  }
};
function StatDrill({
  kind,
  onClose
}) {
  const meta = STAT_DRILL_META[kind] || {
    title: kind,
    cols: []
  };
  const [page, setPage] = useState(1);
  const pageSize = 50;
  useEffect(() => setPage(1), [kind]);
  const {
    data,
    err,
    loading
  } = useData('/api/stat-drill/' + kind + '?limit=' + pageSize + '&offset=' + (page - 1) * pageSize, [kind, page]);
  const total = data ? data.total : 0;
  const pg = data ? {
    page,
    page_size: pageSize,
    total_rows: total,
    total_pages: Math.max(1, Math.ceil(total / pageSize))
  } : null;
  return /*#__PURE__*/React.createElement("div", {
    className: "panel",
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("h3", null, meta.title, " 明細"), /*#__PURE__*/React.createElement("button", {
    className: "ghost small",
    onClick: onClose
  }, "收合 ✕")), loading ? /*#__PURE__*/React.createElement(Loading, null) : err ? /*#__PURE__*/React.createElement(Err, {
    m: err
  }) : !data || !data.rows || !data.rows.length ? /*#__PURE__*/React.createElement("div", {
    className: "empty small"
  }, "無資料") : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "table-wrap"
  }, /*#__PURE__*/React.createElement("table", {
    className: "sku-table"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, meta.cols.map(([k, l]) => /*#__PURE__*/React.createElement("th", {
    key: k
  }, l)))), /*#__PURE__*/React.createElement("tbody", null, data.rows.map((r, i) => /*#__PURE__*/React.createElement("tr", {
    key: i
  }, meta.cols.map(([k]) => /*#__PURE__*/React.createElement("td", {
    key: k,
    className: "small"
  }, r[k] == null ? '—' : String(r[k])))))))), pg && pg.total_pages > 1 && /*#__PURE__*/React.createElement(Pagination, {
    pg: pg,
    onPage: setPage
  })));
}

// ---------- Large Groups ----------
function Groups() {
  const {
    data,
    err,
    loading,
    reload
  } = useData('/api/large-groups');
  const [edit, setEdit] = useState(null),
    [form, setForm] = useState({});
  if (loading) return /*#__PURE__*/React.createElement(Loading, null);
  const save = async () => {
    await api.patch('/api/large-groups/' + edit, form);
    setEdit(null);
    reload();
  };
  return /*#__PURE__*/React.createElement(Page, {
    title: "Main Cat",
    sub: "10 個最高級業務類別。含符號的 Main Cat 不可隨意刪除。"
  }, /*#__PURE__*/React.createElement(Err, {
    m: err
  }), /*#__PURE__*/React.createElement("div", {
    className: "panel"
  }, /*#__PURE__*/React.createElement("div", {
    className: "table-wrap"
  }, /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "代碼"), /*#__PURE__*/React.createElement("th", null, "名稱"), /*#__PURE__*/React.createElement("th", null, "描述"), /*#__PURE__*/React.createElement("th", null, "順序"), /*#__PURE__*/React.createElement("th", null, "狀態"), /*#__PURE__*/React.createElement("th", null))), /*#__PURE__*/React.createElement("tbody", null, (data || []).map(g => /*#__PURE__*/React.createElement("tr", {
    key: g.id
  }, /*#__PURE__*/React.createElement("td", {
    className: "mono"
  }, g.group_code), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("b", null, g.name_zh)), /*#__PURE__*/React.createElement("td", {
    className: "small muted"
  }, g.description || '—'), /*#__PURE__*/React.createElement("td", null, g.display_order), /*#__PURE__*/React.createElement("td", null, g.active ? /*#__PURE__*/React.createElement("span", {
    className: "badge b-green"
  }, "啟用") : /*#__PURE__*/React.createElement("span", {
    className: "badge b-grey"
  }, "停用")), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("button", {
    className: "ghost",
    onClick: () => {
      setEdit(g.id);
      setForm({
        name_en: g.name_en,
        description: g.description,
        display_order: g.display_order,
        active: g.active
      });
    }
  }, "編輯")))))))), edit && /*#__PURE__*/React.createElement("div", {
    className: "panel"
  }, /*#__PURE__*/React.createElement("h3", null, "編輯 Main Cat"), /*#__PURE__*/React.createElement("div", {
    className: "toolbar"
  }, /*#__PURE__*/React.createElement("input", {
    style: {
      flex: 2
    },
    placeholder: "描述",
    value: form.description || '',
    onChange: e => setForm({
      ...form,
      description: e.target.value
    })
  }), /*#__PURE__*/React.createElement("input", {
    style: {
      width: 80
    },
    type: "number",
    placeholder: "順序",
    value: form.display_order || 0,
    onChange: e => setForm({
      ...form,
      display_order: +e.target.value
    })
  }), /*#__PURE__*/React.createElement("label", {
    className: "small"
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: form.active,
    onChange: e => setForm({
      ...form,
      active: e.target.checked
    })
  }), " 啟用"), /*#__PURE__*/React.createElement("button", {
    onClick: save
  }, "儲存"), /*#__PURE__*/React.createElement("button", {
    className: "ghost",
    onClick: () => setEdit(null)
  }, "取消"))));
}

// ---------- Tokens ----------
function Tokens() {
  const {
    data: groups
  } = useData('/api/large-groups');
  const [gid, setGid] = useState('');
  const {
    data,
    err,
    loading,
    reload
  } = useData('/api/tokens' + (gid ? '?group_id=' + gid : ''), [gid]);
  const [sel, setSel] = useState(null);
  const [alias, setAlias] = useState('');
  if (loading && !data) return /*#__PURE__*/React.createElement(Loading, null);
  const detail = sel ? data.find(t => t.id === sel) : null;
  return /*#__PURE__*/React.createElement(Page, {
    title: "產品符號庫",
    sub: "受控的產品概念（非完整可售產品）。一個符號可有多個別名與多個 Product Key。"
  }, /*#__PURE__*/React.createElement(Err, {
    m: err
  }), /*#__PURE__*/React.createElement("div", {
    className: "toolbar"
  }, /*#__PURE__*/React.createElement("select", {
    value: gid,
    onChange: e => setGid(e.target.value)
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, "全部 Main Cat"), groups && groups.map(g => /*#__PURE__*/React.createElement("option", {
    key: g.id,
    value: g.id
  }, g.name_zh)))), /*#__PURE__*/React.createElement("div", {
    className: "panel"
  }, /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "符號代碼"), /*#__PURE__*/React.createElement("th", null, "名稱"), /*#__PURE__*/React.createElement("th", null, "Main Cat"), /*#__PURE__*/React.createElement("th", null, "別名"), /*#__PURE__*/React.createElement("th", null, "Key 數"), /*#__PURE__*/React.createElement("th", null, "SKU 數"), /*#__PURE__*/React.createElement("th", null, "狀態"), /*#__PURE__*/React.createElement("th", null))), /*#__PURE__*/React.createElement("tbody", null, data && data.map(t => /*#__PURE__*/React.createElement("tr", {
    key: t.id
  }, /*#__PURE__*/React.createElement("td", {
    className: "mono small"
  }, t.token_code), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("b", null, t.name_zh)), /*#__PURE__*/React.createElement("td", null, t.group_name), /*#__PURE__*/React.createElement("td", {
    className: "small"
  }, /*#__PURE__*/React.createElement(Aliases, {
    id: t.id
  })), /*#__PURE__*/React.createElement("td", null, t.key_count), /*#__PURE__*/React.createElement("td", null, t.sku_count), /*#__PURE__*/React.createElement("td", null, t.active ? /*#__PURE__*/React.createElement("span", {
    className: "badge b-green"
  }, "啟用") : /*#__PURE__*/React.createElement("span", {
    className: "badge b-grey"
  }, "停用")), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("button", {
    className: "ghost",
    onClick: () => setSel(sel === t.id ? null : t.id)
  }, sel === t.id ? '收合' : '管理'))))))), detail && /*#__PURE__*/React.createElement(TokenDetail, {
    token: detail,
    onDone: () => {
      reload();
    },
    alias: alias,
    setAlias: setAlias
  }));
}
function Aliases({
  id
}) {
  const {
    data
  } = useData('/api/tokens/' + id, [id]);
  if (!data) return '…';
  return (data.aliases || []).map(a => /*#__PURE__*/React.createElement("span", {
    className: "tag",
    key: a.id
  }, a.alias));
}
function TokenDetail({
  token,
  onDone,
  alias,
  setAlias
}) {
  const {
    data,
    reload
  } = useData('/api/tokens/' + token.id, [token.id]);
  const add = async kind => {
    if (!alias) return;
    await api.post('/api/tokens/' + token.id + (kind === 'neg' ? '/negative-aliases' : '/aliases'), {
      alias
    });
    setAlias('');
    reload();
    onDone();
  };
  if (!data) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "panel"
  }, /*#__PURE__*/React.createElement("h3", null, data.name_zh, " — 別名管理"), /*#__PURE__*/React.createElement("div", {
    className: "small",
    style: {
      marginBottom: 8
    }
  }, "核准別名：", (data.aliases || []).map(a => /*#__PURE__*/React.createElement("span", {
    className: "tag",
    key: a.id
  }, a.alias))), /*#__PURE__*/React.createElement("div", {
    className: "small",
    style: {
      marginBottom: 8
    }
  }, "負面別名：", (data.negative_aliases || []).map(a => /*#__PURE__*/React.createElement("span", {
    className: "tag",
    key: a.id,
    style: {
      background: '#fbe2e2'
    }
  }, a.alias))), /*#__PURE__*/React.createElement("div", {
    className: "toolbar"
  }, /*#__PURE__*/React.createElement("input", {
    placeholder: "新增別名",
    value: alias,
    onChange: e => setAlias(e.target.value)
  }), /*#__PURE__*/React.createElement("button", {
    onClick: () => add('pos')
  }, "加核准別名"), /*#__PURE__*/React.createElement("button", {
    className: "sec",
    onClick: () => add('neg')
  }, "加負面別名")));
}

// ---------- Product Keys ----------
function Keys() {
  const [q, setQ] = useState('');
  const {
    data,
    err,
    loading
  } = useData('/api/product-keys' + (q ? '?q=' + encodeURIComponent(q) : ''), [q]);
  const [summaries, setSummaries] = useState({});
  useEffect(() => {
    if (data) data.forEach(k => api.get('/api/product-keys/' + k.id + '/summary').then(s => setSummaries(p => ({
      ...p,
      [k.id]: s
    }))).catch(() => {}));
  }, [data]);
  if (loading && !data) return /*#__PURE__*/React.createElement(Loading, null);
  return /*#__PURE__*/React.createElement(Page, {
    title: "Product Key 庫",
    sub: "結構化商品配置：品牌 | 產品符號 | 產地 | 款式 | 規格。不同款式/規格保持獨立。"
  }, /*#__PURE__*/React.createElement(Err, {
    m: err
  }), /*#__PURE__*/React.createElement("div", {
    className: "toolbar"
  }, /*#__PURE__*/React.createElement("input", {
    style: {
      flex: 1
    },
    placeholder: "搜尋 無糖 / 250ml / 鈣思寶 / 豆奶 / 中國 …",
    value: q,
    onChange: e => setQ(e.target.value)
  })), /*#__PURE__*/React.createElement("div", {
    className: "panel"
  }, /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Key 代碼"), /*#__PURE__*/React.createElement("th", null, "顯示鍵"), /*#__PURE__*/React.createElement("th", null, "品牌"), /*#__PURE__*/React.createElement("th", null, "符號"), /*#__PURE__*/React.createElement("th", null, "產地"), /*#__PURE__*/React.createElement("th", null, "款式"), /*#__PURE__*/React.createElement("th", null, "規格"), /*#__PURE__*/React.createElement("th", null, "SKU"), /*#__PURE__*/React.createElement("th", null, "價格"), /*#__PURE__*/React.createElement("th", null, "庫存"))), /*#__PURE__*/React.createElement("tbody", null, data && data.map(k => {
    const s = summaries[k.id];
    return /*#__PURE__*/React.createElement("tr", {
      key: k.id
    }, /*#__PURE__*/React.createElement("td", {
      className: "mono small"
    }, k.product_key_code), /*#__PURE__*/React.createElement("td", {
      className: "small"
    }, /*#__PURE__*/React.createElement("b", null, k.display_key), /*#__PURE__*/React.createElement(Copy, {
      text: k.display_key
    })), /*#__PURE__*/React.createElement("td", null, k.brand_name || /*#__PURE__*/React.createElement(Null, null)), /*#__PURE__*/React.createElement("td", null, k.token_name), /*#__PURE__*/React.createElement("td", null, k.origin_name || /*#__PURE__*/React.createElement(Null, null)), /*#__PURE__*/React.createElement("td", null, k.variant || /*#__PURE__*/React.createElement(Null, null)), /*#__PURE__*/React.createElement("td", {
      className: "small"
    }, k.display_pack_format || /*#__PURE__*/React.createElement(Null, null)), /*#__PURE__*/React.createElement("td", null, k.sku_count), /*#__PURE__*/React.createElement("td", {
      className: "small"
    }, s && s.price ? s.price.type === 'single' ? fmt$(s.price.value) : /*#__PURE__*/React.createElement("span", {
      title: "範圍"
    }, fmt$(s.price.min), "–", fmt$(s.price.max)) : '—'), /*#__PURE__*/React.createElement("td", {
      className: "small"
    }, s && s.stock ? /*#__PURE__*/React.createElement(StockMini, {
      st: s.stock
    }) : '—'));
  })))));
}
function StockMini({
  st
}) {
  return /*#__PURE__*/React.createElement("span", null, st.IN_STOCK ? /*#__PURE__*/React.createElement("span", {
    className: "badge b-green"
  }, st.IN_STOCK, " 有貨") : null, st.LOW_STOCK ? /*#__PURE__*/React.createElement("span", {
    className: "badge b-amber"
  }, " ", st.LOW_STOCK, " 少") : null, st.OUT_OF_STOCK ? /*#__PURE__*/React.createElement("span", {
    className: "badge b-red"
  }, " ", st.OUT_OF_STOCK, " 缺") : null, !st.IN_STOCK && !st.LOW_STOCK && !st.OUT_OF_STOCK ? /*#__PURE__*/React.createElement("span", {
    className: "badge b-grey"
  }, "離線") : null);
}

// ---------- SKUs ----------
function StockBadge({
  status
}) {
  const map = {
    IN_STOCK: ['b-green', '有貨'],
    LOW_STOCK: ['b-amber', '少貨'],
    OUT_OF_STOCK: ['b-red', '缺貨'],
    PREORDER: ['b-blue', '預購'],
    DISCONTINUED: ['b-grey', '已下架'],
    UNKNOWN: ['b-grey', '離線']
  };
  const [cls, label] = map[status] || ['b-grey', status || '未知'];
  return /*#__PURE__*/React.createElement("span", {
    className: "badge " + cls
  }, label);
}
function SkuDetail({
  sku
}) {
  const {
    data: stock,
    loading: sl
  } = useData('/api/skus/' + sku.id + '/stock', [sku.id]);
  const {
    data: price
  } = useData('/api/skus/' + sku.id + '/price', [sku.id]);
  const {
    data: op
  } = useData('/api/skus/' + sku.id + '/operational', [sku.id]);
  const st = stock && stock[0];
  const vis = op ? op.current_is_invisible === true ? /*#__PURE__*/React.createElement("span", {
    className: "badge b-grey"
  }, "隱藏") : op.current_is_invisible === false ? /*#__PURE__*/React.createElement("span", {
    className: "badge b-green"
  }, "可見") : /*#__PURE__*/React.createElement("span", {
    className: "badge b-grey"
  }, "未知") : '—';
  return /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: "8",
    style: {
      background: '#fafbfc',
      padding: '10px 14px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 28,
      flexWrap: 'wrap',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "lbl"
  }, "庫存狀態"), sl ? '…' : st ? /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement(StockBadge, {
    status: st.stock_status
  }), " ", /*#__PURE__*/React.createElement(Fresh, {
    f: st.freshness
  })) : /*#__PURE__*/React.createElement("span", {
    className: "badge b-grey"
  }, "未有數據")), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "lbl"
  }, "特價 (Tableau)"), /*#__PURE__*/React.createElement("div", {
    className: "small"
  }, op && op.current_discount_price != null ? fmt$(op.current_discount_price) : '—')), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "lbl"
  }, "可見性"), /*#__PURE__*/React.createElement("div", {
    className: "small"
  }, vis)), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "lbl"
  }, "觀察時間"), /*#__PURE__*/React.createElement("div", {
    className: "small"
  }, st ? fmtTime(st.observed_at) : '—')), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "lbl"
  }, "銷售渠道"), /*#__PURE__*/React.createElement("div", {
    className: "small"
  }, st && st.sales_channel || '—')), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "lbl"
  }, "現價"), /*#__PURE__*/React.createElement("div", {
    className: "small"
  }, price && price.effective_price != null ? fmt$(price.effective_price) : '—')), /*#__PURE__*/React.createElement("div", {
    className: "small muted mono",
    style: {
      marginLeft: 'auto'
    }
  }, sku.external_sku_id))));
}
function Skus() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const {
    data,
    err,
    loading
  } = useData('/api/skus?limit=300' + (q ? '&q=' + encodeURIComponent(q) : ''), [q]);
  if (loading && !data) return /*#__PURE__*/React.createElement(Loading, null);
  return /*#__PURE__*/React.createElement(Page, {
    title: "SKU 記錄",
    sub: "來源系統的確切可售記錄。完整原始名稱永不被覆寫。點擊列查看庫存詳情。"
  }, /*#__PURE__*/React.createElement(Err, {
    m: err
  }), /*#__PURE__*/React.createElement("div", {
    className: "toolbar"
  }, /*#__PURE__*/React.createElement("input", {
    style: {
      flex: 1
    },
    placeholder: "搜尋名稱 / SKU ID / 條碼",
    value: q,
    onChange: e => setQ(e.target.value)
  })), /*#__PURE__*/React.createElement("div", {
    className: "panel"
  }, data && data.length ? /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "SKU ID"), /*#__PURE__*/React.createElement("th", null, "原始名稱"), /*#__PURE__*/React.createElement("th", null, "Main Cat"), /*#__PURE__*/React.createElement("th", null, "符號"), /*#__PURE__*/React.createElement("th", null, "Product Key"), /*#__PURE__*/React.createElement("th", null, "信心"), /*#__PURE__*/React.createElement("th", null, "覆核"), /*#__PURE__*/React.createElement("th", null))), /*#__PURE__*/React.createElement("tbody", null, data.map(s => /*#__PURE__*/React.createElement(React.Fragment, {
    key: s.id
  }, /*#__PURE__*/React.createElement("tr", {
    onClick: () => setOpen(open === s.id ? null : s.id),
    style: {
      cursor: 'pointer',
      background: open === s.id ? '#f0f6ff' : 'inherit'
    }
  }, /*#__PURE__*/React.createElement("td", {
    className: "mono small"
  }, /*#__PURE__*/React.createElement(ChanBadge, {
    sku: s.external_sku_id
  }), " ", s.external_sku_id || s.id), /*#__PURE__*/React.createElement("td", {
    className: "sku-name small",
    title: s.raw_sku_name
  }, s.raw_sku_name, /*#__PURE__*/React.createElement(Copy, {
    text: s.raw_sku_name
  })), /*#__PURE__*/React.createElement("td", {
    className: "small"
  }, s.group_name || /*#__PURE__*/React.createElement(Null, null)), /*#__PURE__*/React.createElement("td", {
    className: "small"
  }, s.token_name || /*#__PURE__*/React.createElement(Null, null)), /*#__PURE__*/React.createElement("td", {
    className: "small"
  }, s.key_display || /*#__PURE__*/React.createElement("span", {
    className: "muted"
  }, "未解析")), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(Conf, {
    c: s.mapping_confidence
  })), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(ReviewBadge, {
    s: s.review_status
  })), /*#__PURE__*/React.createElement("td", {
    className: "small muted"
  }, open === s.id ? '▲' : '▼')), open === s.id && /*#__PURE__*/React.createElement(SkuDetail, {
    sku: s
  }))))) : /*#__PURE__*/React.createElement("div", {
    className: "empty"
  }, "暫無 SKU。請用「匯入/匯出」匯入，或用分類測試器。")));
}

// ---------- Classification Tester ----------
function Tester() {
  const [input, setInput] = useState('一口牛柳粒(急凍)#牛肉粒#淋滑#韓燒烤#家常小菜');
  const [batch, setBatch] = useState('');
  const [res, setRes] = useState(null),
    [batchRes, setBatchRes] = useState(null),
    [err, setErr] = useState(null),
    [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      setRes(await api.post('/api/classify', {
        raw_sku_name: input
      }));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const runBatch = async () => {
    setBusy(true);
    setErr(null);
    try {
      const items = batch.split('\n').map(x => x.trim()).filter(Boolean);
      const r = await api.post('/api/classify', {
        items
      });
      setBatchRes(r.results);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return /*#__PURE__*/React.createElement(Page, {
    title: "分類測試器",
    sub: "貼上 SKU 名稱即時測試正規化與分類結果。支援單條與批次。"
  }, /*#__PURE__*/React.createElement(Err, {
    m: err
  }), /*#__PURE__*/React.createElement("div", {
    className: "panel"
  }, /*#__PURE__*/React.createElement("h3", null, "單條測試"), /*#__PURE__*/React.createElement("div", {
    className: "toolbar"
  }, /*#__PURE__*/React.createElement("input", {
    style: {
      flex: 1
    },
    value: input,
    onChange: e => setInput(e.target.value)
  }), /*#__PURE__*/React.createElement("button", {
    onClick: run,
    disabled: busy
  }, "分類")), res && /*#__PURE__*/React.createElement("div", {
    className: "result-box"
  }, /*#__PURE__*/React.createElement("dl", {
    className: "kv"
  }, /*#__PURE__*/React.createElement("dt", null, "正規化文字"), /*#__PURE__*/React.createElement("dd", {
    className: "mono"
  }, res.normalized_sku_name), /*#__PURE__*/React.createElement("dt", null, "基本標題"), /*#__PURE__*/React.createElement("dd", null, res.base_title), /*#__PURE__*/React.createElement("dt", null, "Hashtag"), /*#__PURE__*/React.createElement("dd", null, res.extracted_hashtags.length ? res.extracted_hashtags.map(x => /*#__PURE__*/React.createElement("span", {
    className: "tag",
    key: x
  }, x)) : '—'), /*#__PURE__*/React.createElement("dt", null, "括號屬性"), /*#__PURE__*/React.createElement("dd", null, res.extracted_brackets.length ? res.extracted_brackets.map(x => /*#__PURE__*/React.createElement("span", {
    className: "tag",
    key: x
  }, x)) : '—'), /*#__PURE__*/React.createElement("dt", null, "Main Cat"), /*#__PURE__*/React.createElement("dd", null, /*#__PURE__*/React.createElement("b", null, res.large_group_name || /*#__PURE__*/React.createElement(Null, null))), /*#__PURE__*/React.createElement("dt", null, "產品符號"), /*#__PURE__*/React.createElement("dd", null, /*#__PURE__*/React.createElement("b", null, res.product_token_name || /*#__PURE__*/React.createElement(Null, null)), " ", res.product_token_code && /*#__PURE__*/React.createElement("span", {
    className: "mono small muted"
  }, res.product_token_code)), /*#__PURE__*/React.createElement("dt", null, "Product Key"), /*#__PURE__*/React.createElement("dd", null, res.product_key_display || /*#__PURE__*/React.createElement("span", {
    className: "muted"
  }, "未解析（token-only）")), /*#__PURE__*/React.createElement("dt", null, "命中別名"), /*#__PURE__*/React.createElement("dd", null, res.matched_alias || '—'), /*#__PURE__*/React.createElement("dt", null, "方法"), /*#__PURE__*/React.createElement("dd", null, /*#__PURE__*/React.createElement("span", {
    className: "badge b-blue"
  }, res.match_method)), /*#__PURE__*/React.createElement("dt", null, "信心"), /*#__PURE__*/React.createElement("dd", null, /*#__PURE__*/React.createElement(Conf, {
    c: res.confidence
  })), /*#__PURE__*/React.createElement("dt", null, "需覆核"), /*#__PURE__*/React.createElement("dd", null, res.requires_review ? /*#__PURE__*/React.createElement("span", {
    className: "badge b-amber"
  }, "是") : /*#__PURE__*/React.createElement("span", {
    className: "badge b-green"
  }, "否")), /*#__PURE__*/React.createElement("dt", null, "說明"), /*#__PURE__*/React.createElement("dd", {
    className: "small"
  }, res.explanation)), res.alternative_candidates && res.alternative_candidates.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "small",
    style: {
      marginTop: 8
    }
  }, /*#__PURE__*/React.createElement("b", null, "其他候選："), res.alternative_candidates.map((c, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "muted"
  }, "· ", c.token_name || c.reason, " (score ", c.score, ")"))))), /*#__PURE__*/React.createElement("div", {
    className: "panel"
  }, /*#__PURE__*/React.createElement("h3", null, "批次測試（每行一個）"), /*#__PURE__*/React.createElement("textarea", {
    className: "code",
    rows: "5",
    style: {
      width: '100%'
    },
    placeholder: '一口牛柳粒(急凍)\n鈣思寶無糖豆奶250毫升24支',
    value: batch,
    onChange: e => setBatch(e.target.value)
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: runBatch,
    disabled: busy
  }, "批次分類")), batchRes && /*#__PURE__*/React.createElement("table", {
    style: {
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "輸入"), /*#__PURE__*/React.createElement("th", null, "符號"), /*#__PURE__*/React.createElement("th", null, "Product Key"), /*#__PURE__*/React.createElement("th", null, "信心"), /*#__PURE__*/React.createElement("th", null, "覆核"))), /*#__PURE__*/React.createElement("tbody", null, batchRes.map((r, i) => /*#__PURE__*/React.createElement("tr", {
    key: i
  }, /*#__PURE__*/React.createElement("td", {
    className: "small"
  }, r.raw_sku_name), /*#__PURE__*/React.createElement("td", null, r.product_token_name || '—'), /*#__PURE__*/React.createElement("td", {
    className: "small"
  }, r.product_key_display || '—'), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(Conf, {
    c: r.confidence
  })), /*#__PURE__*/React.createElement("td", null, r.requires_review ? /*#__PURE__*/React.createElement("span", {
    className: "badge b-amber"
  }, "是") : /*#__PURE__*/React.createElement("span", {
    className: "badge b-green"
  }, "否"))))))));
}

// ---------- Review Queue ----------
function Review() {
  const {
    data,
    err,
    loading,
    reload
  } = useData('/api/review/queue');
  const [note, setNote] = useState({});
  if (loading) return /*#__PURE__*/React.createElement(Loading, null);
  const confirm = async sku => {
    await api.post('/api/review/submit', {
      sku_id: sku.id,
      product_token_id: sku.product_token_id,
      product_key_id: sku.product_key_id,
      large_group_id: sku.large_group_id,
      action: 'CONFIRM',
      reason: note[sku.id] || 'confirmed via dashboard'
    });
    reload();
  };
  return /*#__PURE__*/React.createElement(Page, {
    title: "覆核佇列",
    sub: "模糊/低信心分類與操作記錄映射需人工確認。只有人工確認才會成為永久規則。"
  }, /*#__PURE__*/React.createElement(Err, {
    m: err
  }), /*#__PURE__*/React.createElement("div", {
    className: "panel"
  }, /*#__PURE__*/React.createElement("h3", null, "待覆核 SKU（", (data.pending_skus || []).length, "）"), data.pending_skus && data.pending_skus.length ? /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "原始名稱"), /*#__PURE__*/React.createElement("th", null, "建議符號"), /*#__PURE__*/React.createElement("th", null, "建議 Key"), /*#__PURE__*/React.createElement("th", null, "信心"), /*#__PURE__*/React.createElement("th", null, "備註"), /*#__PURE__*/React.createElement("th", null))), /*#__PURE__*/React.createElement("tbody", null, data.pending_skus.map(s => /*#__PURE__*/React.createElement("tr", {
    key: s.id
  }, /*#__PURE__*/React.createElement("td", {
    className: "sku-name small"
  }, s.raw_sku_name), /*#__PURE__*/React.createElement("td", {
    className: "small"
  }, s.token_name || /*#__PURE__*/React.createElement(Null, null)), /*#__PURE__*/React.createElement("td", {
    className: "small"
  }, s.key_display || /*#__PURE__*/React.createElement("span", {
    className: "muted"
  }, "未解析")), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(Conf, {
    c: s.mapping_confidence
  })), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("input", {
    className: "small",
    placeholder: "覆核備註",
    value: note[s.id] || '',
    onChange: e => setNote({
      ...note,
      [s.id]: e.target.value
    })
  })), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("button", {
    onClick: () => confirm(s)
  }, "確認")))))) : /*#__PURE__*/React.createElement("div", {
    className: "empty small"
  }, "佇列已清空 🎉")), /*#__PURE__*/React.createElement("div", {
    className: "panel"
  }, /*#__PURE__*/React.createElement("h3", null, "價格/庫存映射覆核（", (data.mapping || []).length, "）"), data.mapping && data.mapping.length ? /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "類型"), /*#__PURE__*/React.createElement("th", null, "來源記錄"), /*#__PURE__*/React.createElement("th", null, "原因"), /*#__PURE__*/React.createElement("th", null, "時間"))), /*#__PURE__*/React.createElement("tbody", null, data.mapping.map(m => /*#__PURE__*/React.createElement("tr", {
    key: m.id
  }, /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
    className: "badge b-blue"
  }, m.record_type)), /*#__PURE__*/React.createElement("td", {
    className: "small mono"
  }, m.source_record), /*#__PURE__*/React.createElement("td", {
    className: "small"
  }, m.reason), /*#__PURE__*/React.createElement("td", {
    className: "small muted"
  }, fmtTime(m.created_at)))))) : /*#__PURE__*/React.createElement("div", {
    className: "empty small"
  }, "無待處理映射")));
}

// ---------- Price & Stock ----------
// Shared summary cards (also embedded in 總覽). LOW_STOCK removed; UNKNOWN renamed to 離線.
function PriceStockSummary({
  onPick
}) {
  const {
    data,
    err,
    loading
  } = useData('/api/price-stock/overview');
  if (loading) return /*#__PURE__*/React.createElement(Loading, null);
  if (err) return /*#__PURE__*/React.createElement(Err, {
    m: err
  });
  if (!data) return null;
  const Card = ({
    status,
    color,
    val,
    lbl
  }) => onPick ? /*#__PURE__*/React.createElement("button", {
    className: "card card-btn",
    onClick: () => onPick(status)
  }, /*#__PURE__*/React.createElement("div", {
    className: "num",
    style: {
      color
    }
  }, val), /*#__PURE__*/React.createElement("div", {
    className: "lbl"
  }, lbl, " →")) : /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "num",
    style: {
      color
    }
  }, val), /*#__PURE__*/React.createElement("div", {
    className: "lbl"
  }, lbl));
  return /*#__PURE__*/React.createElement("div", {
    className: "cards"
  }, /*#__PURE__*/React.createElement(Card, {
    status: "IN_STOCK",
    color: "var(--green)",
    val: data.in_stock,
    lbl: "有貨"
  }), /*#__PURE__*/React.createElement(Card, {
    status: "OUT_OF_STOCK",
    color: "var(--red)",
    val: data.out_of_stock,
    lbl: "缺貨"
  }), /*#__PURE__*/React.createElement(Card, {
    status: "LOW_STOCK",
    color: "var(--amber)",
    val: data.low_stock,
    lbl: "少貨"
  }), /*#__PURE__*/React.createElement(Card, {
    status: "OFFLINE",
    color: "var(--muted,#6b7280)",
    val: data.unknown_stock,
    lbl: "離線"
  }));
}

// ---------- Import / Export ----------
function ImportExport() {
  const [csv, setCsv] = useState('');
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);
  const [validOnly, setValidOnly] = useState(false);
  const validate = async commit => {
    setErr(null);
    try {
      const rows = csv.split('\n').filter(Boolean).map(line => {
        const c = line.split(',');
        const o = {};
        ['external_sku_id', 'barcode', 'raw_sku_name', 'large_group_code', 'product_token_code', 'product_key_code', 'brand', 'origin', 'variant', 'unit_size', 'unit_measurement', 'pack_count', 'pack_unit', 'sales_channel', 'active'].forEach((h, i) => o[h] = (c[i] || '').trim());
        return o;
      }).filter(o => o.raw_sku_name);
      if (commit) {
        const r = await api.post('/api/import/commit', {
          rows,
          importValidOnly: validOnly
        });
        setResult(r);
      } else {
        const r = await api.post('/api/import/validate', {
          rows
        });
        setResult(r);
      }
    } catch (e) {
      setErr(e.message);
      if (e.details) setResult(e.details);
    }
  };
  return /*#__PURE__*/React.createElement(Page, {
    title: "匯入 / 匯出",
    sub: "支援 CSV / XLSX / JSON。匯入前逐行驗證；除非選擇「只匯入有效行」，否則不作部分匯入。"
  }, /*#__PURE__*/React.createElement(Err, {
    m: err
  }), /*#__PURE__*/React.createElement("div", {
    className: "panel"
  }, /*#__PURE__*/React.createElement("h3", null, "下載範本與備份"), /*#__PURE__*/React.createElement("div", {
    className: "toolbar"
  }, /*#__PURE__*/React.createElement("a", {
    href: "/api/import/template?format=csv"
  }, /*#__PURE__*/React.createElement("button", {
    className: "ghost"
  }, "CSV 範本")), /*#__PURE__*/React.createElement("a", {
    href: "/api/import/template?format=xlsx"
  }, /*#__PURE__*/React.createElement("button", {
    className: "ghost"
  }, "XLSX 範本")), /*#__PURE__*/React.createElement("a", {
    href: "/api/export/skus?format=csv"
  }, /*#__PURE__*/React.createElement("button", {
    className: "ghost"
  }, "匯出 SKU (CSV)")), /*#__PURE__*/React.createElement("a", {
    href: "/api/export/skus?format=xlsx"
  }, /*#__PURE__*/React.createElement("button", {
    className: "ghost"
  }, "匯出 SKU (XLSX)")), /*#__PURE__*/React.createElement("a", {
    href: "/api/export/taxonomy"
  }, /*#__PURE__*/React.createElement("button", {
    className: "ghost"
  }, "匯出分類 (JSON)")), /*#__PURE__*/React.createElement("a", {
    href: "/api/export/backup"
  }, /*#__PURE__*/React.createElement("button", {
    className: "sec"
  }, "完整資料庫備份")))), /*#__PURE__*/React.createElement("div", {
    className: "panel"
  }, /*#__PURE__*/React.createElement("h3", null, "匯入 SKU（貼上 CSV）"), /*#__PURE__*/React.createElement("textarea", {
    className: "code",
    rows: "6",
    style: {
      width: '100%'
    },
    placeholder: "external_sku_id,barcode,raw_sku_name,...",
    value: csv,
    onChange: e => setCsv(e.target.value)
  }), /*#__PURE__*/React.createElement("div", {
    className: "toolbar",
    style: {
      marginTop: 8
    }
  }, /*#__PURE__*/React.createElement("button", {
    className: "ghost",
    onClick: () => validate(false)
  }, "驗證"), /*#__PURE__*/React.createElement("label", {
    className: "small"
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: validOnly,
    onChange: e => setValidOnly(e.target.checked)
  }), " 只匯入有效行"), /*#__PURE__*/React.createElement("button", {
    onClick: () => validate(true)
  }, "匯入")), result && /*#__PURE__*/React.createElement("div", {
    className: "result-box small"
  }, result.imported != null && /*#__PURE__*/React.createElement("div", {
    className: "ok"
  }, "已匯入 ", result.imported, " 行", result.skipped_invalid ? `，略過 ${result.skipped_invalid} 無效行` : ''), result.valid && /*#__PURE__*/React.createElement("div", null, "有效：", result.valid.length, " 行\u3000無效：", result.invalid.length, " 行"), result.invalid && result.invalid.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 6
    }
  }, /*#__PURE__*/React.createElement("b", null, "無效行："), result.invalid.map((v, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "err",
    style: {
      margin: '4px 0'
    }
  }, "第 ", v.row, " 行：", v.errors.join('；')))), result.warnings && result.warnings.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 6
    }
  }, /*#__PURE__*/React.createElement("b", null, "警告："), result.warnings.map((w, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "muted"
  }, "第 ", w.row, " 行：", w.msg))))));
}

// ---------- Audit ----------
function Audit() {
  const {
    data,
    err,
    loading
  } = useData('/api/audit?limit=300');
  if (loading) return /*#__PURE__*/React.createElement(Loading, null);
  return /*#__PURE__*/React.createElement(Page, {
    title: "審計歷史",
    sub: "分類變更、別名增刪、Product Key 變更、擷取與手動操作全記錄。"
  }, /*#__PURE__*/React.createElement(Err, {
    m: err
  }), /*#__PURE__*/React.createElement("div", {
    className: "panel"
  }, data && data.length ? /*#__PURE__*/React.createElement("table", null, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "時間"), /*#__PURE__*/React.createElement("th", null, "實體"), /*#__PURE__*/React.createElement("th", null, "動作"), /*#__PURE__*/React.createElement("th", null, "覆核者"), /*#__PURE__*/React.createElement("th", null, "原因"))), /*#__PURE__*/React.createElement("tbody", null, data.map(a => /*#__PURE__*/React.createElement("tr", {
    key: a.id
  }, /*#__PURE__*/React.createElement("td", {
    className: "small muted"
  }, fmtTime(a.created_at)), /*#__PURE__*/React.createElement("td", {
    className: "small"
  }, a.entity_type, "#", a.entity_id), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
    className: "badge b-blue"
  }, a.action)), /*#__PURE__*/React.createElement("td", {
    className: "small"
  }, a.reviewer || '—'), /*#__PURE__*/React.createElement("td", {
    className: "small"
  }, a.reason || '—'))))) : /*#__PURE__*/React.createElement("div", {
    className: "empty"
  }, "暫無審計記錄")));
}

// ---------- Settings ----------
function Settings() {
  const {
    data: skill
  } = useData('/api/system/skill-status');
  const {
    data: ver
  } = useData('/api/system/taxonomy-version');
  return /*#__PURE__*/React.createElement(Page, {
    title: "設定",
    sub: "重新整理排程、新鮮度門檻、技能整合、信心門檻與備份。"
  }, /*#__PURE__*/React.createElement("div", {
    className: "grid2"
  }, /*#__PURE__*/React.createElement("div", {
    className: "panel"
  }, /*#__PURE__*/React.createElement("h3", null, "技能整合"), skill ? /*#__PURE__*/React.createElement("dl", {
    className: "kv"
  }, /*#__PURE__*/React.createElement("dt", null, "價格技能"), /*#__PURE__*/React.createElement("dd", null, skill.price_skill.name, " ", /*#__PURE__*/React.createElement("span", {
    className: "badge " + (skill.price_skill.connected ? 'b-green' : 'b-red')
  }, skill.price_skill.connected ? '已連接' : '未連接')), /*#__PURE__*/React.createElement("dt", null, "庫存技能"), /*#__PURE__*/React.createElement("dd", null, skill.stock_skill.name, " ", /*#__PURE__*/React.createElement("span", {
    className: "badge " + (skill.stock_skill.connected ? 'b-green' : 'b-red')
  }, skill.stock_skill.connected ? '已連接' : 'not connected')), /*#__PURE__*/React.createElement("dt", null, "庫存腳本"), /*#__PURE__*/React.createElement("dd", {
    className: "mono small",
    style: {
      wordBreak: 'break-all'
    }
  }, skill.stock_skill.script)) : /*#__PURE__*/React.createElement(Loading, null), /*#__PURE__*/React.createElement("div", {
    className: "small muted",
    style: {
      marginTop: 8
    }
  }, "適配層包裝現有技能；不重新實作收集邏輯。多個候選時於此選擇正確技能。")), /*#__PURE__*/React.createElement("div", {
    className: "panel"
  }, /*#__PURE__*/React.createElement("h3", null, "分類與新鮮度"), /*#__PURE__*/React.createElement("dl", {
    className: "kv"
  }, /*#__PURE__*/React.createElement("dt", null, "分類版本"), /*#__PURE__*/React.createElement("dd", null, ver ? ver.version : '…'), /*#__PURE__*/React.createElement("dt", null, "自動接受門檻"), /*#__PURE__*/React.createElement("dd", null, "0.95"), /*#__PURE__*/React.createElement("dt", null, "覆核下限"), /*#__PURE__*/React.createElement("dd", null, "0.75"), /*#__PURE__*/React.createElement("dt", null, "新鮮度門檻"), /*#__PURE__*/React.createElement("dd", null, "30 小時內為最新"), /*#__PURE__*/React.createElement("dt", null, "貨幣"), /*#__PURE__*/React.createElement("dd", null, "HKD"), /*#__PURE__*/React.createElement("dt", null, "時區"), /*#__PURE__*/React.createElement("dd", null, "Asia/Hong_Kong")))), /*#__PURE__*/React.createElement("div", {
    className: "panel"
  }, /*#__PURE__*/React.createElement("h3", null, "重新整理排程（可設定）"), /*#__PURE__*/React.createElement("div", {
    className: "small muted"
  }, "預設每日一次；價格與庫存獨立執行，互不染污。可於「總覽」頁查看。排程時間不寫死，由環境變數 / 未來 cron 設定控制。"), /*#__PURE__*/React.createElement("div", {
    className: "toolbar",
    style: {
      marginTop: 8
    }
  }, /*#__PURE__*/React.createElement("input", {
    placeholder: "價格 cron（如 0 9 * * *）"
  }), /*#__PURE__*/React.createElement("input", {
    placeholder: "庫存 cron（如 0 9 * * *）"
  }), /*#__PURE__*/React.createElement("button", {
    className: "ghost"
  }, "儲存排程"))), /*#__PURE__*/React.createElement("div", {
    className: "panel"
  }, /*#__PURE__*/React.createElement("h3", null, "備份"), /*#__PURE__*/React.createElement("a", {
    href: "/api/export/backup"
  }, /*#__PURE__*/React.createElement("button", {
    className: "sec"
  }, "下載完整資料庫備份"))));
}

// ---------- Categories (分類瀏覽: Main Cat -> Sub Cat -> SKU list) ----------
const STOCK_LABEL = {
  IN_STOCK: ['b-green', '有貨'],
  LOW_STOCK: ['b-amber', '少貨'],
  OUT_OF_STOCK: ['b-red', '缺貨'],
  PREORDER: ['b-blue', '預購'],
  DISCONTINUED: ['b-grey', '已下架'],
  UNKNOWN: ['b-grey', '離線']
};
const StockBadge2 = ({
  s
}) => {
  const m = STOCK_LABEL[s] || ['b-grey', s || '離線'];
  return /*#__PURE__*/React.createElement("span", {
    className: "badge " + m[0]
  }, m[1]);
};
const VisBadge = ({
  v
}) => v == null ? /*#__PURE__*/React.createElement("span", {
  className: "muted small"
}, "—") : v ? /*#__PURE__*/React.createElement("span", {
  className: "badge b-amber"
}, "隱藏") : /*#__PURE__*/React.createElement("span", {
  className: "badge b-green"
}, "顯示");

// Accordion of the 10 Main Cats; expanding one shows its Sub Cats (approved order).
function Categories() {
  const {
    data: mains,
    err,
    loading,
    reload
  } = useData('/api/main-categories');
  const [open, setOpen] = useState(null); // open Main Cat code
  const [sub, setSub] = useState(null); // selected Sub Cat code
  const [sort, setSort] = useState('order');
  if (loading && !mains) return /*#__PURE__*/React.createElement(Loading, null);
  if (sub) return /*#__PURE__*/React.createElement(SubCatTokens, {
    code: sub,
    onBack: () => setSub(null),
    onBackAll: () => {
      setSub(null);
      setOpen(null);
    }
  });
  return /*#__PURE__*/React.createElement(Page, {
    title: "分類瀏覽",
    sub: "Main Cat → Sub Cat → 產品符號 → SKU。點擊 Main Cat 展開其子類，再點子類查看產品符號。"
  }, /*#__PURE__*/React.createElement(Err, {
    m: err
  }), err && /*#__PURE__*/React.createElement("button", {
    className: "ghost",
    onClick: reload
  }, "重試"), /*#__PURE__*/React.createElement("div", {
    className: "cat-accordion",
    role: "list"
  }, (mains || []).map(m => /*#__PURE__*/React.createElement(MainCatCard, {
    key: m.code,
    m: m,
    open: open === m.code,
    sort: sort,
    setSort: setSort,
    onToggle: () => setOpen(open === m.code ? null : m.code),
    onPickSub: code => setSub(code)
  }))));
}
function MainCatCard({
  m,
  open,
  sort,
  setSort,
  onToggle,
  onPickSub
}) {
  const {
    data,
    err,
    loading
  } = useData(open ? '/api/main-categories/' + m.code + '/sub-categories?sort=' + sort : null, [open, sort]);
  return /*#__PURE__*/React.createElement("div", {
    className: "cat-card" + (open ? ' open' : ''),
    role: "listitem"
  }, /*#__PURE__*/React.createElement("button", {
    className: "cat-head",
    "aria-expanded": open,
    onClick: onToggle
  }, /*#__PURE__*/React.createElement("span", {
    className: "cat-name"
  }, m.name), /*#__PURE__*/React.createElement("span", {
    className: "cat-meta small muted"
  }, m.subcat_count, " Sub Cats · ", m.sku_count, " SKUs", m.in_stock_count ? ` · 有貨 ${m.in_stock_count}` : '', m.out_of_stock_count ? ` · 缺貨 ${m.out_of_stock_count}` : '', m.review_count ? ` · 待覆核 ${m.review_count}` : ''), /*#__PURE__*/React.createElement("span", {
    className: "cat-caret",
    "aria-hidden": "true"
  }, open ? '▾' : '▸')), open && /*#__PURE__*/React.createElement("div", {
    className: "cat-body"
  }, /*#__PURE__*/React.createElement("div", {
    className: "toolbar"
  }, /*#__PURE__*/React.createElement("label", {
    className: "small muted"
  }, "排序："), /*#__PURE__*/React.createElement("select", {
    value: sort,
    onChange: e => setSort(e.target.value),
    "aria-label": "Sub Cat 排序"
  }, /*#__PURE__*/React.createElement("option", {
    value: "order"
  }, "核准順序"), /*#__PURE__*/React.createElement("option", {
    value: "count_desc"
  }, "SKU 數（多→少）"), /*#__PURE__*/React.createElement("option", {
    value: "count_asc"
  }, "SKU 數（少→多）"), /*#__PURE__*/React.createElement("option", {
    value: "name"
  }, "名稱 A–Z"))), loading ? /*#__PURE__*/React.createElement(Loading, null) : err ? /*#__PURE__*/React.createElement(Err, {
    m: err
  }) : data && data.sub_cats && data.sub_cats.length ? /*#__PURE__*/React.createElement("div", {
    className: "sub-list"
  }, data.sub_cats.map(s => /*#__PURE__*/React.createElement("button", {
    key: s.code,
    className: "sub-row",
    onClick: () => onPickSub(s.code)
  }, /*#__PURE__*/React.createElement("span", {
    className: "sub-name"
  }, s.name), /*#__PURE__*/React.createElement("span", {
    className: "small muted"
  }, s.sku_count, " SKUs", s.missing_price_count ? ` · 缺價 ${s.missing_price_count}` : '', s.missing_stock_count ? ` · 缺庫存 ${s.missing_stock_count}` : '', s.review_count ? ` · 待覆核 ${s.review_count}` : '')))) : /*#__PURE__*/React.createElement("div", {
    className: "empty"
  }, "No Sub Cat configured（分類設定問題）")));
}

// Product Token list for one Sub Cat: drill-down level between Sub Cat and SKUs.
function SubCatTokens({
  code,
  onBack,
  onBackAll
}) {
  const {
    data,
    err,
    loading
  } = useData('/api/sub-categories/' + code + '/tokens', [code]);
  const [pick, setPick] = useState(null); // {id,name} | {all:true}
  if (pick) return /*#__PURE__*/React.createElement(SubCatSkus, {
    code: code,
    tokenId: pick.all ? null : pick.id,
    tokenName: pick.all ? null : pick.name,
    onBack: () => setPick(null),
    onBackAll: onBackAll
  });
  return /*#__PURE__*/React.createElement(Page, {
    title: "分類瀏覽",
    sub: ""
  }, /*#__PURE__*/React.createElement("nav", {
    className: "crumb small",
    "aria-label": "breadcrumb"
  }, /*#__PURE__*/React.createElement("button", {
    className: "linklike",
    onClick: onBackAll
  }, "分類瀏覽"), data && /*#__PURE__*/React.createElement(React.Fragment, null, " ", /*#__PURE__*/React.createElement("span", {
    className: "muted"
  }, "›"), " ", /*#__PURE__*/React.createElement("button", {
    className: "linklike",
    onClick: onBack
  }, data.main_cat.name), /*#__PURE__*/React.createElement("span", {
    className: "muted"
  }, "›"), " ", /*#__PURE__*/React.createElement("b", null, data.sub_cat.name))), loading ? /*#__PURE__*/React.createElement(Loading, null) : err ? /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Err, {
    m: err
  })) : !data || !data.tokens || !data.tokens.length ? /*#__PURE__*/React.createElement("div", {
    className: "empty"
  }, "此 Sub Cat 暫時沒有產品符號") : /*#__PURE__*/React.createElement("div", {
    className: "panel"
  }, /*#__PURE__*/React.createElement("div", {
    className: "toolbar",
    style: {
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "small muted"
  }, data.tokens.length, " 個產品符號 · 點擊查看其 SKU，或"), /*#__PURE__*/React.createElement("button", {
    className: "ghost",
    onClick: () => setPick({
      all: true
    })
  }, "查看所有 SKU →")), /*#__PURE__*/React.createElement("div", {
    className: "sub-list"
  }, data.tokens.map(t => /*#__PURE__*/React.createElement("button", {
    key: t.id,
    className: "sub-row",
    onClick: () => setPick({
      id: t.id,
      name: t.name
    })
  }, /*#__PURE__*/React.createElement("span", {
    className: "sub-name"
  }, t.name), /*#__PURE__*/React.createElement("span", {
    className: "small muted"
  }, t.sku_count, " SKUs", t.in_stock_count ? ` · 有貨 ${t.in_stock_count}` : '', t.low_stock_count ? ` · 少貨 ${t.low_stock_count}` : '', t.out_of_stock_count ? ` · 缺貨 ${t.out_of_stock_count}` : ''))))));
}

// SKU list for one Sub Cat: server-side pagination + filters + search.
function SubCatSkus({
  code,
  tokenId,
  tokenName,
  onBack,
  onBackAll
}) {
  const [page, setPage] = useState(1);
  const [pageSize] = useState(30);
  const [f, setF] = useState({
    brand: '',
    product_token: '',
    visibility: '',
    stock_status: '',
    review_status: '',
    missing_price: '',
    missing_stock: '',
    keyword: '',
    sku_id: ''
  });
  const qs = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize)
  });
  if (tokenId) qs.set('token_id', String(tokenId));
  Object.entries(f).forEach(([k, v]) => {
    if (v) qs.set(k, v);
  });
  const {
    data,
    err,
    loading
  } = useData('/api/sub-categories/' + code + '/skus?' + qs.toString(), [code, tokenId, page, JSON.stringify(f)]);
  const {
    data: brands
  } = useData('/api/sub-categories/' + code + '/brands', [code]);
  const set = (k, v) => {
    setPage(1);
    setF(prev => ({
      ...prev,
      [k]: v
    }));
  };
  const reset = () => {
    setPage(1);
    setF({
      brand: '',
      product_token: '',
      visibility: '',
      stock_status: '',
      review_status: '',
      missing_price: '',
      missing_stock: '',
      keyword: '',
      sku_id: ''
    });
  };
  const pg = data && data.pagination;
  return /*#__PURE__*/React.createElement(Page, {
    title: "分類瀏覽",
    sub: ""
  }, /*#__PURE__*/React.createElement("nav", {
    className: "crumb small",
    "aria-label": "breadcrumb"
  }, /*#__PURE__*/React.createElement("button", {
    className: "linklike",
    onClick: onBackAll
  }, "分類瀏覽"), data && /*#__PURE__*/React.createElement(React.Fragment, null, " ", /*#__PURE__*/React.createElement("span", {
    className: "muted"
  }, "›"), " ", /*#__PURE__*/React.createElement("button", {
    className: "linklike",
    onClick: onBackAll
  }, data.main_cat.name), /*#__PURE__*/React.createElement("span", {
    className: "muted"
  }, "›"), " ", /*#__PURE__*/React.createElement("button", {
    className: "linklike",
    onClick: onBack
  }, data.sub_cat.name), tokenName && /*#__PURE__*/React.createElement(React.Fragment, null, " ", /*#__PURE__*/React.createElement("span", {
    className: "muted"
  }, "›"), " ", /*#__PURE__*/React.createElement("b", null, tokenName)), !tokenName && /*#__PURE__*/React.createElement(React.Fragment, null, " ", /*#__PURE__*/React.createElement("span", {
    className: "muted"
  }, "›"), " ", /*#__PURE__*/React.createElement("b", null, "所有 SKU")))), /*#__PURE__*/React.createElement("div", {
    className: "panel"
  }, tokenName && /*#__PURE__*/React.createElement("div", {
    className: "toolbar",
    style: {
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "tag"
  }, "產品符號：", tokenName), /*#__PURE__*/React.createElement("button", {
    className: "linklike small",
    onClick: onBack
  }, "← 返回產品符號")), /*#__PURE__*/React.createElement("div", {
    className: "toolbar filters"
  }, /*#__PURE__*/React.createElement("input", {
    placeholder: "關鍵字（名稱/SKU/品牌/規格）",
    value: f.keyword,
    onChange: e => set('keyword', e.target.value),
    "aria-label": "關鍵字"
  }), /*#__PURE__*/React.createElement("input", {
    placeholder: "SKU ID",
    value: f.sku_id,
    onChange: e => set('sku_id', e.target.value),
    "aria-label": "SKU ID"
  }), /*#__PURE__*/React.createElement("select", {
    value: f.brand,
    onChange: e => set('brand', e.target.value),
    "aria-label": "品牌"
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, "全部品牌"), (brands || []).map(b => /*#__PURE__*/React.createElement("option", {
    key: b,
    value: b
  }, b))), /*#__PURE__*/React.createElement("select", {
    value: f.visibility,
    onChange: e => set('visibility', e.target.value),
    "aria-label": "顯示狀態"
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, "顯示/隱藏"), /*#__PURE__*/React.createElement("option", {
    value: "visible"
  }, "顯示"), /*#__PURE__*/React.createElement("option", {
    value: "invisible"
  }, "隱藏")), /*#__PURE__*/React.createElement("select", {
    value: f.stock_status,
    onChange: e => set('stock_status', e.target.value),
    "aria-label": "庫存狀態"
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, "全部庫存"), /*#__PURE__*/React.createElement("option", {
    value: "IN_STOCK"
  }, "有貨"), /*#__PURE__*/React.createElement("option", {
    value: "LOW_STOCK"
  }, "少貨"), /*#__PURE__*/React.createElement("option", {
    value: "OUT_OF_STOCK"
  }, "缺貨"), /*#__PURE__*/React.createElement("option", {
    value: "PREORDER"
  }, "預購"), /*#__PURE__*/React.createElement("option", {
    value: "UNKNOWN"
  }, "離線")), /*#__PURE__*/React.createElement("select", {
    value: f.review_status,
    onChange: e => set('review_status', e.target.value),
    "aria-label": "覆核狀態"
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, "全部覆核"), /*#__PURE__*/React.createElement("option", {
    value: "PENDING"
  }, "待覆核"), /*#__PURE__*/React.createElement("option", {
    value: "CONFIRMED"
  }, "已確認"), /*#__PURE__*/React.createElement("option", {
    value: "NONE"
  }, "無")), /*#__PURE__*/React.createElement("label", {
    className: "small"
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: !!f.missing_price,
    onChange: e => set('missing_price', e.target.checked ? '1' : '')
  }), " 缺價"), /*#__PURE__*/React.createElement("label", {
    className: "small"
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: !!f.missing_stock,
    onChange: e => set('missing_stock', e.target.checked ? '1' : '')
  }), " 缺庫存"), /*#__PURE__*/React.createElement("button", {
    className: "ghost",
    onClick: reset
  }, "重設")), loading ? /*#__PURE__*/React.createElement(Loading, null) : err ? /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Err, {
    m: err
  })) : !data || !data.rows.length ? /*#__PURE__*/React.createElement("div", {
    className: "empty"
  }, Object.values(f).some(v => v) ? '沒有符合條件的 SKU' : '此 Sub Cat 暫時沒有 SKU', " ", Object.values(f).some(v => v) && /*#__PURE__*/React.createElement("button", {
    className: "ghost",
    onClick: reset
  }, "清除篩選")) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "table-wrap"
  }, /*#__PURE__*/React.createElement("table", {
    className: "sku-table"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "SKU ID"), /*#__PURE__*/React.createElement("th", null, "品牌"), /*#__PURE__*/React.createElement("th", null, "產品名稱"), /*#__PURE__*/React.createElement("th", null, "規格"), /*#__PURE__*/React.createElement("th", null, "Product Token"), /*#__PURE__*/React.createElement("th", null, "折後價"), /*#__PURE__*/React.createElement("th", null, "Key 排名"), /*#__PURE__*/React.createElement("th", null, "顯示狀態"), /*#__PURE__*/React.createElement("th", null, "庫存狀態"), /*#__PURE__*/React.createElement("th", null, "價格更新"), /*#__PURE__*/React.createElement("th", null, "庫存更新"), /*#__PURE__*/React.createElement("th", null, "覆核"))), /*#__PURE__*/React.createElement("tbody", null, data.rows.map(s => /*#__PURE__*/React.createElement(React.Fragment, {
    key: s.id
  }, /*#__PURE__*/React.createElement(CatSkuRow, {
    s: s
  })))))), /*#__PURE__*/React.createElement(Pagination, {
    pg: pg,
    onPage: setPage
  }))));
}
function CatSkuRow({
  s
}) {
  const [open, setOpen] = useState(false);
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("tr", {
    onClick: () => setOpen(!open),
    style: {
      cursor: 'pointer',
      background: open ? '#f0f6ff' : 'inherit'
    },
    tabIndex: 0,
    onKeyDown: e => {
      if (e.key === 'Enter') setOpen(!open);
    },
    "aria-expanded": open
  }, /*#__PURE__*/React.createElement("td", {
    className: "mono small"
  }, /*#__PURE__*/React.createElement(ChanBadge, {
    sku: s.sku_id
  }), " ", s.sku_id), /*#__PURE__*/React.createElement("td", {
    className: "small"
  }, s.brand || /*#__PURE__*/React.createElement(Null, null)), /*#__PURE__*/React.createElement("td", {
    className: "sku-name small",
    title: s.product_name
  }, s.product_name), /*#__PURE__*/React.createElement("td", {
    className: "small"
  }, s.packing_spec || '—'), /*#__PURE__*/React.createElement("td", {
    className: "small"
  }, s.product_token || /*#__PURE__*/React.createElement(Null, null)), /*#__PURE__*/React.createElement("td", null, fmt$(s.discount_price)), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(RankBadge, {
    s: s
  })), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(VisBadge, {
    v: s.is_invisible
  })), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(StockBadge2, {
    s: s.stock_status
  })), /*#__PURE__*/React.createElement("td", {
    className: "small muted"
  }, fmtTime(s.price_updated_at)), /*#__PURE__*/React.createElement("td", {
    className: "small muted"
  }, fmtTime(s.stock_updated_at)), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(ReviewBadge, {
    s: s.review_status
  }))), open && /*#__PURE__*/React.createElement(SkuDetail, {
    sku: {
      id: s.id,
      external_sku_id: s.sku_id,
      raw_sku_name: s.product_name
    }
  }));
}
function Pagination({
  pg,
  onPage
}) {
  if (!pg) return null;
  const {
    page,
    total_pages,
    total_rows,
    page_size
  } = pg;
  const start = (page - 1) * page_size + 1,
    end = Math.min(total_rows, page * page_size);
  const pages = [];
  for (let i = 1; i <= total_pages; i++) pages.push(i);
  const win = pages.filter(p => p === 1 || p === total_pages || Math.abs(p - page) <= 2);
  const seq = [];
  let last = 0;
  for (const p of win) {
    if (p - last > 1) seq.push('…');
    seq.push(p);
    last = p;
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "pagination",
    role: "navigation",
    "aria-label": "分頁"
  }, /*#__PURE__*/React.createElement("span", {
    className: "small muted"
  }, "顯示 ", total_rows ? start : 0, "–", end, "，共 ", total_rows, " SKUs · 第 ", page, "/", total_pages, " 頁"), /*#__PURE__*/React.createElement("span", {
    className: "pg-btns"
  }, /*#__PURE__*/React.createElement("button", {
    className: "ghost",
    disabled: page <= 1,
    onClick: () => onPage(page - 1),
    "aria-label": "上一頁"
  }, "‹ 上一頁"), seq.map((p, i) => p === '…' ? /*#__PURE__*/React.createElement("span", {
    key: 'e' + i,
    className: "muted"
  }, "…") : /*#__PURE__*/React.createElement("button", {
    key: p,
    className: "ghost" + (p === page ? ' active-pg' : ''),
    onClick: () => onPage(p),
    "aria-current": p === page ? 'page' : undefined
  }, p)), /*#__PURE__*/React.createElement("button", {
    className: "ghost",
    disabled: page >= total_pages,
    onClick: () => onPage(page + 1),
    "aria-label": "下一頁"
  }, "下一頁 ›")));
}

// ---------- router ----------
function App() {
  const [route, setRoute] = useState(location.hash || '#/');
  useEffect(() => {
    const h = () => setRoute(location.hash || '#/');
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  const pages = {
    '#/': Overview,
    '#/categories': Categories,
    '#/groups': Groups,
    '#/tokens': Tokens,
    '#/keys': Keys,
    '#/skus': Skus,
    '#/tester': Tester,
    '#/review': Review,
    '#/import-export': ImportExport,
    '#/audit': Audit,
    '#/settings': Settings
  };
  const C = pages[route] || Overview;
  return /*#__PURE__*/React.createElement(Layout, {
    route: route
  }, /*#__PURE__*/React.createElement(C, null));
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));
