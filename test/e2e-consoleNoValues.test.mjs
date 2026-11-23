//前端瀏覽器 console 不印資料值之使用者視角驗收(排程第 206 項; 規則帳本 R-LOG-02; 靜態不變式見 unit-consoleNoValuesFront)
//E2E-CN-001: 真瀏覽器以真實登入表單登入系統管理者(先故意輸入錯誤密碼一次, 再以正確密碼登入), 轉至後台後逐頁瀏覽統計、使用者、金鑰、IP 四頁,
//  收集瀏覽器 console 之全部訊息(含物件引數之內容: msg.text() 對物件只回 JSHandle@object, 另取 jsonValue),
//  斷言: ①登入流程之 console 為摘要形(wsemi 摘要: `autoLogin, goto view[(string)] page`、`login err { errType: 'string' } goto view['login'] page`, 不印 view 值與錯誤本體;
//          2026-11-23 第 603 項起: 本地摘要函數已刪、改用 wsemi getDiagShape／getDiagBriefErr, 錯誤摘要為物件引數而非字串);
//        ②全部訊息不含資料庫內任何使用者之 email 與主鍵、不含輸入之密碼、不含登入後之權杖字串、不含 `token=` 網址參數.
//  修前(2026-11-23 之前): 登入流程印出 view 值與錯誤本體, 摘要形之斷言轉紅; 其餘 48 處(錯誤本體、選取列、回應物件)為錯誤與非預期分支, 由 unit-consoleNoValuesFront 靜態盤點全集, 本檔不重造錯誤.
//E2E-CN-002(2026-11-23 第 603 項): 失敗路徑——資料通道請求失敗時 main.js 之 getWebInfor catch 於 console 只印錯誤類別(wsemi getDiagBriefErr 之物件 { errType, errCode? }), 不含瀏覽器之錯誤訊息文字或網址.
//純語意斷言(無標準圖; 只收集 console, 不改畫面、不截圖; 唯一寫入為本檔建立之管理者與其登入權杖, 測後清除).
//act 走 user-facing input(真填表單、真點選單); 單一語系 eng(console 之摘要文字不隨語系).
//跑法: npx mocha test/e2e-consoleNoValues.test.mjs --reporter list --timeout 300000
import assert from 'assert'
import ds from '../src/schema/index.mjs'
import hashPassword from '../server/hashPassword.mjs'
import { woItems } from '../g_mOrm.mjs'
import { startServersOnce, cleanup, baseUrl, resetToBaseSeed, deleteNonBaseSeed, cleanKpAccountLoginFailed, launchBrowser, typeIntoNthInput, waitUntilExist } from './tools/e2e-setup.mjs'
import { pollUntil } from './tools/e2eLib.mjs'

const A = assert.strict

let salt = '{salt}'
let lsKey = 'ksso:userToken'

//本檔建立之系統管理者(登入表單之帳密; redir 指向後台, 使登入後轉至後台)
let admin = {
    id: 'id-cn-admin-5527',
    account: 'cn-admin',
    rawPassword: 'Pw@consoleNoValues1',
    wrongPassword: 'Wrong@consoleNoValues9',
    name: 'Console NoValues Admin',
    email: 'cn-admin-5527@cn-test.example',
}

//console 訊息之收集形式: `<msg.text()> | <各引數之 jsonValue>`(msg.text() 對物件引數之表示依 Playwright 版本而異: 預覽字串或 JSHandle@object, 故斷言只錨定 jsonValue 之部分)
//登入成功後轉址之 autoLogin: 單一字串引數(樣板字串內插 getDiagShape(view))
const RE_AUTO_LOGIN = /^autoLogin, goto view\[\(string\)\] page/
//登入失敗: 三個引數——標籤字串、wsemi getDiagBriefErr 之物件({ errType }; 錯誤為伺服端回傳之語系鍵字串, 故 errType 為 string)、固定詞彙
const RE_LOGIN_ERR = /\| "login err" \| \{"errType":"string"\} \| "goto view\['login'\] page"$/

let text = {
    login: 'Log in',
    statistics: 'Statistics information',
    usersList: 'Users list',
    tokensList: 'Tokens list',
    ipsList: 'Ips list',
}


describe('e2e-consoleNoValues (前端 console 不印資料值, 排程第 206 項)', function() {
    this.timeout(300000)

    before(async function() {
        this.timeout(240000)
        await startServersOnce()
        await resetToBaseSeed()
        let v = ds.users.funNew({
            order: 900,
            account: admin.account,
            password: hashPassword(admin.rawPassword, salt),
            name: admin.name,
            email: admin.email,
            description: '',
            from: 'test',
            redir: `${baseUrl}/?view=backstage&token={token}`,
            isAdmin: 'y',
            timeVerified: '2025-01-01T00:00:00.000+08:00',
            timeExpired: '2030-01-01T00:00:00.000+08:00',
            timeBlocked: '',
            isActive: 'y',
        })
        v.id = admin.id
        v.isAdmin = 'y'
        v.timeVerified = '2025-01-01T00:00:00.000+08:00'
        v.timeExpired = '2030-01-01T00:00:00.000+08:00'
        v.timeBlocked = ''
        await woItems.users.insert([v])
    })

    after(async function() {
        this.timeout(120000)
        await cleanKpAccountLoginFailed().catch(() => {})
        await deleteNonBaseSeed()
        await cleanup()
    })

    it('E2E-CN-001 以登入表單登入(先錯誤密碼、再正確密碼)並逐頁瀏覽後, 瀏覽器 console 只有摘要(鍵名、型別、筆數), 不含使用者資料、密碼與權杖', async function() {
        let browser = await launchBrowser()
        try {
            let context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
            let page = await context.newPage()
            page.on('dialog', (d) => d.accept())

            //console 收集(含物件引數之內容)
            let texts = []
            let pending = []
            page.on('console', (msg) => {
                pending.push((async () => {
                    let parts = [msg.text()]
                    for (let a of msg.args()) {
                        try {
                            parts.push(JSON.stringify(await a.jsonValue()))
                        }
                        catch (err) {
                            parts.push('(unserializable)')
                        }
                    }
                    texts.push(parts.join(' | '))
                })())
            })
            //等收集到符合條件之 console 訊息(事件同步, 不以固定等待)
            let waitConsole = async (label, re) => {
                await pollUntil(label, async () => {
                    await Promise.all(pending)
                    return texts.some((t) => re.test(t)) ? true : null
                }, { timeout: 60000 })
            }

            //①進登入頁(eng), 等表單
            await page.goto(`${baseUrl}/?lang=eng`, { waitUntil: 'domcontentloaded', timeout: 120000 })
            await waitUntilExist(page, 'login form inputs (2 個)', () => document.querySelectorAll('input').length >= 2, { timeout: 60000 })

            //②錯誤密碼登入一次: 登入失敗之 console(PageLogin catch 路徑)
            await typeIntoNthInput(page, 0, admin.account)
            await typeIntoNthInput(page, 1, admin.wrongPassword)
            await page.locator(`text="${text.login}"`).first().click()
            await waitConsole('登入失敗之 console 摘要', RE_LOGIN_ERR)

            //③正確密碼登入: 轉址至後台(autoLogin 路徑), 等後台選單文字
            await typeIntoNthInput(page, 1, admin.rawPassword)
            await page.locator(`text="${text.login}"`).first().click()
            await waitUntilExist(page, `後台 ${text.statistics} 文字`, (s) => document.body.innerText.includes(s), { arg: text.statistics, timeout: 120000 })
            let token = await page.evaluate((k) => localStorage.getItem(k), lsKey)
            A.ok(typeof token === 'string' && token.length >= 8, '登入後 localStorage 應有權杖(供斷言 console 不含之)')

            //④逐頁瀏覽(真點選單; 各頁之表格容器出現即已載入)
            for (let label of [text.usersList, text.tokensList, text.ipsList, text.statistics]) {
                await page.locator(`text="${label}"`).first().click()
                await waitUntilExist(page, `${label} 頁內容`, (s) => document.body.innerText.includes(s) && (document.querySelectorAll('.ag-root-wrapper').length > 0 || document.querySelectorAll('canvas').length > 0), { arg: label, timeout: 60000 })
            }
            await waitConsole('轉址後之 autoLogin 摘要', RE_AUTO_LOGIN)
            await Promise.all(pending)

            //⑤斷言
            //⑤-1 摘要形(修前印 view 值與錯誤本體, 此二案轉紅)
            A.ok(texts.some((t) => RE_AUTO_LOGIN.test(t)), `應有 autoLogin 摘要, 實得 ${JSON.stringify(texts.slice(0, 8))}`)
            A.ok(texts.some((t) => RE_LOGIN_ERR.test(t)), `應有登入失敗摘要(不印錯誤本體), 實得 ${JSON.stringify(texts.slice(0, 8))}`)
            //⑤-2 全部訊息不含: 資料庫內任何使用者之 email 與主鍵、輸入之密碼、權杖字串、`token=`
            let users = await woItems.users.select({})
            let secrets = [admin.rawPassword, admin.wrongPassword, token, admin.account, admin.name]
            for (let u of users) {
                for (let k of ['email', 'id']) {
                    if (typeof u[k] === 'string' && u[k].length >= 6) {
                        secrets.push(u[k])
                    }
                }
            }
            A.ok(secrets.length >= 6, `應有足夠之基準值可比對(實得 ${secrets.length})`)
            for (let t of texts) {
                for (let s of secrets) {
                    A.ok(!t.includes(s), `console 訊息含資料值(長度 ${s.length}): ${t.slice(0, 200)}`)
                }
                A.ok(!/token=/.test(t), `console 訊息含權杖網址參數: ${t.slice(0, 200)}`)
            }
        }
        finally {
            await browser.close()
        }
    })

    //E2E-CN-002(2026-11-23, 排程第 603 項): 失敗路徑——只中止 getWebInfor 之請求(連線、同步、輪詢等其餘請求照常; 全部中止則連線閘後之同步不完成, getWebInfor 根本不會被呼叫),
    //  使 main.js 之 getWebInfor 失敗; catch 內之 console 為 wsemi getDiagBriefErr 之物件 { errType, errCode? }(單一引數), 不含瀏覽器之錯誤訊息文字(如 Failed to fetch)與網址.
    //  修前(本地 describeErr)為字串 `(string)`, 故本案於修前碼轉紅. 純語意(不改畫面、不截圖).
    it('E2E-CN-002 資料通道請求失敗時, getWebInfor 之 catch 於 console 只印錯誤類別(物件 { errType }), 不含錯誤訊息文字', async function() {
        let browser = await launchBrowser()
        try {
            let context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
            let page = await context.newPage()
            let texts = []
            let pending = []
            page.on('console', (msg) => {
                pending.push((async () => {
                    let parts = [msg.text()]
                    for (let a of msg.args()) {
                        try {
                            parts.push(JSON.stringify(await a.jsonValue()))
                        }
                        catch (err) {
                            parts.push('(unserializable)')
                        }
                    }
                    texts.push(parts.join(' | '))
                })())
            })
            await page.route('**/api/main', async (route) => {
                let buf = route.request().postDataBuffer()
                if (buf && buf.includes('getWebInfor')) {
                    await route.abort('failed')
                    return
                }
                await route.continue()
            })
            await page.goto(`${baseUrl}/?lang=eng`, { waitUntil: 'load', timeout: 30000 })
            //等 getWebInfor 之 catch 訊息出現(偵測式等待, 上限 60 秒; w-converhp 用戶端重試數次後才以錯誤拒絕)
            let hit = null
            await pollUntil('getWebInfor 之 catch 訊息(單一物件引數 { errType })', async () => {
                await Promise.all(pending)
                hit = texts.find((t) => /\| \{"errType":"[A-Za-z]+"(?:,"errCode":"[A-Z][A-Z0-9_]+")?\}$/.test(t) && !/^login err/.test(t)) || null
                return hit !== null ? true : null
            }, { timeout: 60000 })
            //msg.text() 為物件引數之預覽(`{errType: string}`; 舊版 Playwright 為 `JSHandle@object`), 其後接 jsonValue: { errType, errCode? }(類別名只含字母; 代碼只含大寫英數與底線);
            //  資料通道之失敗為字串(w-converhp 用戶端以字串拒絕)時 errType 為 string; 若為 Error 類別則為 TypeError 等, 皆符合
            A.match(hit, /^(?:JSHandle@object|\{errType: [A-Za-z]+(?:, errCode: [A-Z][A-Z0-9_]+)?\}) \| \{"errType":"[A-Za-z]+"(?:,"errCode":"[A-Z][A-Z0-9_]+")?\}$/, `應只印錯誤類別, 實得 ${hit.slice(0, 200)}`)
            A.ok(!/Failed to fetch|NetworkError|net::|127\.0\.0\.1|token=/i.test(hit), `getWebInfor 之訊息不得含錯誤訊息文字或網址: ${hit.slice(0, 200)}`)
        }
        finally {
            await browser.close()
        }
    })
})
