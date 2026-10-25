//probe-capture.mjs — 真瀏覽器擷取未登入頁與登入後各頁之框架系統函數呼叫(sso-run01; 暫存)
//用法: node tmp/sso-run01/probe-capture.mjs <label> <outJsonl> [baseUrlOverride]
//經 e2e-setup 啟動前後端(沿用政策), 每個情境 fresh context + netcap 擷取; 收尾一律關瀏覽器、cleanup、清非 base seed 資料
import fs from 'fs'
import path from 'path'
import { startServersOnce, cleanup, launchBrowser, baseUrl as defaultBaseUrl, apiUrl, resetToBaseSeed, deleteNonBaseSeed, waitUntilExist } from '../../test/tools/e2e-setup.mjs'
import { installNetcap } from './netcap.mjs'
import { woItems } from '../../g_mOrm.mjs'
import { buildBaseUsers } from '../../g_initialData.mjs'
import ds from '../../src/schema/index.mjs'
import hashPassword from '../../server/hashPassword.mjs'

let label = process.argv[2] || 'probe'
let out = path.resolve(process.argv[3] || `./tmp/sso-run01/net-${label}.jsonl`)
let baseUrl = process.argv[4] || defaultBaseUrl
console.log('[probe] label', label, 'out', out, 'baseUrl', baseUrl)
fs.mkdirSync(path.dirname(out), { recursive: true })
let uiOut = out.replace(/\.jsonl$/, '.ui.jsonl')
fs.writeFileSync(out, '')
fs.writeFileSync(uiOut, '')

async function uiState(page, scenario, extra = {}) {
    let s = await page.evaluate(() => ({
        url: location.href.replace(/([?&]token=)[^&#]*/g, '$1<masked>'),
        inputs: document.querySelectorAll('input').length,
        pw: document.querySelectorAll('input[type="password"]').length,
        text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 220),
    }))
    fs.appendFileSync(uiOut, JSON.stringify({ label, scenario, ...s, ...extra }) + '\n')
    console.log('[ui]', scenario, JSON.stringify({ ...s, ...extra }))
}

async function scenario(browser, name, fn) {
    let ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    installNetcap(ctx, { out, label: `${label}|${name}` })
    let page = await ctx.newPage()
    let errs = []
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)) })
    page.on('pageerror', (e) => errs.push('pageerror: ' + String(e && e.message || e).slice(0, 200)))
    try {
        await fn(page)
    }
    catch (err) {
        console.log('[scenario-error]', name, err && err.message)
        fs.appendFileSync(uiOut, JSON.stringify({ label, scenario: name, error: String(err && err.message || err).slice(0, 300) }) + '\n')
    }
    finally {
        fs.appendFileSync(uiOut, JSON.stringify({ label, scenario: name, consoleErrors: errs }) + '\n')
        await ctx.close().catch(() => {})
    }
}

let browser = null
try {
    await startServersOnce()
    await resetToBaseSeed()
    //管理員 redir 改為與測試同源(base seed 之 redir 為 localhost:8080, 與 baseUrl 不同源會跳出)
    let us = buildBaseUsers()
    us.find((u) => u.id === 'id-for-admin').redir = `${baseUrl}/?view=backstage&token={token}`
    //未驗證使用者(供「重寄驗證信」畫面; 只進到重寄畫面, 不送出, 避免真的寄信)
    let uv = ds.users.funNew({ order: 300, account: 'sf-unverified', password: hashPassword('Pw@sf12345', '{salt}'), name: 'sf unverified', email: 'sf-unverified@test.com', description: '', from: 'test', redir: `${baseUrl}/?view=user&token={token}`, tokenVerify: 'sf-tv-1', isAdmin: 'n', timeVerified: '', timeExpired: '2030-01-01T00:00:00.000+08:00', timeBlocked: '', isActive: 'y' })
    uv.id = 'id-sf-unverified'
    uv.timeVerified = ''
    uv.tokenVerify = 'sf-tv-1'
    us.push(uv)
    await woItems.users.delAll()
    await woItems.users.insert(us)
    browser = await launchBrowser()

    //S1 登入頁冷載入(無 token)
    await scenario(browser, 'S1-login-cold', async (page) => {
        await page.goto(`${baseUrl}/?lang=eng`, { waitUntil: 'networkidle', timeout: 30000 })
        await page.waitForTimeout(5000) //使輪詢多輪
        await uiState(page, 'S1-login-cold')
    })

    //S2 登入頁 → 申請帳號畫面
    await scenario(browser, 'S2-register-view', async (page) => {
        await page.goto(`${baseUrl}/?lang=eng`, { waitUntil: 'networkidle', timeout: 30000 })
        await page.waitForTimeout(3000)
        await page.locator('text="Register"').first().click()
        await page.waitForTimeout(3000)
        await uiState(page, 'S2-register-view')
    })

    //S3 登入失敗(帳密錯)
    await scenario(browser, 'S3-login-fail', async (page) => {
        await page.goto(`${baseUrl}/?lang=eng`, { waitUntil: 'networkidle', timeout: 30000 })
        await page.waitForTimeout(3000)
        let inputs = page.locator('input')
        await inputs.nth(0).click(); await page.keyboard.insertText('ac-admin')
        await inputs.nth(1).click(); await page.keyboard.insertText('wrong-password')
        await page.locator('text="Log in"').first().click()
        await page.waitForTimeout(4000)
        await uiState(page, 'S3-login-fail')
    })

    //S4 管理員登入 → 後台各頁
    await scenario(browser, 'S4-admin-login-backstage', async (page) => {
        await page.goto(`${baseUrl}/?lang=eng`, { waitUntil: 'networkidle', timeout: 30000 })
        await page.waitForTimeout(3000)
        let inputs = page.locator('input')
        await inputs.nth(0).click(); await page.keyboard.insertText('ac-admin')
        await inputs.nth(1).click(); await page.keyboard.insertText('pw-admin')
        await page.locator('text="Log in"').first().click()
        await waitUntilExist(page, 'backstage Statistics', (s) => document.body.innerText.includes(s), { arg: 'Statistics', timeout: 60000 })
        await page.waitForTimeout(3000)
        await uiState(page, 'S4-after-login')
        for (let t of ['Users list', 'Tokens list', 'Ips list']) {
            await page.locator(`text="${t}"`).first().click()
            await page.waitForTimeout(3000)
            await uiState(page, `S4-page-${t}`)
        }
        await page.waitForTimeout(6000) //登入後再多輪輪詢
    })

    //S6 未驗證使用者登入 → 出現「重寄驗證信」→ 重寄畫面
    await scenario(browser, 'S6-resend-view', async (page) => {
        await page.goto(`${baseUrl}/?lang=eng`, { waitUntil: 'networkidle', timeout: 30000 })
        await page.waitForTimeout(3000)
        let inputs = page.locator('input')
        await inputs.nth(0).click(); await page.keyboard.insertText('sf-unverified')
        await inputs.nth(1).click(); await page.keyboard.insertText('Pw@sf12345')
        await page.locator('text="Log in"').first().click()
        await page.getByText('Resend verification', { exact: false }).first().waitFor({ state: 'visible', timeout: 20000 })
        await uiState(page, 'S6-after-unverified-login')
        await page.getByText('Resend verification', { exact: false }).first().click()
        await page.waitForTimeout(3000)
        await uiState(page, 'S6-resend-view')
    })

    //S5 驗證信結果頁(HTTP 連結, 非 SPA)
    await scenario(browser, 'S5-verifyEmail-result', async (page) => {
        await page.goto(`${apiUrl}/api/verifyEmail?token=bogus-token&lang=eng`, { waitUntil: 'networkidle', timeout: 30000 })
        await page.waitForTimeout(2000)
        await uiState(page, 'S5-verifyEmail-result')
    })
}
catch (err) {
    console.log('[probe-error]', err && err.stack || err)
}
finally {
    if (browser) await browser.close().catch(() => {})
    await deleteNonBaseSeed().catch(() => {})
    cleanup()
    console.log('[probe] done')
    process.exit(0)
}
