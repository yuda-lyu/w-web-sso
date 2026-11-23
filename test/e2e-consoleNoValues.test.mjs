//前端瀏覽器 console 不印資料值之使用者視角驗收(排程第 206 項; 規則帳本 R-LOG-02; 靜態不變式見 unit-consoleNoValuesFront)
//E2E-CN-001: 真瀏覽器以真實登入表單登入系統管理者(先故意輸入錯誤密碼一次, 再以正確密碼登入), 轉至後台後逐頁瀏覽統計、使用者、金鑰、IP 四頁,
//  收集瀏覽器 console 之全部訊息(含物件引數之內容: msg.text() 對物件只回 JSHandle@object, 另取 jsonValue),
//  斷言: ①登入流程之 console 為摘要形(`autoLogin, goto view[(typeof string)] page`、`login err[(string)], goto view['login'] page`, 不印 view 值與錯誤本體);
//        ②全部訊息不含資料庫內任何使用者之 email 與主鍵、不含輸入之密碼、不含登入後之權杖字串、不含 `token=` 網址參數.
//  修前(2026-11-23 之前): 登入流程印出 view 值與錯誤本體, 摘要形之斷言轉紅; 其餘 48 處(錯誤本體、選取列、回應物件)為錯誤與非預期分支, 由 unit-consoleNoValuesFront 靜態盤點全集, 本檔不重造錯誤.
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
            await waitConsole('登入失敗之 console 摘要', /^login err\[\(string\)\], goto view\['login'\] page/)

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
            await waitConsole('轉址後之 autoLogin 摘要', /^autoLogin, goto view\[\(typeof string\)\] page/)
            await Promise.all(pending)

            //⑤斷言
            //⑤-1 摘要形(修前印 view 值與錯誤本體, 此二案轉紅)
            A.ok(texts.some((t) => /^autoLogin, goto view\[\(typeof string\)\] page/.test(t)), `應有 autoLogin 摘要, 實得 ${JSON.stringify(texts.slice(0, 8))}`)
            A.ok(texts.some((t) => /^login err\[\(string\)\], goto view\['login'\] page/.test(t)), '應有登入失敗摘要(不印錯誤本體)')
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
})
