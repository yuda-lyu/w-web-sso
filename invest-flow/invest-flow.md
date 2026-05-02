# invest-flow 技能

針對指定功能，調研程式碼完整呼叫鏈，產出 markdown 流程文件。


## 使用方式

指定功能名稱，例如：
- `invest-flow 使用者一般登入`
- `invest-flow 上傳檔案`
- `invest-flow 訂單建立`


## 調研步驟

1. **確認入口**：找到該功能的觸發點（哪個檔案的哪個函式）
2. **追蹤呼叫鏈**：從入口一路追到最底層，每一層都要讀原始碼
3. **標記每個 await / Promise**：
   - 有明確 `.then` / `.catch` → 列出
   - 無 catch 的 await → 標註「無 catch，reject 時 throw 至 XXX」，指明被哪個外層 catch 接住
4. **標記每個條件判斷**：檢查什麼、各條件的結果
5. **記錄檔名與行號**：每行行末標註 `[檔名:行號]`
6. **過濾無關內容**：不列與流程判斷無關的操作（delay、loading、log 等）


## 輸出格式規則

### 縮排

每進一層呼叫縮排 4 格，縮排深度反映歸屬關係。

### 呼叫展開順序

當一個呼叫同時有「內部實作」和「.then/.catch」時，依照實際執行順序排列：

1. 先展開被呼叫函式的內部實作（因為內部先執行完才會回傳）
2. 再列 .then / .catch（因為是內部執行完、回傳後才觸發的）

範例：

```
呼叫 funcA
    [funcA 內部實作]
    檢查 XXX
        失敗:
            reject('err')
    回傳結果
    .then
        處理成功
    .catch
        處理失敗
```

錯誤示範（不要這樣寫）：

```
呼叫 funcA
    .then
        處理成功
    .catch
        處理失敗
    [funcA 內部實作]   ← 錯：內部實作應該在 .then/.catch 之前
```

### await 回傳後的轉折

當一個 await 呼叫有內部展開時，await 回傳後繼續執行的部分要回到呼叫者的縮排層級，不能留在被呼叫者的縮排內。

範例：

```
呼叫 outerFunc
    執行非同步流程 core()
        呼叫後端 funcA，無 catch，reject 時 throw 至 .catch  [xx.mjs:yy]
            [funcA 內部展開，多層縮排]
            回傳結果
        後端回傳成功，繼續前端處理  [xx.mjs:zz]    ← 回到核心流程層級
        更新狀態
    .catch  [xx.mjs:ww]    ← 與核心流程同層，不在其內部
        處理錯誤
```

### async function 與其 .catch 的歸屬

當函式內部定義了一個 async function（如 `core()`）並呼叫它，`core()` 的內容和其 `.catch` 是不同層級：

- `core()` 內部的步驟 → 縮排在 core() 之下
- `.catch` → 與 core() 同層（不在 core 內部，是外部接住 core 的錯誤）

這樣才能看出 `.catch` 攔截的是哪個範圍的錯誤。

範例：

```
呼叫 outerFunc
    執行非同步流程 core()
        步驟 A
        步驟 B（若 reject，throw 至 .catch）
        步驟 C
        resolve
    .catch
        接住核心流程內所有未 catch 的 reject/throw
        處理錯誤
        上拋 err
```

錯誤示範（不要這樣寫）：

```
呼叫 outerFunc
    步驟 A
    步驟 B
    步驟 C
    resolve
    .catch    ← 錯：看不出 catch 攔截的是上方哪些步驟
        處理錯誤
```

### .then / .catch

一律獨立成行，內容換下行縮排：

```
呼叫 xxx
    .then
        處理內容
    .catch
        處理內容
```

### 條件判斷

描述檢查什麼，各條件結果換行縮排：

```
檢查 XXX
    條件A:
        處理
    條件B:
        處理
```

### 縮排層級必須反映歸屬

同一個函式內的步驟，縮排層級必須相同。不同函式的內容不能混在同一層。

範例（WWebSso kpFunExt 內有呼叫 pp，也有自己的判斷）：

```
呼叫 kpFunExt.loginByAccountAndPassword  [WWebSso.mjs:xx]
    呼叫 pp.loginByAccountAndPassword  [WWebSso.mjs:yy]
        [procProtect 內部展開]
        [procCore 內部展開]
        .then
            處理
        .catch
            處理
    檢查回傳結果  [WWebSso.mjs:zz]    ← 回到 kpFunExt 層級，不在 procProtect 層級
        有值:
            回傳
        無值:
            reject
```

### 檔名與行號

一律放該行最末尾 `[檔名:行號]`，不放前面。

標註規則：
- 每一行對應到程式碼的執行行都要標
- 條件分支的標籤行（如 `封鎖中:`、`不一致:`）不標，因為它不是獨立的執行行，是上一行檢查的分支
- `.then` / `.catch` 本身要標（它是程式碼中明確的呼叫位置）

```
比對密碼雜湊  [procCore.mjs:263]
    不一致:
        reject('incorrect user account or password')  [procCore.mjs:264]
```

### 行號

左邊固定 3 位數行號 `001`、`002`...

### 範圍符號

行號範圍用 `-` 而非 `~`，避免 markdown 將 `~` 解讀為刪除線：
- 正確：003-044
- 錯誤：003~044

### 不列入的內容

- delay、sleep 等等待
- loading 狀態切換
- console.log 等 debug 操作
- 純 log 記錄（除非是判斷分支的一部分）
- 變數賦值等實作細節（除非該變數影響後續分支）

### 描述方式

- 用清楚的中文描述「做什麼」，不寫 pseudo-code
- 但函式名稱要保留，格式為「中文描述 + 函式名」，如 `執行非同步流程 core()`
- 不壓縮，一個動作一行
- reject 字串用單引號包裹，如 `reject('account blocked')`


## 輸出結構

```markdown
# XXX 流程

## 觸發

說明觸發點。

## 流程

（code block 內的巢狀列表）

## 補充表格（視需要）

如：檢查順序、錯誤處理層級、分流條件等。
```


## 範例

見工作目錄下的流程文件：
- `z流程_使用者一般登入.md`
- `z流程_使用者自動登入.md`
- `z流程_使用者創建帳密.md`
