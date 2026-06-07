# 後台 IP 清單流程

## 觸發

管理員登入後台後，於左側導覽點「Ips list」進入 IP 清單頁（`LayoutContentIps.vue`）。此頁列出系統追蹤的 IP 紀錄（含封鎖到期時間），提供管理員檢視、調整封鎖時間、刪除與儲存。

後端 `getIpsList` / `updateIpsList` 皆以 `funCheckAdmin` 包裝（`server/WWebSso.mjs:1397,1404`），**僅具 admin 權限的有效 token 可存取**；token 無效／過期／非 admin 一律 reject。

## 重要流程

- **E2E-001**
  - title: 管理員進入 IP 清單頁顯示初始檢視態
  - description: 驗證管理員以有效 admin token 登入後台後，自左側導覽進入「Ips list」頁，後端 `getIpsList` 回傳目前系統追蹤之 IP 紀錄並渲染於表格中。本案例為 IP 清單流程之第 1 段（初始檢視態），用於確認頁面開啟時可正常取得資料並呈現，無任何儲存或修改動作，僅驗證初始載入結果。
  - flow:
    - 測試資料：[待撰寫]
    - 操作：[待撰寫]
    - 驗證：[待撰寫]
    - 雙語：[待撰寫]
    - 清理：[待撰寫]

- **E2E-002**
  - title: 管理員修改封鎖時間後儲存成功
  - description: 驗證管理員於 IP 清單頁修改某列之 `timeBlocked` 封鎖到期時間後點「Save」按鈕，後端 `updateIpsList` 以差異更新方式將變更寫入 DB `ips` 表，前端隨即顯示 System message 持久 modal 之儲存成功訊息（i18n 鍵 `ipSaveIpsSuccess`）。依 spec 粒度規則，操作結果一律以 `showCheckYes` 持久 modal 呈現，管理員須點 OK 確認讀過，且該訊息可同時做 pixel 與語意斷言。
  - flow:
    - 測試資料：[待撰寫]
    - 操作：[待撰寫]
    - 驗證：[待撰寫]
    - 雙語：[待撰寫]
    - 清理：[待撰寫]

- **E2E-003**
  - title: 管理員勾選刪除某列後儲存成功
  - description: 驗證管理員於 IP 清單頁勾選某列後執行刪除動作，再點「Save」按鈕送出，後端 `updateIpsList` 透過 diff 將該列自 DB `ips` 表移除，前端顯示 System message 持久 modal 之儲存成功訊息（`ipSaveIpsSuccess`）。本案例與 E2E-002 共享同一條成功路徑與 i18n 訊息，差別僅在於資料異動為「刪除」而非「修改」。
  - flow:
    - 測試資料：[待撰寫]
    - 操作：[待撰寫]
    - 驗證：[待撰寫]
    - 雙語：[待撰寫]
    - 清理：[待撰寫]

- **E2E-004**
  - title: 管理員 token 失效時儲存顯示失敗訊息
  - description: 驗證管理員點 Save 當下其 admin token 已過期或非 admin 時，後端 `checkToken`（內含 `funCheckAdmin`）拒絕請求，前端 `errTemp` 被設值後流程於檢查 errTemp 階段中止，顯示 System message 持久 modal 之儲存失敗訊息（i18n 鍵 `ipSaveIpsFail` 後接後端錯誤字串），DB `ips` 表內容不變。依 spec 粒度規則，後端 reject 屬可預期失敗，仍走 `showCheckYes` 持久 modal 而非 `$alert` toast。
  - flow:
    - 測試資料：[待撰寫]
    - 操作：[待撰寫]
    - 驗證：[待撰寫]
    - 雙語：[待撰寫]
    - 清理：[待撰寫]

## 執行流程

```
001  管理員點 Save, 觸發 saveIps  [LayoutContentIps.vue:680]
002      執行非同步流程 core()  [LayoutContentIps.vue:685]
003          開啟 loading  [LayoutContentIps.vue:689]
004          檢查 isError  [LayoutContentIps.vue:692]
005              註: isError computed 恆回傳 ''  [LayoutContentIps.vue:398]
006                  → 此分支為死碼, 永遠不進入 (showCheckYes 不會被觸發)
007          取得當前 opt.rows 與 admin token  [LayoutContentIps.vue:698,707]
008          呼叫後端 updateIpsList(token, rows)  [LayoutContentIps.vue:711]
009              checkToken(token, {fun: funCheckAdmin})  [procCore.mjs:1764]
010                  token 無效 / 過期 / 非 admin:
011                      reject  → errTemp 被設值  [LayoutContentIps.vue:713]
012              updateTabItems('ips', rows, 'id', {resetOrder:false}) 差異更新  [procCore.mjs:1755]
013          檢查 errTemp  [LayoutContentIps.vue:717]
014              非 null (後端 reject):
015                  關 loading, 顯示 System message modal 儲存失敗訊息, return  [LayoutContentIps.vue:719]
016          isModified = false  [LayoutContentIps.vue:724]
017          關 loading, 顯示 System message modal 儲存成功訊息  [LayoutContentIps.vue:728]
018      .catch  [LayoutContentIps.vue:735]
019          非預期例外 → console.log + $alert toast (anUnexpectedErrorOccurred)  [LayoutContentIps.vue:737]
020      .finally  [LayoutContentIps.vue:739]
021          關 loading (一處關閉)  [LayoutContentIps.vue:742]
```

## i18n 訊息粒度規則

| 觸發情境 | i18n 鍵 (grep `server/procLang.mjs`) | 顯示元件 | 規則 |
|---|---|---|---|
| 儲存成功 | `ipSaveIpsSuccess` | `showCheckYes` 持久 modal（System message） | 管理員須點 OK 確認讀過 |
| 儲存失敗（後端 reject） | `ipSaveIpsFail`（後接錯誤字串） | `showCheckYes` 持久 modal | 同上 |
| 非預期例外（外層 catch） | `anUnexpectedErrorOccurred` | `$alert` toast（4 秒自動消失） | 非預期錯誤刻意低調呈現，不阻斷 |

實際翻譯文字 → 寫測試時 grep `server/procLang.mjs` 對應鍵後直接讀取。

## 參數來源

| 概念 | 來源 | 流程影響 |
|---|---|---|
| 操作者 token | 前端 store（登入後 admin token） | 後端以 `funCheckAdmin` 驗證；失效則 Save reject 走失敗 modal |

## spec 規則摘要

- **權限**：`getIpsList` / `updateIpsList` 皆 admin-only（`funCheckAdmin`）。
- **粒度**：操作結果（成功 / 失敗）一律 `showCheckYes` 持久 modal（須確認讀過、可做 e2e pixel + 語意斷言）；非預期例外才用 `$alert` toast。
- **邊界**：`isError` 恆為 `''`，前端驗證攔截分支為死碼；無「手動新增」列。
- **契約**：Save 前開 loading、`finally` 一處關 loading；每個 `await showCheckYes(...)` 前先關 loading（modal 阻斷，避免 loading 疊著）。
