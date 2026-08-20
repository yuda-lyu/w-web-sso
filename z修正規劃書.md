# w-web-sso 修正規劃書

## 🔴 升級破壞事件(2026-08-20, 引用方 1.0.37 → 1.0.56 原封升級啟動失敗)— 已修復, 根因須引以為戒

> **事件**: 引用方 `rddmanager_sso` 僅升版套件、settings 一鍵未動, 啟動即連撞 `invalid siteUrl` 與 `invalid passwordPolicy` 兩次 throw 無法起服;補鍵啟動後, 舊 DB 全體使用者(含 admin)因密碼雜湊格式變更(scrypt-only)登入失敗且被誤導為「密碼錯誤」計入封鎖。事證要點已收錄於本節與 ADR-050(supersede ADR-047), 原始外部報告文件已閱畢刪除。
>
> **根因(四項, 全為過往 agent 修正輪之治理失誤, 非單一手滑)**:
> 1. **新功能預設強制開啟**: 2026-05-02(`4e58446`)加入自助註冊時 `allowUserRegistration` 出生即預設 `true`, 未曾要求註冊的引用方被迫供應 `siteUrl`——升級即改掉別人的預設行為。
> 2. **新設定無內建預設**: `passwordPolicy` 出生即無條件 throw, 套件自帶 settings 有完整預設值但程式端不採用, 與同檔「未給即回退預設值」慣例相悖;且 unit test 把「缺鍵回 true」寫成通過斷言, 將錯誤預設固化為「已測試之正確行為」。
> 3. **驗收情境永遠是完整 settings**: `genTempSettings` 以自帶 settings 為底只能改值不能缺鍵, 「舊引用方缺鍵升級」路徑零測試覆蓋, 套件自身永遠感覺不到破壞。
> 4. **決策前提未經查證**: ADR-047 寫死「尚無任何主專案引用」採 clean break, 但該前提成立當下 `rddmanager_sso` 已在 1.0.37 上運行——破壞性變更之管理(changelog / 遷移指引 / 版本儀式)被整批豁免。
>
> **附帶格式破壞**: 2026-07-23(`2560145`)為讓 unit test 直測而把 normalize 邏輯抽成函式並自 `WWebSso.mjs` 具名匯出, 破壞主檔 `export default WWebSso` 單一出口格式(內部 helper 洩漏至公開介面)。
>
> **處置(2026-08-20 已全數落地, 驗收通過)**:
> - `allowUserRegistration` 預設改 `false`(opt-in, `=== true` 嚴格判定), 讀取處還原一行式, 包裝函式與具名匯出移除, 主檔還原單一出口
> - `passwordPolicy` 未給採內建預設(`server/defaultPasswordPolicy.mjs`)+`[INFO]`, 有給才逐欄 throw
> - 信件文字鍵(`chpwEmTitle`/`chpwEmContent`/`regVerifyEmTitle`/`regVerifyEmContent`)**恢復完整支援**(2026-08-20 同日二次修正): 初版處置為 WARN 告知改用其他管道, 經業主駁回——settings 既有鍵是安裝方唯一介面, 擴充不可要求搬移;現四鍵皆為優先於內建之覆寫來源(逐語系物件+原樣 `{placeholder}` 置換, 語意同舊版), 廢棄鍵掃描機制隨之移除(已無廢棄鍵)
> - 信件文字架構定案(2026-08-20 同日三次演進, 業主裁決): ①信件 body 為單行 HTML 字串不該做檔案模板——內建預設全數移入 `procLang.mjs` 語系鍵(`*EmContent` 與 `*EmTitle` 成對), 刪除 6 支信件模板檔, `server/template/` 只留複雜模板 `verifyEmailResult.html`;②全部文字鍵(含新增 `resetPwEmTitle`/`resetPwEmContent`/`verifyEmailResultContent`)各值可給文字**或檔案路徑**(基於啟動路徑, 檔案存在即初始化讀檔, 不存在原樣視為文字);③結果頁模板解析統一移至初始化(不在 API handler 內讀檔);④套件自帶 settings.json 補齊全部擴充鍵與預設文字作為安裝方範本(verifyBaseUrl/信件六鍵/verifyEmailResultContent/pathTemplate)——擴充功能未展示於 settings.json = 沒交付完
> - `verifyBaseUrl` 開放 settings 提供(原硬編 localhost 使註冊於非本機實質不可用), 未給回退本機+開註冊時 `[WARN]`
> - `pathTemplate` 開放 settings 指定自訂模板資料夾(缺檔逐檔回退內建), 補上信件 body / 結果頁之引用方客製管道
> - JSDoc `// *` 參數塊補齊 9 個新鍵;unit-register 改測 procCore 真實閘門(`userRegistrationNotAllowed`), 45 unit 全過
> - spec 全文行號引用因本次程式修改漂移, 已以 diff-hunk 位移映射機械校正 299 處並抽驗
> - **驗收**: 兩輪實測啟動成功——①移除三鍵之 1.0.37 式 settings;②安裝方式 settings(缺三鍵+帶四信件鍵原格式), 皆 `[INFO]` 採內建密碼政策、信件鍵零警告、正常監聽
>
> **資料層處置(業主裁決)**: 舊 DB 密碼 hash 不可逆, 由引用方重建重匯入使用者資料解決;套件端不加舊格式相容層(維持 ADR-035 scrypt 單一格式)。
>
> **殘留追蹤(未修, 勿爛尾)**:
> - [x] 版本儀式(2026-08-20 業主裁決): **不升主版號, 維持 1.0.x 照常遞增**.理由: 修復後對 1.0.37 之實質破壞僅剩密碼雜湊+timeVerified(引用方以重建 DB 處置)、SALT 守門(僅影響佔位符 salt, 有 ALLOW_PLACEHOLDER_SALT 逃生口)、信件客製鍵一度停止讀取(同日已恢復完整支援, 不再是破壞)三件;破壞版本早已以 1.0.38~1.0.56 發佈, 補升 2.0.0 攔不到任何人屬純形式.遷移說明由 README Upgrade Notes 承載, 不另做 CHANGELOG.
> - [ ] `siteUrl` 仍為「驗證後傳入 procCore 但零使用」之懸空設定(現已因 opt-in 僅在開註冊時才要求, 破壞面消失), 未來要嘛實際使用要嘛降選填
> - [ ] jsdoc 產出(`docs/`)自始不含任何 `opt.*` 參數(`// *` 行註解格式 jsdoc 不解析, 1.0.37 即如此, 非本次事件造成), 引用方僅能靠原始碼查設定, 待另案改善
> - [x] README Upgrade Notes 已補(2026-08-20 同日): settings 啟動契約 + DB 資料契約遷移作法 + 廢棄鍵替代管道 + SALT 守門

## ✅ 覆核(2026-07-11 主代理派獨立子代理逐項查證)

> 逐項讀碼 + 實跑快速測試複驗本書宣稱: **10/11 屬實**。唯一不符為 S-1 之 `tokenTimeUpdate` 行號原誤植「:160」, 實際位於 `server/procLang.mjs:871`, 已就地訂正(鍵值內容 'Updated time' 本身正確)。無任何待修 code 項。
>
> - **S-2 現況描述準確**: `WWebSso.mjs:916,920` 讀 query.key/value 確無 `_strictStr` guard, 對照 kpfun `getUserInfor`(`:1180-1181`)有 guard —— 維持「非必修」判定。
> - **已完成項逐一屬實**: T-3 fdLog 修復(`procStaInfor.mjs:223/:257/:345` 皆傳 `{ fdLog: logFd }`)、J-1 更名(`api-doubleclick`/`api-getuserinfor` 存在, e2e- 舊名已除)、`filterVpfsByWindow.mjs`(簽章 `(vpfs, tStart, fmt)` + `keyStart.slice(0, bn.length)`, 三支 staLogs 皆 import)、C-1 三處純 key reject(`:1772/:1776/:1779`)、logout E2E-001 改站「使用者資訊」頁(spec 與測試兩處 act 同步)、`normalizeAllowUserRegistration` 具名匯出且 unit-register 直測真實函式、`mmIpsListMsg.eng` 已為 IPs 描述(`procLang.mjs:280`)。
> - **實跑**: unit-register **24 passing** / unit-staLogs **5 passing**;`server/staLogs/` 下舊 `test_` 零斷言 demo script 已不存在。
> - **後續(同日業主授權執行)**: S-2 之 `_strictStr` guard 已補一行並驗證無迴歸, 詳 S-2 節。

## 🔍 稽核追加(2026-07-11 三維度稽核 + 主代理回查降級期改動)

> 本輪含兩件事: (1)三維度稽核(架構/風格/弱點, opus 半邊 + 主代理複查);(2)回查潛在模型降級期之改動有無誤修。**結論: 無誤修**(baseline 重產皆查到真根因、產品碼經 356/0 驗證、測試斷言只強化未弱化)。以下記 2 項計畫外但正確之順手改動(§5 違反, 保留+補記)+ 1 項低度防禦缺口。

### S-1 [已完成 / 計畫外] 2 處既有 i18n 鍵順手修正(皆正確, 不影響 baseline, 保留)
主代理回查 `git diff server/procLang.mjs` 發現 2 處**既有鍵值被改、未在任何規劃書記載**, 屬弱模型「順手改善」(違反 §5 精準修改)。經查兩者**都是正確修正**, 且都不影響 baseline(故 356/0 無礙), **保留不還原**(還原反而重新引入錯誤):
- `unknow`(`:98`): `Unknow` → `Unknown`(typo。僅 `LayoutContentUserInfor.vue:65,119` 於時間未知時顯示, seed 資料不觸發, 無 baseline 捕獲)。
- `tokenTimeUpdate`(`:871`;2026-07-11 覆核訂正: 原誤植「:160」): `End time` → `Updated time`(該鍵為 tokens 表 `timeUpdate` 欄標題 `LayoutContentTokens.vue:486`, 舊標「End time」語意錯誤;該欄在 1280px 寬 baseline 中被截於畫面外, 無 baseline 捕獲)。
- 教訓: 弱模型易在修 A 時順手改鄰近 B。本輪已逐字比對確認無害, 但記此供後續警覺。

### S-2 [低度 / 防禦深度] `getSsoUserInfor` REST handler 缺 `_strictStr` guard — ✅ 已補(2026-07-11)
- **位置**: `server/WWebSso.mjs:905-935`(讀 `query.key`/`query.value` 未過 `_strictStr`), 對照 kpfun `getUserInfor`(:1180)有 `if (!_strictStr(...)) reject('tokenExpired')`。
- **真痛三條件**: ①合約內=勉強(入口一致性);②已被觀察=否;③後果具體=否 —— 此路徑須先過 admin/app token(funCheckAdmin), 且 HTTP query 值恆為字串/字串陣列, 下游 `_getGenUserByKV` duplicate-check + `getUserInfor` 邊界 `.catch(()=>null)` 中和, 無外洩、無 auth bypass。
- **處置**: 歸「深度防禦入口一致性」低度項, 原判非必修。
- **✅ 已執行(2026-07-11, 業主授權「有什麼需要修改的由你去修」)**: 於 REST handler 讀完 token/key/value 後補一行 `if (!_strictStr(token, key, value)) return Promise.reject('tokenExpired')`, 位置與風格對齊 kpfun `getUserInfor`(guard 先於 srLog 與 callApiByToken 調用計數, 同 kpfun 慣例)。驗證: `node --check` 通過;`npx mocha test/api-getuserinfor.test.mjs` **5 passing / 0 failing**(invalid-token / 非 admin 拒絕 / admin 查詢等路徑皆無迴歸)。

### S 其他(非缺陷, 已查核歸檔)
- `timingSafePasswordEqual`(procCore.mjs:64)死碼(ADR/前輪已標, 不刪)、logoutSsoUser alias(ADR-049)、登入失敗計數含「密碼正確但未驗證」(無安全影響)、token 調用計數只在 5 REST handler(spec B01 契約範圍, kpfun 由 IP 層覆蓋)—— 皆已知, 不列待修。
- **弱點面正面確認**: NoSQL operator injection 各層 isestr/型別 guard 守住、密碼走 verifyPassword(crypto.timingSafeEqual)、無 Vue2 async-arrow 靜默編錯、憑證 log 遮罩 —— 無必修弱點。

---

## ✅ 已破案並修復(2026-07-10 深度調研, **撤回前一版「token 計數器污染」推定**)

**前情**: 全套 `npm test` 曾錄得 245/111 與 278 failing 之大量失敗, 前一版推定為「共用 admin token × token 呼叫次數自動封鎖」之累積污染。**深度調研後該推定不成立, 據實撤回**。

**調研方法與證據鏈(逐層排除)**:
1. **S1**: `api-resetpassword` 於全新 DB+後端**單跑 9/9 綠**(先前失敗之 API-001 過)。
2. **S2**: **全部 8 支 api 檔合跑 40/40 綠**(API-001 + D13 全過)→「api 檔互相污染」不成立。
3. **S3**: 完整 `npm test` 於**真正乾淨基座**(重殺殘留進程 + g.initialData + 重啟後端)重跑 → **342 passing / 14 failing**(對照先前 245/111)。**若 token 計數器理論為真, S3 跑同樣的累積呼叫量應同樣大量失敗——並沒有**。D13 於套件內 4/4 綠、autoblock 於套件內全綠。
4. **結論一(大量失敗的真因)**: 先前 run1-run4 的百餘顆失敗是**操作面環境假象**——多次強殺跑批留下殭屍 mocha/服務進程(事後在 perm 抓到 4 隻同型殭屍)、Windows LMDB 記憶體映射殘留(§11.4)、後端缺位/雙前端互搶所致, 非套件設計缺陷。1,206 筆 tokenExpired 為此類壞境下的次生噪音。
5. **結論二(真正的既有債 = 3 個 suite 共 14 顆過期 baseline, 單跑亦倒)**: S3 的 14 顆失敗全為 pixel mismatch 且**單檔跑同樣失敗**(e2e-tokens 單跑 8/8 倒), 與合併模式無關:
   - `tokens`(eng+cht ×4 case): 側欄選單文字整體 ~7px 位移 —— 與**同日產製**(06-20)之 adduser baseline 對照, adduser 全過而 tokens 全倒, 證明 tokens 該批圖產製當下環境有微差(baseline 自身不一致), 非 UI 迴歸。
   - `ips`(僅 eng ×4 case): **鐵證** —— HEAD 之 `procLang.mjs` `mmIpsListMsg.eng` 為複製貼上錯誤(IP 頁寫著 tokens 的描述 `Provide a list of tokens...`), 工作區已於先前輪次修正為 `Provide a list of IPs, which can be blocked, etc.` 但**未重產 baseline** → 舊圖拍的是錯字版。cht 值未變故 cht 全過, 與觀察完全吻合。
   - `logout`(eng+cht E2E-001): **⚠ 此行原診斷有誤, 2026-07-11 審計輪訂正** —— 真因是 **2026-07-10 之 fdLog 修復讓統計面板復活**(baseline 產製時代統計 RPC 恆 reject, 後台落地頁恆顯示 Waiting data = 意外決定性;修復後變成隨 log 內容變動的活圖表)。第一次重產(07-10 19:18)**誤把活圖表烙進 baseline**(時變炸彈), 審計輪全量(跨午夜)如預測在此炸出全場唯二失敗(354/2)。**正確修法(已執行)**: 依 spec-first 更新 `流程_使用者登出.md` E2E-001(stage1 改站「使用者資訊」頁截圖 —— 該頁內容全由固定 seed 導出, 跨日決定性;統計活圖表非本案例主題不作背景), 測試兩處 act(產圖函式+mocha 本體)同步加入切頁步驟, 重產雙語兩段 baseline, 單跑 ×2 皆 10/10 綠。

**修法(已執行)**: 手術式重產 —— tokens 全檔、ips 僅 eng 4 case(含 E2E-002/003 之分段圖, 注意 `--names` 為「case 閘 + 逐張名閘」雙層過濾, 分段圖名須一併列入)、logout 僅 E2E-001 雙語兩段。重產後單檔驗證: **tokens 8/8、ips 8/8、logout 10/10 全綠**。全量 `npm test` 終驗結果見下方補記。

**最終終驗(2026-07-11 03:19, logout 決定性修法後)**: 全量 `npm test`(30 檔, 2h)= **356 passing / 0 failing** —— 專案全量驗收管線首次完全綠燈。

**操作面教訓(記錄)**: 中斷 mocha 跑批後必須依 §11.4 回驗——殭屍 mocha/服務/LMDB 映射不清乾淨, 之後任何跑批結果皆不可信;本次前一版的錯誤推定正是建立在被污染的觀測上。

---

## ✅ 稽核追加各項處置結果(2026-07-10 執行完畢)

| 項 | 處置 | 結果 |
|---|---|---|
| T-1 | 派 opus 子代理逐筆親驗校正三份 spec trace 行號(禁用偏移量批次推算) | ✔ 查詢使用者資訊 52 筆 trace + ~20 筆散文;自動封鎖 D 區 7 筆(A/B/C 抽驗正確未動);登出 13 筆(含 prompt 未列之 Layout.vue +9 飄移)。**E2E-009 查明**: 2026-05-20 曾存在(「後端取不到 client IP 以封鎖處理」標註不測試), 2026-06-07 spec 三點結構重構時因「只列可測 case」被剔除, 無 baseline 殘留 → 已補缺號說明、不重編號 |
| T-2 | `WWebSso.mjs` 抽出並具名匯出 `normalizeAllowUserRegistration`, A3/A4/A2 改打真實函式 | ✔ unit-register 24 passing;正規化邏輯改壞時測試會轉紅 |
| T-3 | **診斷訂正(原診斷為誤診)**: `srv.mjs` 其實有把 settings 傳入(`WWebSso.mjs:87` `procSettings.getSettings()` 讀 settings.json 含 `logFd:'./logs'`), opt 鏈是通的——與 perm M-8 同型誤診。**真正斷點在 `procStaInfor.mjs`**: `:22` 解構 `logFd`, 但三處呼叫(`:223/:257/:345`)用了**從未定義的 `fdLog`** → 執行期 ReferenceError 被 wsemi cache 吞掉回 undefined → reject `getStaDataFailed`。已修: 三處改 `{ fdLog: logFd }`。D43 契約至此才真正生效 | ✔ 這同時就是 T-4 的根因 |
| T-4 | D13-003 根因即 T-3 之變數名錯配(非效能問題, 批 B 證偽的推測至此收斂) | ✔ **api-stainfor 4 passing / 0 failing**(D13-003 首次轉綠) |
| J-1 | 裁決採方案 A: `git mv` 更名 `api-doubleclick` / `api-getuserinfor`, 同步更新兩檔自身註解 + spec 引用(設計要點與取捨/流程_後台重設使用者密碼)+ `procCore.mjs:806` 註解 + ADR-048 內之待裁決句 | ✔ 舊名全庫僅剩歷史文件(z修正規劃書/z待整合) |
| J-2 | `logoutSsoUser` 確認為 `/api/logoutByToken` 之功能完全相同的重複別名(兩者皆薄包裝 `p.logoutByToken`), 零內部呼叫者。因對外 SSO API 不可單方面下架(可能有外部整合依賴), 保留並凍結 | ✔ 記入 **ADR-049**(deprecated alias, 新整合一律用 logoutByToken;移除須業主確認無外部依賴) |

## 🔍 稽核追加(2026-07-09 主代理親自複查)— 待修正在上、已修正在後

> 針對業主三問:(1)本規劃書內容是否屬實 (2)spec 是否涵蓋重要流程且含細部 (3)test 是否依原則與 spec 完成。方法: 2 個唯讀稽核子代理(spec / test)+ 主代理 fact-check 與親自複查(**已濾除誤報**, 見§三)。

### 一、待修正(經複查確認之缺陷)

**T-1 [doc] spec 執行流程 trace 之 `file:line` 系統性飄移**
- `spec/流程_查詢使用者資訊.md`: 執行流程 trace 全篇飄移(WWebSso ~13-16 行、procCore 不均勻 ~50-99 行; 已實測 `_checkToken` 現於 `procCore.mjs:474`, spec 稱 `:564`)。需重新校正 file:line。
- `spec/流程_自動封鎖機制.md`: A/B/C 區塊行號已正確, 但 **D 區塊(IP 初次偵測)~13 行飄移**(D01 稱 `procProtect:681` 實為 `694`; D06 稱 `723` 實為 `736`, 因中間插入 `getInforsByIpCallApi`/`getCountsByIpCallApi` 未同步); 另「重要流程」E2E-008 直跳 E2E-010, **缺 E2E-009**, 需確認刻意保留或編號遺漏。
- `spec/流程_使用者登出.md`: procCore ~5 行 + 散文引用 `WWebSso:806`(實為 `819`)小幅飄移(輕微, 可併下次維護)。

**T-2 [test] `test/unit-register.test.mjs:275-306` 測試自我斷言複製邏輯, 零回歸保護**
A3/A4/A2 三 case 把 `WWebSso.mjs:278-280` 的 allowUserRegistration 預設正規化邏輯**逐字複製進測試檔自我斷言** → 測「自己抄的公式」, WWebSso 那段改壞仍綠燈(全域 §14.2 現狀指紋)。修法: 改為呼叫真實載入 opt 之路徑, 或匯出正規化函式後呼叫。

**T-3 [code] logFd 設定未接通(本規劃書 §三:149 自揭、未修)**
`srv.mjs` 未傳 logFd 給 WWebSso → `WWebSso.mjs:513` `get(opt,'logFd','')` 取空字串 → 靠 `staLogs` fallback `'./logs'` 才正確; **settings.json 之 logFd 改他值不會生效**(D43 註解意圖落空)。修法: srv.mjs 建構 WWebSso 時傳入 settings 之 logFd。

**T-4 [test] `api-stainfor` 之 `D13-003-ip-summary-counts` 既有失敗(本規劃書標另案)**
回 `getStaDataFailed`, 與批 B 無關之既有 bug(規劃書已證偽「掃描過慢」推測: 批 B 後 staIp worker 僅 252ms 仍失敗)。需另案釐清根因。

### 二、待你裁決(修 or 記為設計取捨)

**J-1 `test/e2e-doubleclick.test.mjs` / `test/e2e-getuserinfor.test.mjs` 命名**
兩檔自述「純 API、無 UI/Playwright/baseline」卻用 `e2e-` 前綴, 與專案慣例(純 API → `api-*`)不符, 曾致稽核者誤套 e2e rubric。**建議更名** `api-doubleclick` / `api-getuserinfor`(較一致); 或決定沿用則把「例外沿用」理由寫入設計要點與取捨.md。因動到檔名(+可能 package.json test glob / CI 引用), 交你定案。

**J-2 `logoutSsoUser`(`WWebSso.mjs:705`)疑似冗餘端點**
呼叫 `logoutByToken`(self-service 登出, 正確不需 admin guard — **非安全問題**); 但 grep 全 repo 無外部 caller、無 SDK helper, 與 `/api/logoutByToken` 之差異未記錄。**建議**: 釐清存在目的後記錄(設計取捨)或評估移除(死碼, 提報不自刪)。

### 三、誤報排除紀錄(稽核 agent 提出、經主代理複查為非缺陷)

- **`getSsoUsersList`「無測試 / 權限守門無驗證覆蓋」= 誤報**: spec 稽核 agent 只掃 `spec/` 未看 `test/`。實際 `test/api-httpendpoints.test.mjs:99-175` 有 4 case 含 **admin 權限邊界**(非 admin viewer → `funCheckAdmin` 擋下 @ :171); `WWebSso.mjs:876` 確為 `{fun: funCheckAdmin}` admin-only(ADR-004 IDOR 收緊)。→ 已追認為設計取捨, 記入 `spec/設計要點與取捨.md` **ADR-048**(對外功能 spec 覆蓋分層)。

### 四、已修正(外層 agent 規劃書批次, 主代理 fact-check 屬實)

| 批 | 主代理驗證 |
|---|---|
| A-3 三表頭註解 byte-equal→pixelmatch | ✓ `ips:869` / `tokens:901` / `resetpassword:920` 已改 |
| A-4 次要 byte-equal 改寫 | ✓ 僅剩 `e2e-setup.mjs:258/319/329` 之 captureStable settle(byte 用詞正確, 本該留) |
| B `filterVpfsByWindow` 共用模組 | ✓ 已建 + 3 支 staLogs 引用 |
| C-1 三處 reject→純 key + api-adduser 斷言 | ✓ `procCore:1772/1776/1779` + `api-adduser:173/187` |
| C-2 spec `timingSafePasswordEqual` 清除 | ✓ `spec/` 0 命中 |
| 未由主代理親驗 | A-1/A-2 `CLAUDE.md`(業主之檔); V-1 e2e-autoblock 18 passing(需 ~5min 重跑始能證) |

> **結論(業主三問)**: (1)規劃書「全部完成」宣稱**屬實**(抽驗項全對)。(2)spec **1:1 涵蓋重要流程**、細部大致足夠, 惟 3 支 trace 之 file:line 飄移(T-1)。(3)test **大致合格**(rubric 抽驗 4 檔五維全過、lifecycle cleanup 全過、spec↔e2e 1:1), 惟 `unit-register` 一處假測試(T-2)+ 2 檔命名待裁決(J-1)。

---

> ## ✅ 執行狀態: **全部完成**(2026-07-09, 由 ds4 執行、主代理逐批獨立驗收)
>
> | 批 | 內容 | 結果 |
> |---|---|---|
> | V-1 | e2e-autoblock 驗證債 | ✔ **18 passing / 0 failing**(含「封鎖到期隱性解除」case, 證實 timer 移除正確) |
> | A | CLAUDE.md 兩項 + 9 處註解訂正 | ✔ 與規劃書逐字相同;勿改三處完好;server/ 與 spec/ 零變更 |
> | B | 三支 staLogs 時間窗過濾(抽共用模組) | ✔ 輸出 **IDENTICAL**;**13.3s → 48ms**(約 280×);安全網與 worker 未動 |
> | C | 3 處 reject 改純 key + 4 處文件訂正 | ✔ lang/kpLang 保留;死碼未刪;hashPassword 未動 |
>
> **測試**: unit+api **71 passing / 1 failing**(唯一失敗為既有 bug `D13-003`, 見批 B 註記);e2e-autoblock **18 passing**。
>
> **⚠️ 規劃書未預見、執行中補做的一項配套**: C-1 改為回傳純 key 後, 既有 `test/api-adduser.test.mjs:172,185` 因斷言「翻譯後整句」而失敗(迴歸 71→69)。經查該二測試名稱本即為 `reject "cannotDemoteSelf"` / `reject "cannotDisableSelf"`, 斷言整句屬**現狀指紋**(全域規範 §14.2), 與專案 `CLAUDE.md`「錯誤回傳一律 err-key」契約相悖。已由主代理將二處斷言改為 `assert.strict.equal(r.err, 'cannotDemoteSelf'/'cannotDisableSelf')` 並加註契約說明。前端 UI 訊息由 `LayoutContentUsers.vue:1458-1473` 自行以 `$t()` 產生、**不經後端**, 故 `e2e-adduser` 之 UI 文字斷言不受影響(已確認)。修正後回到基準 **71/1**。

> **產出日**: 2026-07-09　|　**產出者**: 主代理(跨 4 專案整合)　|　**執行者**: w-web-sso 主責 agent
> **來源**: 整合 `z待整合_API.md` / `z待整合_SSO.md` / `z待整合_PERM.md` / `z待整合_TASK.md` / `z待修正清單.md` 五份文件, 經事實查證與去重仲裁後產出。
> **行號基準**: 2026-07-09 之工作區狀態。**動手前務必先 grep 確認行號**, 勿盲信本文行號(本專案 spec 已出現多處行號飄移, 見 C-2)。

---

## 零、執行紀律(動工前必讀)

1. **只做本規劃書明列之項目**。凍結區(§五)一律不碰 —— 其中多項已在前輪對抗式覆核中判為**鍍金型假痛**, 再度「發現」請直接跳過。
2. **真痛三條件**(全滿足才動手): ①在合約內 ②已被觀察 ③後果具體。「不夠優雅 / DRY / 業界最佳實踐」不是後果。
3. **每批完成即驗收**, 不要一次全改再驗。
4. 暫存檔一律落 `C:\opensrc\w-web-sso\tmp\`;探索用 Glob/Grep/Read, 禁止 dump-to-disk。
5. 不主動 commit。
6. **不得改動任何密碼比對邏輯**(見 C-2, 只改文件)。
7. **不得改動** `test/e2e-setup.mjs` 之 baseline 比對實作與參數預設值、不得改 baseline 圖檔、不得重產標準圖。

---

## 一、背景:業主已拍板之四項全域決策(2026-07-09)

| # | 決策點 | 業主裁示 |
|---|---|---|
| 1 | 全域技能 `role-code-for-test-e2e` 寫死 sso 函式名 | **只描述機制, 不寫死函式名**;函式實名改由各專案 `CLAUDE.md` 落地映射 |
| 2 | 四專案 `CLAUDE.md` 之 `:105`/`:115`/`:124` 自相矛盾 | **方案 A**: 改 `:115` 為契約語意、不點名 API;`:105`/`:124` 維持「禁寫 API 呼叫形式」立場 |
| 3 | spec 內既有之「(pixelmatch 容差)」字樣(本專案 **175 處**) | **B1 保留原樣, 不回頭批次改寫** |
| 4 | 統計 API 之 log 檔全量掃描 | **api / sso / perm 三專案一併修**(統一修法) |

> **已由主代理完成(勿重做)**: 全域技能 `~/.claude/skills/role-code-for-test-e2e/SKILL.md` 之 3 處寫死函式名已移除。
>
> **仲裁紀錄**: `z待整合_SSO.md` 將「log 全量掃描」判為 BORDERLINE(無 benchmark), `z待整合_PERM.md` 判為成立。業主裁示**一併修**(理由: 技術事實明確、修法不改語意、low risk、三專案同構可一次統一風格)。故本規劃書之批 B **為正式任務, 非可選項**。

---

## 二、批 A|e2e baseline 比對機制之文件一致性(doc-only, 零 runtime 風險)

> **事實基準(勿再質疑)**: 本專案 baseline 比對函式為 `assertBaselineMatch(buf, baselinePath, label, opts?)`(`test/e2e-setup.mjs:690`), 使用 **pixelmatch 反鋸齒感知容差**(`includeAA:false` / `threshold:0.1` / `maxDiffPixels` 預設 100, 見 `:691`), **非 byte-exact**。此實作與 `test/e2e-setup.mjs:678` 之註解、以及所有 `spec/流程_*.md` 皆正確。**待修的只是散落的陳舊註解。**

### A-1 |【四專案共通・逐字相同】`CLAUDE.md:115` 改寫

**問題**: `:115` 要求驗證 bullet 寫「以 pixelmatch…容差比對, **非 byte-exact**」, 但 `:105`/`:124` 明文把該類 API 列為「flow 內絕對不寫」。「驗證」正是 flow 五個 bullet 之一 → 規則自相矛盾。本專案因服從 `:115`, 在 spec 內重複同一句話 **175 次**。

- **Before**(逐字):
  ```
  | 3 | **驗證** | 分「語意」(DOM 文字 / URL / 元素存在性, 對應技能[role-code-for-test-e2e] 完整度 rubric #3(Assert 完整))+「視覺」(baseline 檔名 `test/pics/<flow>/<flow>-{eng,cht}-E2E-NNN-name.png`, 以 pixelmatch 反鋸齒感知 + `maxDiffPixels` 容差比對, **非 byte-exact**).共用其他 case 的 baseline 在此寫明(「與 E2E-002 共用 `...E2E-002-wrong-pw.png`, 本案例不另存檔」) |
  ```
- **After**(逐字, 四專案完全相同):
  ```
  | 3 | **驗證** | 分「語意」(DOM 文字 / URL / 元素存在性, 對應技能[role-code-for-test-e2e] 完整度 rubric #3(Assert 完整))+「視覺」(baseline 檔名 `test/pics/<flow>/<flow>-{eng,cht}-E2E-NNN-name.png`).視覺 baseline 一律採**感知容差比對(非逐位元精確)**——此為全專案統一機制, **不強制**逐 case 複述, 若要複述亦不得寫成 API 呼叫形式(見反面清單);機制與本專案落地函式見本檔「e2e baseline 比對落地映射」節.共用其他 case 的 baseline 在此寫明(「與 E2E-002 共用 `...E2E-002-wrong-pw.png`, 本案例不另存檔」) |
  ```

**重要**: 依決策 3(B1), spec 內既有的 175 處「pixelmatch 容差」字樣 **一律不動**。新規則只是把「強制寫」降為「不強制寫」, 既有寫法在新規則下仍合法, 且能被 grep 到作為防誤報之正面陳述。**新寫的 case 可不寫。**

### A-2 |【四專案共通・內容依專案】`CLAUDE.md` 新增「e2e baseline 比對落地映射」節

**理由**: 全域技能已不寫死函式名(決策 1), 其明文要求「函式實名由各專案 `CLAUDE.md` 落地映射」。

**位置**: 插在 `CLAUDE.md` 之「### e2e 測試之標準圖管理」小節**之後**。

**新增內容**(本專案版本, 逐字):

```markdown
### e2e baseline 比對落地映射(全域技能之專案落地)

全域技能[role-code-for-test-e2e]刻意**不寫死**比對函式名(各專案不同).本專案落地如下:

| 項目 | 本專案實作 |
|---|---|
| baseline 比對函式 | `assertBaselineMatch(buf, baselinePath, label, opts?)` — `test/e2e-setup.mjs:690` |
| 比對機制 | **pixelmatch 反鋸齒感知容差**(`includeAA:false`, `threshold:0.1`, `maxDiffPixels` 預設 100 — `test/e2e-setup.mjs:691`), **非 byte-exact** |
| settle 偵測(**勿混淆**) | `captureStable` 內之 `curr.equals(prev)`(`test/e2e-setup.mjs:420`)為連續兩張截圖之**真 byte 比較**, 用於判斷畫面是否已穩定, **與 baseline 比對無關, 刻意如此, 不可改為容差** |
| 失敗證據 | fail-dump 至 `./testPending/<label>__<ts>__{capture,baseline,diff}.png`, 帶 ms timestamp、永不覆蓋 |

> **防誤判**: 下「本專案沒有 pixelmatch / 是 byte-exact」這類否定結論前, 一律先 `grep -rn pixelmatch test/ package.json`, **不可憑函式名 grep 落空即斷言**(全域規範 §4 規則 1).注意: w-web-api 之同功能函式實名為 `assertOrRegenBaseline`, 與本專案不同, 機制相同.
```

### A-3 |【本專案專屬】陳舊註解訂正:直接矛盾者(原 1a)

下列三處表頭註解寫「byte-equal」, 但其下 `verifyBaseline` 實際呼叫 `assertBaselineMatch`(= pixelmatch 容差), **註解與實作直接矛盾**, 曾誤導 agent 誤判。

| 檔案 | 行 | Before(片段) | After |
|---|---|---|---|
| `test/e2e-ips.test.mjs` | 869 | `baseline 比對 helper (內含: 檔存在 / byte-equal / spec 語意斷言)` | `baseline 比對 helper (內含: 檔存在 / pixelmatch 反鋸齒容差 / spec 語意斷言)` |
| `test/e2e-tokens.test.mjs` | 901 | 同上 | 同上 |
| `test/e2e-resetpassword.test.mjs` | 920 | 同上 | 同上 |

### A-4 |【本專案專屬】陳舊註解訂正:用詞過時者(原 1b)

下列各處以「byte-equal」描述「鎖定決定性資料以免浮動」之理由 —— **道理正確、用詞過時**(下游 baseline 比對現為 pixelmatch 容差)。

- `test/e2e-tokens.test.mjs`: `:170`、`:204`、`:464`
- `test/e2e-logout.test.mjs`: `:296`、`:363`
- `test/e2e-stainfor.test.mjs`: `:383-384`
- `test/e2e-setup.mjs`: `:425`

**修法**: 將「byte-equal」之語意改寫為「pixel 穩定 / 可通過 pixelmatch 容差」。**逐處讀原文後改寫, 不要 sed 全域替換**(因 A-5 之處必須保留)。

### A-5 |【本專案專屬】**勿改**清單:byte 用詞正確之處

下列為 `captureStable` 的**穩定態偵測**(判斷連續兩張截圖是否 settle), 是**真 byte 比較**, 與 baseline 比對無關, **刻意如此, 不可改**:

- `test/e2e-setup.mjs:420`
- `test/e2e-stainfor.test.mjs:432`、`:810`

> A-4 與 A-5 混在同一批檔案內, **請逐行判讀**: 語境是「兩張截圖比對是否 settle」→ 屬 A-5 勿改;語境是「baseline 比對」或「資料要固定以免 baseline 浮動」→ 屬 A-4 要改。

### A-6 |【本專案專屬】README 補正面陳述 — **不做**

**主代理判斷**: `w-web-sso/README.md` 為 npm 套件說明(僅 25 行, Documentation / Installation / Example 三節), **無測試章節**。硬插 e2e 比對機制說明對套件使用者是雜訊。防誤報所需之正面陳述已由 A-2 落地映射節(位於 agent 必讀的 `CLAUDE.md`)完整覆蓋。**README 不改。**

---

## 三、批 B|統計 log 檔全量掃描(效能, 三專案統一修法)

### B-1 | 三支 staLogs 開檔前無時間窗過濾

**位置**(三檔皆同一 pattern):
- `server/staLogs/staIp.mjs:41` — `let vpfs = fsTreeFolder(fdLog)`
- `server/staLogs/staToken.mjs:41` — 同
- `server/staLogs/staUserAccountLogin.mjs:41` — 同

**現況**: 取回**全部**保留檔, 完整逐行讀取後才 per-line `t.isAfter(tStart)` 丟棄。

**量級**: w-syslog `hr` 模式穩態約 **8760 檔**, 7 天統計只需約 **168 檔** → **約 50× 浪費**, 隨 uptime 單調成長。統計面板 cache TTL 30 秒(`procStaInfor.mjs:79,105`), 每次 cache miss 重付一次全量掃描。

> 🔴 **已被觀察(主代理實測, 2026-07-09) — 本項已從 BORDERLINE 升格為真痛三條件全滿足**:
> - 本機 `logs/` 現有 **620 個 log 檔**;直接呼叫 `staIp(7,'hr',{fdLog:'./logs'})` 實測耗時 **12.6 秒**(7 天窗實際只需約 168 檔)。
> - 三支合計每次 cache miss 約 **38 秒**。
>
> ✅ **批 B 已完成並驗收(2026-07-09)**: 輸出逐字相同(IDENTICAL), 耗時 **13.3s → 48ms(約 280×)**。
>
> ⚠️ **修正一則先前推測(誠實紀錄)**: 主代理原推測既有失敗之 `D13-003-ip-summary-counts`(錯誤 `getStaDataFailed`)是「掃描過慢」所致, 並寫入「批 B 後應轉綠」之加碼驗收。**該推測已被證偽**: 批 B 後 staIp worker 僅需 **252ms**(實測 `tmp/probeWorker.mjs`), 後處理僅 **2ms**, D13-003 **仍失敗**。
> → **D13-003 為與批 B 無關之既有 bug**, 批 B 前後皆失敗, 不列入批 B 驗收條件。該 bug **不在本規劃書範圍**, 另案回報業主。
>
> 📌 **附帶發現(既有缺陷, 未修, 供業主參考)**: `srv.mjs` **未傳** `logFd` 給 `WWebSso`, 故 `WWebSso.mjs:513` 之 `get(opt,'logFd','')` 取得空字串, 再傳入 `procStaInfor` → `staIp({fdLog:''})`。所幸 `staIp.mjs:19-22` 有 `fallback './logs'` 使行為正確 —— 但這使 `procStaInfor.mjs:22` 之 D43 註解(「承接設定之 logFd, 取代其硬寫預設 './logs'」)**實際未生效**, settings.json 之 `logFd` 若改為他值將不會被 staLogs 採用。

**技術事實**(佐證): w-syslog 檔名為 ISO 前綴(`hr`: `YYYY-MM-DDTHH.log` / `day`: `YYYY-MM-DD.log`), **字典序 ≡ 時間序**;w-syslog 自身之 `cleanLogs` 即依賴此性質(`node_modules/w-syslog/src/WSyslog.mjs:127-128`)。

**統一修法**(三專案風格一致):

> ⚠️ **型別關鍵(主代理實測確認, 2026-07-09)**: `fsTreeFolder()` 回傳的是**物件陣列**, 每筆為
> `{ isFolder:false, level:1, path:'C:\\...\\logs\\2025-07-07T22.log', name:'2025-07-07T22.log' }`。
> 各 staLogs 檔內即以 `vpf.path` 取路徑。**過濾時請用 `vpf.name`**, 不可把 `vpf` 當字串傳給 `path.basename()`。

> ⚠️ **本 snippet 已於 2026-07-10 訂正**(w-web-api 規劃書 P-7b 指出原版有真 bug): 原版簽章 `(vpfs, tStart, timeInterval='hr')` 於內部推導 fmt 且直接 `bn >= keyStart` 比較, 當檔名為 day 粒度(10 字元)而 fmt 為 hr 粒度(13 字元)時, `'2026-07-08' >= '2026-07-08T21'` 為 false → **含 tStart 之當天檔被誤判窗外、漏讀整天資料**。已落地之實作(`server/staLogs/filterVpfsByWindow.mjs`)為下列修正版, **日後勿照抄舊版**:

```js
//filterVpfsByWindow: 開檔前依「檔名時間窗」過濾 log 檔清單, 剔除窗外檔.
//w-syslog 檔名為 ISO 前綴 (hr: `YYYY-MM-DDTHH.log` / day: `YYYY-MM-DD.log`), 字典序 ≡ 時間序,
//故可用字串比較篩選 (w-syslog 自身 cleanLogs 亦依賴此性質, 見 node_modules/w-syslog/src/WSyslog.mjs:127-128).
//邊界檔一律保留, 其內 per-line `t.isAfter(tStart)` 仍為最終判準 → 輸出語意零改變.
//fail-open: 檔名不符 ISO 前綴者一律保留 (寧可多讀, 不可漏讀).
//vpfs 為 fsTreeFolder 回傳之物件陣列, 每筆含 { path, name, isFolder, level }.
//【粒度自適應】比較時以「檔名長度」截取 keyStart: srLog 之 logInterval (決定檔名粒度) 與 staLogs 之
//timeInterval (決定 fmt) 為兩個獨立設定, 兩者不一定相同. 截取後 day 檔比日期、hr 檔比小時, 皆偏保留 (fail-safe).
function filterVpfsByWindow(vpfs, tStart, fmt) {
    let keyStart = tStart.format(fmt)
    return filter(vpfs, (vpf) => {
        let bn = get(vpf, 'name', '').replace(/\.log$/, '')
        if (!/^\d{4}-\d{2}-\d{2}/.test(bn)) {
            return true //fail-open: 非預期檔名一律保留
        }
        return bn >= keyStart.slice(0, bn.length)
    })
}
```

呼叫點(各檔 `let vpfs = fsTreeFolder(fdLog)` 之後緊接一行):
```js
let vpfs = fsTreeFolder(fdLog)
vpfs = filterVpfsByWindow(vpfs, tStart, timeInterval) //開檔前剔除窗外檔
```

> **`tStart` 之取用**: 各 staLogs 檔內已有 `let tStart = now.subtract(timeLength, 'day')`(dayjs 物件)。
> 因 `tStart.format('YYYY-MM-DDTHH')` 與 `tStart.startOf('hour').format(...)` 相同, 直接沿用該 `tStart` 即可, **不要自行重算**。

**共用與否的決定**: 三支各自貼一份 helper **不可接受**(那正是本專案 3c 所指的 DRY 問題)。請抽至 `server/staLogs/` 下之共用模組(例如 `filterVpfsByWindow.mjs`), 三支 import 使用。**此為本批唯一允許的抽取**, 不得順手做 3c 的其他 DRY 合併(見凍結區)。

**硬規則(違反即為越界)**:
1. **不得移除** per-line 之 `t.isAfter(tStart)` 判斷 —— 邊界檔安全網, 亦是輸出語意不變之保證。
2. **不得改動** sync 檔案列舉 / 串流讀取之基礎模型, 不得動 worker plumbing(`callWorker` / `shellWorker`)。
3. **輸出語意必須零改變**。
4. 變數名請對接各檔既有命名, 不要自創。

**驗收**:
```bash
cd C:\opensrc\w-web-sso
node --check server/staLogs/staIp.mjs
node --check server/staLogs/staToken.mjs
node --check server/staLogs/staUserAccountLogin.mjs
npx mocha test/unit-staLogs.test.mjs --reporter list --timeout 300000   # 2026-07-10 起: 舊三支零斷言 demo script 已升級搬移至此(真斷言+粒度覆蓋)
```
> **額外要求**: 三支既有 unit test 未涵蓋「大量檔案 + 窗外檔」情境。執行 agent 須在 `tmp/` 自造 fixture(含窗內 / 窗外 / 邊界檔 / 非 ISO 檔名檔), 驗證 **①窗外檔未被開啟 ②統計輸出與修改前逐字相同**, 並把驗證方式寫進回報。

---

## 四、批 C|本專案專屬之契約與文件修正

### C-1 | 3 處自我保護 reject 回「已翻譯整句」而非 err-key(API 契約一致性)

**位置**: `server/procCore.mjs:1772` / `:1776` / `:1779`

**現況**:
```js
return Promise.reject(get(kpLang, `${lang}.cannotDeleteSelf`, 'admin cannot delete yourself'))
```
(`cannotDemoteSelf` / `cannotDisableSelf` 同款)

**問題**: 全檔約 40 處 reject, **唯這 3 處**把 lang 解析後的整句當 payload, **破壞 key-only 契約**(專案 `CLAUDE.md` 明文 + `server/WWebSso.mjs:526`)。三個 key 皆已存在: `procLang.mjs:1145` / `:1149` / `:1153`。

**修法**: 改為純 key —
```js
return Promise.reject('cannotDeleteSelf')
```
(其餘兩處同理)。前端 `$tErr` 依 lang 翻譯。

**風險評估**: 前端 `src/components/LayoutContentUsers.vue:1458-1473` 已擋這 3 個自我操作, **只有直接打 API 才摸得到** → 屬 API 契約一致性修正, 非 UI 可見 bug。與已核准的 key-only 修法系列(C-6 等)同類。

**注意**: 若 `lang` 變數在改後成為未使用變數, **請一併移除**(自己造成的孤兒變數要清)。

**驗收**: `npm test` 之 unit/api 全綠;確認無其他呼叫端依賴「整句」回傳。

### C-2 | `timingSafePasswordEqual` 文件脫鉤(spec 事實錯誤 + 行號飄移)

**事實**(主代理已讀碼確認):
- `server/procCore.mjs:64-70` 定義 `timingSafePasswordEqual`, **全庫零呼叫**(死碼)。
- 實際密碼比對走 `verifyPassword`(`server/hashPassword.mjs:53`), 其內部使用 `crypto.timingSafeEqual`(`hashPassword.mjs:97`)。
- 呼叫點: `procCore.mjs:324`(loginByAccountAndPassword)、`procCore.mjs:1094`(changeUserPassword)。

**待訂正之文件三處**:

| 位置 | 現況錯誤 | 訂正方向 |
|---|---|---|
| `spec/設計要點與取捨.md:214` | 稱該 helper 在 `procCore.mjs:47`, 且「用於 loginByAccountAndPassword(procCore.mjs:308)與 changeUserPassword(procCore.mjs:1042)」 | 三個行號**全錯**且函式**用錯**。改為: 密碼比對走 `verifyPassword`(`hashPassword.mjs:53`, 內含 `crypto.timingSafeEqual` @ `:97`), 呼叫於 `procCore.mjs:324` 與 `:1094` |
| `spec/設計要點與取捨.md:108` | 拿 `timingSafePasswordEqual` 當**資安論據**(「被…type guard 守住無 auth bypass」)—— 引用死函式當安全機制 | 改為引用實際生效者: `_getGenUserByKV` duplicate check + `verifyPassword` 之型別/長度 guard |
| `spec/設計要點與取捨.md:225` | 列 `server/procCore.mjs:47 (timingSafePasswordEqual helper)` 條目 | 行號錯 + 為死碼。改為指向 `hashPassword.mjs:53 verifyPassword` |

**另**: `server/WWebSso.mjs:519` 註解亦提及 `timingSafePasswordEqual`, 一併訂正為 `verifyPassword`。

**死碼處置**: `procCore.mjs:64-70`(7 行, 含註解)為死碼。依全域規範「既有死碼提出不自刪」——
- **本次不刪**, 於回報中提報, 由業主決定。
- 若業主同意刪除, 需一併確認 `crypto` import 是否成為孤兒。

> **絕對不得改動任何密碼比對邏輯。本項為純文件 + 註解訂正。**

---

## 五、凍結區(**本次不執行**)

### 5.1 已明確駁回(對抗式覆核判為鍍金/過早優化, **勿再提**)

| 項 | 不做理由 |
|---|---|
| `updateTabItems`(procCore.mjs:1291-1493)202 行拆 generic+hook | `if (woName === 'users')` guard 已是清楚邊界;拆分使 spec 4 段 ADR 之逐行引用行號全失效 |
| 登入 2× users 全表掃描合併 | 無 benchmark 之 scaling 假設;合併須讓 hash 密碼穿越封鎖檢查模組邊界, 擴大曝露面 |
| changePassword/adminReset 之 checkToken+getUserByToken 雙掃 tokens | 冷路徑、LMDB in-memory;checkToken 被 15+ 處共用, 合併風險不成比例 |
| procProtect 4 處 `setInterval 2000ms` 抽 settings | 輪詢節奏是內部實作細節, 與業務門檻不同級 |
| `getBlockedByUser`/`getBlockedByOip` 合併 | `procCore.mjs:1626-1627` 已註解刻意保持內部 reject 字串穩定 |

### 5.2 BORDERLINE — 業主未核准, 本次不做

| 項 | 說明 |
|---|---|
| **3a** 撤 token 迴圈於 3 處重複(`procProtect.mjs:149-154` / `procCore.mjs:1442-1445` / `:1799-1802`) | 屬安全關鍵路徑;三處目前一致、未觀察到 divergence bug, 痛點為「未來若再改」→ 不符真痛三條件之②。**凍結** |
| **3c** staLogs / procStaInfor 之 DRY(staIp≈staToken;procStaInfor 三組 cache wrapper) | 純 DRY, 自同次 commit 至今未發散、無踩坑。**凍結**(注意: 批 B 允許為 `filterVpfsByWindow` 抽單一共用模組, **僅此一項**, 不得順手合併 staIp/staToken 骨架) |
| 前端重構(`LayoutContentUsers/Tokens/Ips` 三份後台清單之 grid/save/checkYes 共用度;WTimeminute cell-render 樣板 7 段重複) | 業主已指示**重構凍結**。且此維度之調研本身尚未完成(見 §六)。**凍結** |
| `procCore.mjs` 四處內嵌「select token→0/≥2 筆判斷→reject」樣板未重用 `getTokenByKV`(`:212`) | 同上, 重構凍結 |

### 5.3 死碼(提報不自刪)

- `procCore.mjs:64-70` `timingSafePasswordEqual`(見 C-2)
- `src/components/LayoutContentUserInfor.vue:50,76,103,130` 四處 `v-show="false"` 死 markup(其引用之 i18n 鍵部分已於 `procLang.mjs:163-170` 註解為孤兒)
- `procSettings.mjs:32-40` `setSettings` 匯出後零呼叫(e2e 改 settings 走直接 fs 寫檔繞過此 API)—— **此項證據較弱(推測性)**, 需執行 agent 先 grep 全庫確認再提報

> 以上一律**只提報、不刪除**, 待業主決定。

---

## 六、遺留驗證債(**優先於批 B/C 處理**)

### V-1 | `e2e-autoblock` 迴歸尚未補跑

**背景**: 先前已移除 `procCore.mjs` 之 `cleanUsers` / `cleanIps` 兩組每 2 秒全表掃描 timer(對齊 ADR-013「隱性解除」), unit 41 綠, 但**直接受影響流程之 e2e 尚未跑**。

**阻礙**: 本專案 `test/e2e-setup.mjs` 寫死前端 `127.0.0.1:8080` 且「已占用即沿用」。若 8080 被其他專案之 dev server 佔用, 現在跑會打到**錯誤的前端**得到假失敗。

**執行前置**:
```bash
netstat -ano | grep ":8080 " | grep LISTENING    # 必須為空, 或確認佔用者是本專案自己啟動的
```
- 若被佔用且**非本專案所啟**: **停下回報**, 不要自行 taskkill 他人服務。

**執行**:
```bash
cd C:\opensrc\w-web-sso
npx mocha test/e2e-autoblock.test.mjs --reporter list
```
**必須全綠**。特別關注 `execBlockExpiryImplicitUnlock`(封鎖到期隱性解除)case —— 該 case 斷言純靠「等 33 秒後登入成功」之時間比對, timer 移除後語意不變, 預期通過。

**風險**: low(變更未動封鎖判定路徑, 判定一律走 `getBlockedByUser` 時間比對)。

---

## 七、調研缺口(**不在本次執行範圍**, 供業主排程參考)

- **前端 dup 維度整支未跑**: `LayoutContentUsers.vue`(1548 行)/ `LayoutContentTokens.vue`(920)/ `LayoutContentIps.vue`(765)三份後台清單「整張表編輯」模式之共用度, 及各頁 async 提交是否遵循全域 §5.4 `core()`+`finally` canonical。**尚未調研, 亦在重構凍結範圍內。**

---

## 八、驗收總表

| 批 | 項目 | 風險 | 驗收方式 |
|---|---|---|---|
| V-1 | e2e-autoblock 迴歸 | low | `npx mocha test/e2e-autoblock.test.mjs --reporter list` 全綠 |
| A-1 | `CLAUDE.md:115` 改寫 | 零(doc) | 目視;確認與其他三專案逐字相同 |
| A-2 | `CLAUDE.md` 新增落地映射節 | 零(doc) | `grep -n "assertBaselineMatch" CLAUDE.md` 應命中落地映射節 |
| A-3 | 3 檔表頭註解訂正 | 零(註解) | `grep -c "byte-equal" test/e2e-ips.test.mjs test/e2e-tokens.test.mjs test/e2e-resetpassword.test.mjs` 對應處應歸零 |
| A-4 | 6 處用詞過時註解 | 零(註解) | 逐處目視;**確認 A-5 三處未被誤改** |
| A-5 | 勿改清單 | — | `grep -n "equals(prev)" test/e2e-setup.mjs` 仍在 `:420` |
| B-1 | 三支 staLogs 時間窗過濾 | low | 三支 `test_sta*.mjs` 全綠 + 自造 fixture 對照 |
| C-1 | 3 處 reject 改回 key | low | `npm test` unit/api 全綠 |
| C-2 | spec 三處 + WWebSso.mjs:519 訂正 | 零(doc) | `grep -rn "timingSafePasswordEqual" spec/ server/WWebSso.mjs` 應僅剩 procCore.mjs 之死碼定義 |

**完整驗收指令**:
```bash
cd C:\opensrc\w-web-sso

# 語法
node --check server/procCore.mjs
node --check server/staLogs/staIp.mjs
node --check server/staLogs/staToken.mjs
node --check server/staLogs/staUserAccountLogin.mjs

# staLogs unit
npx mocha test/unit-staLogs.test.mjs --reporter list --timeout 300000   # 2026-07-10 起: 舊三支零斷言 demo script 已升級搬移至此(真斷言+粒度覆蓋)

# 全套(mocha: unit + api + e2e)
npm test
```

> **基準線(動手前狀態, 必須維持)**: unit/api **56/56 綠**;受影響 e2e **53/53 綠**。動手前先跑一次記錄基準。
> 批 A 為純文件/註解變更, **不需重跑 npm test**。批 B/C 動到後端程式碼, 須跑完整驗收。

---

## 九、回報要求

1. 逐項 before/after 之 `file:line` 與實際 diff。
2. 批 B 之 fixture 驗證方法與「輸出逐字相同」之證據。
3. C-2 之死碼提報(`procCore.mjs:64-70`)+ 5.3 其餘死碼之 grep 確認結果, 供業主決定是否刪除。
4. 驗收指令之實際輸出(不要只寫「通過」)。
5. 任何**與本規劃書描述不符**之現況(行號飄移、程式碼已被他人改動)—— **停下回報**, 不要自行推測修改。
