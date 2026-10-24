//unit-appUpgrade.test.mjs — 升級不得使已失效之應用系統金鑰復活 (ADR-095 補記; sso-run02 範圍一): 遷移判準與 procCore.migrateLegacyAppTokens 之單元測試(不起服務)
//
// 依據: 使用者身分驗證原則.md 二.8(改版預設相容)、二之一第 7 點(應用系統 token 不給期限);
//   主控裁定: 升級前已逾期之舊應用系統金鑰列(無用途欄者)維持失效; 未逾期之舊列升級後視為系統服務用途、不設期限; 新建者不設期限; 不得刪列; 須冪等; 與表鎖相容
//   UP-01~02 判準(src/appUsage.mjs 純函式); UP-10~19 遷移(可用性升級前後、冪等、時間流逝、表鎖、失敗 fail closed、已失效列之各入口與後台處置、統計)
// 真服務啟動時之遷移(含重啟冪等)見 api-apptoken-upgrade.test.mjs; 清單顯示見 e2e-tokens(E2E-011)與 spec/流程_後台金鑰清單.md
//
// 「升級前」欄 BEFORE_UPGRADE 取自升級前舊碼(commit 88b2397 之 procCore._checkTokenByObj)對下列四種舊列之實際判定(以 git archive 取出舊碼實跑 checkToken,
// 證據見 sso-run02 報告〈二〉; 舊碼: timeEnd 須為合法時間否則 reject 'invalid timeEnd', 且現在 < timeEnd 才為真, 對外一律 tokenExpired)

import assert from 'assert'
import omit from 'lodash-es/omit.js'
import { getAppUsage, isLegacyAppToken, classifyLegacyAppToken, keyAppUsageRetired, keysAppUsage } from '../src/appUsage.mjs'
import { keysAppPerm } from '../src/appPerms.mjs'
import { mkEnvSso, mkToken, errOf, snapTables, writesOf, holdLocks, track, sleep, afterSelectDelete } from './tools/unitEnv.mjs'
import { withFakeClock, buildProc } from './tools/unitProc.mjs'
import procStaInfor from '../server/procStaInfor.mjs'
import { baselineOfTokens } from '../src/baselineOf.mjs'


let T_PAST = '2020-01-01T00:00:00.000+08:00'
let T_FUTURE = '2099-01-01T00:00:00.000+08:00'

//升級前舊碼對各舊列之判定(true=可用): 逾期、未逾期、無 timeEnd(缺欄)、timeEnd 為空字串、timeEnd 格式錯(缺 T 與時區)
let BEFORE_UPGRADE = {
    'l-past': false,
    'l-future': true,
    'l-none': false,
    'l-empty': false,
    'l-bad': false,
}
let LEGACY_IDS = Object.keys(BEFORE_UPGRADE)


//mkApp: 應用系統金鑰列(預設為尚未定案之舊列: 無 appUsage / appName)
let mkApp = (id, ext = {}) => ({ ...mkToken(id, `tk-${id}`, 'u-a', { isApp: 'y', perms: ['readStats'] }), ...ext })


//seed: 五種舊列 + 已定案之各類列(使用者用途、系統服務用途、已失效、未登錄值); 先移除 mkEnvSso 預設之兩把舊格式金鑰以免混入計數
//tPast / tFuture 預設為絕對時間(遠過去 / 遠未來), 假時鐘測試另給
let seed = (env, tPast = T_PAST, tFuture = T_FUTURE) => {
    env.tokens.kp.delete('t-app1')
    env.tokens.kp.delete('t-app2')
    let put = (t) => env.tokens.kp.set(t.id, t)
    put(mkApp('l-past', { timeEnd: tPast }))
    put(mkApp('l-future', { timeEnd: tFuture }))
    let none = mkApp('l-none')
    delete none.timeEnd
    put(none)
    put(mkApp('l-empty', { timeEnd: '' }))
    put(mkApp('l-bad', { timeEnd: '2099-09-01 12:00:00' }))
    put(mkApp('m-user', { appUsage: 'user', timeEnd: '' }))
    put(mkApp('m-system', { appUsage: 'system', appName: 'svc', timeEnd: '' }))
    put(mkApp('m-retired', { appUsage: 'retired', timeEnd: tPast }))
    put(mkApp('m-weird', { appUsage: 'weird', timeEnd: tFuture }))
}


//usable: 以 checkToken 判定該列此刻可否使用
let usable = async (env, id) => {
    let p = env.p
    return (await errOf(p.checkToken(`tk-${id}`))) === null
}


//availability: 全部舊列之可用性
let availability = async (env) => {
    let o = {}
    for (let id of LEGACY_IDS) {
        o[id] = await usable(env, id)
    }
    return o
}


describe('升級遷移之判準 (src/appUsage.mjs)', function() {

    it('UP-01 classifyLegacyAppToken: 判準 = 升級前之判定(timeEnd 須為合法時間且現在 < timeEnd 才可用); 逾期、恰等於現在、無 timeEnd、空字串、格式錯、非字串一律已失效', function() {
        let tn = '2026-10-24T12:00:00.000+08:00'
        let c = (timeEnd) => classifyLegacyAppToken({ isApp: 'y', timeEnd }, tn)
        assert.strictEqual(c('2026-10-24T12:00:00.001+08:00'), 'system', '未逾期(多 1ms)')
        assert.strictEqual(c(T_FUTURE), 'system')
        assert.strictEqual(c('2026-10-24T11:59:59.999+08:00'), keyAppUsageRetired, '逾期(少 1ms)')
        assert.strictEqual(c('2026-10-24T12:00:00.000+08:00'), keyAppUsageRetired, '恰等於現在: 升級前 tn < timeEnd 不成立即已到期')
        assert.strictEqual(c(T_PAST), keyAppUsageRetired)
        for (let v of [undefined, null, '', ' ', 'abc', '2099-09-01 12:00:00', '2099-09-01T12:00:00+08:00', '2099-09-01', 4102444800000, true, {}, []]) {
            assert.strictEqual(c(v), keyAppUsageRetired, `timeEnd=${JSON.stringify(v)}`)
        }
        assert.strictEqual(classifyLegacyAppToken({ isApp: 'y' }, tn), keyAppUsageRetired, '缺欄')
    })

    it('UP-02 classifyLegacyAppToken / isLegacyAppToken: 只處理 isApp=y 且 appUsage 缺欄 / null / 空字串之舊列; 已有任何用途值(含未登錄字串)、登入 token、非物件皆不在範圍', function() {
        let tn = '2026-10-24T12:00:00.000+08:00'
        for (let appUsage of [undefined, null, '']) {
            assert.strictEqual(isLegacyAppToken({ isApp: 'y', appUsage }), true, String(appUsage))
        }
        assert.strictEqual(isLegacyAppToken({ isApp: 'y' }), true)
        for (let appUsage of ['user', 'system', 'retired', 'weird', 'User', ' ', 0, false, [], {}]) {
            let tk = { isApp: 'y', appUsage, timeEnd: T_PAST }
            assert.strictEqual(isLegacyAppToken(tk), false, JSON.stringify(appUsage))
            assert.strictEqual(classifyLegacyAppToken(tk, tn), '', JSON.stringify(appUsage))
        }
        for (let isApp of ['n', '', undefined, null, 'Y']) {
            assert.strictEqual(classifyLegacyAppToken({ isApp, timeEnd: T_PAST }, tn), '', `isApp=${String(isApp)}`)
        }
        assert.strictEqual(classifyLegacyAppToken(null, tn), '')
        assert.strictEqual(classifyLegacyAppToken(undefined, tn), '')
    })

    it('UP-03 getAppUsage: retired 為獨立回傳值(不可用); 不入新建可選之 keysAppUsage; 大小寫差異仍 fail closed', function() {
        assert.strictEqual(keyAppUsageRetired, 'retired')
        assert.deepStrictEqual(keysAppUsage, ['user', 'system'])
        assert.strictEqual(getAppUsage({ isApp: 'y', appUsage: 'retired' }), 'retired')
        assert.strictEqual(getAppUsage({ isApp: 'y', appUsage: 'Retired' }), '')
        assert.strictEqual(getAppUsage({ isApp: 'n', appUsage: 'retired' }), '')
    })

})


describe('migrateLegacyAppTokens: 升級遷移 (procCore)', function() {

    it('UP-10 [定案與資料] 五種舊列逐列定案: 未逾期→system、其餘(逾期 / 無 timeEnd / 空 / 格式錯)→retired; 不刪列; 只寫 appUsage(timeEnd 與其他欄位不動); 已定案之列與登入 token 不被碰', async function() {
        let env = mkEnvSso()
        seed(env)
        let before = snapTables(env).tokens
        let r = await env.p.migrateLegacyAppTokens()
        assert.deepStrictEqual(r, { marked: 5, system: 1, retired: 4 })
        let after = snapTables(env).tokens
        assert.deepStrictEqual(after.map((x) => x.id), before.map((x) => x.id), '不刪列、不增列')
        let byId = (rows, id) => rows.find((x) => x.id === id)
        assert.strictEqual(byId(after, 'l-future').appUsage, 'system')
        for (let id of ['l-past', 'l-none', 'l-empty', 'l-bad']) {
            assert.strictEqual(byId(after, id).appUsage, 'retired', id)
        }
        let audit = ['appUsage', 'timeUpdate', 'userIdUpdate']
        for (let id of LEGACY_IDS) {
            assert.deepStrictEqual(omit(byId(after, id), audit), omit(byId(before, id), audit), `${id}: 除 appUsage 與稽核欄外一律不動(含 timeEnd / perms / userId / token / isApp)`)
            assert.strictEqual(byId(after, id).userIdUpdate, 'system', `${id}: 更新者記系統`)
        }
        for (let b of before) {
            if (!LEGACY_IDS.includes(b.id)) {
                assert.deepStrictEqual(byId(after, b.id), b, `${b.id}: 非舊列(登入 token 與已定案之金鑰)原樣不動(含 timeUpdate)`)
            }
        }
        //寫入只含舊列之 id 與 appUsage(及 procOrm 戳記之稽核欄)
        assert.strictEqual(env.tokens.log.save.length, 1, '單批寫入')
        let items = env.tokens.log.save[0]
        assert.deepStrictEqual(items.map((x) => x.id).sort(), [...LEGACY_IDS].sort())
        for (let it of items) {
            assert.deepStrictEqual(Object.keys(it).filter((k) => !['id', 'appUsage', 'timeUpdate', 'userIdUpdate'].includes(k)), [], `${it.id}: 只寫 appUsage 與稽核欄`)
        }
    })

    it('UP-11 [升級前後之可用性] 升級後每一筆舊列之可用性 = 升級前舊碼之判定(逾期 / 無 timeEnd / 空 / 格式錯維持失效; 未逾期維持可用且不設期限); 已定案之各類列照其用途', async function() {
        let env = mkEnvSso()
        seed(env)
        await env.p.migrateLegacyAppTokens()
        assert.deepStrictEqual(await availability(env), BEFORE_UPGRADE)
        assert.strictEqual(await usable(env, 'm-user'), true, '使用者用途(所綁使用者可用)')
        assert.strictEqual(await usable(env, 'm-system'), true, '系統服務用途')
        assert.strictEqual(await usable(env, 'm-retired'), false, '已失效之列')
        assert.strictEqual(await usable(env, 'm-weird'), false, '未登錄之用途值 fail closed')
        //未逾期之舊列升級後視為系統服務用途: 授權依 perms、反查為應用系統身分、不設期限
        let u = await env.p.getUserByToken('tk-l-future')
        assert.deepStrictEqual([u.id, u.isApp, u.isAdmin], ['app:l-future', 'y', 'y'])
        assert.strictEqual(await errOf(env.p.checkTokenAndGetUsersList('tk-l-future', { perm: 'readUsers' })), null, '基本權限 readUsers')
        assert.strictEqual(await errOf(env.p.checkTokenAndGetTokensList('tk-l-future', { perm: 'readTokens' })), 'tokenExpired', '缺 readTokens')
        //已失效之列各入口一律不可用(含反查、取清單)
        for (let id of ['l-past', 'l-none', 'l-empty', 'l-bad']) {
            assert.strictEqual(await errOf(env.p.getUserByToken(`tk-${id}`)) !== null, true, `${id}: getUserByToken`)
            assert.strictEqual(await errOf(env.p.checkTokenAndGetUsersList(`tk-${id}`, { perm: 'readUsers' })), 'tokenExpired', `${id}: 取使用者清單`)
        }
    })

    it('UP-12 [冪等] 重複執行(同一 procCore 兩次、全新 procCore〔等同重啟〕兩次)零寫入、資料逐位元不變(含 timeUpdate)', async function() {
        let env = mkEnvSso()
        seed(env)
        await env.p.migrateLegacyAppTokens()
        let snap1 = snapTables(env)
        let w1 = writesOf(env.tokens)
        for (let i = 0; i < 2; i++) {
            let r = await env.p.migrateLegacyAppTokens()
            assert.deepStrictEqual(r, { marked: 0, system: 0, retired: 0 }, `第 ${i + 2} 次`)
        }
        for (let i = 0; i < 2; i++) {
            let p2 = buildProc(env.woItems, env.procOrm, { srLog: env.srLog }) //重啟: 全新 procCore 對同一份資料
            let r = await p2.migrateLegacyAppTokens()
            assert.deepStrictEqual(r, { marked: 0, system: 0, retired: 0 }, `重啟第 ${i + 1} 次`)
            assert.deepStrictEqual(await availability({ p: p2 }), BEFORE_UPGRADE)
        }
        assert.strictEqual(writesOf(env.tokens), w1, '第 1 次之後零寫入')
        assert.deepStrictEqual(snapTables(env), snap1)
    })

    it('UP-13 [時間流逝] 升級當下未逾期之舊列,日後 timeEnd 成為過去值仍可用(定案為持久標記,重啟不重新判逾期); 升級當下已逾期者不因時間而改變', async function() {
        await withFakeClock(async (clock) => {
            let env = mkEnvSso()
            seed(env, '2026-10-24T11:00:00.000+08:00', '2026-10-24T13:00:00.000+08:00')
            await env.p.migrateLegacyAppTokens() //升級當下 12:00
            assert.deepStrictEqual(await availability(env), BEFORE_UPGRADE)
            clock.advance(2 * 60 * 60 * 1000) //14:00, l-future 的 timeEnd(13:00) 已成過去值
            assert.strictEqual(await usable(env, 'l-future'), true, '已定案為系統服務用途, 不設期限')
            let p2 = buildProc(env.woItems, env.procOrm, { srLog: env.srLog }) //14:00 重啟
            let w = writesOf(env.tokens)
            assert.deepStrictEqual(await p2.migrateLegacyAppTokens(), { marked: 0, system: 0, retired: 0 })
            assert.strictEqual(writesOf(env.tokens), w, '重啟零寫入')
            assert.strictEqual(await usable({ p: p2 }, 'l-future'), true)
            assert.strictEqual(await usable({ p: p2 }, 'l-past'), false)
        }, Date.parse('2026-10-24T12:00:00.000+08:00'))
    })

    it('UP-14 [表鎖] 寫入皆在 tokens 表鎖內; 他人持鎖期間遷移排隊不寫入; 期間(不等鎖、不死結)尚未定案之舊列依升級前規則判定——已逾期者仍失效、未逾期者照常可用; 放行後完成', async function() {
        let env = mkEnvSso({ trackLocks: true })
        seed(env)
        let h = await holdLocks(env, ['tokens'])
        let w0 = writesOf(env.tokens)
        let t = track(env.p.migrateLegacyAppTokens())
        await sleep(80)
        assert.ok(!t.state.done, '持鎖期間遷移不得完成')
        assert.strictEqual(writesOf(env.tokens), w0, '持鎖期間不得寫入')
        assert.deepStrictEqual(await availability(env), BEFORE_UPGRADE, '遷移進行中: 未定案之舊列 = 升級前之判定(不中斷可用者, 不復活已逾期者)')
        assert.strictEqual(await usable(env, 'm-system'), true, '已定案者照常')
        assert.strictEqual(await usable(env, 'm-user'), true)
        assert.strictEqual(await errOf(env.p.checkToken('tk-admin')), null, '登入 token 照常')
        h.release()
        await h.done
        await t.pm
        assert.ok(t.state.ok, `放行後應完成, 實際 err=${String(t.state.err)}`)
        assert.deepStrictEqual(await availability(env), BEFORE_UPGRADE)
        assert.deepStrictEqual(env.outsideWrites, [], '所有寫入皆在表鎖內')
    })

    it('UP-14b [同時呼叫] 進行中再呼叫回同一個結果, 只寫一次', async function() {
        let env = mkEnvSso()
        seed(env)
        let h = await holdLocks(env, ['tokens'])
        let t1 = track(env.p.migrateLegacyAppTokens())
        let t2 = track(env.p.migrateLegacyAppTokens())
        await sleep(40)
        h.release()
        await h.done
        await t1.pm
        await t2.pm
        assert.deepStrictEqual(t1.state.value, { marked: 5, system: 1, retired: 4 })
        assert.deepStrictEqual(t2.state.value, t1.state.value)
        assert.strictEqual(env.tokens.log.save.length, 1)
    })

    it('UP-15 [失敗不放寬] 讀取或寫入失敗: reject 固定鍵並記錄; 未定案之舊列仍依升級前規則判定(已逾期者仍失效, 未逾期者依其 timeEnd 尚未改為不設期限), 比升級前不更寬; 已定案之列與登入 token 不受影響; 不刪列; 重試成功後定案', async function() {
        for (let mode of ['save', 'select']) {
            await withFakeClock(async (clock) => {
                let env = mkEnvSso()
                seed(env, '2026-10-24T11:00:00.000+08:00', '2026-10-24T13:00:00.000+08:00')
                let ids = snapTables(env).tokens.map((x) => x.id)
                env.tokens.fail.batch.add(mode)
                let err = await errOf(env.p.migrateLegacyAppTokens())
                assert.strictEqual(err, 'tokenAppLegacyMigrateFailed', mode)
                env.tokens.fail.batch.delete(mode)
                assert.ok(env.srLog.logs.error.some((x) => x.event === 'fun-migrateLegacyAppTokens' && x.key === 'tokenAppLegacyMigrateFailed'), `${mode}: 須記錄失敗`)
                assert.deepStrictEqual(await availability(env), BEFORE_UPGRADE, `${mode}: 失敗後仍 = 升級前之判定`)
                for (let id of LEGACY_IDS) {
                    assert.strictEqual(['system', 'retired'].includes(env.tokens.get(id).appUsage), false, `${mode}/${id}: 未寫入(仍為尚未定案之舊列)`)
                }
                assert.strictEqual(await usable(env, 'm-system'), true, `${mode}: 已定案者不受影響`)
                assert.strictEqual(await usable(env, 'm-user'), true)
                assert.strictEqual(await errOf(env.p.checkToken('tk-admin')), null)
                assert.deepStrictEqual(snapTables(env).tokens.map((x) => x.id), ids, `${mode}: 不刪列`)
                //失敗持續期間時間流逝: 未定案之未逾期列依其 timeEnd 於逾期後失效(與升級前相同, 不復活、不放寬)
                clock.advance(2 * 60 * 60 * 1000)
                assert.strictEqual(await usable(env, 'l-future'), false, `${mode}: 未定案者逾期後失效`)
                //重試(重啟): 此時 l-future 已逾期, 定案為 retired(維持失效)
                let r = await env.p.migrateLegacyAppTokens()
                assert.deepStrictEqual(r, { marked: 5, system: 0, retired: 5 }, mode)
                assert.strictEqual(await usable(env, 'l-future'), false, mode)
            }, Date.parse('2026-10-24T12:00:00.000+08:00'))
            //失敗後於未逾期前重試成功: 定案為系統服務用途
            let env2 = mkEnvSso()
            seed(env2)
            env2.tokens.fail.batch.add(mode)
            assert.strictEqual(await errOf(env2.p.migrateLegacyAppTokens()), 'tokenAppLegacyMigrateFailed')
            env2.tokens.fail.batch.delete(mode)
            let r2 = await env2.p.migrateLegacyAppTokens()
            assert.deepStrictEqual(r2, { marked: 5, system: 1, retired: 4 }, mode)
            assert.deepStrictEqual(await availability(env2), BEFORE_UPGRADE, mode)
        }
    })

    it('UP-15b [逐筆寫入失敗] procOrm 對其中一列寫入失敗: 整體視為失敗; 已成功寫入之列保持定案; 未寫入之列仍依升級前規則判定; 重試只補其餘', async function() {
        let env = mkEnvSso()
        seed(env)
        env.tokens.fail.save.add('l-bad')
        let err = await errOf(env.p.migrateLegacyAppTokens())
        assert.strictEqual(err, 'tokenAppLegacyMigrateFailed')
        assert.strictEqual(env.tokens.get('l-bad').appUsage === 'retired', false, '寫入失敗之列未定案')
        assert.strictEqual(env.tokens.get('l-future').appUsage, 'system', '其餘列已寫入')
        assert.deepStrictEqual(await availability(env), BEFORE_UPGRADE, '已寫入與未寫入者之可用性皆 = 升級前之判定')
        env.tokens.fail.save.delete('l-bad')
        let r = await env.p.migrateLegacyAppTokens()
        assert.deepStrictEqual(r, { marked: 1, system: 0, retired: 1 }, '重試只補未定案之 l-bad')
        assert.deepStrictEqual(await availability(env), BEFORE_UPGRADE)
        assert.strictEqual(env.tokens.get('l-bad').appUsage, 'retired')
    })

    it('UP-15c [未定案之舊列即時判定] 遷移從未執行 / 啟動後才直寫庫之舊格式列: 讀取時依升級前規則——未逾期可用、已逾期 / 無 timeEnd / 空 / 格式錯不可用; 不比升級前更寬', async function() {
        let env = mkEnvSso()
        seed(env)
        assert.deepStrictEqual(await availability(env), BEFORE_UPGRADE, '遷移尚未執行')
        await env.p.migrateLegacyAppTokens()
        //遷移完成「之後」才直寫庫之舊格式列(external write): 仍依升級前規則, 待下次啟動定案
        let late = mkApp('late-past', { timeEnd: T_PAST })
        let lateOk = mkApp('late-future', { timeEnd: T_FUTURE })
        env.tokens.kp.set('late-past', late)
        env.tokens.kp.set('late-future', lateOk)
        assert.strictEqual(await usable(env, 'late-past'), false)
        assert.strictEqual(await usable(env, 'late-future'), true)
        assert.deepStrictEqual(await env.p.migrateLegacyAppTokens(), { marked: 2, system: 1, retired: 1 }, '下次啟動定案')
    })

    it('UP-16 [已失效之列] 全部入口一律不可用(不論 perms 多高、不論所列使用者); refreshToken 維持 tokenAppNoRefresh; 作為被查詢之目標亦不可', async function() {
        let env = mkEnvSso()
        seed(env)
        env.tokens.kp.set('r-hi', mkApp('r-hi', { appUsage: 'retired', timeEnd: T_PAST, perms: [...keysAppPerm] }))
        let tk = 'tk-r-hi'
        assert.strictEqual(await errOf(env.p.checkToken(tk)), 'tokenExpired')
        assert.strictEqual(await errOf(env.p.getUserByToken(tk)) !== null, true)
        assert.strictEqual(await errOf(env.p.checkTokenAndGetUsersList(tk, { perm: 'readUsers' })), 'tokenExpired')
        assert.strictEqual(await errOf(env.p.checkTokenAndGetTokensList(tk, { perm: 'readTokens' })), 'tokenExpired')
        assert.strictEqual(await errOf(env.p.checkTokenAndUpdateTokensList(tk, [], { perm: 'writeTokens' })), 'tokenExpired')
        assert.strictEqual(await errOf(env.p.checkTokenAndCreateAppToken(tk, { name: 'x', usage: 'system', perms: [] }, { perm: 'writeTokens' })), 'tokenExpired')
        assert.strictEqual(await errOf(env.p.checkTokenAndChangePassword(tk, 'eng', 'x', 'y')) !== null, true)
        assert.strictEqual(await errOf(env.p.refreshToken(tk)), 'tokenAppNoRefresh')
        assert.strictEqual(await env.p.checkTokenAndGetUserByToken('tk-admin', tk), null, '管理員查已失效之金鑰: 目標須此刻可用, 否則回 null(對外為 tokenNoPermission, S-5)')
        assert.strictEqual(env.tokens.get('r-hi').appUsage, 'retired', '被拒絕之呼叫不改資料')
    })

    it('UP-17 [後台處置] 後台清單可見已失效之列(appUsage=retired)並可刪除; 無法被「修改」復活(用途為伺服器專有、到期時間 / 權杖字串 / isApp / userId 鎖定)', async function() {
        let env = mkEnvSso()
        seed(env)
        await env.p.migrateLegacyAppTokens()
        let rows = await env.p.getTokensList()
        let retired = rows.filter((x) => x.appUsage === 'retired').map((x) => x.id).sort()
        assert.deepStrictEqual(retired, ['l-bad', 'l-empty', 'l-none', 'l-past', 'm-retired'])
        //用戶端改用途 / 到期時間皆無法復活
        let revived = rows.map((x) => (x.id === 'l-past' ? { ...x, appUsage: 'system' } : x))
        assert.strictEqual(await errOf(env.p.checkTokenAndUpdateTokensList('tk-admin', revived)), null)
        assert.strictEqual(env.tokens.get('l-past').appUsage, 'retired', '客戶端之用途值不採用')
        assert.strictEqual(await usable(env, 'l-past'), false)
        let edited = rows.map((x) => (x.id === 'l-past' ? { ...x, timeEnd: T_FUTURE } : x))
        assert.strictEqual(await errOf(env.p.checkTokenAndUpdateTokensList('tk-admin', edited)), 'tokenAppLocked', '到期時間鎖定')
        let downgraded = rows.map((x) => (x.id === 'l-past' ? { ...x, isApp: 'n' } : x))
        assert.strictEqual(await errOf(env.p.checkTokenAndUpdateTokensList('tk-admin', downgraded)), 'tokenAppLocked', 'isApp 鎖定')
        assert.strictEqual(await usable(env, 'l-past'), false)
        //刪除: 該列消失, 其餘列不動
        let others = snapTables(env).tokens.filter((x) => x.id !== 'l-past')
        let kept = rows.filter((x) => x.id !== 'l-past')
        assert.strictEqual(await errOf(env.p.checkTokenAndUpdateTokensList('tk-admin', kept)), null)
        assert.strictEqual(env.tokens.get('l-past'), undefined, '已刪除')
        assert.deepStrictEqual(snapTables(env).tokens.filter((x) => !['tk-admin'].includes(x.token)).map((x) => x.id).sort(), others.filter((x) => !['tk-admin'].includes(x.token)).map((x) => x.id).sort())
        assert.strictEqual(await usable(env, 'l-future'), true)
    })

    it('UP-18 [與鑄造共存] 遷移與 createAppToken 同在表鎖佇列: 新鑄造之金鑰已帶用途, 遷移不重寫(更新者仍為操作者); 舊列照常定案', async function() {
        let env = mkEnvSso()
        seed(env)
        let h = await holdLocks(env, ['tokens', 'users'])
        let t1 = track(env.p.migrateLegacyAppTokens())
        let t2 = track(Promise.resolve().then(() => env.p.checkTokenAndCreateAppToken('tk-admin', { name: 'made', usage: 'system', perms: ['readStats'] }, {})))
        await sleep(60)
        h.release()
        await h.done
        await t1.pm
        await t2.pm
        assert.ok(t1.state.ok && t2.state.ok, `遷移 err=${String(t1.state.err)}; 鑄造 err=${String(t2.state.err)}`)
        let made = Array.from(env.tokens.kp.values()).filter((x) => x.appName === 'made')
        assert.strictEqual(made.length, 1)
        assert.strictEqual(made[0].appUsage, 'system')
        assert.notStrictEqual(made[0].userIdUpdate, 'system', '遷移不重寫已帶用途之新金鑰')
        assert.deepStrictEqual(await availability(env), BEFORE_UPGRADE)
        assert.strictEqual(await errOf(env.p.checkToken(made[0].token)), null)
    })

    it('UP-20 [與清單存檔之基準相容] 遷移前載入之清單(基準於遷移前所算; 庫內尚未定案, 清單列上之用途為即時判定值): 遷移後存檔不因而 saveStale; 改系統服務用途之 perms 可存且客戶端送回之用途值(含刻意送錯者)不被採用(定案標記不被舊清單洗掉); 刪除已失效之列可存', async function() {
        let env = mkEnvSso()
        seed(env)
        let a = { rows: await env.p.getTokensList() }
        Object.assign(a, baselineOfTokens(a.rows))
        assert.strictEqual(['', undefined].includes(env.tokens.get('l-future').appUsage), true, '載入時庫內尚未定案')
        assert.strictEqual(a.rows.find((x) => x.id === 'l-future').appUsage, 'system', '清單回傳即時判定之用途(未逾期 → system)')
        assert.strictEqual(a.rows.find((x) => x.id === 'l-past').appUsage, 'retired', '清單回傳即時判定之用途(已逾期 → retired)')
        await env.p.migrateLegacyAppTokens()
        let optA = { baseline: a.baseline, baselineSession: a.baselineSession }
        //未動存回: 不拒收、不改定案標記
        let w = writesOf(env.tokens)
        assert.strictEqual(await errOf(env.p.checkTokenAndUpdateTokensList('tk-admin', a.rows, {}, optA)), null, '遷移後以遷移前之基準存回未動之清單不得 saveStale')
        assert.strictEqual(writesOf(env.tokens), w, '摘要同基準之列不寫')
        assert.strictEqual(env.tokens.get('l-future').appUsage, 'system')
        assert.strictEqual(env.tokens.get('l-past').appUsage, 'retired')
        //改 l-future 之 perms, 且客戶端送回之 appUsage 刻意為 'retired'(用途為伺服器專有欄位, 不採用客戶端值)
        let rows2 = a.rows.map((x) => (x.id === 'l-future' ? { ...x, perms: ['readIps'], appUsage: 'retired' } : x))
        assert.strictEqual(await errOf(env.p.checkTokenAndUpdateTokensList('tk-admin', rows2, {}, optA)), null, '可修改系統服務用途之權限')
        assert.deepStrictEqual(env.tokens.get('l-future').perms, ['readIps'])
        assert.strictEqual(env.tokens.get('l-future').appUsage, 'system', '客戶端送回之用途值不得洗掉定案標記')
        assert.strictEqual(await usable(env, 'l-future'), true)
        //刪除已失效之列(存檔成功後前端重新載入, 取新基準)
        let c = { rows: await env.p.getTokensList() }
        Object.assign(c, baselineOfTokens(c.rows))
        let rows3 = c.rows.filter((x) => x.id !== 'l-past')
        assert.strictEqual(await errOf(env.p.checkTokenAndUpdateTokensList('tk-admin', rows3, {}, { baseline: c.baseline, baselineSession: c.baselineSession })), null)
        assert.strictEqual(env.tokens.get('l-past'), undefined, '已刪除')
        assert.strictEqual(env.tokens.get('l-bad').appUsage, 'retired', '其餘已失效之列不動')
    })

    it('UP-21 [mustExist: 讀取之後、寫入之前列被不共用本鎖之寫入者刪除] 整批 reject、已刪之列不得被以殘缺列新增回庫; 還原後重試只定案其餘(外審 sol F8 情境 A)', async function() {
        let env = mkEnvSso()
        seed(env)
        let restore = afterSelectDelete(env.tokens, 'l-past') //第 1 次回傳含 l-past 之 select 之後立即刪除該列
        let err = await errOf(env.p.migrateLegacyAppTokens())
        assert.strictEqual(err, 'tokenAppLegacyMigrateFailed')
        assert.strictEqual(env.tokens.get('l-past'), undefined, '已刪之列不得被新增回庫(殘缺列復活)')
        assert.strictEqual(['', undefined].includes(env.tokens.get('l-future').appUsage), true, '整批未寫入(寫入前之存在檢查整批 reject)')
        restore()
        let r = await env.p.migrateLegacyAppTokens()
        assert.deepStrictEqual(r, { marked: 4, system: 1, retired: 3 }, '重試只處理仍在庫之 l-future / l-none / l-empty / l-bad')
        assert.strictEqual(env.tokens.get('l-past'), undefined)
    })

    it('UP-22 [全表讀取在表鎖內] 他人持鎖期間遷移排隊; 排隊期間他人完成之變更(新增舊列、刪除舊列、改 timeEnd)須被放鎖後之讀取看見——新增者被定案、已刪者不復活、timeEnd 變更依新值判定(外審 sol F8 情境 B)', async function() {
        let env = mkEnvSso()
        seed(env)
        let h = await holdLocks(env, ['tokens'])
        let t = track(env.p.migrateLegacyAppTokens())
        await sleep(80)
        env.tokens.kp.set('l-late', mkApp('l-late', { timeEnd: T_FUTURE }))
        env.tokens.kp.delete('l-none')
        env.tokens.kp.set('l-future', { ...env.tokens.get('l-future'), timeEnd: T_PAST })
        h.release()
        await h.done
        await t.pm
        assert.ok(t.state.ok, `放鎖後應完成, 實際 err=${String(t.state.err)}`)
        assert.strictEqual(env.tokens.get('l-late').appUsage, 'system', '排隊期間新增之舊列於放鎖後被讀到並定案')
        assert.strictEqual(env.tokens.get('l-none'), undefined, '排隊期間已刪者不復活')
        assert.strictEqual(env.tokens.get('l-future').appUsage, 'retired', '排隊期間 timeEnd 已改為過去值: 依新值判定')
    })

    it('UP-23 [判準之相容 oracle 與時間表示法 / 伺服器時區] 判準 = 升級前判定 ∧ 時刻未逾期: 非本機偏移之時間字串從不比舊碼寬; 本機偏移之伺服器資料不因升級時更換伺服器時區而改判(外審 sol F1 / F7)', function() {
        //舊碼判定(oracle)取自 git archive 88b2397 之 procCore.checkToken 於假時鐘 2026-10-24T12:00:00.000+08:00 之實跑(tmp 腳本 before-upgrade-formats.mjs; 證據見 sso-run02 報告〈二〉)
        let TN = '2026-10-24T12:00:00.000+08:00'
        let TN_UTC = '2026-10-24T04:00:00.000+00:00' //同一瞬間, 伺服器時區換成 UTC 後之 tn
        let CASES = [
            { id: 'c1', timeEnd: '2026-10-24T12:00:00.001+08:00', old: true, want: 'system' },
            { id: 'c2', timeEnd: '2026-10-24T12:00:00.000+08:00', old: false, want: 'retired' },
            { id: 'c3', timeEnd: '2026-10-24T11:59:59.999+08:00', old: false, want: 'retired' },
            { id: 'c4', timeEnd: '2026-10-24T04:00:00.001Z', old: false, want: 'retired' }, //字串序居前: 舊碼判已逾期, 時刻上未逾期 1ms; 從嚴同舊碼
            { id: 'c5', timeEnd: '2026-10-24T20:00:00.000+09:00', old: true, want: 'system' },
            { id: 'c6', timeEnd: '2026-10-24T12:00:00.000+14:00', old: true, want: 'retired' }, //唯一與舊碼不同: 舊碼因字串序判可用, 時刻上已逾期 6h → 從嚴為已失效
            { id: 'c7', timeEnd: '2026-10-24T06:30:00.000-05:00', old: false, want: 'retired' },
            { id: 'c8', timeEnd: '2026-10-24T11:00:00.000+08:00', old: false, want: 'retired' },
            { id: 'c9', timeEnd: '2026-10-24T13:00:00.000+08:00', old: true, want: 'system' },
        ]
        let cls = (timeEnd, tn) => classifyLegacyAppToken({ isApp: 'y', timeEnd }, tn)
        for (let c of CASES) {
            assert.strictEqual(cls(c.timeEnd, TN), c.want, `${c.id} ${c.timeEnd}`)
            //不比舊碼寬: 舊碼判不可用者一律已失效
            if (!c.old) {
                assert.strictEqual(cls(c.timeEnd, TN), 'retired', `${c.id}: 舊碼不可用 → 不得為 system`)
            }
        }
        assert.deepStrictEqual(CASES.filter((c) => c.old !== (c.want === 'system')).map((c) => c.id), ['c6'], '與舊碼之差異僅 c6(從嚴)')
        //伺服器產生之資料(本機偏移 +08:00; c1 c2 c3 c8 c9)之判定與 tn 之偏移無關: 同一瞬間以 +08:00 或 UTC 表示之 tn 結果相同(換時區之升級不得改判)
        for (let id of ['c1', 'c2', 'c3', 'c8', 'c9']) {
            let c = CASES.find((x) => x.id === id)
            assert.strictEqual(cls(c.timeEnd, TN_UTC), c.want, `${id}: 換伺服器時區(tn=UTC)判定不變`)
        }
        //F1 核心情境: 舊 Taipei 伺服器判已逾期(11:00+08 < 12:00+08)之列, 新 UTC 行程之字串序(04:00+00:00 < 11:00+08:00)判可用——時刻上已逾期, 仍須已失效
        assert.strictEqual(cls('2026-10-24T11:00:00.000+08:00', TN_UTC), 'retired')
        //不合法或無法解析者(含 istimemsTZ 寬鬆接受而一般 parser 不接受之尾碼): 不得為 system
        for (let v of ['2026-10-24T20:00:00.000|08:00', '2026-10-24T20:00:00.000+99:99']) {
            assert.strictEqual(cls(v, TN), 'retired', v)
        }
    })

    it('UP-24 [快取] 遷移部分成功後 reject: 權杖清單快取仍須失效, 其後讀取反映已落地之定案(外審 sol F5)', async function() {
        let env = mkEnvSso()
        seed(env)
        let warm = await env.p.getTokensListCache() //預熱快取(30 秒)
        assert.strictEqual(warm.find((x) => x.id === 'l-past').userIdUpdate === 'system', false)
        env.tokens.fail.save.add('l-bad')
        assert.strictEqual(await errOf(env.p.migrateLegacyAppTokens()), 'tokenAppLegacyMigrateFailed')
        let hot = await env.p.getTokensListCache()
        assert.strictEqual(env.tokens.get('l-past').userIdUpdate, 'system', '已落地')
        assert.strictEqual(hot.find((x) => x.id === 'l-past').userIdUpdate, 'system', '快取已失效並重讀(反映已落地之定案與稽核欄)')
    })

    it('UP-19 [統計] 已失效之舊列計入「已到期」而不計入「有效」——不論已定案或尚未定案(遷移前 / 失敗 / 啟動後直寫庫), 統計與授權判定一致; 應用系統金鑰(未失效者)仍不計到期', async function() {
        let env = mkEnvSso()
        seed(env)
        let pf = procStaInfor(env.woItems, env.p, { srLog: env.srLog, logFd: '' })
        //總計 12 列: 登入 token 3 + 應用系統金鑰 9; 已失效 5(尚未定案之 l-past / l-none / l-empty / l-bad 與已定案之 m-retired), 其餘 7 列有效
        //(含 l-future 未逾期、m-user、m-system、未登錄用途值之 m-weird——後者另為授權端 fail closed, 統計沿用既有「未登錄者不計已到期」)
        let s0 = await pf.getStaTokenSummary()
        assert.deepStrictEqual([s0.active, s0.ended], [7, 5], '尚未定案時: 已逾期 / 無 timeEnd / 空 / 格式錯者即計入已到期(外審 sol F2)')
        await env.p.migrateLegacyAppTokens()
        let s1 = await pf.getStaTokenSummary()
        assert.deepStrictEqual([s1.active, s1.ended], [7, 5], '遷移後不變')
        assert.strictEqual(s1.ending24h, s0.ending24h, '應用系統金鑰不計即將到期')
        //統計與授權一致: 計入已到期者皆不可用, 計入有效之應用系統金鑰(l-future / m-user / m-system)皆可用
        assert.deepStrictEqual(await availability(env), BEFORE_UPGRADE)
    })

})
