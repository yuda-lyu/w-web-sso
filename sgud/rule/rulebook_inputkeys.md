# 規則帳本(分冊: 使用端字串作鍵與迭代規則)

本檔為規則帳本之分冊(2026-10-22 自 `sgud/rule/rulebook.md` 依類型拆出, 節號與標題不變、內容只搬不刪); 總索引見 `rulebook.md`.

### R-OBJ-ITER-01: 迭代使用端 / log 來源之物件, 只依自有可列舉字串鍵; 數字 `length` 鍵不得使走訪改成陣列樣(2026-10-20, 主控第 90 項; 對應 wsemi `sgud/rule/rulebook.md` 同名規則與 w-web-perm 同日修正)

- **規則**:
  1. lodash `each / forEach / map / filter / reduce / some / every / find / size / sortBy / groupBy / sumBy / includes …` 對具非負整數 `length` 屬性(0 ≤ 整數 ≤ 2^53-1)之**任何**物件改走索引 `0..length-1`、不走自有鍵, 且迭代次數即 `length` 之值. 迭代**使用端或 log 來源**之物件(請求本體之列、統計 log 之 IP / userId 鍵、伺服器回傳給前端之以名稱 / IP 為鍵之物件、JSON 解析結果)一律以 `Object.keys` 走訪(`length` 與其他鍵同為一般鍵, 成本只依實際鍵數); 真陣列以索引走訪; 契約本來是陣列或本程式自建之陣列, 不在本規則範圍.
  2. 來源: 修改前(HEAD `46e1cd4`)`X-Forwarded-For` 標頭第一段即 `verifyConn` 之 `ip`(未驗證格式、未登入者可植入; 2026-10-20 第 93 項起, 非 IP 字串退回連線位址, 見 R-IP-01, 故 `length` 等 IP 鍵之今後來源只剩既有 log〔修改前產生之歷史紀錄、他處植入〕, 本規則之統計端防禦仍須保留), 寫入 `verifyConn` log → `staLogsCore` 以 `ip` 為鍵累計 → 統計頁(`getStaIp`)走訪; `users.id` / `tokens.userId` 由管理端寫入, 為 `length` 者同理(`fun-checkToken` log → `getStaToken`). 後果(HEAD `46e1cd4` 經真實 HTTP 實測): 標頭填 `length` 3 次後, 現時小時桶之 `data` 為 `{ length: 3, '1.2.3.4': …, count }`, `each` 只走 `0,1,2` ——該桶全部真實 IP 之計數與總數 `count` 消失、其餘 168 個桶(經 JSON 回傳後)各多出值為 0 之 `0 / 1 / 2` 三個假鍵(共 504 個; 現時小時桶之假鍵值為 `undefined`, 不被序列化), 假鍵數 = 其餘桶數 × `length` 值; 前端統計頁(使用 / IP 用量表)同型.
- **理由**: 見規則 2 之實測. 單一未登入請求即可使管理者統計頁失真; `length` 值只能靠請求量累積, 不能任意指定, 故 `4294967295` 不能直接達成.
- **盤點指令**:
  - 持有者: `git grep -n -E "lodash-es/(each|forEach|map|filter|reject|reduce|some|every|find|findLast|flatMap|groupBy|countBy|keyBy|partition|sortBy|orderBy|includes|size|toArray|sample|shuffle|merge|mergeWith|mapKeys|mapValues|sumBy|maxBy|minBy|uniqBy)\.js" -- server src srv.mjs g_*.mjs toolg`
  - 逐檔呼叫點: Grep `(^|[^.\w$])(each|forEach|map|filter|reduce|some|every|find|size|sortBy|groupBy|sumBy|includes)\(` 於持有檔, 判迭代對象之來源(使用端物件 / 真陣列 / 內部結構).
  - 可執行版: `test/unit-iterClientObj.test.mjs` 之 `SITE-IT-001`(已套站點不再出現列舉之寫法)、`SITE-SU-001`(前端統計頁).
- **站點全集(2026-10-20; 行號為修正前 HEAD `46e1cd4`; 範圍 `server/`、`srv.mjs`、`g_*.mjs`、`toolg/`、`zMem.mjs`、`src/`〔含 `.vue`〕)**:

| # | 站點 | 迭代對象與來源 | 判定 |
|---|---|---|---|
| 1 | `server/procStaInfor.mjs:263-264` `_getStaToken` 蒐集 userId 鍵 | `staToken` 輸出之 `v.data`: 鍵為 log 之 userId | **已套**(`Object.keys`) |
| 2 | `server/procStaInfor.mjs:290` `_getStaToken` 填入次數 | 同上 | **已套** |
| 3 | `server/procStaInfor.mjs:352-353` `_getStaIp` 蒐集 IP 鍵 | `staIp` 輸出之 `v.data`: 鍵為 `verifyConn` log 之 ip(標頭可植入) | **已套** |
| 4 | `server/procStaInfor.mjs:368` `_getStaIp` 填入次數 | 同上 | **已套** |
| 5 | `server/procCore.mjs:2018` `checkTokenAndUpdateUsersList` 之 `each(rows, (rr) => …)`(自我保護找操作者自己之列) | 客戶端 `rows`; RPC 入口 `WWebSso` `updateUsersList` 以 `isearr` 守門, 故 HEAD 經 RPC 不可達, 屬縱深(本函數單獨呼叫時, `{ length: 2^32-1 }` 空轉; `{ length: 3 }` 回 `cannotDeleteSelf` 而非 `invalidRows`) | **已套**(入口 `isarr` 守門→`invalidRows`, 走訪改索引迴圈) |
| 6 | `server/procCore.mjs:1448` `updateTabItems` 之 `each(rows)`(收集 `_isNew`) | 前一步 `isarr(rows)` 守門(`invalidRows`)後之真陣列 | 刻意不套 |
| 7 | `server/procCore.mjs:1470 / 1541 / 1573 / 1609 / 1626` `each(rows / r.add / r.diff)`、`:1460 / :1725 / :1936 / :2108 map` | `ltdtmapping` 以固定 schema 欄位重建之真陣列, `ltdtDiffByKey` 輸出, 資料庫 `select` 陣列 | 刻意不套 |
| 8 | `server/procCore.mjs:1629` `each(row, (v, k) => …)`(`r.diff` 之列) | 列已於 `:1455` 經 `ltdtmapping` 以 `ds[woName].keys` 重建, 不含 `length`(三表 schema 皆無該欄; 建議書排除項, 已核對) | 刻意不套 |
| 9 | `server/procCore.mjs:1519 / 1533 / 1570 / 1623 / 2094` `each(ltdtOld)` / `each(await tokens.select())`, 及全部 `size(us / ts / oips / tks / recs / rs)` | 資料庫 `select` 之真陣列 | 刻意不套 |
| 10 | `server/procProtect.mjs:760 / 767 / 781` `each(oips)`、`each(ips)`、`map(ipsNew)` | 資料庫陣列, `Object.keys` 陣列, 內部陣列 | 刻意不套 |
| 11 | `server/procProtect.mjs:773` `each(kpIpNew, (v, ip) => …)` | 值恆為 `true`(`length: true` 不構成陣列樣); 容器改為無原型(R-KEY-01)後同步改 `Object.keys` | **已套** |
| 12 | `server/procProtect.mjs:296 / 435 / 807` `pmSeries(kpAccountLoginFailed / kpTokenCallApi / kpIpCallApi, …)` | 值恆為陣列(非數字 `length` 構成陣列樣的條件); 已安裝 wsemi 1.9.21 之 `pmSeries` 對 `length` 數值鍵亦走自有鍵(2026-10-20 實測), 對無原型物件亦正確 | 刻意不套 |
| 13 | `server/WWebSso.mjs:162 / 330 / 331 / 349 / 434`、`server/procLang.mjs`、`srLog.mjs`、`srEmail.mjs`、`ormWrite.mjs`、`getIgnoredOrmKeys.mjs`、`lockSave.mjs`、`hashPassword.mjs`、`genRandomPassword.mjs` | 部署設定(settings / optExt)與內部陣列, 信任邊界為部署方(同 w-web-perm 站點 12) | 刻意不套 |
| 14 | `server/staLogs/staLogsCore.mjs` `mergeAgg` 之 `for (let id in s.kp)`、`filterVpfsByWindow.mjs:18` | `for…in` 非陣列樣; 本機 log 檔清單 | 刻意不套(`kp` 容器改無原型, 見 R-KEY-01) |
| 15 | `src/components/LayoutContentStaInfor.vue:993 / 1063` `each(userData / ipData, (value, key) => …)`(經 `omit(entry.data, 'count')`) | 伺服器回傳之 `data`: 鍵為使用者名稱 / IP; 修正後伺服端輸出 `length` 為真實鍵, 前端不改則同型缺陷移到前端 | **已套**(`src/plugins/staUsage.mjs` `calcUsageSummary`: `Object.keys`) |
| 16 | `src/components/LayoutContentStaInfor.vue:646` `each(keysPick)`、`:608 / :631 / :641 / :695 / :697` `size / groupBy / map` | 程式自建之陣列(`['attempt','success','error']`、`keys()` 之結果)與時間桶陣列 | 刻意不套 |
| 17 | 前端其他(`src/plugins/mUI.mjs`、`mShare.mjs`、`submitGuard.mjs`、`src/store/mutations.mjs`、`appPerms.mjs`、`fetchSsoMsg.mjs`、`getUser*.mjs`、`LayoutContent.vue`、`LayoutContentUsers / Tokens / Ips.vue`、`PageLogin / PageUser.vue`、`AppPermsTags.vue` 等) | 列陣列、`$children`、schema 建表物件(3 鍵)、`runSubmit` 字面鍵 map、常數選單: 皆非使用端 / log 來源之物件, 三清單頁之 `sortBy / size` 對象為伺服端 `select` 產出之陣列(子代理 Explore 逐檔判讀 + 主責 Grep 複核) | 刻意不套 |
| 18 | `g_initialData.mjs`、`toolg/`、`srv.mjs`、`zMem.mjs` | 種子與維運腳本之程式內資料 | 刻意不套 |
| 19 | 下游 `w-orm-lmdb/src/WOrmLmdb.mjs:817` `merge({}, 舊值, 新值)`(同欄位一邊陣列、一邊帶 `length` 物件落入 lodash `merge` 之 `isArrayLikeObject` 分支) | 位於 `node_modules`, 非本套件碼; 本套件經 `adjustData` 先 `clearXSS`, 欄位 schema 為字串 / 簡單型別; 建議書標示未驗證 | **未套**(下游, 由主控登記; 本輪未驗證) |

- **測試**: 見下 R-KEY-01 之測試(兩規則共用 `unit-iterClientObj` / `unit-staUsage` / `api-iterclient`): IT-S-001～004、IT-P-001～002、IT-C-004～005、SITE-IT-001; SU-001～005; IT-A-001～002.

### R-KEY-01: 以使用端 / log 來源之字串為鍵之容器一律無原型; 查值不把該字串當 lodash 路徑(2026-10-20, 主控第 90 項; 對應 w-web-perm R-KEY-01 / R-AUTH-PATH-01)

- **規則**:
  1. 以使用端可決定之字串(帳號、權杖、來源 IP、主鍵、email、log 之 ip / userId)為鍵之容器, 一律以 `Object.create(null)` 建立. 一般物件下, 鍵為 `constructor`、`__proto__`、`toString`、`hasOwnProperty`、`valueOf` 等時: ①`kp[key]` 取得繼承值(函數、`Object.prototype`), `if (!kp[key]) kp[key] = []` 被略過後 `.push` 拋 `TypeError`; ②`__proto__` 之指派被忽略(原始值)或改寫原型(物件值); ③計數 `(kp[key] || 0) + 1` 累加成 `"function Object() { [native code] }1"` 字串; ④wsemi `haskey`(以 `in` 判)為真. 該 `TypeError` 若發生在未 `await` 之 async 呼叫(`verifyConn` 的 `pp.callApiByIp(ip)`、路由的 `pp.callApiByToken(token)`), 為未接住之 rejection → Node 24 預設使行程結束(**單一未登入請求即可使後端結束**, HEAD 實測: `X-Forwarded-For: constructor` / `__proto__`、`/api/checkToken?token=constructor` 皆使後端以離開碼 1 結束).
  2. 查值一律 `kp[key]`(無原型容器)或自有屬性判斷, 不用 lodash `get(kp, key)`: 含 `.` 或 `[` 之字串被解析為路徑(`get(kp, 'a.length')` 取得 `kp.a.length`、`get(item, 'data.1.2.3.4')` 解析為 `data → 1 → 2 → 3 → 4` 而恆得預設值).
  3. 統計輸出之 `count` 為保留字(該桶總筆數; **使用者名稱恰為 `count` 者亦同**——權杖統計最終鍵為使用者名稱, 其筆數併入總數、不另列, `IT-P-003`): `staLogsCore.buildOutputs` 與 `procStaInfor` 於展開明細後以總筆數覆寫 `count`; IP / userId 恰為 `count` 者之筆數已含於總數, 不另列(HEAD: 明細展開蓋掉總數, 該桶總數失真).
  4. R-ERR-01 規則 4 更正: 「`pp.callApiByToken` / `pp.callApiByIp` 函式體只 push 陣列, 不會 reject」僅在容器無原型時成立(本規則前不成立).
- **理由**: 見規則 1 之實測. 原型鍵名與 `length` 皆為 HTTP 標頭 / 查詢參數可送入之合法字串.
- **盤點指令**:
  - 容器: Grep `^\s*(let|const)\s+\w+\s*=\s*\{\s*\}` 與 `\w+\[[A-Za-z_][\w.]*\]\s*(=[^=]|\+=|\|\|=)` 於 `server/`, 逐筆判鍵是否可由使用端決定.
  - 路徑: Grep `(^|[^.\w$])(get|has|set|unset|update|at|result|pick|omit)\([^,()]+,\s*[^'"\s]` 與 `` ,\s*` `` 於 `server/` 與 `src/`, 逐筆判路徑字串是否含使用端值.
  - 可執行版: `SITE-IT-002`(`procProtect` 五容器不以字面 `{}` 建立、不 `get(kpXxxCallApi, …)`; `procStaInfor` 不 `get(kpUsername, …)`; `staLogsCore` 之 `kp` 不以字面 `{}` 建立).
- **站點全集(2026-10-20; 行號為修正前 HEAD `46e1cd4`)**:

| # | 站點 | 鍵之來源 | 判定 |
|---|---|---|---|
| K1 | `server/procProtect.mjs:69 / 74 / 228 / 235-240` `kpAccountLoginFailed`、`cleanKpAccountLoginFailed` | 登入帳號(使用端可註冊 / 輸入任意字串; 帳號為原型鍵名之既存使用者, 登入失敗時 `.push` 拋 `TypeError`, 失敗永不計次、永不封鎖) | **已套**(`mkKp()`) |
| K2 | `server/procProtect.mjs:312 / 401-406 / 414 / 444` `kpTokenCallApi`、`getInforsByTokenCallApi`(`get(kp, token, [])`) | 權杖字串(任意); `callApiByToken` 為未 `await` 之 async 呼叫 → 行程結束 | **已套**(`mkKp()` + `kp[token]`) |
| K3 | `server/procProtect.mjs:468 / 473-474 / 721-726 / 734 / 816` `kpIpCallApi`、`cleanKpIpCallApi`、`getInforsByIpCallApi`(`get(kp, ip, [])`) | `X-Forwarded-For` 第一段(任意字串); `callApiByIp` 為 `verifyConn` 內未 `await` 之 async 呼叫 → 行程結束 | **已套** |
| K4 | `server/procProtect.mjs:759 / 766` `kpIpOld`、`kpIpNew`(`haskey` 判新 IP) | 同 K3(`kpIpNew['__proto__'] = true` 被忽略而該 IP 不登錄; `haskey(kpIpOld, 'constructor')` 恆真而不登錄) | **已套** |
| K5 | `server/staLogs/staLogsCore.mjs:229 / 239 / 292 / 303` `kp`(`scanFile` / `mergeAgg`)、`buildOutputs` 之 `{ count, ...kp }` | log 之 ip / userId; 原型鍵名累加成字串, `__proto__` 遺失, `count` 蓋掉總數 | **已套**(`Object.create(null)`; `count` 保留字) |
| K6 | `server/procStaInfor.mjs:262 / 276 / 299 / 351` `kpCount`、`kpUsername`、`get(kpUsername, userId, userId)`、`cloneDeep(kpCount)` | 同 K5; `get(…, userId)` 把 userId 當路徑(`x.length` 取得名稱字串之長度當鍵) | **已套**(無原型 + `Object.assign`; 自有鍵查值) |
| K7 | `server/procCore.mjs:1469 / 1518 / 1532 / 1539 / 1569 / 1622 / 2093` `kp`(`ckKey`)、`kpIdOld`、`accountToIdOld`、`kpAccount`、`oldById`、`kpOld`、`kpPermsOld` | 清單儲存之主鍵 / email / 帳號(管理端或具寫入權限之 app token 送入; 自助註冊之帳號亦為使用端值) | **已套**(無原型). 修前: 主鍵 / 帳號為 `constructor` 等時 `haskey` 誤判重複(`invalidRows` / `accountDuplicate`), `oldById['constructor']` 取得 `Object` 使新使用者之明文密碼被清為 `undefined`; `__proto__` 主鍵 `oldById['__proto__'] = r` 改寫容器原型 |
| K8 | `server/procCore.mjs:1630` `get(kpOld, [id, k])` | 陣列路徑(不解析 `.` / `[`), `kpOld` 已無原型 | 刻意不套(已安全) |
| K9 | `server/procCore.mjs:112 / 118 / 911 / 1047 / 1204 / 1350`、`server/WWebSso.mjs:1045-1046` `get(kpLang, \`${lang}.${key}\`)` | `lang` 為使用端參數; 查值對象為語系字典(程式常數與部署設定), 無授權 / 資料歸屬語意, 取不到即回預設(空字串或 key 本身) | 刻意不套 |
| K10 | `server/procCore.mjs:1473` `get(v, key, '')`、`:1624 / 1627` `get(v, keyDetect, '')` | `key` / `keyDetect` 為程式常數(`'id'`、`'email'`) | 刻意不套 |
| K11 | `server/procCore.mjs:137` `woItems.users.select({ [keyUser]: valueUser, … })`(`getSsoUserInfor` 之 `key` 查詢參數) | 使用端指定查詢欄位名(經 `funCheckAdmin` / `readUsers` 權限閘; 非 lodash 路徑, 為資料庫選擇器鍵) | 刻意不套(非本規則範圍; 觀察: 權限閘之後以呼叫者指定之欄位名為選擇器鍵, 列〈已知缺口〉) |
| K12 | `src/components/LayoutContentStaInfor.vue:647 / 705`(`sumBy(vs, \`data.${k}\`)`、`get(item, \`data.${valueKey}\`, 0)`)、`getName` 之 `haskey(kpKey, valueKey)` | 圖表序列鍵: 使用者名稱 / IP; IPv4 含 `.` 被解析為路徑, 逐 IP 圖表與時間分組恆為 0(HEAD 既有缺陷, 與是否植入無關) | **已套**(`getFreqVal` / `groupFreq`〔時間分組之 `data` 為無原型, 外審 sol 指出 `r.data['__proto__'] = n` 被忽略而加總值遺失〕/ 自有鍵判斷) |
| K13 | `src/components/LayoutContentStaInfor.vue:965-1010 / 1035-1080`(`acc` 容器) | 同 K12 | **已套**(`calcUsageSummary` 無原型容器) |
| K14 | `src/components/LayoutContentUsers.vue:931 / 938` `cellFieldErr` / `cellPasswordErr` 之 `get(errMap, v, '')` | 鍵為使用者輸入之 account / email / redir 值: 含 `.` 者被解析為路徑, 可取到他列之錯誤文字首字元(僅誤顯警示) | **已套**(自有鍵查值) |
| K14b | `src/components/LayoutContentUsers.vue:665-666 / 705-706 / 754 / 781` `errItemsByAccount / ByEmail / ByRedir / ByPassword` 之 `kpErr`、`kpAccount`、`kpEmail`(`haskey` 判重複) | 建立側容器(外審 minimax / sol 指出, 初版漏列): 使用者於清單輸入之帳號 / email / 新增列主鍵. 帳號為 `constructor` / `toString` / `hasOwnProperty` / `valueOf` 時 `haskey({}, key)` 恆真 → 前端預檢誤判「帳號重複」而擋下整份清單儲存(後端已放行); 為 `__proto__` 時錯誤字典指派被忽略 | **已套**(`Object.create(null)`; `SITE-IT-003`; e2e-adduser E2E-002～008 × 2 語系 14 / 14 綠) |
| K15 | `src/plugins/mUI.mjs:235 / 239` `get(kpText, key)`、`get(kpFallback, \`${key}.${lang}\`)`(`$tErr` / `$transErr`) | `key` 為伺服器 reject 字串(程式 key 或內部不變量原文); 查無即回 key 本身 | 刻意不套(資訊級, 無授權 / 歸屬語意) |
| K16 | `server/staLogs/staLogsCore.mjs:416 / 447` `kpAgg[f.name]`、`kpRs[r.name]` | 本機 log 檔名 | 刻意不套(非使用端字串) |
| K17 | `server/WWebSso.mjs:412 / 427 / 443 / 453` | 部署設定(settings)之字典 | 刻意不套 |
| K18 | `src/plugins/mUI.mjs:303-332` `parseUrlParams` 之 `kp`(`window.location.search` 逐參數指派) | 瀏覽器自身網址參數(外審 sol 指出漏列): `?__proto__=x` 之指派被忽略; 唯一消費端只讀固定鍵(`view`、`token` 等), 不跨信任邊界、無授權 / 歸屬語意, 未證明導航故障 | 刻意不套 |
| K19 | `server/procCore.mjs` `updateTokensList`(`for (let r of rows)` / `map(rows)`)、`updateIpsList` | 權杖清單 `rows`(外審 minimax 指出與使用者清單守門不對稱): 資料通道入口以 `isearr` 守門, 直呼時非陣列原拋 `TypeError: rows is not iterable` | **已套**(入口 `isarr` 守門 → `invalidRows`; `IT-C-006`); `updateIpsList` 直接進 `updateTabItems`(已有守門) |

- **更正**: 本檔〈專案特有機制〉原載「後端忽略 `X-Forwarded-For`, IP 類統計不用 XFF 製造」不成立——`verifyConn` 取 XFF 第一段為來源 IP(`getIpByHeaders`); 僅 `/api/cleanKpIpCallApi`、`/api/cleanKpAccountLoginFailed` 兩個本機放行端點取 socket 位址(已更正該條).
- **測試**: `test/unit-iterClientObj.test.mjs`(IT-S / IT-P / IT-K / IT-C / SITE, 18 案)、`test/unit-staUsage.test.mjs`(SU-001～005 + SITE-SU-001)、`test/api-iterclient.test.mjs`(IT-A-001～003d, 6 案, 經真後端 / 真 HTTP / 資料通道; 以臨時 settings 之 `logFd` 隔離統計 log). 修前紅: 18 案中 17 案失敗(IT-S-004 為對照), api 6 / 6 失敗(IT-A-003a～d 之 HEAD 行為為後端行程結束), 前端邏輯另以修前逐行複本重現(`tmp/evidence/`).

### R-CNT-01: 以使用端字串為鍵之計數容器, 週期剪枝後窗內無紀錄之鍵須刪除(不留空陣列)(2026-10-20, 主控第 93 項)

- **規則**:
  1. 容器 `kpAccountLoginFailed`、`kpTokenCallApi`、`kpIpCallApi`(procProtect; 鍵為帳號 / 權杖 / 來源 IP, 使用端可植入互異字串)之剪枝, 一律經 `pruneKpKey(kp, key, times, timeStart)` 單一擁有: 窗內無紀錄 → `delete` 該鍵, 有 → 換成只含窗內紀錄之陣列; 回傳窗內紀錄. 三個剪枝計時器(`accountLoginFailedPrune`、`tokenCallApi`、`ipCallApi`)皆呼叫它, 不再各自 `kp[key] = recs`. 窗口起點含邊界: 恰在 `timeStart` 之紀錄保留(`>=`).
  2. identity 守門: `kp[key]` 已不是計時器讀取時之陣列(`times`)者——計時器逐鍵 `await` 封鎖寫入之間, `cleanKpIpCallApi` / `cleanKpAccountLoginFailed` 可能已換掉整個容器、或該鍵已被重建 / 刪除——`pruneKpKey` 回 `null` 且不更動(不得以舊陣列覆蓋 / 刪除新紀錄), `tokenCallApi` / `ipCallApi` 計時器遇 `null` 略過該鍵(**不得以舊快照之紀錄作為封鎖依據**: 管理端清空計數後, 尚未處理的鍵不應再依清空前的紀錄被封鎖; 修改前會).
  3. 登入成功清除該帳號之失敗紀錄改為 `delete kpAccountLoginFailed[account]`(原置為空陣列而留鍵至下一輪剪枝).
  4. 與 `ipDetectNew` 之關係: 偵測新 IP 取 `Object.keys(kpIpCallApi)` 對 `ips` 表登錄, 且於**讀完 `ips` 清單後才取鍵**(讀取等待期間已被剪枝刪鍵者不登錄、同期新出現者一併登錄; 修改前於讀取前取鍵). 已知限制: ①鍵於窗口(`minForIpCallApi`, 預設 10 分鐘)內無新請求即刪; 偵測每 2 秒, 窗內至少 N 輪, 故正常情況每個 IP 皆被登錄; 偵測**連續失敗超過整個窗口**(資料庫持續不可用逾 `minForIpCallApi` 分鐘, 失敗皆記 `timer-error`)時, 窗內僅請求過一次之 IP 不再補登, 該 IP 再次請求即重建鍵並登錄(修前鍵永久殘留故最終補登). ②取鍵之後到登錄完成之間(僅剩 `ips.insert` 一次寫入)已開始的輪次仍可能登錄當時存在之鍵——「窗口過後不再復活」指新輪次, 不保證在途輪次. ③管理者自 `ips` 表刪除某 IP 列後, 修前每 2 秒被偵測計時器重新登錄(鍵永久殘留); 修後窗口過後不再復活(窗內仍會, 與修前同).
  5. `pp.getKpKeyCounts()` 回三容器目前之鍵數(診斷用, `pp` 為套件內部物件非對外 API), 供測試與日後監控觀察鍵確實退場.
- **理由**: 修前 `tokenCallApi` / `ipCallApi` 之剪枝只換陣列、不刪鍵, 未登入請求每換一個權杖參數或標頭值就多一個永久殘留之空陣列鍵(長時間運行記憶體無上限成長, 且每 2 秒的剪枝與偵測計時器走訪全部鍵). `kpAccountLoginFailed` 原即由計時器刪鍵, 但成功登入後留空鍵至下一輪.
- **盤點指令**: `git grep -n -E "(let|const)\s+\w+\s*=\s*(mkKp\(\)|new Map\(\)|new Set\(\)|Object\.create\(null\))" -- server`(逐筆判鍵是否使用端可決定、是否有退場); `git grep -n -E "kp(AccountLoginFailed|TokenCallApi|IpCallApi)\[[^\]]+\]\s*=" -- server`(賦值只應出現在建鍵 `[]` 與 `pruneKpKey`). 可執行版: `unit-countKeys` 之 `SITE-CNT-001`(剪枝計時器不直接賦值 `kp[key] = recs`、`pruneKpKey` 單一定義 3 處呼叫、三計時器呼叫點).
- **站點全集(2026-10-20)**:

| # | 站點 | 鍵之來源 / 退場 | 判定 |
|---|---|---|---|
| C1 | `procProtect.mjs` `kpAccountLoginFailed`(`accountLoginFailedPrune`; 成功登入 `delete`) | 登入帳號; 窗內無紀錄即刪鍵(改經 `pruneKpKey`) | **已套** |
| C2 | `procProtect.mjs` `kpTokenCallApi`(`tokenCallApi`) | 權杖字串; 修前只剪紀錄不刪鍵 | **已套** |
| C3 | `procProtect.mjs` `kpIpCallApi`(`ipCallApi`) | 來源 IP; 修前只剪紀錄不刪鍵 | **已套** |
| C4 | `procCore.mjs` `lastResendTime` / `lastResetTime`(Map: 帳號 / 目標使用者 id → 時戳, 30 秒節流) | 僅於 `save` 成功後寫入, 鍵限既有使用者, 鍵集以使用者數為界、值為單一數字; 不隨請求值增生 | 刻意不套(列觀察: 條目不退場, 規模 ≤ 使用者數) |
| C5 | `procCore.mjs` `kmx`(`pmKeyMutex`)、`cst`(`cacheSt`) | wsemi 實作: `pmKeyMutex` 於 `finally` 計數歸零即刪鍵(2026-10-20 讀 `node_modules/wsemi/src/pmKeyMutex.mjs`); `cacheSt.setWithFree` 於 fn 結束即釋放 | 刻意不套(套件自管) |
| C6 | `staLogs/staLogsCore.mjs` `kpCache` / `kpInflight` | 鍵為 `fdLog` 絕對路徑與快取鍵(設定與視窗), 非使用端字串; `kpInflight` 於結束刪 | 刻意不套 |
| C7 | `ips` 表(資料庫) | 合法格式之大量互異 IP 仍可使列數成長 | 刻意不套(屬 R-IP-01 規則 4 之自填範圍; 防火牆之責) |
| C8 | 權杖容器無對應的 clean 端點(帳號、IP 容器有) | 外審 minimax 指出清理能力不對稱; 屬既有設計(清除端點供 e2e / 運維重置帳號與 IP 計數), 新增端點為另案 | 刻意不套(觀察) |

- **測試**: `test/unit-countKeys.test.mjs`(CNT-001～011、SITE-CNT-001 共 12 案; 真實 `procProtect` 工廠 + 攔得之計時器回呼 + `withFakeClock` + `getKpKeyCounts`): CNT-001 權杖、CNT-002 IP 窗口過後鍵退場; CNT-003 同鍵新舊混合只留窗內; CNT-004 窗內全有者不動; CNT-005 原型鍵名與 `length` / `count` / 含 `.` 之鍵可退場; CNT-006 300 組互異權杖 / IP 過期後全數退場; CNT-007 identity 守門(計時器停在封鎖寫入時容器被換掉, 新紀錄不被舊陣列覆蓋); CNT-008 帳號容器鍵退場、成功登入即刪鍵、行為不變; CNT-009 容器被換掉後不以舊快照封鎖; CNT-010 窗口起點邊界(三容器恰在起點保留、早 1 ms 剔除); CNT-011 偵測新 IP 於讀取清單等待期間之鍵變動(已刪鍵者不登錄、同期新鍵一併登錄); `test/api-sourceip.test.mjs` IP-A-004(經真後端與真計時器, `minForIpCallApi: 0.1`〔6 秒〕: 窗口過後被刪之 `ips` 列不復活)、IP-A-005.
- **修前紅 / 變異**: 修前紅同 R-IP-01(CNT-001～011 與 SITE-CNT-001 於 HEAD 全數失敗). 變異(同上 23 項全數轉紅): M8 `pruneKpKey` 不刪空鍵 → CNT-001 / 002 / 003 / 005 / 006 / 008 / 010 + IP-A-004; M9 移除 identity 守門 → CNT-007 / CNT-009; M9b 不符時仍回舊紀錄供封鎖 → CNT-009; M10 / M11 `ipCallApi` / `tokenCallApi` 改回直接賦值 → CNT-002 / 003 / 005 / 006 / 007 / 010 與 CNT-001 / 003 / 005 / 006 / 010 + SITE-CNT-001; M12 偵測改回讀取前取鍵 → CNT-011; M13 成功登入改回置空陣列 → CNT-008; M14 窗口起點 `>=` 改 `>` → CNT-010; M15 帳號剪枝計時器停擺 → CNT-008 / SITE-CNT-001.
- **外審採納(sol / minimax)**: 舊快照不得作為封鎖依據(規則 2, CNT-009)、偵測取鍵時點(規則 4, CNT-011)、成功登入刪鍵(規則 3)、鍵數觀察改用 `getKpKeyCounts`(取代「`getInforsBy*` 連呼是否同一陣列」之判準, 該判準依賴實作細節且觀察不到帳號容器)、窗口起點邊界案. 不採: 權杖容器補 clean 端點(C8, 另案).

