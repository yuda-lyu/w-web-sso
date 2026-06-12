# DB query 攻擊問題：NoSQL operator injection via mingo

**狀態**：✅ 已修 (Round-3 audit Phase 5, 2026-06-12)
**嚴重度**：medium (深度防禦級, 無立即危害)
**對應 audit**：Round-3 finding `input-validation-03`

## 修復摘要 (2026-06-12)

採方案 3 + 4 雙層 guard:
- **Outer (kpfun 入口, `server/WWebSso.mjs`)**: 加 `_strictStr(...vals) => vals.every(v => isestr(v))` helper +
  22 處 kpfun 第一行 `if (!_strictStr(...)) return Promise.reject(...)`. 錯訊統一映射至 ADR-006
  'token expired' (token 系) / ADR-003 'incorrect user account or password' (login 系) /
  'invalid rows' (admin batch update 系), 不洩 type-check 失敗 vs business 失敗.
- **Inner (procCore 入口, `server/procCore.mjs`)**: `loginByAccountAndPassword` / `checkToken` /
  `refreshToken` / `logoutByToken` 4 處補既有 isestr canonical pattern (對齊 createUser line 734
  / verifyEmail line 855 / resendVerifyEmail line 894 已有的內部 type check). defense-in-depth
  防 procCore 函式被 kpfun 外其他 caller 直接呼叫繞過 outer.
- **updateXxxList(rows) array deep check**: 3 處 `updateUsersList` / `updateTokensList` /
  `updateIpsList` 加 `isearr(rows) + rows.every(r => isestr(get(r, 'id', '')))` 防 row.id 為 operator object.

e2e regression: 跑 e2e-login + e2e-doubleclick + e2e-autoblock + e2e-tokens 4 個關鍵 e2e,
65 passing / 0 failing — Y-03 改動不影響任何既有路徑.

以下為原問題分析記錄 (保留供未來 audit 參考).

---

## 問題描述

使用者輸入之 `account` / `email` / `password` 等字串參數在進入 `woItems.users.select(...)` / `woItems.tokens.select(...)` 等 ORM 查詢前**未做 type check**。`w-orm-lmdb` 內部使用 `mingo.Query()` 評估查詢條件，**支援 MongoDB-style operator** (`$ne`, `$gt`, `$regex` 等)，故攻擊者可將字串參數替換為 operator 物件繞過原本「以字串比對特定欄位」的語意。

## 攻擊路徑

```
HTTP POST /api/...
  Payload: { "account": { "$ne": null }, "password": "x" }
              ↓ (hapi 解析 JSON, account 變成 object)
WWebSso.kpfun.loginByAccountAndPassword(_t, account, password)  [WWebSso.mjs:1043]
              ↓
procProtect.loginByAccountAndPassword(account, password)        [procProtect.mjs:156]
              ↓
getBlockedByAccount(account) → getGenUserByAccount(account)     [procProtect.mjs:99-113]
              ↓
procCore._getGenUserByKV('account', account, opt)               [procCore.mjs:94]
              ↓
woItems.users.select({ account: {$ne: null}, isActive: 'y' })   [procCore.mjs:105]
              ↓
mingo.Query({ account: {$ne: null}, isActive: 'y' }).find(...)  [w-orm-lmdb/src/WOrmLmdb.mjs:146]
              ↓
回傳「所有 isActive='y' 之 user」(多筆)
```

## 為何無法達成 auth bypass

實際追過控制流，攻擊者**無法用此向量繞過認證**：

1. **`_getGenUserByKV` 的 duplicate check 防住** ([procCore.mjs:140](server/procCore.mjs#L140))
   - `if (nus >= 2) reject('duplicate account')`
   - operator 注入導致 select 回多筆 user → 直接 reject，不會把 user 物件傳給下游

2. **`timingSafePasswordEqual` 的 type check 防住** ([procCore.mjs:48-54](server/procCore.mjs#L48))
   - 即使攻擊者以 operator 構造剛好 match 1 筆的 query (例如 `account: { $eq: 'admin' }`)，
     後續 password 比對仍會走 `crypto.timingSafeEqual`
   - 函式入口有 `typeof a/b !== 'string'` 防呆，object 形式 password 直接回 false
   - 退一步即使 password 也送 operator object → `hashPassword(pw, salt)` 之 template string 會 coerce 成 `[object Object]:salt` hash，與真實 DB hash 永遠不相等

3. **passwordTest 來自 hashPassword** ([procCore.mjs:293](server/procCore.mjs#L293))
   - server 端強制走 hash 比對，不接受外部直接傳 hash

## 實際後果

| 後果 | 程度 |
|---|---|
| Auth bypass | ❌ 不可能 (被 duplicate check + timingSafeEqual + hashPassword 三層防住) |
| 資料外洩 | ❌ 不可能 (reject 訊息不含具體欄位內容) |
| DoS via 全表 mingo scan | ⚠ 可能 (operator query 觸發 mingo 對整張 users / tokens 表逐筆評估; 小 DB 影響可忽略, 大規模部署需評估) |
| 內部 log 噪音 | ⚠ 可能 (每次 operator query 觸發 `console.log` 噴 keyUser / valueUser, 攻擊者灌大量 request 造成 log 膨脹) |
| 未來 code 改動引入 bypass | ⚠ 潛在 (若日後改寫 `_getGenUserByKV` 邏輯, 例如改成「duplicate 時取第一筆」, 則上述防線失效) |

## 建議修法（最小成本）

在所有 kpfun 入口 (`server/WWebSso.mjs` kpfun 區段) 對 `account` / `email` / `password` / `token` / `name` 等使用者輸入做 **type check**，非字串直接 reject。

```js
import isestr from 'wsemi/src/isestr.mjs'

loginByAccountAndPassword: async (_t, account, password) => {
    if (!isestr(account) || !isestr(password)) {
        return Promise.reject('incorrect user account or password')
    }
    // ... 既有邏輯
}
```

優點：
- 改動極小（每個 kpfun 入口 3 行）
- 不破壞任何既有 spec / e2e
- 對齊 ADR-003 anti-enumeration（type-mismatch 直接走統一拒絕訊息）
- 從根防止 operator object 流入 ORM query

## 為何先文件化未直接修

- 經實測核實**無 auth bypass 路徑**，不屬 critical
- 修法不影響任何 spec 條款，可獨立於後續 audit fix 批次中處理
- 業主 (2026-06-11) 決議先文件化, 後續批次再依優先順序處理

## 相關文件

- 全域 CLAUDE.md §3.1 真痛三條件（本問題屬「在合約內 + 後果具體 (深度防禦) + 已被觀察 (mingo operator 支援為 lib 文件明文)」三條件部分滿足，故歸文件化等待批次處理）
- `spec/設計要點與取捨.md` ADR-003 (anti-enumeration)
- `spec/設計要點與取捨.md` ADR-030 (單機單 process 假設)
