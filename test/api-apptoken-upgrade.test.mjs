// api-apptoken-upgrade.test.mjs — 升級不得使已失效之應用系統金鑰復活 (ADR-095 補記; sso-run02 範圍一): 真後端啟動時之升級遷移與重啟冪等
//
// 依據: 使用者身分驗證原則.md 二.8(改版預設相容)、二之一第 7 點(應用系統 token 不給期限);
//   主控裁定: 升級前已逾期之舊應用系統金鑰列(無用途欄者)維持失效; 未逾期之舊列升級後視為系統服務用途、不設期限; 新建者不設期限; 不得刪列; 須冪等
// 作法: 測試行程直寫庫(與後端共用同一 LMDB)建立「升級前」之舊格式列(無 appUsage / appName 欄) → 重啟真後端(= 升級後第一次啟動, WWebSso 啟動時呼叫 migrateLegacyAppTokens)
//   → 斷言資料與每把金鑰經 HTTP 與 kpfun 兩條入口之可用性; 再重啟兩次斷言資料逐位元不變(零寫入)
// 「升級前」之可用性取自舊碼(commit 88b2397)實跑: 逾期 / 無 timeEnd / 空字串 / 格式錯 → tokenExpired; 未逾期 → 可用
// 單元層(判準、時間流逝、表鎖、失敗 fail closed)見 unit-appUpgrade.test.mjs

import assert from 'assert'
import { woItems } from '../g_mOrm.mjs'
import ds from '../src/schema/index.mjs'
import { startServersOnce, callFapi } from './tools/api-setup.mjs'
import { resetToBaseSeed, deleteNonBaseSeed, restartBackend } from './tools/e2e-setup.mjs'
import { httpApi, usable, getRowsForSave } from './tools/apiAccess.mjs'


let PAST = '2020-01-01T00:00:00.000+08:00'
let FUTURE = '2099-01-01T00:00:00.000+08:00'
let sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))


//mkLegacy: 升級前格式之應用系統金鑰列(無 appUsage / appName 欄); timeEnd 為 undefined 時整欄不存在
let mkLegacy = (id, timeEnd) => {
    let t = ds.tokens.funNew({ userId: 'id-for-viewer', isApp: 'y', perms: ['readStats'] })
    t.id = id
    t.token = `upg-${id}`
    delete t.appUsage
    delete t.appName
    if (timeEnd === undefined) {
        delete t.timeEnd
    }
    else {
        t.timeEnd = timeEnd
    }
    return t
}


//升級前舊碼之判定(true=可用)與升級遷移之預期用途
let LEGACY = [
    { id: 'l-past', timeEnd: PAST, before: false, usage: 'retired', title: '逾期' },
    { id: 'l-future', timeEnd: FUTURE, before: true, usage: 'system', title: '未逾期' },
    { id: 'l-none', timeEnd: undefined, before: false, usage: 'retired', title: '無 timeEnd(缺欄)' },
    { id: 'l-empty', timeEnd: '', before: false, usage: 'retired', title: 'timeEnd 為空字串' },
    { id: 'l-bad', timeEnd: '2099-09-01 12:00:00', before: false, usage: 'retired', title: 'timeEnd 格式錯' },
]


//rowsOf: 取列(依主鍵排序)
let rowsOf = async (ids) => {
    let rs = await woItems.tokens.select()
    return rs.filter((r) => ids.includes(r.id)).sort((a, b) => (a.id < b.id ? -1 : 1))
}


//waitSettled: 等後端啟動時之升級遷移完成(舊列皆已有用途值); 逾時即失敗
let waitSettled = async (ids, ms = 20000) => {
    let t0 = Date.now()
    while (Date.now() - t0 < ms) {
        let rs = await rowsOf(ids)
        if (rs.length === ids.length && rs.every((r) => typeof r.appUsage === 'string' && r.appUsage !== '')) {
            return rs
        }
        await sleep(200)
    }
    throw new Error(`遷移逾時未完成: ${JSON.stringify(await rowsOf(ids))}`)
}


describe('升級遷移: 升級前已失效之應用系統金鑰不因「不設期限」而復活 (ADR-095 補記)', function() {
    this.timeout(900000)

    let ids = [...LEGACY.map((x) => x.id), 'm-user', 'm-system', 'm-retired']
    let snapSeed = null

    before(async function() {
        await startServersOnce()
        await resetToBaseSeed()
        let rows = LEGACY.map((x) => mkLegacy(x.id, x.timeEnd))
        //已定案之各類列(升級後新建或曾遷移): 使用者用途(綁一般使用者)、系統服務用途、已失效
        let mu = mkLegacy('m-user', '')
        mu.appUsage = 'user'
        mu.appName = 'upg-viewer'
        mu.perms = []
        let ms = mkLegacy('m-system', '')
        ms.appUsage = 'system'
        ms.appName = 'upg-svc'
        let mr = mkLegacy('m-retired', PAST)
        mr.appUsage = 'retired'
        mr.appName = ''
        await woItems.tokens.insert([...rows, mu, ms, mr])
        snapSeed = await rowsOf(ids)
        //升級 = 以新碼重啟後端(啟動時遷移)
        await restartBackend('./settings.json')
    })

    after(async function() {
        await deleteNonBaseSeed()
        await resetToBaseSeed() //base seed 之 token-for-app 為舊格式列, 遷移會為其定案; 還原為出廠種子供後續測試檔
    })


    it('UPG-01 [定案與資料] 升級後第一次啟動: 未逾期→system; 逾期 / 無 timeEnd / 空 / 格式錯→retired; 不刪列; timeEnd 與其餘欄位不動; 已定案之列不被碰', async function() {
        let rs = await waitSettled(ids)
        assert.strictEqual(rs.length, ids.length, '不刪列')
        for (let x of LEGACY) {
            let r = rs.find((v) => v.id === x.id)
            assert.strictEqual(r.appUsage, x.usage, `${x.id}(${x.title})`)
            let s = snapSeed.find((v) => v.id === x.id)
            for (let k of ['token', 'userId', 'isApp', 'perms', 'timeCreate', 'timeEnd']) {
                assert.deepStrictEqual(r[k], s[k], `${x.id}.${k} 不動`)
            }
        }
        for (let id of ['m-user', 'm-system', 'm-retired']) {
            assert.deepStrictEqual(rs.find((v) => v.id === id), snapSeed.find((v) => v.id === id), `${id}: 已定案之列原樣不動(含 timeUpdate)`)
        }
    })

    it('UPG-02 [升級前後之可用性] 每把舊金鑰升級後之可用性 = 升級前舊碼之判定(HTTP 與 kpfun 兩入口一致); 逾期 / 無 timeEnd / 空 / 格式錯維持失效', async function() {
        //不等遷移完成(只讓出一點時間): 未定案之舊列由後端即時依升級前規則判定, 可用性與遷移進度無關(此為設計性質; 修前之版本無此判定, 逾期者即為可用)
        await sleep(500)
        for (let x of LEGACY) {
            assert.strictEqual(await usable(`upg-${x.id}`), x.before, `${x.id}(${x.title})`)
        }
        assert.strictEqual(await usable('upg-m-user'), true, '使用者用途(所綁使用者可用)')
        assert.strictEqual(await usable('upg-m-system'), true, '系統服務用途')
        assert.strictEqual(await usable('upg-m-retired'), false, '已失效之列')
        //失效時對外一律固定鍵 tokenExpired, 不洩漏原因
        for (let id of ['l-past', 'l-none', 'l-empty', 'l-bad', 'm-retired']) {
            assert.strictEqual((await httpApi('checkToken', { token: `upg-${id}` })).err, 'tokenExpired', id)
            assert.strictEqual((await callFapi('checkToken', [`upg-${id}`])).err, 'tokenExpired', id)
        }
    })

    it('UPG-03 [未逾期者視為系統服務用途] 授權依 perms、反查為應用系統身分(app:<主鍵>)、不設期限(不可續期); 已失效者各入口皆拒絕', async function() {
        await sleep(500) //同 UPG-02: 與遷移進度無關
        assert.strictEqual((await callFapi('getStaTokenSummary', ['upg-l-future'])).ok, true, 'readStats 依 perms')
        assert.strictEqual((await callFapi('getTokensList', ['upg-l-future'])).ok, false, '缺 readTokens')
        let u = await callFapi('getUserByToken', ['upg-l-future'])
        assert.deepStrictEqual([u.ok, u.val.id, u.val.isApp], [true, 'app:l-future', 'y'])
        assert.strictEqual((await callFapi('refreshToken', ['upg-l-future'])).err, 'tokenAppNoRefresh')
        //作為被查詢之目標(有效且具 readUsers 之呼叫者以 key=token 查): 未逾期者反查為應用系統身分; 已失效者與逾期 / 查無同鍵 tokenNoPermission(S-5, 不洩漏原因; 外審 sol F6)
        let qOk = await httpApi('getSsoUserInfor', { token: 'token-for-admin', key: 'token', value: 'upg-l-future' })
        assert.deepStrictEqual([qOk.ok, qOk.val && qOk.val.id], [true, 'app:l-future'])
        for (let id of ['l-past', 'l-none', 'l-empty', 'l-bad', 'm-retired']) {
            let q = await httpApi('getSsoUserInfor', { token: 'token-for-admin', key: 'token', value: `upg-${id}` })
            assert.deepStrictEqual([q.ok, q.err], [false, 'tokenNoPermission'], `${id}: 作為被查詢之目標`)
        }
        for (let id of ['l-past', 'l-none', 'l-empty', 'l-bad', 'm-retired']) {
            assert.strictEqual((await callFapi('getStaTokenSummary', [`upg-${id}`])).ok, false, `${id}: 統計`)
            assert.strictEqual((await callFapi('getUserByToken', [`upg-${id}`])).ok, false, `${id}: 反查`)
            assert.strictEqual((await callFapi('getUsersList', [`upg-${id}`])).ok, false, `${id}: 基本權限 readUsers 亦不可`)
        }
    })

    it('UPG-04 [後台清單] 後台取得之清單含已失效之列(appUsage=retired, 原 timeEnd 與其他欄位如實回傳)供檢視; 統計計入已到期而不計入有效', async function() {
        await waitSettled(ids)
        let r = await callFapi('getTokensList', ['token-for-admin'])
        assert.strictEqual(r.ok, true)
        for (let x of LEGACY) {
            let row = r.val.find((v) => v.id === x.id)
            assert.ok(row, `${x.id} 在清單內`)
            assert.strictEqual(row.appUsage, x.usage, x.id)
            assert.strictEqual(row.isApp, 'y')
            if (x.timeEnd !== undefined) {
                assert.strictEqual(row.timeEnd, x.timeEnd, `${x.id}: 原到期時間如實回傳`)
            }
        }
        let sum = await callFapi('getStaTokenSummary', ['token-for-admin'])
        assert.strictEqual(sum.ok, true)
        let nRetired = r.val.filter((v) => v.isApp === 'y' && v.appUsage === 'retired').length
        assert.strictEqual(nRetired, 5, 'l-past / l-none / l-empty / l-bad / m-retired')
        assert.ok(sum.val.ended >= nRetired, `已到期 ${sum.val.ended} 須計入 retired ${nRetired}`)
    })

    it('UPG-05 [重啟冪等] 再重啟兩次: 逐筆資料逐位元不變(含 timeUpdate / userIdUpdate, 即零寫入), 可用性不變; 未逾期者不因日後逾期而改判', async function() {
        await waitSettled(ids)
        let s1 = await woItems.tokens.select()
        s1.sort((a, b) => (a.id < b.id ? -1 : 1))
        for (let i = 0; i < 2; i++) {
            await restartBackend('./settings.json')
            await sleep(1500) //遷移於啟動時進行, 給足時間讓任何錯誤之重複寫入顯現
            let s2 = await woItems.tokens.select()
            s2.sort((a, b) => (a.id < b.id ? -1 : 1))
            assert.deepStrictEqual(s2, s1, `重啟第 ${i + 1} 次: 資料不變`)
            for (let x of LEGACY) {
                assert.strictEqual(await usable(`upg-${x.id}`), x.before, `重啟第 ${i + 1} 次 ${x.id}`)
            }
        }
    })

    it('UPG-06 [後台處置] 已失效之列無法經清單存檔復活(用途為伺服器專有, 到期時間鎖定), 但可刪除; 刪除不影響其他金鑰', async function() {
        await waitSettled(ids)
        let rows = await getRowsForSave('tokens')
        //改用途 → 不採用客戶端值
        let r1 = await callFapi('updateTokensList', ['token-for-admin', 'eng', rows.map((x) => (x.id === 'l-past' ? { ...x, appUsage: 'system' } : x))])
        assert.strictEqual(r1.ok, true, JSON.stringify(r1))
        assert.strictEqual((await rowsOf(['l-past']))[0].appUsage, 'retired')
        assert.strictEqual(await usable('upg-l-past'), false)
        //改到期時間 → 鎖定
        let r2 = await callFapi('updateTokensList', ['token-for-admin', 'eng', rows.map((x) => (x.id === 'l-past' ? { ...x, timeEnd: FUTURE } : x))])
        assert.strictEqual(r2.err, 'tokenAppLocked')
        assert.strictEqual(await usable('upg-l-past'), false)
        //刪除
        let r3 = await callFapi('updateTokensList', ['token-for-admin', 'eng', rows.filter((x) => x.id !== 'l-past')])
        assert.strictEqual(r3.ok, true, JSON.stringify(r3))
        assert.strictEqual((await rowsOf(['l-past'])).length, 0, '已刪除')
        assert.strictEqual((await rowsOf(['l-future', 'l-none', 'm-system'])).length, 3, '其他金鑰不動')
        assert.strictEqual(await usable('upg-l-future'), true)
    })

    it('UPG-07 [啟動後才直寫庫之舊格式列] 於下次啟動才定案: 其間後端即時依升級前規則判定(未逾期可用、已逾期不可用), 後台清單與統計回傳之用途與授權判定一致(外審 sol F2 / F3)', async function() {
        await waitSettled(ids.filter((x) => x !== 'l-past')) //l-past 已於 UPG-06 刪除
        let before = (await callFapi('getStaTokenSummary', ['token-for-admin'])).val
        await woItems.tokens.insert([mkLegacy('late-past', PAST), mkLegacy('late-future', FUTURE)])
        assert.strictEqual(await usable('upg-late-past'), false)
        assert.strictEqual(await usable('upg-late-future'), true)
        assert.strictEqual((await rowsOf(['late-past']))[0].appUsage === undefined || (await rowsOf(['late-past']))[0].appUsage === '', true, '庫內尚未定案')
        let r = await callFapi('getTokensList', ['token-for-admin'])
        assert.strictEqual(r.ok, true)
        assert.strictEqual(r.val.find((v) => v.id === 'late-past').appUsage, 'retired', '清單回傳即時判定之用途')
        assert.strictEqual(r.val.find((v) => v.id === 'late-future').appUsage, 'system')
        //統計: 新增之兩列中已逾期者計入已到期、未逾期者計入有效(清單快取 30 秒內可能仍為舊值, 故以 getStaTokenSummary 於寫入前後之差判斷; 快取已於其他入口之寫入時清除, 此處容許最多等待快取過期)
        let ok = false
        for (let i = 0; i < 40 && !ok; i++) {
            let after = (await callFapi('getStaTokenSummary', ['token-for-admin'])).val
            ok = after.ended - before.ended === 1 && after.active - before.active === 1
            if (!ok) {
                await sleep(1000)
            }
        }
        assert.strictEqual(ok, true, '統計: 已逾期之未定案列計入已到期、未逾期者計入有效')
    })

})
