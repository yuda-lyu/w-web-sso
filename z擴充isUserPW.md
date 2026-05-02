# 擴充 isUserPw

## 一、現有 isUserPw 分析

### 檔案位置

`wsemi/src/isUserPw.mjs`

### 現有 opt 參數

| 參數 | 類型 | 預設值 | 說明 |
|------|------|--------|------|
| `useKeyForError` | Boolean | false | true 時回傳 error key，false 時回傳中文訊息 |
| `useOnlyOneError` | Boolean | false | true 時遇到第一個錯誤即 throw |
| `numLenMin` | Integer | 8 | 最小長度 |
| `numLenMax` | Integer | 30 | 最大長度 |

### 現有驗證順序

| 順序 | 檢查項目 | error key | 硬編碼 |
|------|----------|-----------|--------|
| 1 | pw 是否為有效字串 | `keyInvalidPassword` | — |
| 2 | numLenMin > numLenMax 設定矛盾 | `keyLimNumLenMinOrMax` | — |
| 3 | 禁止空白字元 | `keyLimHasSpace` | 固定啟用 |
| 4 | 最小長度 | `keyLimNumLenMin` | 預設 8 |
| 5 | 最大長度 | `keyLimNumLenMax` | 預設 30 |
| 6 | 必須同時含大寫+小寫+數字+特殊符號 | `keyLimCombination` | 固定啟用、四者綁死 |

### 現有問題

1. **字元要求全部綁死**：大寫、小寫、數字、特殊符號合併為一個 `keyLimCombination`，無法個別啟用/停用
2. **無法只要求「有英文字母」**：業主要求不限大小寫，但現有強制要求大寫+小寫都要有
3. **缺少禁止特定字元**：無 `forbiddenChars`
4. **缺少帳號連續字元檢查**：無 `noConsecutiveCharsFromAccount`
5. **缺少黑名單比對**：無 `commonPasswordBlacklist`
6. **空白檢查無法關閉**：固定啟用，無法透過 opt 控制


## 二、擴充方案

### 新增 opt 參數

```javascript
isUserPw(pw, {

    // --- 現有參數（保留不動）---
    useKeyForError: true,
    useOnlyOneError: true,
    numLenMin: 8,
    numLenMax: 16,

    // --- 新增參數 ---

    // 字元要求（個別控制，取代原本綁死的 keyLimCombination）
    requireLetter: true,        // 需包含英文字母（不分大小寫）
    requireUppercase: false,    // 需包含大寫英文
    requireLowercase: false,    // 需包含小寫英文
    requireDigit: true,         // 需包含數字
    requireSpecial: true,       // 需包含特殊符號

    // 空白控制
    noSpace: true,              // 是否禁止空白（改為可配置，預設 true 維持向下相容）

    // 禁止字元
    forbiddenChars: ['\\'],     // 禁止包含的字元列表

    // 帳號關聯
    account: '',                            // 使用者帳號（用於連續字元比對）
    noConsecutiveCharsFromAccount: true,     // 是否啟用
    consecutiveCharsMinMatch: 2,            // 連續字元最小比對長度

    // 黑名單
    commonPasswordBlacklist: ['1qaz@WSX', 'P@ssw0rd', ...],

})
```

### 向下相容策略

**關鍵原則：所有新增參數未給予時，行為必須與現有完全一致。**

```javascript
// 字元要求的向下相容邏輯：
let requireLetter = get(opt, 'requireLetter', null)
let requireUppercase = get(opt, 'requireUppercase', null)
let requireLowercase = get(opt, 'requireLowercase', null)
let requireDigit = get(opt, 'requireDigit', null)
let requireSpecial = get(opt, 'requireSpecial', null)

// 若所有新參數皆未給予（皆為 null）→ 走原本的 keyLimCombination 邏輯
// 若任一新參數有給予 → 走新的個別檢查邏輯
let useNewCharRequirements = (
    isbol(requireLetter) ||
    isbol(requireUppercase) ||
    isbol(requireLowercase) ||
    isbol(requireDigit) ||
    isbol(requireSpecial)
)
```


## 三、擴充後完整驗證順序

| 順序 | 檢查項目 | error key | 觸發條件 |
|------|----------|-----------|----------|
| 1 | pw 是否為有效字串 | `keyInvalidPassword` | 固定 |
| 2 | numLenMin > numLenMax 設定矛盾 | `keyLimNumLenMinOrMax` | 固定 |
| 3 | 禁止空白字元 | `keyLimHasSpace` | `noSpace !== false`（預設啟用） |
| 4 | 最小長度 | `keyLimNumLenMin` | 固定 |
| 5 | 最大長度 | `keyLimNumLenMax` | 固定 |
| 6a | **（新邏輯）** 需含英文字母 | `keyLimRequireLetter` | `requireLetter === true` |
| 6b | **（新邏輯）** 需含大寫英文 | `keyLimRequireUppercase` | `requireUppercase === true` |
| 6c | **（新邏輯）** 需含小寫英文 | `keyLimRequireLowercase` | `requireLowercase === true` |
| 6d | **（新邏輯）** 需含數字 | `keyLimRequireDigit` | `requireDigit === true` |
| 6e | **（新邏輯）** 需含特殊符號 | `keyLimRequireSpecial` | `requireSpecial === true` |
| 6 | **（舊邏輯）** 需含大寫+小寫+數字+特殊 | `keyLimCombination` | 新參數皆未給予時 |
| 7 | **（新增）** 禁止特定字元 | `keyLimForbiddenChar` | `forbiddenChars` 有值 |
| 8 | **（新增）** 黑名單比對 | `keyLimCommonPassword` | `commonPasswordBlacklist` 有值 |
| 9 | **（新增）** 帳號連續字元 | `keyLimConsecutiveCharsFromAccount` | `noConsecutiveCharsFromAccount === true` |


## 四、各新增檢查的實作邏輯

### 4.1 requireLetter（需含英文字母，不分大小寫）

```javascript
//isStrHasLetter
let isStrHasLetter = (password) => {
    return /[a-zA-Z]/.test(password)
}

if (isbol(requireLetter) && requireLetter) {
    if (!isStrHasLetter(pw)) {
        if (useKeyForError) {
            err.push('keyLimRequireLetter')
        }
        else {
            err.push('密碼須包含至少一個英文字母')
        }
    }
}
```

### 4.2 個別字元要求（requireUppercase、requireLowercase、requireDigit、requireSpecial）

```javascript
if (isbol(requireUppercase) && requireUppercase) {
    if (!isStrHasCapital(pw)) {
        err.push(useKeyForError ? 'keyLimRequireUppercase' : '密碼須包含至少一個大寫英文字母')
    }
}
if (isbol(requireLowercase) && requireLowercase) {
    if (!isStrHasLowerCase(pw)) {
        err.push(useKeyForError ? 'keyLimRequireLowercase' : '密碼須包含至少一個小寫英文字母')
    }
}
if (isbol(requireDigit) && requireDigit) {
    if (!isStrHasNumber(pw)) {
        err.push(useKeyForError ? 'keyLimRequireDigit' : '密碼須包含至少一個數字')
    }
}
if (isbol(requireSpecial) && requireSpecial) {
    if (!isStrHasSymbol(pw)) {
        err.push(useKeyForError ? 'keyLimRequireSpecial' : '密碼須包含至少一個特殊符號')
    }
}
```

### 4.3 forbiddenChars（禁止特定字元）

```javascript
let forbiddenChars = get(opt, 'forbiddenChars', null)
if (isearr(forbiddenChars)) {
    for (let ch of forbiddenChars) {
        if (pw.includes(ch)) {
            if (useKeyForError) {
                err.push('keyLimForbiddenChar')
            }
            else {
                err.push(`密碼不可包含字元：${ch}`)
            }
            break  // 只報第一個違規字元
        }
    }
}
```

### 4.4 commonPasswordBlacklist（黑名單比對）

```javascript
let commonPasswordBlacklist = get(opt, 'commonPasswordBlacklist', null)
if (isearr(commonPasswordBlacklist)) {
    let pwLower = pw.toLowerCase()
    let matched = commonPasswordBlacklist.some((item) => {
        return isstr(item) && pwLower === item.toLowerCase()
    })
    if (matched) {
        if (useKeyForError) {
            err.push('keyLimCommonPassword')
        }
        else {
            err.push('此密碼為常見弱密碼，不允許使用')
        }
    }
}
```

### 4.5 noConsecutiveCharsFromAccount（帳號連續字元）

```javascript
let account = get(opt, 'account', '')
let noConsecutiveCharsFromAccount = get(opt, 'noConsecutiveCharsFromAccount', null)
let consecutiveCharsMinMatch = get(opt, 'consecutiveCharsMinMatch', '')
if (!ispint(consecutiveCharsMinMatch)) {
    consecutiveCharsMinMatch = 2
}
consecutiveCharsMinMatch = cint(consecutiveCharsMinMatch)

if (isbol(noConsecutiveCharsFromAccount) && noConsecutiveCharsFromAccount && isstr(account) && size(account) >= consecutiveCharsMinMatch) {
    let accLower = account.toLowerCase()
    let pwLower = pw.toLowerCase()
    let found = false
    for (let i = 0; i <= accLower.length - consecutiveCharsMinMatch; i++) {
        let sub = accLower.substring(i, i + consecutiveCharsMinMatch)
        if (pwLower.includes(sub)) {
            found = true
            break
        }
    }
    if (found) {
        if (useKeyForError) {
            err.push('keyLimConsecutiveCharsFromAccount')
        }
        else {
            err.push(`密碼不可包含與帳號相同之${consecutiveCharsMinMatch}個以上連續字元`)
        }
    }
}
```

### 4.6 noSpace 改為可配置

```javascript
// 原本：固定檢查空白
// 改為：
let noSpace = get(opt, 'noSpace', null)
if (!isbol(noSpace)) {
    noSpace = true  // 預設 true，向下相容
}

if (noSpace) {
    if (isStrHasSpace(pw)) {
        if (useKeyForError) {
            err.push('keyLimHasSpace')
        }
        else {
            err.push('密碼不可包含空白字元')
        }
    }
}
```


## 五、擴充後完整程式碼結構

```javascript
function isUserPw(pw, opt = {}) {
    let err = []

    // --- 讀取選項 ---
    let useKeyForError = get(opt, 'useKeyForError', false)
    let useOnlyOneError = get(opt, 'useOnlyOneError', false)

    // --- 1. pw 有效性 ---
    if (!isstr(pw)) { ... throw }

    // --- 2. 長度設定矛盾 ---
    let numLenMin = get(opt, 'numLenMin', 8)
    let numLenMax = get(opt, 'numLenMax', 30)
    if (numLenMin > numLenMax) { ... throw }

    // --- 3. 空白檢查（可配置） ---
    let noSpace = get(opt, 'noSpace', true)
    if (noSpace && isStrHasSpace(pw)) { ... }

    // --- 4. 最小長度 ---
    if (size(pw) < numLenMin) { ... }

    // --- 5. 最大長度 ---
    if (size(pw) > numLenMax) { ... }

    // --- 6. 字元要求 ---
    let requireLetter = get(opt, 'requireLetter', null)
    let requireUppercase = get(opt, 'requireUppercase', null)
    let requireLowercase = get(opt, 'requireLowercase', null)
    let requireDigit = get(opt, 'requireDigit', null)
    let requireSpecial = get(opt, 'requireSpecial', null)

    let useNewCharRequirements = (
        isbol(requireLetter) ||
        isbol(requireUppercase) ||
        isbol(requireLowercase) ||
        isbol(requireDigit) ||
        isbol(requireSpecial)
    )

    if (useNewCharRequirements) {
        // 新邏輯：個別檢查
        if (requireLetter && !isStrHasLetter(pw)) { ... }
        if (requireUppercase && !isStrHasCapital(pw)) { ... }
        if (requireLowercase && !isStrHasLowerCase(pw)) { ... }
        if (requireDigit && !isStrHasNumber(pw)) { ... }
        if (requireSpecial && !isStrHasSymbol(pw)) { ... }
    }
    else {
        // 舊邏輯：四者綁死（向下相容）
        if (!isStrHasCapital(pw) || !isStrHasLowerCase(pw) || !isStrHasNumber(pw) || !isStrHasSymbol(pw)) { ... }
    }

    // --- 7. 禁止字元 ---
    let forbiddenChars = get(opt, 'forbiddenChars', null)
    if (isearr(forbiddenChars)) { ... }

    // --- 8. 黑名單 ---
    let commonPasswordBlacklist = get(opt, 'commonPasswordBlacklist', null)
    if (isearr(commonPasswordBlacklist)) { ... }

    // --- 9. 帳號連續字元 ---
    let noConsecutiveCharsFromAccount = get(opt, 'noConsecutiveCharsFromAccount', null)
    if (noConsecutiveCharsFromAccount) { ... }

    // --- 最終檢查 ---
    if (size(err) > 0) { throw new Error(err) }

    return true
}
```


## 六、w-web-sso 端的調整

### procCore.mjs — checkUserPassword 改造

```javascript
// 現有（line 663）
isUserPw(pw, { useKeyForError: true, useOnlyOneError: true })

// 改為：將 passwordPolicy 轉換為 isUserPw 的 opt 格式
isUserPw(pw, {
    useKeyForError: true,
    useOnlyOneError: true,
    numLenMin: passwordPolicy.minLength,
    numLenMax: passwordPolicy.maxLength,
    requireLetter: passwordPolicy.requireLetter,
    requireUppercase: passwordPolicy.requireUppercase,
    requireLowercase: passwordPolicy.requireLowercase,
    requireDigit: passwordPolicy.requireDigit,
    requireSpecial: passwordPolicy.requireSpecial,
    noSpace: passwordPolicy.noSpace,
    forbiddenChars: passwordPolicy.forbiddenChars,
    commonPasswordBlacklist: passwordPolicy.commonPasswordBlacklist,
    noConsecutiveCharsFromAccount: passwordPolicy.noConsecutiveCharsFromAccount,
    consecutiveCharsMinMatch: passwordPolicy.consecutiveCharsMinMatch,
    account: opt.account || '',  // 由呼叫端傳入
})
```

**結論：不需要新建 `passwordEngine.mjs`，直接擴充 `isUserPw` 即可。** 規格書 2 中的 `validatePassword` 改為直接呼叫擴充後的 `isUserPw`，`generatePassword` 仍需新增（可放在 wsemi 或 w-web-sso 中）。


## 七、新增 import

```javascript
// isUserPw.mjs 新增 import
import isearr from './isearr.mjs'
```

現有 import 已有 `isbol`、`isstr`、`ispint`、`cint`、`size`、`get`，不需重複。


## 八、新增 error key 總表

| error key | 說明 | 新增/現有 |
|-----------|------|-----------|
| `keyInvalidPassword` | 非有效字串 | 現有 |
| `keyLimNumLenMinOrMax` | 設定矛盾 | 現有 |
| `keyLimHasSpace` | 包含空白 | 現有 |
| `keyLimNumLenMin` | 長度不足 | 現有 |
| `keyLimNumLenMax` | 長度超過 | 現有 |
| `keyLimCombination` | 字元組合不足（舊邏輯） | 現有 |
| `keyLimRequireLetter` | 缺少英文字母 | **新增** |
| `keyLimRequireUppercase` | 缺少大寫英文 | **新增** |
| `keyLimRequireLowercase` | 缺少小寫英文 | **新增** |
| `keyLimRequireDigit` | 缺少數字 | **新增** |
| `keyLimRequireSpecial` | 缺少特殊符號 | **新增** |
| `keyLimForbiddenChar` | 包含禁止字元 | **新增** |
| `keyLimCommonPassword` | 常見弱密碼 | **新增** |
| `keyLimConsecutiveCharsFromAccount` | 與帳號連續字元相同 | **新增** |


## 九、測試案例（需新增）

```javascript
// 業主需求完整測試
let policy = {
    useKeyForError: true,
    useOnlyOneError: true,
    numLenMin: 8,
    numLenMax: 16,
    requireLetter: true,
    requireDigit: true,
    requireSpecial: true,
    noSpace: true,
    forbiddenChars: ['\\'],
    noConsecutiveCharsFromAccount: true,
    consecutiveCharsMinMatch: 2,
    commonPasswordBlacklist: ['1qaz@WSX', 'P@ssw0rd'],
    account: 'ac-admin',
}

// 通過
isUserPw('Abcd@1234', policy)  // true

// 長度不足
isUserPw('Ab@1', policy)  // keyLimNumLenMin

// 長度超過
isUserPw('Abcdefghijk@12345', policy)  // keyLimNumLenMax

// 缺少英文
isUserPw('1234@5678', policy)  // keyLimRequireLetter

// 缺少數字
isUserPw('Abcdefg@!', policy)  // keyLimRequireDigit

// 缺少特殊符號
isUserPw('Abcdefg123', policy)  // keyLimRequireSpecial

// 包含反斜線
isUserPw('Abcd@12\\4', policy)  // keyLimForbiddenChar

// 常見弱密碼
isUserPw('1qaz@WSX', policy)  // keyLimCommonPassword
isUserPw('p@ssw0rd', policy)  // keyLimCommonPassword（不分大小寫）

// 帳號連續字元（account='ac-admin'）
isUserPw('Xac@12345', policy)  // keyLimConsecutiveCharsFromAccount（含 'ac'）
isUserPw('Xad@12345', policy)  // true（'ad' 不在 account 連續子字串中）

// 向下相容（不給新參數，走舊邏輯）
isUserPw('Asdf%1234', { useKeyForError: true, useOnlyOneError: true })  // true
isUserPw('asdf1234', { useKeyForError: true, useOnlyOneError: true })   // keyLimCombination
```


## 十、影響範圍

| 檔案 | 變動 |
|------|------|
| `wsemi/src/isUserPw.mjs` | 擴充 opt 參數、新增 6 項檢查邏輯 |
| `wsemi/test/isUserPw.test.mjs` | 新增測試案例 |
| `w-web-sso/server/procCore.mjs` | `checkUserPassword` 調整呼叫方式 |
| `w-web-sso/z規格書2-密碼生成與驗證引擎.md` | `validatePassword` 改為包裝 `isUserPw`，`generatePassword` 仍需新增 |
