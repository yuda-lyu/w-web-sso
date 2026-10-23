import assert from 'assert'
import fs from 'fs'
import path from 'path'
import ot from 'dayjs'
import ds from '../src/schema/index.mjs'
import hashPassword from '../server/hashPassword.mjs'
import { woItems } from '../g_mOrm.mjs'
import { buildBaseUsers, buildBaseTokens } from '../g_initialData.mjs'
import procLang from '../server/procLang.mjs'
import { startServersOnce, cleanup, captureStableWithBox, baseUrl, resetToBaseSeed, deleteNonBaseSeed, cleanKpIpCallApi, assertBaselineMatch, launchBrowser, waitUntilExist } from './tools/e2e-setup.mjs'
import { runBaselineCase, createBaselineGate, pageHasText, collectDomText, waitGridIdle } from './tools/e2eLib.mjs'


//
// E2E concurrency test — 多人同時編輯之寫入契約(原則 10)於後台三個清單頁之使用者可見行為
//
// 對應規格: C:\opensrcOper\dspec\多人同時編輯之寫入契約.md §8(前端)、§13 V1(舊畫面存檔整次拒收、草稿保留、提示重新載入)、V10(瀏覽器端自算之基準 = 伺服端所算)
// 對應帳本: sgud/rule/rulebook_concurrency.md R-CONC-05; spec/流程_後台使用者清單.md 等三份流程文件之「多人同時編輯」小節
//
// 使用方式:
//   1. 先產生標準圖: node test/e2e-concurrency.test.mjs --baseline   (新案例, 主控授權產製)
//   2. 跑測試比對:   npx mocha test/e2e-concurrency.test.mjs --timeout 300000
//
// 每個案例(使用者清單 / 金鑰清單 / IP 清單 各一, × 2 語系)走同一條使用者路徑:
//   ① 管理員開啟清單、改一格(草稿) → ② 「另一位管理員 / 系統」於其載入後更動同表另一列(以直接寫庫代之) →
//   ③ 按儲存: 整次拒收, 彈出失敗訊息框(前綴 + saveStale 文字, 提示重新載入)[標準圖], 庫內無該修改 →
//   ④ 關閉訊息框: 草稿保留(改過的格仍在、儲存鈕仍在) → ⑤ 重新載入清單: 見到他人之更動, 重改同一格並儲存成功 →
//   ⑥ 不重新載入, 再改另一格並儲存仍成功(存檔成功後以伺服端重新讀取之列為新基準; 自己送出之值不當基準).
// 其中 ⑤⑥ 之成功儲存亦驗證 V10: 瀏覽器端經 webpack 打包之 buildBaseline 與伺服端新鮮讀取所算相同(否則會被誤拒 saveStale).
// 標準圖僅「被拒訊息框」一階段(每清單每語系 1 張); 語意斷言為主.
//

let salt = '{salt}'
let baselineDir = './test/pics/concurrency'
let langs = ['eng', 'cht']
let FIX_TIME = '2025-01-01T00:00:00.000+08:00'
let SEL_MODAL = 'div[style*="overscroll-behavior"] div[tabindex="0"] > div'


function bp(lang, name) {
    return path.join(baselineDir, `concurrency-${lang}-${name}.png`)
}


//畫面文字與訊息直接取自 server/procLang.mjs(單一來源), 不另抄寫
let kpLang = procLang()
let kpUiText = {
    eng: { ok: 'OK', statistics: 'Statistics', editMode: 'Edit mode', usersList: 'Users list', tokensList: 'Tokens list', ipsList: 'Ips list' },
    cht: { ok: '確認', statistics: '統計', editMode: '編輯模式', usersList: '使用者清單', tokensList: '金鑰清單', ipsList: 'IP清單' },
}


let mdiCloudUploadOutline = 'M6.5 20Q4.22 20 2.61 18.43 1 16.85 1 14.58 1 12.63 2.17 11.1 3.35 9.57 5.25 9.15 5.88 6.85 7.75 5.43 9.63 4 12 4 14.93 4 16.96 6.04 19 8.07 19 11 20.73 11.2 21.86 12.5 23 13.78 23 15.5 23 17.38 21.69 18.69 20.38 20 18.5 20H13Q12.18 20 11.59 19.41 11 18.83 11 18V12.85L9.4 14.4L8 13L12 9L16 13L14.6 14.4L13 12.85V18H18.5Q19.55 18 20.27 17.27 21 16.55 21 15.5 21 14.45 20.27 13.73 19.55 13 18.5 13H17V11Q17 8.93 15.54 7.46 14.08 6 12 6 9.93 6 8.46 7.46 7 8.93 7 11H6.5Q5.05 11 4.03 12.03 3 13.05 3 14.5 3 15.95 4.03 17 5.05 18 6.5 18H9V20M12 13Z'


// ===================================================================
// 測試資料: 管理員 + 各清單專屬 seed(全部審計時間欄凍結, 避免全頁截圖含時間欄而 flake)
// ===================================================================

let admin = {
    id: 'id-cc-admin',
    account: 'cc-admin',
    rawPassword: 'Pw@ccadmin1',
    name: 'CC Admin',
    email: 'cc-admin@test.com',
}
let userTokens = {}

//使用者清單: base seed 3 位 + 管理員 + 兩位被編輯 / 被他人更動者
let seedUsers = [
    { id: 'id-cc-ua', account: 'cc-ua', name: 'CC UserA', email: 'cc-ua@test.com' },
    { id: 'id-cc-ub', account: 'cc-ub', name: 'CC UserB', email: 'cc-ub@test.com' },
]
//金鑰清單: 兩支應用系統金鑰 + 一支 session 金鑰(固定到期時間)
let seedTokens = [
    { id: 'id-cc-app1', token: 'cc-token-app1', userId: 'id-cc-owner1', isApp: 'y', perms: [], timeEnd: '2030-01-01T00:00:00.000+08:00' },
    { id: 'id-cc-app2', token: 'cc-token-app2', userId: 'id-cc-owner2', isApp: 'y', perms: ['readStats'], timeEnd: '2030-06-15T12:00:00.000+08:00' },
    { id: 'id-cc-sess1', token: 'cc-token-sess1', userId: 'id-cc-ua', isApp: 'n', perms: [], timeEnd: '2030-09-20T08:30:00.000+08:00' },
]
//IP 清單
let seedIps = [
    { id: 'id-cc-ip1', ip: '10.1.0.1', timeBlocked: '2030-01-01T00:00:00.000+08:00' },
    { id: 'id-cc-ip2', ip: '10.1.0.2', timeBlocked: '2030-06-15T12:00:00.000+08:00' },
    { id: 'id-cc-ip3', ip: '10.1.0.3', timeBlocked: '2030-09-20T08:30:00.000+08:00' },
]


//admin session 金鑰列之 id(funNew 隨機產生, insertSeed 時記錄, 供 assertSeedOnly 比對)
let adminSessionTokenId = ''


async function insertSeed() {
    await resetToBaseSeed()

    let mk = (o, order) => {
        let v = ds.users.funNew({
            order,
            account: o.account,
            password: hashPassword(admin.rawPassword, salt),
            name: o.name,
            email: o.email,
            description: '',
            from: 'test',
            redir: `${baseUrl}/?view=backstage&token={token}`,
            isAdmin: o.isAdmin || 'n',
            timeVerified: FIX_TIME,
            timeExpired: '2030-01-01T00:00:00.000+08:00',
            timeBlocked: '',
            isActive: 'y',
        })
        v.id = o.id
        v.isAdmin = o.isAdmin || 'n'
        v.timeVerified = FIX_TIME
        v.timeExpired = '2030-01-01T00:00:00.000+08:00'
        v.timeCreate = FIX_TIME
        v.timeUpdate = FIX_TIME
        return v
    }
    await woItems.users.insert([mk({ ...admin, isAdmin: 'y' }, 890), mk(seedUsers[0], 891), mk(seedUsers[1], 892)])

    //管理員 session 金鑰: token 字串固定(此列顯示於金鑰清單畫面, 隨機 UUID 會使 E2E-CC-002 標準圖每次不同); timeEnd 為動態值(隨執行時間), 該欄不在標準圖可見範圍; timeCreate / timeUpdate 凍結
    let t = ds.tokens.funNew({ userId: admin.id })
    t.token = 'cc-token-admin-session'
    t.timeEnd = ot().add(60, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
    t.timeCreate = FIX_TIME
    t.timeUpdate = FIX_TIME
    adminSessionTokenId = t.id
    userTokens[admin.id] = t.token
    let rows = seedTokens.map((o) => {
        let v = ds.tokens.funNew({ userId: o.userId, isApp: o.isApp })
        v.id = o.id
        v.token = o.token
        v.isApp = o.isApp
        v.perms = o.perms
        v.timeEnd = o.timeEnd
        v.timeCreate = FIX_TIME
        v.timeUpdate = FIX_TIME
        return v
    })
    await woItems.tokens.insert([t, ...rows])

    //統一 base seed 各列之審計時間(funNew 預設填 wall-clock now, 會出現在畫面時間欄)
    for (let r of await woItems.users.select()) {
        await woItems.users.save({ id: r.id, timeCreate: FIX_TIME, timeUpdate: FIX_TIME })
    }
    for (let r of await woItems.tokens.select()) {
        await woItems.tokens.save({ id: r.id, timeCreate: FIX_TIME, timeUpdate: FIX_TIME })
    }

    await woItems.ips.insert(seedIps.map((o) => {
        let v = ds.ips.funNew({ ip: o.ip, timeBlocked: o.timeBlocked })
        v.id = o.id
        return v
    }))
}


async function cleanSeed() {
    await deleteNonBaseSeed()
}


//案例開始前之隔離守門: users / tokens / ips 三表之列恰為「base seed + 本檔固定種子」, 不多不少(以主鍵集合比對, 與 insertSeed 之寫入獨立列舉).
//why: 本檔畫面(尤其 E2E-CC-003 之 IP 清單)之列組成須只由本案種子決定; 前序測試檔遺留之 server 記憶體計數(kpIpCallApi)會被 ipDetectNew 計時器補登進 ips 表,
//使清單多出不屬本案之列而讓標準圖比對失敗. 此處把「隔離被破壞」報成明確之隔離錯誤(列出多出/缺少之 id), 而不是事後之像素差異.
async function assertSeedOnly() {
    let expect = {
        users: [...buildBaseUsers().map((o) => o.id), admin.id, ...seedUsers.map((o) => o.id)],
        tokens: [...buildBaseTokens().map((o) => o.id), adminSessionTokenId, ...seedTokens.map((o) => o.id)],
        ips: seedIps.map((o) => o.id),
    }
    for (let tab of Object.keys(expect)) {
        let got = (await woItems[tab].select()).map((r) => r.id).sort()
        let want = [...expect[tab]].sort()
        let extra = got.filter((id) => !want.includes(id))
        let lack = want.filter((id) => !got.includes(id))
        let ips = tab === 'ips' ? (await woItems.ips.select()).filter((r) => extra.includes(r.id)).map((r) => r.ip) : []
        assert.ok(extra.length === 0 && lack.length === 0, `隔離失敗: ${tab} 表非固定種子狀態, 多出 [${extra.join(', ')}]${ips.length > 0 ? ` (ip: ${ips.join(', ')})` : ''}, 缺少 [${lack.join(', ')}]`)
    }
}


// ===================================================================
// UI helpers(全部走真實鍵盤滑鼠; 取自 e2e-ips / e2e-tokens / e2e-modifyuser 之同款作法)
// ===================================================================

async function locateMdiButton(page, dPath) {
    let found = await page.evaluate((d) => {
        let p = Array.from(document.querySelectorAll('svg path')).find((x) => x.getAttribute('d') === d)
        if (!p) return null
        let btn = p.closest('div[tabindex]')
        if (!btn) return null
        let r = btn.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) return null
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    }, dPath)
    if (!found) throw new Error(`mdi button not found / not visible: d=${dPath.slice(0, 30)}...`)
    return found
}


async function ensureColumnVisible(page, colId) {
    let ok = await page.evaluate(async (cid) => {
        let body = document.querySelector('.ag-center-cols-viewport')
        if (!body) return false
        let sw = body.scrollWidth
        let cw = body.clientWidth
        let positions = []
        let step = Math.max(60, cw * 0.6)
        for (let x = 0; x <= sw - cw + step; x += step) positions.push(Math.min(x, Math.max(0, sw - cw)))
        for (let pos of positions) {
            body.scrollLeft = pos
            await new Promise((resolve) => setTimeout(resolve, 80))
            let header = document.querySelector(`.ag-header-cell[col-id="${cid}"]`)
            if (header) {
                let r = header.getBoundingClientRect()
                let bbox = body.getBoundingClientRect()
                let center = bbox.x + bbox.width / 2
                let headerCenter = r.x + r.width / 2
                body.scrollLeft = pos + (headerCenter - center)
                await new Promise((resolve) => setTimeout(resolve, 120))
                return true
            }
        }
        return false
    }, colId)
    if (!ok) throw new Error(`column not findable in any scroll position: ${colId}`)
    await page.waitForTimeout(300)
}


async function clearInputByBackspace(page, cellSel) {
    let cur = await page.evaluate((sel) => document.querySelector(sel + ' input')?.value || '', cellSel)
    if (!cur) return
    await page.keyboard.press('End')
    for (let i = 0; i < cur.length + 2; i++) {
        await page.keyboard.press('Backspace')
    }
}


//ag-grid 文字欄位編輯: dblclick → 偵測 input → insertText → 驗值(重試 3 次) → Enter
async function fillAgGridCell(page, rowIdx, colId, value) {
    await ensureColumnVisible(page, colId)
    let cellSel = `.ag-row[row-index="${rowIdx}"] .ag-cell[col-id="${colId}"]`
    let cell = page.locator(cellSel)
    await cell.scrollIntoViewIfNeeded()
    await cell.dblclick()
    let editor = page.locator(`${cellSel} input`)
    await editor.waitFor({ state: 'visible', timeout: 5000 })
    await page.waitForTimeout(1000)
    let maxAttempts = 3
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await editor.click()
        await clearInputByBackspace(page, cellSel)
        await page.keyboard.insertText(value)
        await page.waitForTimeout(200)
        let got = await page.evaluate((sel) => {
            let el = document.querySelector(sel + ' input')
            return el ? el.value : null
        }, cellSel)
        if (got === value) break
        if (attempt === maxAttempts) {
            throw new Error(`fillAgGridCell ${colId} ${maxAttempts} 次仍漏字: 預期「${value}」, 最終「${got}」`)
        }
        await page.waitForTimeout(400)
    }
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)
}


//依欄位文字找列之 row-index
async function findRowIdx(page, colId, text) {
    let idx = await page.evaluate(({ colId, text }) => {
        let cells = Array.from(document.querySelectorAll(`.ag-row .ag-cell[col-id="${colId}"]`))
        for (let c of cells) {
            if ((c.innerText || '').trim() === text) {
                let row = c.closest('.ag-row')
                return row ? row.getAttribute('row-index') : null
            }
        }
        return null
    }, { colId, text })
    if (idx === null) throw new Error(`row not found: ${colId}=${text}`)
    return parseInt(idx, 10)
}


//以預填之 admin 金鑰自動登入後台並開啟指定清單, 確認編輯模式開啟
async function openList(page, lang, menuKey, headerCol) {
    let t = kpUiText[lang]
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
    await page.evaluate(() => localStorage.clear())
    await page.evaluate((o) => localStorage.setItem(o.k, o.v), { k: 'ksso:userToken', v: userTokens[admin.id] })
    await page.goto(`${baseUrl}/?view=backstage&lang=${lang}`, { waitUntil: 'networkidle', timeout: 15000 })
    await page.waitForTimeout(3000)
    await waitUntilExist(page, `backstage ${t.statistics} 文字`, (s) => document.body.innerText.includes(s), { arg: t.statistics, timeout: 60000 })
    await page.locator(`text="${t[menuKey]}"`).first().waitFor({ state: 'visible', timeout: 60000 })
    await page.locator(`text="${t[menuKey]}"`).first().click()
    await page.locator(`text="${t.editMode}"`).first().waitFor({ state: 'visible', timeout: 60000 })
    let editChecked = await page.evaluate((label) => {
        let lab = Array.from(document.querySelectorAll('div')).find((d) => (d.innerText || '').trim() === label && d.children.length === 0)
        if (!lab) return null
        let cb = lab.parentElement && lab.parentElement.querySelector('input[type="checkbox"]')
        return cb ? cb.checked : null
    }, t.editMode)
    if (editChecked === false) {
        await page.locator(`text="${t.editMode}"`).first().click()
        await page.waitForTimeout(500)
    }
    await waitUntilExist(page, 'ag-grid 第一列', () => document.querySelectorAll('.ag-row').length > 0, { timeout: 60000 })
    await waitGridIdle(page, { requireSelector: `.ag-header-cell[col-id="${headerCol}"]`, minCells: 1, timeout: 60000 })
    await page.waitForTimeout(1000)
}


async function clickSave(page) {
    let p = await locateMdiButton(page, mdiCloudUploadOutline)
    await page.mouse.click(p.x, p.y)
    await page.mouse.move(0, 0)
}


async function hasSaveButton(page) {
    return await page.evaluate((d) => !!Array.from(document.querySelectorAll('svg path')).find((x) => x.getAttribute('d') === d), mdiCloudUploadOutline)
}


async function waitCheckYes(page, lang, headerCol) {
    let t = kpUiText[lang]
    await page.locator(`text="${t.ok}"`).first().waitFor({ state: 'visible', timeout: 30000 })
    await page.evaluate(() => {
        window.scrollTo(0, 0)
        let body = document.querySelector('.ag-center-cols-viewport')
        if (body) body.scrollLeft = 0
    })
    await page.mouse.move(0, 0)
    await waitGridIdle(page, { requireSelector: `.ag-header-cell[col-id="${headerCol}"]`, requireScrollLeftZero: true, minCells: 1, timeout: 15000 })
    await page.waitForTimeout(1500)
}


async function closeCheckYes(page, lang, headerCol) {
    let t = kpUiText[lang]
    await page.locator(`text="${t.ok}"`).first().click()
    await page.locator(`text="${t.ok}"`).first().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {})
    await page.evaluate(() => {
        window.scrollTo(0, 0)
        let body = document.querySelector('.ag-center-cols-viewport')
        if (body) body.scrollLeft = 0
    })
    await waitGridIdle(page, { requireSelector: `.ag-header-cell[col-id="${headerCol}"]`, requireScrollLeftZero: true, minCells: 1, timeout: 15000 })
    await page.mouse.move(0, 0)
    await page.waitForTimeout(800)
}


async function assertModalHas(page, text, label) {
    let found = await pageHasText(page, text)
    if (!found) {
        let dump = await collectDomText(page)
        assert.fail(`${label}: 預期訊息框含「${text}」, 實際: ${dump}`)
    }
}


// ===================================================================
// 三個清單之差異設定與共同流程
// ===================================================================

let pages = {
    users: {
        menuKey: 'usersList',
        headerCol: 'account',
        editCol: 'name',
        rowCol: 'account',
        rowText: 'cc-ua',
        valueFirst: 'CC UserA Edited',
        rowCol2: 'account',
        rowText2: 'cc-ub',
        valueSecond: 'CC UserB Edited',
        failKey: 'userSaveUsersFail',
        okKey: 'userSaveUsersSuccess',
        //他人於載入後更動同表另一列
        other: async () => {
            await woItems.users.save({ id: 'id-cc-ub', name: 'Changed By Other Admin' })
        },
        otherSeen: 'Changed By Other Admin',
        dbFirst: async () => (await woItems.users.select({ id: 'id-cc-ua' }))[0].name,
        dbSecond: async () => (await woItems.users.select({ id: 'id-cc-ub' }))[0].name,
        dbOther: async () => (await woItems.users.select({ id: 'id-cc-ub' }))[0].name,
        origFirst: 'CC UserA',
    },
    tokens: {
        menuKey: 'tokensList',
        headerCol: 'token',
        editCol: 'token',
        rowCol: 'token',
        rowText: 'cc-token-app1',
        valueFirst: 'cc-token-app1-edited',
        rowCol2: 'token',
        rowText2: 'cc-token-app2-ext', //他人更動後之值(重新載入後才見到)
        valueSecond: 'cc-token-app2-edited',
        failKey: 'tokenSaveTokensFail',
        okKey: 'tokenSaveTokensSuccess',
        other: async () => {
            //他人於載入後改了另一支應用系統金鑰之字串(應用系統金鑰列為嚴格整表比對)
            await woItems.tokens.save({ id: 'id-cc-app2', token: 'cc-token-app2-ext' })
        },
        otherSeen: 'cc-token-app2-ext',
        dbFirst: async () => (await woItems.tokens.select({ id: 'id-cc-app1' }))[0].token,
        dbSecond: async () => (await woItems.tokens.select({ id: 'id-cc-app2' }))[0].token,
        dbOther: async () => (await woItems.tokens.select({ id: 'id-cc-app2' }))[0].token,
        origFirst: 'cc-token-app1',
    },
    ips: {
        menuKey: 'ipsList',
        headerCol: 'ip',
        editCol: 'ip',
        rowCol: 'ip',
        rowText: '10.1.0.1',
        valueFirst: '10.1.0.91',
        rowCol2: 'ip',
        rowText2: '10.1.0.3',
        valueSecond: '10.1.0.93',
        failKey: 'ipSaveIpsFail',
        okKey: 'ipSaveIpsSuccess',
        other: async () => {
            await woItems.ips.save({ id: 'id-cc-ip2', ip: '10.1.0.92' })
        },
        otherSeen: '10.1.0.92',
        dbFirst: async () => (await woItems.ips.select({ id: 'id-cc-ip1' }))[0].ip,
        dbSecond: async () => (await woItems.ips.select({ id: 'id-cc-ip3' }))[0].ip,
        dbOther: async () => (await woItems.ips.select({ id: 'id-cc-ip2' }))[0].ip,
        origFirst: '10.1.0.1',
    },
}


//共同流程: 見檔頭 ①~⑥; 回傳「被拒訊息框」標準圖
async function captureStaleReject(page, lang, key, stageName) {
    let c = pages[key]
    let L = kpLang[lang]
    await openList(page, lang, c.menuKey, c.headerCol)

    //① 改一格(草稿)
    let rowIdx = await findRowIdx(page, c.rowCol, c.rowText)
    await fillAgGridCell(page, rowIdx, c.editCol, c.valueFirst)
    assert.ok(await hasSaveButton(page), '改格後儲存鈕出現')

    //② 他人於載入後更動同表另一列
    await c.other()

    //③ 按儲存 → 整次拒收, 訊息框含失敗前綴與 saveStale 文字(提示重新載入)
    await clickSave(page)
    await waitCheckYes(page, lang, c.headerCol)
    await assertModalHas(page, L[c.failKey], `${key} 失敗前綴`)
    await assertModalHas(page, L.saveStale, `${key} saveStale 文字`)
    let buf = await captureStableWithBox(page, SEL_MODAL)

    //庫內: 此次修改零寫入, 他人之更動維持
    assert.strictEqual(await c.dbFirst(), c.origFirst, `${key}: 被拒之修改不得寫入`)
    assert.strictEqual(await c.dbOther(), c.otherSeen, `${key}: 他人之更動維持`)

    //④ 關閉訊息框: 草稿保留(改過的格仍在、儲存鈕仍在)
    await closeCheckYes(page, lang, c.headerCol)
    await ensureColumnVisible(page, c.editCol) //欄位虛擬化: 先捲到被編輯之欄再讀畫面文字
    assert.ok(await pageHasText(page, c.valueFirst), `${key}: 草稿(改過的格)保留`)
    assert.ok(await hasSaveButton(page), `${key}: 儲存鈕仍在`)

    //⑤ 重新載入清單: 見到他人之更動; 重改同一格並儲存成功
    await openList(page, lang, c.menuKey, c.headerCol)
    await ensureColumnVisible(page, c.editCol)
    assert.ok(await pageHasText(page, c.otherSeen), `${key}: 重新載入後見到他人之更動`)
    rowIdx = await findRowIdx(page, c.rowCol, c.rowText)
    await fillAgGridCell(page, rowIdx, c.editCol, c.valueFirst)
    await clickSave(page)
    await waitCheckYes(page, lang, c.headerCol)
    await assertModalHas(page, L[c.okKey], `${key} 儲存成功訊息(重新載入後)`)
    await closeCheckYes(page, lang, c.headerCol)
    assert.strictEqual(await c.dbFirst(), c.valueFirst, `${key}: 重新載入後之儲存成功`)

    //⑥ 不重新載入, 再改另一格並儲存仍成功(存檔成功後新基準取自伺服端)
    rowIdx = await findRowIdx(page, c.rowCol2, c.rowText2)
    await fillAgGridCell(page, rowIdx, c.editCol, c.valueSecond)
    await clickSave(page)
    await waitCheckYes(page, lang, c.headerCol)
    await assertModalHas(page, L[c.okKey], `${key} 儲存成功訊息(連續第二次)`)
    assert.strictEqual(await c.dbSecond(), c.valueSecond, `${key}: 連續第二次儲存成功`)

    return { [stageName]: buf }
}


// ===================================================================
// 案例宣告與案例管線(產製端與比對端共用)
// ===================================================================

let cases = [
    {
        name: 'E2E-CC-001-users-stale-save-rejected',
        run: (page, lang) => captureStaleReject(page, lang, 'users', 'E2E-CC-001-1-stale-save-rejected-modal'),
        stages: ['E2E-CC-001-1-stale-save-rejected-modal'],
    },
    {
        name: 'E2E-CC-002-tokens-stale-save-rejected',
        run: (page, lang) => captureStaleReject(page, lang, 'tokens', 'E2E-CC-002-1-stale-save-rejected-modal'),
        stages: ['E2E-CC-002-1-stale-save-rejected-modal'],
    },
    {
        name: 'E2E-CC-003-ips-stale-save-rejected',
        run: (page, lang) => captureStaleReject(page, lang, 'ips', 'E2E-CC-003-1-stale-save-rejected-modal'),
        stages: ['E2E-CC-003-1-stale-save-rejected-modal'],
    },
]


async function runCase(mode, lang, c, extra = {}) {
    return await runBaselineCase({
        mode,
        lang,
        name: c.name,
        run: c.run,
        stages: c.stages,
        verify: c.verify || null,
        launch: launchBrowser,
        pathOf: bp,
        labelOf: (lg, key) => `concurrency-${lg}-${key}`,
        match: assertBaselineMatch,
        prepare: async () => {
            //每案自行重設為固定種子狀態, 不依賴前序測試之殘留(skill role-coder-for-test-e2e §6):
            //① 先清 server 記憶體之 IP 調用計數: ips 表之列不只來自 DB 寫入, ipDetectNew 計時器(每 2 秒)會把計數內「表中尚無」之 IP 補登進表,
            //   前序測試檔(e2e-autoblock 以 X-Forwarded-For 登記 1.2.3.x)殘留於計數者, 會在 ② 清表後數秒內被補登回來, 使 IP 清單多出一列.
            //   本案管理員自己之瀏覽器流量所登記之 127.0.0.1 仍照常補登(標準圖之既有第一列, 與前序無關).
            //② 清庫並寫入本案固定種子(順序不可對調: 先清庫再清計數, 計時器可於兩者之間補登) ③ 守門: 三表恰為固定種子.
            await cleanKpIpCallApi()
            await cleanSeed()
            await insertSeed()
            await assertSeedOnly()
        },
        afterCase: async () => {
            await cleanSeed()
        },
        ...extra,
    })
}


async function generateBaseline() {
    process.env.E2E_STRICT_CAPTURE = '1'
    let gate = createBaselineGate({ langs, cases })
    console.log(gate.describe())
    await startServersOnce()
    if (!fs.existsSync(baselineDir)) {
        fs.mkdirSync(baselineDir, { recursive: true })
    }
    for (let lang of gate.langs) {
        console.log(`=== 產生標準圖（${lang}）===`)
        for (let c of gate.casesFor(lang)) {
            console.log(`  ${c.name}`)
            await runCase('regen', lang, c, { gate })
        }
    }
    gate.finalize()
    await cleanSeed()
    console.log('=== 標準圖產生完成 ===')
    cleanup()
}


if (process.argv.includes('--baseline')) {
    generateBaseline()
        .catch((err) => {
            console.error(err)
            process.exit(1)
        })
}
else {

    for (let lang of langs) {

        describe(`Concurrency E2E [${lang}] — 多人同時編輯(舊畫面存檔整次拒收)`, function() {
            this.timeout(300000)

            beforeEach(async function() {
                this.timeout(300000)
                await startServersOnce()
            })

            for (let c of cases) {
                it(`${c.name}`, async function() {
                    await runCase('compare', lang, c, { onKnownDefect: () => this.skip() })
                })
            }

        })

    }

}
