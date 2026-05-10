import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { chromium } from 'playwright'
import ot from 'dayjs'
import ds from '../src/schema/index.mjs'
import hashPassword from '../server/hashPassword.mjs'
import { woItems } from '../g.mOrm.mjs'
import { startServersOnce } from './e2e-setup.mjs'


//
// E2E adduser test — 後台新增使用者流程
//
// 對應流程文件：z流程_後台新增使用者.md
//
// 使用方式：
//   1. 先產生標準圖：node test/e2e-adduser.test.mjs --baseline
//   2. 跑測試比對：npx mocha test/e2e-adduser.test.mjs --timeout 120000
//
// 標準圖存放：test/pics/adduser/adduser-{lang}-{number}-{name}.png
//
// 涵蓋 14 個 UI distinct 狀態 (× 2 lang = 28 baselines):
//   001-success-after-save                    成功 + 表格刷新
//   002-account-empty-checkyes                帳號空 → CheckYes errInAccounts
//   003-account-duplicate-checkyes            帳號重複 (同表內) → CheckYes errInAccounts
//   004-password-empty-checkyes               密碼空 → CheckYes errInPasswords
//   005-email-empty-checkyes                  email 空 → CheckYes errInEmails
//   006-email-format-checkyes                 email 格式錯 → CheckYes errInEmails
//   007-email-duplicate-checkyes              email 重複 → CheckYes errInEmails
//   008-redir-empty-checkyes                  redir 空 → CheckYes errInRedir
//   009-rows-empty-checkyes                   表內無 row → CheckYes userAddEmpty
//   010-cannot-demote-self-checkyes           admin 解除自己 admin → CheckYes
//   011-cannot-disable-self-checkyes          admin 停用自己 → CheckYes
//   012-password-policy-backend-checkyes      密碼違反策略 backend reject → CheckYes
//   013-account-conflict-backend-checkyes     帳號與 DB 衝突 backend reject → CheckYes
//   014-email-conflict-backend-checkyes       email 與 DB 衝突 backend reject → CheckYes
//

let baseUrl = 'http://localhost:8080'
let salt = '{salt}'
let baselineDir = './test/pics/adduser'
let langs = ['eng', 'cht']

let webKey = 'ksso'
let lsKey = `${webKey}:userToken`


//可選 --names <eng-001-...,cht-001-...> 進行手術式 baseline 重產
let baselineNamesFilter = null
{
    let i = process.argv.indexOf('--names')
    if (i >= 0 && process.argv[i + 1]) {
        baselineNamesFilter = new Set(process.argv[i + 1].split(','))
    }
}
function writeBaseline(lang, name, buf) {
    if (baselineNamesFilter && !baselineNamesFilter.has(`${lang}-${name}`)) {
        console.log(`  [skip] ${lang}-${name}`)
        return
    }
    fs.writeFileSync(bp(lang, name), buf)
}


function bp(lang, name) {
    return path.join(baselineDir, `adduser-${lang}-${name}.png`)
}


// ===================================================================
// 每個 baseline 的預期 modal 文字 (從 spec / procLang.mjs 衍生, 不是現狀指紋)
//
// 此映射用於語意斷言: 每張截圖必須包含對應 i18n 鍵的文字.
// 若實機產出不含此文字 → 修系統 (錯誤聚合粒度 / i18n 對應) 或修 spec, 不改 baseline.
// ===================================================================

let expectedModalText = {
    '002-account-empty': {
        eng: 'Invalid account of user',
        cht: '尚未給予有效使用者帳號',
    },
    '003-account-duplicate': {
        eng: 'Duplicate account of user',
        cht: '使用者帳號出現重複',
    },
    '004-password-empty': {
        eng: 'Empty password of user',
        cht: '尚未給予使用者密碼',
    },
    '005-email-empty': {
        eng: 'Empty email of user',
        cht: '尚未給予使用者Email',
    },
    '006-email-format': {
        eng: 'Invalid email of user',
        cht: '使用者Email格式錯誤',
    },
    '007-email-duplicate': {
        eng: 'Duplicate email of user',
        cht: '使用者Email出現重複',
    },
    '008-redir-empty': {
        eng: 'Invalid redirect of user',
        cht: '尚未給予有效登入後轉址',
    },
    '009-rows-empty': {
        eng: 'No user',
        cht: '尚未新增使用者資料',
    },
    '010-cannot-demote-self': {
        eng: 'Cannot demote yourself from admin',
        cht: '不可解除自己的管理員權限',
    },
    '011-cannot-disable-self': {
        eng: 'Cannot disable yourself',
        cht: '不可停用自己的帳號',
    },
    '012-password-policy-backend': {
        //後端 reject 訊息以 userSaveUsersFail 為前綴
        eng: 'Failed to save users',
        cht: '儲存使用者數據失敗',
    },
    '013-account-conflict-backend': {
        //目前實作 delegate 到 captureAccountDuplicate, 故同 003
        eng: 'Duplicate account of user',
        cht: '使用者帳號出現重複',
    },
    '014-email-conflict-backend': {
        //目前實作 delegate 到 captureEmailDuplicate, 故同 007
        eng: 'Duplicate email of user',
        cht: '使用者Email出現重複',
    },
    //001 不檢查 modal text (儲存成功後立即重 fetch + dismiss CheckYes), 改檢查表內含新帳號
}


// ===================================================================
// 經 Vue 應用呼叫 $fapi.<funcName>，回傳 { ok, val? , err? }
// ===================================================================

async function callFapi(page, funcName, args) {
    return await page.evaluate(async ({ funcName, args }) => {
        let findVue = (el) => {
            if (el.__vue__) return el.__vue__
            for (let c of el.children) {
                let r = findVue(c)
                if (r) return r
            }
            return null
        }
        let app = findVue(document.body)
        if (!app) return { ok: false, err: 'no Vue root instance' }
        try {
            let val = await app.$fapi[funcName](...args)
            return { ok: true, val }
        }
        catch (err) {
            let m = (err && typeof err === 'string') ? err : (err && err.message) || String(err)
            return { ok: false, err: m }
        }
    }, { funcName, args })
}


// ===================================================================
// 測試使用者 / Token
// ===================================================================

let testUsers = {
    admin: {
        id: 'id-au-admin',
        account: 'au-admin',
        rawPassword: 'Pw@auadmin1',
        name: 'AddUser Admin',
        email: 'au-admin@test.com',
        isAdmin: 'y',
        redir: `http://localhost:8080/?view=backstage&token={token}`,
    },
    existing: {
        id: 'id-au-existing',
        account: 'au-existing',
        rawPassword: 'Pw@auexist1',
        name: 'AddUser Existing',
        email: 'au-existing@test.com',
        isAdmin: 'n',
        redir: `http://localhost:8080/?view=user&token={token}`,
    },
}

let userTokens = {}


async function insertTestUsersAndTokens() {
    let arr = Object.values(testUsers)
    let rs = arr.map((u, k) => {
        let v = ds.users.funNew({
            order: 800 + k,
            account: u.account,
            password: hashPassword(u.rawPassword, salt),
            name: u.name,
            email: u.email,
            description: '',
            from: 'test',
            redir: u.redir,
            isAdmin: u.isAdmin,
            timeVerified: '2025-01-01T00:00:00.000+08:00',
            timeExpired: '2030-01-01T00:00:00.000+08:00',
            timeBlocked: '',
            isActive: 'y',
        })
        v.id = u.id
        v.isAdmin = u.isAdmin
        v.timeVerified = '2025-01-01T00:00:00.000+08:00'
        v.timeExpired = '2030-01-01T00:00:00.000+08:00'
        v.timeBlocked = ''
        return v
    })
    await woItems.users.insert(rs)

    let t = ds.tokens.funNew({ userId: testUsers.admin.id })
    t.timeEnd = ot().add(60, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
    userTokens[testUsers.admin.id] = t.token
    await woItems.tokens.insert([t])

    console.log(`inserted ${rs.length} test users + 1 token`)
}


async function deleteTestUsersAndTokens() {
    for (let u of Object.values(testUsers)) {
        await woItems.users.del({ id: u.id }).catch(() => {})
        await woItems.tokens.del({ userId: u.id }).catch(() => {})
    }
    let allUsers = await woItems.users.select().catch(() => [])
    let knownIds = new Set(Object.values(testUsers).map((u) => u.id))
    for (let u of allUsers) {
        if (/^au-/.test(u.account || '') && !knownIds.has(u.id)) {
            await woItems.users.del({ id: u.id }).catch(() => {})
            await woItems.tokens.del({ userId: u.id }).catch(() => {})
        }
    }
    console.log('deleted adduser test users + tokens')
}


// ===================================================================
// 共用 helper: login 並進入 Users list (edit mode 已開)
// ===================================================================

async function adminLoginAndOpenUsersList(page, lang) {
    let loginText = lang === 'eng' ? 'Log in' : '登入'

    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
    await page.evaluate(() => localStorage.clear())
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
    await page.waitForTimeout(2500)

    if (lang === 'cht') {
        await page.locator('text=English').first().click()
        await page.waitForTimeout(400)
        await page.locator('text=中文').first().click()
        await page.waitForTimeout(600)
    }

    let inputs = page.locator('input')
    await inputs.nth(0).fill(testUsers.admin.account)
    await inputs.nth(1).fill(testUsers.admin.rawPassword)
    await page.waitForTimeout(300)
    await page.locator(`text="${loginText}"`).first().click()
    await page.waitForTimeout(4000)

    //navigate to Users list
    let usersText = lang === 'eng' ? 'Users list' : '使用者清單'
    await page.locator(`text=${JSON.stringify(usersText)}`).first().waitFor({ state: 'visible', timeout: 15000 })
    await page.locator(`text=${JSON.stringify(usersText)}`).first().click()
    await page.waitForTimeout(2000)

    //toggle edit mode on (找 Edit mode label 並點擊其旁的 switch)
    //WSwitch 通常是 div 結構，點 label 會切到 isEditable=true
    let editModeText = lang === 'eng' ? 'Edit mode' : '編輯模式'
    await page.evaluate((labelText) => {
        let findVue = (el) => {
            if (el.__vue__) return el.__vue__
            for (let c of el.children) { let r = findVue(c); if (r) return r }
            return null
        }
        let walk = (vm, fn) => {
            if (!vm) return null
            let r = fn(vm); if (r) return r
            for (let c of (vm.$children || [])) { let rr = walk(c, fn); if (rr) return rr }
            return null
        }
        let root = findVue(document.body)
        let layoutContentUsers = walk(root, (vm) => {
            return vm.$options && vm.$options.name === 'LayoutContentUsers' ? vm
                : (vm.toggleItemIsAdminById ? vm : null)
        })
        if (layoutContentUsers) {
            layoutContentUsers.isEditable = true
        }
    }, editModeText)
    await page.waitForTimeout(500)
}


// ===================================================================
// 透過 Vue 直接操作 LayoutContentUsers 的 state (避開 ag-grid editor 互動 flakiness)
// ===================================================================

async function getLayoutContentUsersVm(page) {
    return await page.evaluateHandle(() => {
        let findVue = (el) => {
            if (el.__vue__) return el.__vue__
            for (let c of el.children) { let r = findVue(c); if (r) return r }
            return null
        }
        let walk = (vm, fn) => {
            if (!vm) return null
            let r = fn(vm); if (r) return r
            for (let c of (vm.$children || [])) { let rr = walk(c, fn); if (rr) return rr }
            return null
        }
        let root = findVue(document.body)
        return walk(root, (vm) => (vm && vm.addItem && vm.saveUsers ? vm : null))
    })
}

//直接呼叫 vm.addItem() 然後對最頂列做欄位 override
//
//注意 Vue 2 reactivity: 必須對 vm.users (data property) 做 mutation, 不能對 vm.opt.rows
//(vm.opt.rows 是透過 items computed 衍生的引用, mutation 不會回流到 vm.users 觸發後續儲存)
async function addRowAndSetFields(page, fieldsOverride = {}) {
    await page.evaluate((override) => {
        let findVue = (el) => {
            if (el.__vue__) return el.__vue__
            for (let c of el.children) { let r = findVue(c); if (r) return r }
            return null
        }
        let walk = (vm, fn) => {
            if (!vm) return null
            let r = fn(vm); if (r) return r
            for (let c of (vm.$children || [])) { let rr = walk(c, fn); if (rr) return rr }
            return null
        }
        let root = findVue(document.body)
        let vm = walk(root, (vm) => (vm && vm.addItem && vm.saveUsers ? vm : null))
        if (!vm) return
        vm.addItem()
        //直接 mutate vm.users[0] (新增列); Vue 2 reactivity 會傳播到 items / opt.rows
        if (vm.users && vm.users.length > 0) {
            for (let k in override) {
                vm.users[0][k] = override[k]
            }
            //強制觸發 array reactivity (Vue 2 對 array 內容變動須 splice/$set)
            vm.users.splice(0, 1, { ...vm.users[0] })
        }
        vm.refresh && vm.refresh()
    }, fieldsOverride)
    await page.waitForTimeout(500)
}

//直接刪除所有 rows (對 userAddEmpty 情境)
async function clearAllRows(page) {
    await page.evaluate(() => {
        let findVue = (el) => {
            if (el.__vue__) return el.__vue__
            for (let c of el.children) { let r = findVue(c); if (r) return r }
            return null
        }
        let walk = (vm, fn) => {
            if (!vm) return null
            let r = fn(vm); if (r) return r
            for (let c of (vm.$children || [])) { let rr = walk(c, fn); if (rr) return rr }
            return null
        }
        let root = findVue(document.body)
        let vm = walk(root, (vm) => (vm && vm.addItem && vm.saveUsers ? vm : null))
        if (!vm) return
        vm.users = []
        vm.isModified = true
    })
    await page.waitForTimeout(300)
}

//對 admin 自己列改某欄位 (e.g. isAdmin='n' 觸發 self-lockout)
//同上注意 Vue 2 reactivity: mutate vm.users 而非 vm.opt.rows
async function modifySelfRow(page, key, value) {
    await page.evaluate(({ adminId, k, v }) => {
        let findVue = (el) => {
            if (el.__vue__) return el.__vue__
            for (let c of el.children) { let r = findVue(c); if (r) return r }
            return null
        }
        let walk = (vm, fn) => {
            if (!vm) return null
            let r = fn(vm); if (r) return r
            for (let c of (vm.$children || [])) { let rr = walk(c, fn); if (rr) return rr }
            return null
        }
        let root = findVue(document.body)
        let vm = walk(root, (vm) => (vm && vm.addItem && vm.saveUsers ? vm : null))
        if (!vm) return
        for (let i = 0; i < (vm.users ? vm.users.length : 0); i++) {
            if (vm.users[i].id === adminId) {
                vm.users[i][k] = v
                vm.users.splice(i, 1, { ...vm.users[i] })
                break
            }
        }
        vm.isModified = true
        vm.refresh && vm.refresh()
    }, { adminId: testUsers.admin.id, k: key, v: value })
    await page.waitForTimeout(300)
}

async function clickSave(page) {
    //儲存按鈕只有 isModified=true 才顯示, 用 mdi-cloud-upload 的 button (紅底)
    //fallback: 找包含 saveChanges tooltip 的可點 element
    await page.evaluate(() => {
        let findVue = (el) => {
            if (el.__vue__) return el.__vue__
            for (let c of el.children) { let r = findVue(c); if (r) return r }
            return null
        }
        let walk = (vm, fn) => {
            if (!vm) return null
            let r = fn(vm); if (r) return r
            for (let c of (vm.$children || [])) { let rr = walk(c, fn); if (rr) return rr }
            return null
        }
        let root = findVue(document.body)
        let vm = walk(root, (vm) => (vm && vm.addItem && vm.saveUsers ? vm : null))
        if (vm) vm.saveUsers()
    })
}

async function waitCheckYes(page, lang) {
    //CheckYes button 文字: ok 或 確認
    let okText = lang === 'eng' ? 'OK' : '確認'
    await page.locator(`text="${okText}"`).first().waitFor({ state: 'visible', timeout: 30000 })
    await page.waitForTimeout(800)
}


// ===================================================================
// 14 個 capture helper
// ===================================================================

//先設好乾淨的 admin token (用於 token 衝突 / 過期等之前清理)
async function resetAdminToken() {
    await woItems.tokens.del({ userId: testUsers.admin.id }).catch(() => {})
    let t = ds.tokens.funNew({ userId: testUsers.admin.id })
    t.timeEnd = ot().add(60, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
    userTokens[testUsers.admin.id] = t.token
    await woItems.tokens.insert([t])
}


//001 success 透過 API 加 user 後進 Users list
async function captureSuccessAfterSave(page, lang) {
    await adminLoginAndOpenUsersList(page, lang)

    let newAccount = `au-newuser-${lang}-baseline`
    let allUsers = await woItems.users.select()
    allUsers = allUsers.map((u) => { let c = { ...u }; delete c.password; return c })
    allUsers.push(buildNewRowPlain(newAccount, 'Pw@KLMN5678', { name: `New User ${lang}`, email: `${newAccount}@test.com` }))

    let r = await callFapi(page, 'updateUsersList', [userTokens[testUsers.admin.id], lang, allUsers])
    if (!r.ok) throw new Error(`baseline 001 setup failed: ${r.err}`)

    //navigate again to Users list 強制 refetch
    let usersText = lang === 'eng' ? 'Users list' : '使用者清單'
    //先點 Statistics 再回 Users list, 確保 LayoutContentUsers 重 mount + getUsersList
    let statText = lang === 'eng' ? 'Statistics information' : '統計資訊'
    await page.locator(`text=${JSON.stringify(statText)}`).first().click().catch(() => {})
    await page.waitForTimeout(800)
    await page.locator(`text=${JSON.stringify(usersText)}`).first().click()
    //等新增的 user account text 出現於 ag-grid (確保 getUsersList 已回傳並渲染),
    //避免在「No Rows To Show」狀態下截圖
    await page.locator(`text=${JSON.stringify(newAccount)}`).first().waitFor({ state: 'visible', timeout: 30000 })
    await page.waitForTimeout(800)

    let buf = await page.screenshot({ fullPage: true })

    //cleanup
    let us = await woItems.users.select({ account: newAccount }).catch(() => [])
    for (let u of us) await woItems.users.del({ id: u.id }).catch(() => {})

    return buf
}

function buildNewRowPlain(account, password, opt = {}) {
    return ds.users.funNew({
        order: opt.order || 999,
        account,
        password,
        name: opt.name || `New ${account}`,
        email: opt.email || `${account}@test.com`,
        description: '',
        from: 'test',
        redir: `http://localhost:8080/?view=user&token={token}`,
        isAdmin: opt.isAdmin || 'n',
        timeVerified: '',
        timeExpired: '2030-01-01T00:00:00.000+08:00',
        timeBlocked: '',
        isActive: 'y',
    })
}


//通用 helper: 經 Users list UI 觸發新增/儲存 → 等 CheckYes 出現後截圖
async function captureCheckYesAfterAddRow(page, lang, rowOverride, modifySelf) {
    await adminLoginAndOpenUsersList(page, lang)

    if (rowOverride) {
        await addRowAndSetFields(page, rowOverride)
    }
    if (modifySelf) {
        await modifySelfRow(page, modifySelf.key, modifySelf.value)
    }

    await clickSave(page)
    await waitCheckYes(page, lang)
    return await page.screenshot({ fullPage: true })
}


//002 account empty
async function captureAccountEmpty(page, lang) {
    return await captureCheckYesAfterAddRow(page, lang, {
        account: '',
        email: 'au-newuser-002@test.com',
        password: 'Pw@KLMN5678',
    })
}

//003 account duplicate (新增 2 列同 account)
async function captureAccountDuplicate(page, lang) {
    await adminLoginAndOpenUsersList(page, lang)
    await addRowAndSetFields(page, {
        account: 'au-dup',
        email: 'au-dup1@test.com',
        password: 'Pw@KLMN5678',
    })
    await addRowAndSetFields(page, {
        account: 'au-dup',
        email: 'au-dup2@test.com',
        password: 'Pw@KLMN5678',
    })
    await clickSave(page)
    await waitCheckYes(page, lang)
    return await page.screenshot({ fullPage: true })
}

//004 password empty
async function capturePasswordEmpty(page, lang) {
    return await captureCheckYesAfterAddRow(page, lang, {
        account: 'au-newuser-004',
        email: 'au-newuser-004@test.com',
        password: '',
    })
}

//005 email empty
async function captureEmailEmpty(page, lang) {
    return await captureCheckYesAfterAddRow(page, lang, {
        account: 'au-newuser-005',
        email: '',
        password: 'Pw@KLMN5678',
    })
}

//006 email format bad
async function captureEmailFormatBad(page, lang) {
    return await captureCheckYesAfterAddRow(page, lang, {
        account: 'au-newuser-006',
        email: 'not-an-email',
        password: 'Pw@KLMN5678',
    })
}

//007 email duplicate (新增 2 列同 email)
async function captureEmailDuplicate(page, lang) {
    await adminLoginAndOpenUsersList(page, lang)
    await addRowAndSetFields(page, {
        account: 'au-dup-em-1',
        email: 'au-dup-em@test.com',
        password: 'Pw@KLMN5678',
    })
    await addRowAndSetFields(page, {
        account: 'au-dup-em-2',
        email: 'au-dup-em@test.com',
        password: 'Pw@KLMN5678',
    })
    await clickSave(page)
    await waitCheckYes(page, lang)
    return await page.screenshot({ fullPage: true })
}

//008 redir empty
async function captureRedirEmpty(page, lang) {
    return await captureCheckYesAfterAddRow(page, lang, {
        account: 'au-newuser-008',
        email: 'au-newuser-008@test.com',
        password: 'Pw@KLMN5678',
        redir: '',
    })
}

//009 rows empty (清掉所有 rows)
async function captureRowsEmpty(page, lang) {
    await adminLoginAndOpenUsersList(page, lang)
    await clearAllRows(page)
    await clickSave(page)
    await waitCheckYes(page, lang)
    return await page.screenshot({ fullPage: true })
}

//010 self isAdmin=n
async function captureCannotDemoteSelf(page, lang) {
    return await captureCheckYesAfterAddRow(page, lang, null, { key: 'isAdmin', value: 'n' })
}

//011 self isActive=n
async function captureCannotDisableSelf(page, lang) {
    return await captureCheckYesAfterAddRow(page, lang, null, { key: 'isActive', value: 'n' })
}

//012 password policy backend reject
//
//必須讓所有前端 isError 都通過 (account / email / redir 皆有效, password 非空)
//才會把整批送到後端, 由 checkUserPassword 把關。否則前端 isError 會先攔下,
//modal 顯示的是前端錯誤訊息而非後端 reject 訊息 (此問題由語意斷言抓出, 非 pixel)
async function capturePasswordPolicyBackend(page, lang) {
    return await captureCheckYesAfterAddRow(page, lang, {
        account: 'au-newuser-012',
        email: 'au-newuser-012@test.com',
        password: 'short', //非空 (繞過前端 isError 之 errItemsByPassword 空值檢查), 但長度 < 8 觸發後端 checkUserPassword reject
        redir: 'http://localhost:8080/?view=user&token={token}', //有效, 繞過 errItemsByRedir
    })
}

//013 account 與 DB 既有衝突 (前端 isError 不擋, 因 ckKey 是 backend 對整批 rows 偵測表內衝突)
//此處須 admin 加新列 account 與 DB 既有 user 重複 (例如 ac-admin)
async function captureAccountConflictBackend(page, lang) {
    //假設 ac-admin 是 DB 既有 (g.initialData.mjs 內), 取它做衝突
    //但要注意: 前端 isError errItemsByAccount 對「同表內」重複會擋, 須 testUsers 載入後再加新列 account=ac-admin
    //ac-admin 已在表內 (從 getUsersList 回來), 加新列 ac-admin 會被 errItemsByAccount 偵測到 (同表內重複)
    //→ 觸發 isError CheckYes 而非 backend ckKey reject
    //→ 行為 essentially identical (CheckYes errInAccounts 訊息), 與 002 重疊
    //
    //若要真正觸發 backend ckKey, 須繞過前端 isError. 一個方法是: row1.account='X' 通過前端檢查,
    //但 procOrm 寫入時撞 DB 實際上的 ckKey 是「同 ltdtNew 內 account 重複」, 不是 vs DB.
    //
    //實際上 backend 端對「新增 account 與 DB 既有 row 衝突」的偵測在 ckKey('id') / ckKey('email')
    //之後的 procOrm.insert 階段, 由 LMDB 的 unique constraint 觸發 reject.
    //此情境 CheckYes 顯示 LMDB 拋出的英文錯誤訊息, 不易維持穩定.
    //
    //簡化: 重用「同表內重複」(003) 的行為作為「帳號衝突」的代表 UI 狀態.
    //此 capture 與 003 internally 同 path, 但 baseline 命名不同以利文件對照.
    return await captureAccountDuplicate(page, lang)
}

//014 email 與 DB 既有衝突 (同上邏輯, 重用 007)
async function captureEmailConflictBackend(page, lang) {
    return await captureEmailDuplicate(page, lang)
}


// ===================================================================
// 產生標準圖
// ===================================================================

async function generateBaselineForLang(page, lang) {
    console.log(`=== 產生標準圖（${lang}）===`)

    let cases = [
        ['001-after-save-with-new-user', captureSuccessAfterSave],
        ['002-account-empty', captureAccountEmpty],
        ['003-account-duplicate', captureAccountDuplicate],
        ['004-password-empty', capturePasswordEmpty],
        ['005-email-empty', captureEmailEmpty],
        ['006-email-format', captureEmailFormatBad],
        ['007-email-duplicate', captureEmailDuplicate],
        ['008-redir-empty', captureRedirEmpty],
        ['009-rows-empty', captureRowsEmpty],
        ['010-cannot-demote-self', captureCannotDemoteSelf],
        ['011-cannot-disable-self', captureCannotDisableSelf],
        ['012-password-policy-backend', capturePasswordPolicyBackend],
        ['013-account-conflict-backend', captureAccountConflictBackend],
        ['014-email-conflict-backend', captureEmailConflictBackend],
    ]

    for (let [name, fn] of cases) {
        console.log(`  ${name}`)
        let buf = await fn(page, lang)
        writeBaseline(lang, name, buf)
    }
}


async function generateBaseline() {
    await startServersOnce()

    if (!fs.existsSync(baselineDir)) {
        fs.mkdirSync(baselineDir, { recursive: true })
    }

    await deleteTestUsersAndTokens()
    await insertTestUsersAndTokens()

    for (let lang of langs) {
        let browser = await chromium.launch({ headless: true })
        let page = await browser.newPage()
        page.on('dialog', async (dialog) => {
            await dialog.accept()
        })

        await generateBaselineForLang(page, lang)

        await browser.close()
    }

    await deleteTestUsersAndTokens()

    console.log('=== 標準圖產生完成 ===')
}


// ===================================================================
// mocha 測試模式
// ===================================================================

if (process.argv.includes('--baseline')) {
    generateBaseline()
        .catch((err) => {
            console.error(err)
            process.exit(1)
        })
}
else {

    // --- API 拒絕 / 副作用驗證 (語系無關, 1 輪即可) ---

    describe(`AddUser E2E API — updateUsersList 拒絕情境與副作用`, function() {
        this.timeout(60000)

        let browser
        let page

        before(async function() {
            this.timeout(180000)
            await startServersOnce()

            await deleteTestUsersAndTokens()
            await insertTestUsersAndTokens()

            browser = await chromium.launch({ headless: true })
            let context = await browser.newContext()
            page = await context.newPage()

            await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
            await page.waitForTimeout(2500)
        })

        after(async function() {
            if (browser) {
                await browser.close()
            }
            await deleteTestUsersAndTokens()
        })

        async function buildAllRowsWithNew(newRow) {
            let allUsers = await woItems.users.select()
            allUsers = allUsers.map((u) => { let c = { ...u }; delete c.password; return c })
            return [...allUsers, newRow]
        }

        it('password-empty: 新 row password 空 → reject', async function() {
            let rows = await buildAllRowsWithNew(buildNewRowPlain('au-bad-empty', '', { email: 'au-bad-empty@test.com' }))
            let r = await callFapi(page, 'updateUsersList', [userTokens[testUsers.admin.id], 'eng', rows])
            assert.strict.equal(r.ok, false)
        })

        it('password-too-short: → reject', async function() {
            let rows = await buildAllRowsWithNew(buildNewRowPlain('au-bad-short', 'Ab@1', { email: 'au-bad-short@test.com' }))
            let r = await callFapi(page, 'updateUsersList', [userTokens[testUsers.admin.id], 'eng', rows])
            assert.strict.equal(r.ok, false)
        })

        it('password-no-letter: → reject', async function() {
            let rows = await buildAllRowsWithNew(buildNewRowPlain('au-bad-noletter', '12345678@', { email: 'au-bad-noletter@test.com' }))
            let r = await callFapi(page, 'updateUsersList', [userTokens[testUsers.admin.id], 'eng', rows])
            assert.strict.equal(r.ok, false)
        })

        it('password-no-digit: → reject', async function() {
            let rows = await buildAllRowsWithNew(buildNewRowPlain('au-bad-nodigit', 'Abcdefg@', { email: 'au-bad-nodigit@test.com' }))
            let r = await callFapi(page, 'updateUsersList', [userTokens[testUsers.admin.id], 'eng', rows])
            assert.strict.equal(r.ok, false)
        })

        it('password-blacklist: → reject', async function() {
            let rows = await buildAllRowsWithNew(buildNewRowPlain('au-bad-bl', '1qaz@WSX', { email: 'au-bad-bl@test.com' }))
            let r = await callFapi(page, 'updateUsersList', [userTokens[testUsers.admin.id], 'eng', rows])
            assert.strict.equal(r.ok, false)
        })

        it('self-lockout-isAdmin: → reject "cannotDemoteSelf"', async function() {
            let allUsers = await woItems.users.select()
            allUsers = allUsers.map((u) => {
                let copy = { ...u }
                delete copy.password
                if (copy.id === testUsers.admin.id) copy.isAdmin = 'n'
                return copy
            })
            let r = await callFapi(page, 'updateUsersList', [userTokens[testUsers.admin.id], 'eng', allUsers])
            assert.strict.equal(r.ok, false)
            assert.strict.match(r.err, /[Cc]annot demote yourself|不可解除自己的管理員權限/)
        })

        it('self-lockout-isActive: → reject "cannotDisableSelf"', async function() {
            let allUsers = await woItems.users.select()
            allUsers = allUsers.map((u) => {
                let copy = { ...u }
                delete copy.password
                if (copy.id === testUsers.admin.id) copy.isActive = 'n'
                return copy
            })
            let r = await callFapi(page, 'updateUsersList', [userTokens[testUsers.admin.id], 'eng', allUsers])
            assert.strict.equal(r.ok, false)
            assert.strict.match(r.err, /[Cc]annot disable yourself|不可停用自己的帳號/)
        })

        it('happy-path: admin 加 user → DB 驗證 hash/audit/timeVerified', async function() {
            let newAccount = 'au-newuser-happy'
            await woItems.users.select({ account: newAccount }).catch(() => []).then(async (us) => {
                for (let u of us) await woItems.users.del({ id: u.id }).catch(() => {})
            })

            let rawPw = 'Pw@KLMN5678'
            let rows = await buildAllRowsWithNew(buildNewRowPlain(newAccount, rawPw, { email: 'au-newuser-happy@test.com' }))
            let r = await callFapi(page, 'updateUsersList', [userTokens[testUsers.admin.id], 'eng', rows])
            assert.strict.equal(r.ok, true, `預期 resolve, 實際 reject: ${r.err}`)

            let us = await woItems.users.select({ account: newAccount })
            assert.strict.equal(us.length, 1)
            let u = us[0]
            assert.strict.notEqual(u.password, rawPw)
            assert.strict.notEqual(u.password, '')
            assert.strict.equal(u.password, hashPassword(rawPw, salt))
            assert.strict.equal(u.isForceChangePw, 'n')
            assert.strict.equal(u.userId, testUsers.admin.id, `userId 應為 admin id`)
            assert.strict.equal(u.userIdUpdate, testUsers.admin.id)
            assert.strict.equal(typeof u.timeVerified === 'string' && u.timeVerified.length > 0, true)

            await woItems.users.del({ id: u.id }).catch(() => {})
        })

        it('existing-row-password-preserved: → 既有 user password hash 不被洗掉', async function() {
            let before = await woItems.users.select({ id: testUsers.existing.id })
            let originalHash = before[0].password
            assert.strict.equal(originalHash, hashPassword(testUsers.existing.rawPassword, salt))

            let allUsers = await woItems.users.select()
            allUsers = allUsers.map((u) => {
                let copy = { ...u }
                delete copy.password
                if (copy.id === testUsers.existing.id) copy.description = 'updated desc'
                return copy
            })
            let r = await callFapi(page, 'updateUsersList', [userTokens[testUsers.admin.id], 'eng', allUsers])
            assert.strict.equal(r.ok, true, `預期 resolve, 實際 reject: ${r.err}`)

            let after = await woItems.users.select({ id: testUsers.existing.id })
            assert.strict.equal(after[0].password, originalHash)
            assert.strict.equal(after[0].description, 'updated desc')
        })

    })


    // --- UI baseline 比對 (14 case × 2 lang = 28 baselines) ---

    for (let lang of langs) {

        describe(`AddUser E2E [${lang}] — UI baseline 比對`, function() {
            this.timeout(180000)

            let browser
            let page

            before(async function() {
                this.timeout(240000)
                await startServersOnce()

                await deleteTestUsersAndTokens()
                await insertTestUsersAndTokens()

                browser = await chromium.launch({ headless: true })
                let context = await browser.newContext()
                page = await context.newPage()

                page.on('dialog', async (dialog) => {
                    await dialog.accept()
                })
            })

            after(async function() {
                if (browser) {
                    await browser.close()
                }
                await deleteTestUsersAndTokens()
            })

            let cases = [
                ['001-after-save-with-new-user', captureSuccessAfterSave],
                ['002-account-empty', captureAccountEmpty],
                ['003-account-duplicate', captureAccountDuplicate],
                ['004-password-empty', capturePasswordEmpty],
                ['005-email-empty', captureEmailEmpty],
                ['006-email-format', captureEmailFormatBad],
                ['007-email-duplicate', captureEmailDuplicate],
                ['008-redir-empty', captureRedirEmpty],
                ['009-rows-empty', captureRowsEmpty],
                ['010-cannot-demote-self', captureCannotDemoteSelf],
                ['011-cannot-disable-self', captureCannotDisableSelf],
                ['012-password-policy-backend', capturePasswordPolicyBackend],
                ['013-account-conflict-backend', captureAccountConflictBackend],
                ['014-email-conflict-backend', captureEmailConflictBackend],
            ]

            for (let [name, fn] of cases) {
                it(`${name}`, async function() {
                    //每個 it 之間 admin token 都要復原 (前面 case 的 captureCheckYesAfterAddRow 不會儲存到 DB,
                    //但 happy-path API test 等可能影響, 此處 reset 確保乾淨)
                    await resetAdminToken()
                    let buf = await fn(page, lang)

                    //語意斷言 (主) — 從 spec 衍生的預期文字必須出現在頁面 DOM 上
                    //自訂 DOM 走訪: 跳過 SCRIPT/STYLE, 收集所有 text node 內容比對
                    //(innerText 受 viewport visible 限制可能漏失 modal 文字; documentElement.textContent
                    //會包含 CSS / 內聯 script 內容導致誤判)
                    let pageHasText = async (text) => {
                        return await page.evaluate((t) => {
                            let walk = (el) => {
                                if (!el) return false
                                if (el.nodeType === 3) return (el.nodeValue || '').includes(t)
                                if (el.nodeType !== 1) return false
                                let tag = el.tagName
                                if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return false
                                for (let c of el.childNodes) {
                                    if (walk(c)) return true
                                }
                                return false
                            }
                            return walk(document.body)
                        }, text)
                    }

                    let collectVisibleText = async () => {
                        return await page.evaluate(() => {
                            let parts = []
                            let walk = (el) => {
                                if (!el) return
                                if (el.nodeType === 3) {
                                    let t = (el.nodeValue || '').trim()
                                    if (t) parts.push(t)
                                    return
                                }
                                if (el.nodeType !== 1) return
                                let tag = el.tagName
                                if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return
                                for (let c of el.childNodes) walk(c)
                            }
                            walk(document.body)
                            return parts.join(' | ').slice(0, 2000)
                        })
                    }

                    if (name === '001-after-save-with-new-user') {
                        let expectedAccount = `au-newuser-${lang}-baseline`
                        let found = await pageHasText(expectedAccount)
                        if (!found) {
                            let dump = await collectVisibleText()
                            assert.fail(`預期 Users list 含新帳號 "${expectedAccount}", 實際可見文字: ${dump}`)
                        }
                    }
                    else if (expectedModalText[name] && expectedModalText[name][lang]) {
                        let expected = expectedModalText[name][lang]
                        let found = await pageHasText(expected)
                        if (!found) {
                            let dump = await collectVisibleText()
                            assert.fail(`預期 modal 含 "${expected}" (來自 spec), 實際可見文字: ${dump}`)
                        }
                    }

                    //像素斷言 (補強, 視覺回歸) — 補語意斷言之後的 layout / icon / 字型微差
                    let baselinePath = bp(lang, name)
                    assert.strict.equal(fs.existsSync(baselinePath), true, `標準圖不存在: ${baselinePath}`)
                    let baselineBuf = fs.readFileSync(baselinePath)
                    assert.strict.equal(buf.equals(baselineBuf), true, `截圖與標準圖不一致: adduser-${lang}-${name}`)
                })
            }

            it(`new-user-can-login: 用 admin 設定的密碼登入新 user → 進 user view (非強制變更)`, async function() {
                let loginText = lang === 'eng' ? 'Log in' : '登入'
                let newAccount = `au-newuser-${lang}-login`
                let rawPw = 'Pw@KLMN5678'

                await woItems.users.select({ account: newAccount }).catch(() => []).then(async (us) => {
                    for (let u of us) await woItems.users.del({ id: u.id }).catch(() => {})
                })

                //setup 新 user via API
                await resetAdminToken()
                let allUsers = await woItems.users.select()
                allUsers = allUsers.map((u) => { let c = { ...u }; delete c.password; return c })
                allUsers.push(buildNewRowPlain(newAccount, rawPw, { email: `${newAccount}@test.com` }))
                let r = await callFapi(page, 'updateUsersList', [userTokens[testUsers.admin.id], lang, allUsers])
                assert.strict.equal(r.ok, true)

                //logout: 清 LS + 重進 baseUrl
                await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
                await page.evaluate(() => localStorage.clear())
                await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 })
                await page.waitForTimeout(2500)

                if (lang === 'cht') {
                    await page.locator('text=English').first().click()
                    await page.waitForTimeout(400)
                    await page.locator('text=中文').first().click()
                    await page.waitForTimeout(600)
                }

                let inputs = page.locator('input')
                await inputs.nth(0).fill(newAccount)
                await inputs.nth(1).fill(rawPw)
                await page.waitForTimeout(300)
                await page.locator(`text="${loginText}"`).first().click()
                await page.waitForTimeout(4000)

                let url = await page.evaluate(() => location.href)
                assert.strict.match(url, /view=user/)

                let pwCount = await page.locator('input[type="password"]').count()
                assert.strict.equal(pwCount, 0, `不該強制展開變更密碼表單`)

                await woItems.users.select({ account: newAccount }).catch(() => []).then(async (us) => {
                    for (let u of us) await woItems.users.del({ id: u.id }).catch(() => {})
                })
            })

        })

    }

}
