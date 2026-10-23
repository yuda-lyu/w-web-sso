# 規則帳本(分冊: 前端 / UI 規則)

本檔為規則帳本之分冊(2026-10-22 自 `sgud/rule/rulebook.md` 依類型拆出, 節號與標題不變、內容只搬不刪); 總索引見 `rulebook.md`.

### R-VUE-01: `v-show` 之元素其靜態 `style` 不得含 `display`(2026-09-24, ADR-067)

- **規則**: 需要 `display:flex` 等之容器若要 `v-show`, 把 `display` 放在內層元素; 或改用 `v-if`.
- **理由**: Vue 2.7.16 `updateStyle` 每次重繪無條件重設靜態 style 全部屬性, 蓋掉 v-show 之 `display:none`(殷鑑見 `sgud/exp/experience.md`).
- **盤點指令**(列出 `src/` 內所有 v-show 元素, 違規印 `VIOLATION`; 屬性值內含 `>` 亦可正確解析):

```bash
node -e 'const fs=require("fs"),p=require("path");const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(p.join(d,e.name)):[p.join(d,e.name)]);const re=/<([a-zA-Z][\w-]*)((?:\s+[^\s="\x27>\/]+(?:\s*=\s*"[^"]*")?)*)\s*\/?>/g;for(const f of walk("src").filter(f=>f.endsWith(".vue"))){const s=fs.readFileSync(f,"utf8");for(const m of s.matchAll(re)){if(!/\sv-show=/.test(m[2]))continue;const st=(m[2].match(/\sstyle="([^"]*)"/)||[])[1]||"";const ln=s.slice(0,m.index).split("\n").length;console.log((/(^|;)\s*display\s*:/.test(st)?"VIOLATION":"ok")+"\t"+f.split(p.sep).join("/")+":"+ln)}}'
```

- **站點全集(2026-09-24)**: 5 處全 ok —— `Layout.vue` 漢堡容器(已套: display 移至內層)、`LayoutContentUserInfor.vue` 四處 `v-show="false"`(無靜態 style, 不適用).

### R-VUE-02: 以 v-model 控制開關之 `WPopup`, 其觸發區內自帶 click 之按鈕須以 `@click.stop` 截斷(2026-09-24, ADR-067)

- **規則**: `WPopup` 非 isolated(`:value` + `@input`)且觸發區內按鈕之 `@click` 會改同一開關狀態(如再點關閉)時, 按鈕外包 `<div @click.stop>`, 開關一律由該狀態控制; isolated 之 `WPopup` 由元件自理開啟, 不適用.
- **理由**: 真實點擊於各監聽器之間先跑 microtask, 按鈕(`WButtonCircle` 以 `$nextTick` emit)關閉並重繪後, WPopup 觸發區 `@click="evShow"` 才收到同一 click 而重新開啟. 外部點擊關閉走 window mouseup, 不受 `.stop` 影響(殷鑑見 `sgud/exp/experience.md`).
- **盤點指令**: Grep `<WPopup` 於 `src/`(`-A 4`), 逐一看是否 `:isolated="true"`; 非 isolated 者檢查其 `v-slot:trigger` 內按鈕是否包 `@click.stop`.
- **站點全集(2026-09-24; 2026-09-25 +1)**: 6 處 —— `Layout.vue` 漢堡選單(非 isolated, 已套); `Layout.vue` 寬版使用者彈窗、`LayoutContent{Users,Tokens,Ips}.vue` 顯示欄位、`LayoutContentTokens.vue` 應用系統權限清單(ADR-069; 以 `@show` / `@hide` 載入與寫回草稿)(isolated, 不適用; 其觸發區再點不關閉, 為元件既有行為, 見 ADR-067 已知限制).

### R-UI-01: 有副作用之送出一律經 `$ui.runSubmit`; w-component-vue 按鈕之 promiseUnlock 鎖交由送出流程釋放(2026-09-29, ADR-074)

- **規則**:
  1. 寫 DB、寄信、改密碼、登入 / 登出等送出函式, 以 `vo.$ui.runSubmit('<key>', () => { return core()... }, opt)` 包覆; 同一操作之所有入口(按鈕滑鼠 / 鍵盤 Enter、輸入框 Enter、原生 div)呼叫同一送出函式、共用同一 key; 有確認框者自開確認框起整段包進.
  2. WButtonChip / WButtonCircle 之送出鈕 `:promiseUnlock="true"`, handler 為 method 名、`vo.x({ pm: msg.pm })`, **不得**於 handler `pm.resolve()`(鎖由 `updateLoading(false)` 或流程結束釋放); 先開確認框之流程於開框前呼叫 runSubmit 傳入之 `unlock`.
  3. 後端清單儲存以 `lockSave` 依操作者占位; 前端自產 id 之新增列帶 `_isNew` 送後端.
  4. 單例訊息框(`src/components/Common/CheckYes.vue` / `CheckYesNo.vue`)之 `show()` 開頭須結束前一個等待者(CheckYes `resolve`、CheckYesNo `reject('close')`), 否則被取代之流程永久等待、其 runSubmit key 不釋放.
- **理由**: 全頁 loading 只擋滑鼠; handler 第一行解鎖時鍵盤連按照樣送出(ADR-074 實測).
- **盤點指令**:
  - Grep `msg\.pm\.resolve\(\)` 於 `src/` → 0.
  - Grep `:promiseUnlock="true"` 於 `src/` → 每筆之 handler 皆把 `msg.pm` 交給 runSubmit 包覆之函式.
  - Grep `\$fapi\.(createUser|resendVerifyEmail|checkUserPassword|changeUserPassword|adminResetUserPassword|updateUsersList|updateTokensList|updateIpsList)\(` 於 `src/` 與 `loginByAccountAndPassword|logoutByToken` 於 `src/plugins/mUI.mjs` → 每筆所在流程皆由 runSubmit 包覆(登入 / 登出經 PageLogin.login / Layout.logout / PageUser.logout).
  - Grep `runSubmit\('` 於 `src/` → key 全集.
  - Grep `if \(vo\.pm\)` 於 `src/components/Common/` → 2(CheckYes、CheckYesNo 之 show 開頭).
- **站點全集(2026-09-29)**: runSubmit 10 處 9 個 key —— `register`、`resendVerifyEmail`、`login`(PageLogin)、`changeUserPassword`、`logout`(PageUser 與 Layout 兩處共用)、`adminResetUserPassword`、`saveUsers`、`saveTokens`、`saveIps`; promiseUnlock 按鈕 9 顆(PageLogin 3、PageUser 2、LayoutContentUsers 2、LayoutContentTokens 1、LayoutContentIps 1), `msg.pm.resolve()` 0 處.

### R-UI-02: 資料頁之載入狀態——載入中顯示 `waitingData`、失敗顯示 `getDataError`, 不以空表格代替(2026-09-29, ADR-076)

- **規則**:
  1. 於 `mounted` 以 `$fapi.getXxx` 載入資料之頁面, data 宣告 `errMsg: ''`; 失敗時 `errMsg = $t('getDataError')`, 模板以訊息取代主內容(`!firstLoading && !errMsg` 才顯示表格).
  2. `firstLoading` 只由載入請求結束(`.finally`)設為 false; computed(如清單頁之 `changeParams`)不得設定之, 需要時讀取之以取得相依.
- **理由**: 原 `changeParams` 一渲染即設 `firstLoading=false`, 載入中(網路中斷時重試約 6 秒)即以空表格呈現「No Rows To Show」; `errMsg` 未宣告亦未顯示, 失敗時只剩空表(真瀏覽器實測見 `spec/evidence/2026-09-29-list-loadfail-probe.md`).
- **盤點指令**:
  - Grep `errMsg = vo\.\$t\('getDataError'\)` 於 `src/components` → 每檔皆有 `errMsg: ''`(data)與 `{{errMsg}}`(模板).
  - Grep `firstLoading = false` 於 `src/components` → 只可出現在載入請求之 `.finally`(不得在 computed 內).
- **站點全集(2026-09-29)**: `LayoutContentUsers.vue`、`LayoutContentTokens.vue`、`LayoutContentIps.vue`(本次修正)、`LayoutContentStaInfor.vue`、`LayoutContentUserInfor.vue`(原即如此), 皆已套.

### R-UI-03: 自訂強色底之按鈕一併給焦點色(2026-09-30, ADR-077)

- **規則**: WButtonCircle / WButtonChip 之 `:backgroundColor` 為強色(紅底儲存鈕等)者, 須同時給 `:backgroundColorFocus`(取 hover 色)與 `:iconColorFocus`(取 hover 圖示色); 白底 / 淡底者可不給(元件預設焦點底 `rgb(230,230,230)` 比 hover 深一階, 合乎元件「一般 → hover → 焦點」逐級加深之慣例).
- **理由**: 按鈕點擊後取得焦點, 未給焦點色即落回元件預設淡灰底; 使用者清單之儲存鈕只給了白色焦點圖示, 點擊後成為「淡灰底＋白圖示」幾乎看不見、看似停用, 儲存失敗訊息框期間與標準圖皆可見(同系統 IP / 金鑰清單之儲存鈕早已給焦點底色, 三頁不一致).
- **盤點指令**: Grep `-A12 "<WButtonCircle"` 與 `-A20 "<WButtonChip"` 於 `src/components` → 帶 `:backgroundColor="'rgba(255,0,50` 者皆同時帶 `:backgroundColorFocus` 與 `:iconColorFocus`.
- **站點全集(2026-09-30)**: 強色底按鈕 3 顆, 皆為儲存鈕 —— `LayoutContentUsers.vue`(本次補 `backgroundColorFocus`)、`LayoutContentTokens.vue`、`LayoutContentIps.vue`(原即如此); 皆已套. 其餘圓鈕為白底(`#fff` / hover `#f2f2f2`)或抽屜鈕(已給焦點色), 刻意不套.

