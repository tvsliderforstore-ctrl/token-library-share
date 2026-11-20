# God banner（BB page）更新指示 — 俾負責 Marketing Buddy 嘅 agent

> 來源：Geo dashboard（patch 20261116k13）｜負責人：Jack（HKTVmall O2O MKT）｜呢個檔每次會同 Excel 一齊更新

## 1. 個檔喺邊（GitHub）

- Repo：`tvsliderforstore-ctrl/token-library-share`，branch `main`
- **最新版**：`god_banner/God_banner_latest.xlsx`（每次都讀呢個；舊版唔會保留）
- 呢份指示：`god_banner/README.md`
- 幾時更新：大約每 4 小時，同 Lite app ON/OFF 清單同一時間 — 每次查庫存做完（07:00–19:00，大約 10:30／14:30／18:30）+ 08:00／14:00／18:00。
- 「說明」tab 第 1 行有出檔時間；每次開工先睇時間，同上次做嗰份比較係咪新。
- ⚠️ 呢個 repo 嘅 main 每次 dashboard 發佈都會 force-push 重寫，唔好靠 git 歷史／commit 去搵舊版；只讀最新檔。

## 2. Excel 有咩

| Tab | 用途 |
|---|---|
| 說明 | 時間、數字、規則 |
| **Agent 工作** | **你要做嘅嘢**：63 個 Main BB code 各一行 |
| 摘要 | 每個中類有幾多 facing、補位、缺口 |
| God banner 清單 | 每隻 SKU 嘅詳細資料（名、品牌、價錢、庫存、補位原因） |

「Agent 工作」欄位：

| 欄 | 意思 |
|---|---|
| 要更新 | **Y = 要做**；空白 = 同上一次一樣，唔使郁 |
| BB code（Main BB code） | Marketing Buddy 入面 God banner 嘅 Main BB code |
| 中類／組別 | 參考用（SM／PC） |
| SKU 數 | banner 應該有幾多隻 SKU（最多 120；有啲中類因為缺貨唔夠 120） |
| 新加 SKU／移除 SKU | 同上一次比較，要加入／要刪走嘅 SKU |
| 變動 | 首次（全部更新）／有加／減／只係次序變／冇變／成個中類冇咗（要清空） |
| SKU 清單（按陳列次序） | **banner 最終應該係咩樣**：逗號分隔，第 1 隻放第 1 位 |

## 3. 要做嘅嘢

1. 由 GitHub 攞 `god_banner/God_banner_latest.xlsx` →「Agent 工作」tab。
2. 篩「要更新」= **Y**。
3. 逐行：喺 **Marketing Buddy** 搵返同一個 **Main BB code** 嘅 God banner。
4. 將 banner 嘅 SKU 改成同「SKU 清單（按陳列次序）」**一模一樣**（數量同次序都要啱）：
   - 「移除 SKU」→ 喺 banner 刪走
   - 「新加 SKU」→ 加入
   - 次序跟「SKU 清單」由第 1 位排落去
5. 「變動」= 成個中類冇咗 → 清空嗰個 banner 之前先問 Jack。
6. 做完記低：檔案時間（說明第 1 行）、完成時間、有問題嘅 BB code（例如 SKU 加唔到），報返 Jack。

**如果你漏咗之前幾次**（例如上次做嗰份唔係上一份）：「新加／移除」只係同上一次自動出比較，唔準。直接將每個 BB code 改成「SKU 清單」嘅樣（即係全部 63 行當 Y 咁做）。

## 4. 唔好做

- 63 個 Main BB code 以外嘅 banner、頁面、設定一律唔好郁；唔好為咗「了解系統」去睇其他頁面。要用到其他頁面先問 Jack。
- 唔好自己改 SKU 清單（例如自己揀有貨嘅頂上）：清單已經計好缺貨補位。
- 唔好改 GitHub repo 入面任何嘢（只讀）。
- 唔好存入密碼、登入資料、客人個人資料。

## 5. BB code 範圍（參考）

- SM：BB01000169261 – BB01000169621（食品、飲品、急凍、成人尿片／護墊、家居、寵物）
- PC：BB01000169631 – BB01000169861（營養奶粉、保健、個人護理）
- 街市貨品：BB01000177401 – BB01000177421（暫放 SM）
