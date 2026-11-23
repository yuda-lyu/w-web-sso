# 證據: 統計 `timeLength` 入口檢測(301)、前端 console 摘要(206)、e2e 等待條件事件化(389)(2026-11-23)

對應 `spec/設計要點與取捨.md` ADR-106／107／108 與 `sgud/rule/` 之 R-STA-TIMELENGTH-01、R-LOG-02、R-E2E-WAIT-01. 腳本皆於套件根執行.

## 第 301 項

| 檔 | 內容 |
|---|---|
| `repro301-run.mjs` | 最小重現: 逐候選以逾時保護之子行程(`test/tools/timeLengthChild.mjs`)跑統計各層, 逾時視為同步無窮迴圈; 用法 `node spec/evidence/tws1-20261123/repro301-run.mjs <輸出 jsonl> [逾時 ms]` |
| `repro301-prefix.jsonl` | 修前(HEAD)實測: 31 候選, 14 個逾時(`timeLength` 為 `NaN`、`±Infinity`、`-1e9`、`100000`、`1e20`、`'abc'`、`{}`; `opt.timeNow` 為 `NaN`、`±Infinity`、`1e300`、`±8.64e15`) |
| `repro301-postfix.jsonl` | 修後同一組候選: 無逾時, 14 個無效候選於各層皆被拒為固定鍵 `errTimeLengthInvalid`(`genPlan` 同步 throw、`staLogs` reject), 合法候選桶數不變 |
| `301-red-prefix-mocha.txt` | 修前碼鏡像根(`git archive HEAD` 之 `server`／`src` 加 shim)跑新測試 `unit-staLogs-timeLength` 之案例清單: 16 passing／52 failing(TL-001 因 shim 為紅, 其餘紅來自修前真實行為) |
| `mutation-results.json` | 變異驗證結果(33 項: 32 擊殺、1 等價; 另含 2 個對照組) |

## 第 206 項

| 檔 | 內容 |
|---|---|
| `inv206.mjs` | 盤點: `src/` 下全部可執行 console 站點(檔:行、`SRV`／`FRONT`、`VALUE`〔引數可能印值〕／`ok`、文字); 用法 `node spec/evidence/tws1-20261123/inv206.mjs` |
| `206-sites-prefix.tsv`、`206-sites-postfix.tsv` | 修前／修後之盤點輸出(修後 `VALUE` 只剩引用方後端之 `fetchSsoMsg.mjs`) |
| `206-inventory.tsv` | 48 站修前／修後逐字(欄位: `檔:行`、修前、修後) |
| `206-red-prefix-mocha.txt`、`206-red-prefix-violations.txt` | 修前碼之 `src` 跑 `unit-consoleNoValuesFront`: CNVF-001 紅, 48 處違規 |

## 第 389 項

| 檔 | 內容 |
|---|---|
| `probe389.mjs`、`probe389-reporter.cjs`、`probe389-run.mjs` | 負載探測: 同一行程重複載入 `e2e-autoblock.test.mjs` N 次(伺服端共用、每案 fresh browser), 啟動器起 ≤ 核數 − 2 個低優先權 CPU 燒耗行程並於結束時終止回驗; `PROBE_SOURCE=head` 用修前版; `PROBE_LATENCY_MS` 於暫存副本中延遲本機請求(非缺陷之時序變異) |
| `389-head-cpuload.jsonl`、`389-work-cpuload.jsonl` | 6 個 CPU 燒耗行程下修前／修後各 20 案: 20/20 綠(單案 20.0～20.7 秒 vs 17.9～18.7 秒) |
| `389-head-latency{2500,4500,6500,9000}.jsonl`、`389-work-latency9000.jsonl` | 請求延遲 N 毫秒: 修前 2.5／4.5／6.5 秒皆綠、9 秒 0/4(`page.goto: Timeout 15000ms exceeded`, 等待 networkidle); 修後 9 秒 4/4 綠 |

結論與限制見 `sgud/rule/rulebook_test.md` R-E2E-WAIT-01: 修前之固定 12 秒非失敗成因; 原偶紅之現場於允許之負載下重現不出, 回報「已緩解、未證實根除」.
