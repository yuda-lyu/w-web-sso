# 後台 IP 清單流程

## 觸發

管理員登入後台後，於左側導覽點「Ips list」進入 IP 清單頁（`LayoutContentIps.vue`）。此頁列出系統追蹤的 IP 紀錄（含封鎖到期時間），提供管理員檢視、調整封鎖時間、刪除與儲存。

後端 `getIpsList` / `updateIpsList` 皆以 `funCheckAdmin` 包裝（`server/WWebSso.mjs:1317,1264`，funCheckAdmin 施加於 `checkTokenAndGetIpsList` / `checkTokenAndUpdateIpsList`，`server/procCore.mjs:1944,1922`），**僅具 admin 權限的有效 token 可存取**；token 無效／過期／非 admin 一律 reject。

## 重要流程

- **E2E-001**
  - title: 管理員進入 IP 清單頁顯示初始檢視態
  - description: 驗證管理員以有效 admin token 登入後台後，自左側導覽進入「Ips list」頁，後端 `getIpsList` 回傳目前系統追蹤之 IP 紀錄並渲染於表格中。本案例為 IP 清單流程之第 1 段（初始檢視態），用於確認頁面開啟時可正常取得資料並呈現，無任何儲存或修改動作，僅驗證初始載入結果。
  - flow:
    - 測試資料：admin user（`isAdmin='y'` / `isActive='y'` / `timeVerified` 有值 / `timeExpired` 未來 / `timeBlocked` 空）+ 其有效 admin token；另 seed 5 筆 IP 記錄（各具固定 IP 與未來固定 `timeBlocked`，固定值以免 pixel 浮動）。
    - 操作：開乾淨登入頁 → 輸入 admin 帳號密碼 → 點「Log in」/「登入」→ 轉址後台 → 點側欄「Ips list」/「IP清單」→ 確認進入編輯模式。
    - 驗證（等 ag-grid 載入穩定後）：
      1. 語意：表格可見 seed 之 IP 列（含其一之 IP 字串）。
      2. 視覺：與 baseline `test/pics/ips/ips-{eng,cht}-E2E-001-list-loaded.png` 視覺一致（pixelmatch 容差）。
    - 雙語：eng / cht 各一輪。
    - 清理：移除本檔特化 admin user / token / 全部 IP 記錄，保留 base seed。

- **E2E-002**
  - title: 管理員修改某列欄位後儲存成功
  - description: 驗證管理員於 IP 清單頁修改某列之可編輯欄位後點「Save」按鈕，後端 `updateIpsList` 以差異更新方式將變更寫入 DB `ips` 表，前端隨即顯示 System message 持久 modal 之儲存成功訊息（i18n 鍵 `ipSaveIpsSuccess`），管理員點 OK 確認後，表格重新取回資料並顯示已更新的欄位值。本案例採多階段截圖（共 3 張）：stage1 截「ip 已改、尚未 Save」之觸發圖，stage2 截成功 modal，stage3 截 OK 後表格已更新列。（測試以該列 `ip` 文字欄位之修改為「修改欄位」之代表——與修改 `timeBlocked` 走同一 updateIpsList 差異更新路徑、終態同為成功 modal；之所以不用 timeBlocked 是其欄為 WTimeminute 自訂渲染、UI 操作路徑不同。）
  - flow:
    - 測試資料：同 E2E-001（目標列為其中一筆 IP 記錄）。
    - 操作：登入後台 → 點「Ips list」/「IP清單」→ 於目標列之 `ip` 欄位雙擊進入編輯 → 清空後輸入新 IP 值（`10.0.0.99`）→ 按 Enter 離開編輯（cell 顯示新值、表格進入「已修改」態、Save 按鈕出現）→ 點 Save。
    - 驗證（多階段截圖）：
      - **stage1**（Enter 離開 editor 後、點 Save 之前）：
        1. 語意：ip cell 已顯示新值 `10.0.0.99`（editor 退出、cell 仍顯示未存值）。
        2. 視覺：與 baseline `test/pics/ips/ips-{eng,cht}-E2E-002-1-ip-edited-before-save.png` 視覺一致（pixelmatch 容差）；觀看區為被編輯的 ip cell 紅框標注。
      - **stage2**（等成功 modal 浮出穩定後、點 OK 之前）：
        1. 語意：出現「Save IPs successfully」/「儲存IP數據成功」之 System message 持久 modal。
        2. 視覺：與 baseline `test/pics/ips/ips-{eng,cht}-E2E-002-2-save-success-modal.png` 視覺一致（pixelmatch 容差）；觀看區為 modal panel 紅框標注。
      - **stage3**（點 OK 關閉 modal，等表格重新取回資料顯示更新後 ip 值）：
        1. 語意：表格可見已更新之 ip 字串（`10.0.0.99`）；且 DB 中該列之 `ip` 已更新為新值。
        2. 視覺：與 baseline `test/pics/ips/ips-{eng,cht}-E2E-002-3-modify-ip-result-row.png` 視覺一致（pixelmatch 容差）；觀看區為已更新 ip 之該列紅框標注。
    - 雙語：eng / cht 各一輪。
    - 清理：移除本檔特化資料並復原 seed，保留 base seed。

- **E2E-003**
  - title: 管理員勾選刪除某列後儲存成功
  - description: 驗證管理員於 IP 清單頁勾選某列後執行刪除動作，再點「Save」按鈕送出，後端 `updateIpsList` 透過 diff 將該列自 DB `ips` 表移除，前端顯示 System message 持久 modal 之儲存成功訊息（`ipSaveIpsSuccess`）。本案例與 E2E-002 共享同一條成功路徑與 i18n 訊息，差別僅在於資料異動為「刪除」而非「修改」。採多階段截圖（共 2 張）：stage1 截「已勾選目標列、尚未刪除/Save」之觸發圖，stage2 截成功 modal。
  - flow:
    - 測試資料：同 E2E-001（目標列為其中一筆 IP 記錄）。
    - 操作：登入後台 → 點「Ips list」/「IP清單」→ 勾選目標列之列選取 checkbox → 點垃圾桶（刪除）→ 點 Save。
    - 驗證（多階段截圖）：
      - **stage1**（checkbox 勾選完成後、點垃圾桶/Save 之前）：
        1. 語意：目標列仍在表格中（ip 字串 `10.0.0.2` 可見）、列選取 checkbox 已勾選。
        2. 視覺：與 baseline `test/pics/ips/ips-{eng,cht}-E2E-003-1-row-selected-before-save.png` 視覺一致（pixelmatch 容差）；觀看區為目標整列（pinned-left + center 聯集）紅框標注。
      - **stage2**（等成功 modal 浮出穩定後）：
        1. 語意：出現「Save IPs successfully」/「儲存IP數據成功」之 System message modal（與 E2E-002 共用 i18n 訊息，但因表格列數不同**不共用 baseline**）；且 DB 中該列已不存在、其餘 IP 記錄仍在。
        2. 視覺：與 baseline `test/pics/ips/ips-{eng,cht}-E2E-003-2-delete-row-save-success.png` 視覺一致（pixelmatch 容差）；觀看區為 modal panel 紅框標注。
    - 雙語：eng / cht 各一輪。
    - 清理：移除本檔特化資料並復原 seed，保留 base seed。

- **E2E-004**
  - title: 管理員 token 失效時儲存顯示失敗訊息
  - description: 驗證管理員點 Save 當下其 admin token 已過期或非 admin 時，後端 `checkToken`（內含 `funCheckAdmin`）拒絕請求，前端 `errTemp` 被設值後流程於檢查 errTemp 階段中止，顯示 System message 持久 modal 之儲存失敗訊息（i18n 鍵 `ipSaveIpsFail` 後接後端錯誤字串），DB `ips` 表內容不變。依 spec 粒度規則，後端 reject 屬可預期失敗，仍走 `showCheckYes` 持久 modal 而非 `$alert` toast。
  - flow:
    - 測試資料：同 E2E-001（目標列為其中一筆 IP 記錄）；本案模擬「填完表格後 admin token 才到期」——於進頁、改完 `ip` 欄位後、Save 前將 admin token 之 `timeEnd` 設為過去（過期）。
    - 操作：登入後台 → 點「Ips list」/「IP清單」→ 於目標列 `ip` 欄位雙擊編輯輸入新值（使 Save 按鈕出現）→（admin token 於 Save 前轉為過期）→ 點 Save。
    - 驗證（等失敗 modal 浮出穩定後）：
      1. 語意：出現「Failed to save IPs」/「儲存IP數據失敗」之 System message 持久 modal（非 `$alert` toast）；且 DB 中該列之 `ip` 仍為原值、IP 記錄數量不變（後端 reject、無寫入）。
      2. 視覺：與 baseline `test/pics/ips/ips-{eng,cht}-E2E-004-token-expired-save-fail.png` 視覺一致（pixelmatch 容差）。
    - 雙語：eng / cht 各一輪。
    - 清理：移除本檔特化資料並復原 admin token 效期，保留 base seed。

## 執行流程

```
001  管理員點 Save, 觸發 saveIps  [LayoutContentIps.vue:681]
002      執行非同步流程 core()  [LayoutContentIps.vue:686]
003          開啟 loading  [LayoutContentIps.vue:695]
004          檢查 isError  [LayoutContentIps.vue:698]
005              註: isError computed 恆回傳 ''  [LayoutContentIps.vue:398-400]
006                  → 此分支為死碼, 永遠不進入 (showCheckYes 不會被觸發)
007          取得當前 opt.rows 與 admin token  [LayoutContentIps.vue:705,714]
008          呼叫後端 updateIpsList(token, lang, rows)  [LayoutContentIps.vue:719]
009              checkTokenAndUpdateIpsList(token, rows, {fun: funCheckAdmin})  [procCore.mjs:1967]
010                  checkToken(token, opt)  [procCore.mjs:1970]
011                      token 無效 / 過期 / 非 admin:
012                          reject  → errTemp 被設值  [LayoutContentIps.vue:721]
013                  updateIpsList(rows)  [procCore.mjs:1973]
014                      updateTabItems('ips', rows, 'id', {resetOrder:false}) 差異更新  [procCore.mjs:1960]
015          檢查 errTemp  [LayoutContentIps.vue:725]
016              非 null (後端 reject):
017                  關 loading, 顯示 System message modal 儲存失敗訊息, return  [LayoutContentIps.vue:726-730]
018          isModified = false  [LayoutContentIps.vue:734]
019          關 loading, 顯示 System message modal 儲存成功訊息  [LayoutContentIps.vue:737-738]
020      .catch  [LayoutContentIps.vue:747]
021          非預期例外 → console.log + $alert toast (anUnexpectedErrorOccurred)  [LayoutContentIps.vue:748-749]
022      .finally  [LayoutContentIps.vue:751]
023          關 loading (一處關閉)  [LayoutContentIps.vue:754]
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
