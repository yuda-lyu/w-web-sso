import assert from 'assert'
import ot from 'dayjs'
import cloneDeep from 'lodash-es/cloneDeep.js'
import istimemsTZ from 'wsemi/src/istimemsTZ.mjs'
import ds from '../src/schema/index.mjs'
import hashPassword, { verifyPassword } from '../server/hashPassword.mjs'
import ormWrite from '../server/ormWrite.mjs'
import { mkOpt, buildProc, buildProtect, mkSrLog, mkTable, mkProcOrm } from './tools/unitProc.mjs'


//
// ORM 寫入失敗之處理 (spec: spec/設計要點與取捨.md ADR-080、ADR-081, 並對齊 ADR-021 / ADR-037 / ADR-044)
//
// w-orm 系列規格: save、del 遇單筆失敗時整批仍 resolve, 該筆以 ok 為 0 回報; w-serv-orm 1.1.7 起 procOrm 遇逐筆失敗即 reject,
// 且其餘筆已寫入; 1.1.8 起新增與修改之主鍵會被 clearXSS 改寫者整批拒絕. 本檔以真實 procCore / procProtect 工廠、真實 w-serv-orm procOrm,
// 搭配可注入失敗之記憶體資料表(test/tools/unitProc.mjs mkTable), 驗證寫入失敗時之回應、撤銷 token、清快取、寄信與節流. 不起 server、不碰資料庫.
//


let SALT = mkOpt().salt
let PW_INIT = 'Init@1234'
let HASH_INIT = hashPassword(PW_INIT, SALT)


//tFuture: token 到期時間(1 小時後)
let tFuture = () => ot().add(60, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')


//mkUser: 依 schema funNew 產生完整欄位之使用者列, 再以固定主鍵與 ext 覆寫(funNew 會強制 isActive='y')
let mkUser = (id, account, order, ext = {}) => {
    let u = ds.users.funNew({
        account,
        name: account,
        email: `${account}@example.com`,
        password: HASH_INIT,
        isAdmin: 'n',
        timeVerified: '2026-01-01T00:00:00.000+08:00',
    })
    return { ...u, id, order, ...ext }
}


//mkToken
let mkToken = (id, token, userId) => {
    return { ...ds.tokens.funNew({ userId }), id, token, isApp: 'n', timeEnd: tFuture() }
}


//mkIp
let mkIp = (id, ip) => {
    return { ...ds.ips.funNew({ ip }), id, timeBlocked: '' }
}


//mkEnv: 每案例獨立之資料表、procOrm 實例與 procCore
async function mkEnv() {
    let users = mkTable([
        mkUser('u-admin', 'admin1', 1, { isAdmin: 'y' }),
        mkUser('u-z', 'zuser', 2),
        mkUser('u-x', 'xuser', 3),
        mkUser('u-y', 'yuser', 4),
        mkUser('u-v', 'vuser', 5, { tokenVerify: 'tv-1', timeVerified: '' }),
    ])
    let tokens = mkTable([
        mkToken('t-admin', 'tk-admin', 'u-admin'),
        mkToken('t-z1', 'tk-z1', 'u-z'),
        mkToken('t-x1', 'tk-x1', 'u-x'),
        mkToken('t-x2', 'tk-x2', 'u-x'),
        mkToken('t-y1', 'tk-y1', 'u-y'),
    ])
    let ips = mkTable([
        mkIp('ip-1', '10.0.0.1'),
        mkIp('ip-2', '10.0.0.2'),
    ])
    let woItems = { users, tokens, ips }
    let procOrm = mkProcOrm(ds, woItems)
    let srLog = mkSrLog()
    let mails = []
    let srEmail = {
        send: async (sender, title, content, email) => {
            mails.push({ sender, title, content, email })
        },
    }
    let kpLang = {
        eng: {
            webName: 'Test',
            regVerifyEmTitle: 'Verify',
            regVerifyEmContent: '{verifyUrl}',
            chpwEmTitle: 'Changed',
            chpwEmContent: '{name}',
            resetPwEmTitle: 'Reset',
            resetPwEmContent: '{newPassword}',
        },
    }
    let p = buildProc(woItems, procOrm, { srLog, srEmail, kpLang })
    return { users, tokens, ips, woItems, srLog, mails, p }
}


//listRows: 模擬後台清單頁送回之整表(使用者清單已剝除 password, 依 order 排序)
let listRows = (t) => {
    let rs = [...t.kp.values()].map((r) => {
        let c = cloneDeep(r)
        delete c.password
        return c
    })
    return rs.sort((a, b) => (a.order || 0) - (b.order || 0))
}


//tokenIdsOf: 某使用者名下之 token 主鍵
let tokenIdsOf = (tokens, userId) => {
    return [...tokens.kp.values()].filter((t) => t.userId === userId).map((t) => t.id).sort()
}


//errOf: 取 promise 之 reject 值, resolve 時回 null
let errOf = async (pm) => {
    try {
        await pm
    }
    catch (err) {
        return err
    }
    return null
}


//errLogs: 取某 event 之 srLog.error 紀錄
let errLogs = (srLog, event) => {
    return srLog.logs.error.filter((o) => o.event === event)
}


//snapTables: 三表全部列之快照(依主鍵排序), 供斷言「資料庫無任何變更」
let snapTables = (env) => {
    let snap = (t) => [...t.kp.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, r]) => cloneDeep(r))
    return { users: snap(env.users), tokens: snap(env.tokens), ips: snap(env.ips) }
}


//writesOf: 資料表之寫入呼叫次數(insert + save + del)
let writesOf = (t) => {
    return t.calls.insert + t.calls.save + t.calls.del
}


//mkUserNew: 後台新增使用者列(前端以 funNew 產生並標 _isNew, 明文密碼符合策略)
let mkUserNew = (id, account) => {
    return { ...ds.users.funNew({ account, name: account, email: `${account}@example.com`, isAdmin: 'n' }), id, password: 'Good@2468', _isNew: true }
}


//htmlUnescape: 信件內文為 HTML, 置換值經 procCore htmlEscape(& < > " '), 收信端呈現時還原; 取信中之值須先還原(&amp; 最後處理)
let htmlUnescape = (s) => {
    return s
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"')
        .replaceAll('&#39;', '\'')
        .replaceAll('&amp;', '&')
}


describe('ormWrite - 直接寫入點之逐筆檢查', function() {

    it('D1 逐筆失敗: reject 訊息含失敗筆主鍵與錯誤原文, 其餘筆已寫入', async function() {
        let t = mkTable([{ id: 'a', v: 1 }, { id: 'b', v: 1 }])
        t.fail.save.add('b')
        let err = await errOf(ormWrite(t, 'save', [{ id: 'a', v: 2 }, { id: 'b', v: 2 }]))
        //w-orm 規格: 單筆失敗整批仍 resolve, 須由呼叫端逐筆檢查 → ormWrite 檢出並 reject
        assert.ok(typeof err === 'string' && err.includes('id[b]') && err.includes('injected save fail'), String(err))
        //單筆失敗不中斷整批
        assert.strictEqual(t.get('a').v, 2)
        assert.strictEqual(t.get('b').v, 1)
    })

    it('D2 整批性錯誤: ORM 之 reject 原樣透出', async function() {
        let t = mkTable([{ id: 'a' }])
        t.fail.batch.add('del')
        let err = await errOf(ormWrite(t, 'del', { id: 'a' }))
        assert.ok(err instanceof Error && err.message === 'injected del batch fail')
    })

    it('D3 全部成功: resolve ORM 逐筆結果', async function() {
        let t = mkTable([{ id: 'a' }])
        let rs = await ormWrite(t, 'del', [{ id: 'a' }, { id: 'none' }])
        //查無主鍵屬 ok:1(未命中), 非失敗
        assert.deepStrictEqual(rs, [{ n: 1, nDeleted: 1, ok: 1 }, { n: 0, nDeleted: 0, ok: 1 }])
    })

    it('D4 只接受逐筆函數 save、del', async function() {
        let t = mkTable([])
        let err = await errOf(ormWrite(t, 'insert', [{ id: 'a' }]))
        assert.strictEqual(err, 'invalid mode[insert]')
    })

})


describe('updateTabItems - 清單儲存之寫入失敗 (ADR-080)', function() {

    it('A1 刪除使用者其中一筆寫入失敗: 回 saveWriteFail, 本批欲刪除者之 token 皆撤銷, 快取已清', async function() {
        let env = await mkEnv()
        let cached = await env.p.getUsersListCache() //先載入快取(含 x、y)
        assert.ok(cached.some((u) => u.id === 'u-x'))
        env.users.fail.del.add('u-y')
        let rows = listRows(env.users).filter((r) => r.id !== 'u-x' && r.id !== 'u-y')
        let err = await errOf(env.p.checkTokenAndUpdateUsersList('tk-admin', 'eng', rows))
        //ADR-080 決策 2: 寫入階段失敗一律回 saveWriteFail, 不回 ORM 原文
        assert.strictEqual(err, 'saveWriteFail')
        //w-orm 規格: 單筆失敗不中斷整批 → x 已刪, y 仍在
        assert.strictEqual(env.users.get('u-x'), undefined)
        assert.ok(env.users.get('u-y'))
        //ADR-080 決策 3(a): 撤銷範圍依本批意圖, 不依寫入成敗 → x、y 之 token 皆撤銷
        assert.deepStrictEqual(tokenIdsOf(env.tokens, 'u-x'), [])
        assert.deepStrictEqual(tokenIdsOf(env.tokens, 'u-y'), [])
        //本批未涉及者不受影響
        assert.deepStrictEqual(tokenIdsOf(env.tokens, 'u-z'), ['t-z1'])
        assert.deepStrictEqual(tokenIdsOf(env.tokens, 'u-admin'), ['t-admin'])
        //ADR-080 決策 3(b): 寫入階段一經進入即清快取 → 快取反映資料庫(x 已不在)
        let us = await env.p.getUsersListCache()
        assert.ok(!us.some((u) => u.id === 'u-x'))
        //ADR-080 決策 2: 原文(含失敗筆主鍵)與 key 寫入 srLog.error
        let es = errLogs(env.srLog, 'fun-updateTabItems-write')
        assert.strictEqual(es.length, 1)
        assert.strictEqual(es[0].key, 'saveWriteFail')
        assert.strictEqual(es[0].woName, 'users')
        assert.ok(es[0].err.includes('id[u-y]'), es[0].err)
    })

    it('A2 停用使用者其中一筆寫入失敗: 回 saveWriteFail, 本批停用者之 token 皆撤銷', async function() {
        let env = await mkEnv()
        env.users.fail.save.add('u-x')
        let rows = listRows(env.users).map((r) => {
            if (r.id === 'u-z' || r.id === 'u-x') {
                return { ...r, isActive: 'n' }
            }
            return r
        })
        let err = await errOf(env.p.checkTokenAndUpdateUsersList('tk-admin', 'eng', rows))
        //ADR-080 決策 2
        assert.strictEqual(err, 'saveWriteFail')
        //單筆失敗不中斷整批 → z 已停用, x 未寫入
        assert.strictEqual(env.users.get('u-z').isActive, 'n')
        assert.strictEqual(env.users.get('u-x').isActive, 'y')
        //ADR-080 決策 3(a) / ADR-037: 停用意圖之 token 皆撤銷(含寫入失敗之 x)
        assert.deepStrictEqual(tokenIdsOf(env.tokens, 'u-z'), [])
        assert.deepStrictEqual(tokenIdsOf(env.tokens, 'u-x'), [])
        //仍有效者不受影響
        assert.deepStrictEqual(tokenIdsOf(env.tokens, 'u-y'), ['t-y1'])
        assert.deepStrictEqual(tokenIdsOf(env.tokens, 'u-admin'), ['t-admin'])
    })

    it('A3 驗證失敗(新增列密碼不符策略)與刪除同批: 回該驗證之 key, 資料庫無變更、不撤銷、不清快取', async function() {
        let env = await mkEnv()
        await env.p.getUsersListCache()
        let nSelect = env.users.calls.select
        let rowNew = { ...ds.users.funNew({ account: 'nuser', name: 'nuser', email: 'nuser@example.com', isAdmin: 'n' }), id: 'u-new', password: 'Ab@1', _isNew: true }
        let rows = listRows(env.users).filter((r) => r.id !== 'u-x')
        rows.push(rowNew)
        let err = await errOf(env.p.checkTokenAndUpdateUsersList('tk-admin', 'eng', rows))
        //ADR-080 決策 1 / ADR-021: 全部驗證於寫入前完成, 回驗證之 key
        assert.strictEqual(err, 'userPassword_keyLimNumLenMin')
        //ADR-021: 任一驗證失敗整批不落地 → 欲刪除之 x 仍在, 新增列未寫入
        assert.ok(env.users.get('u-x'))
        assert.strictEqual(env.users.get('u-new'), undefined)
        assert.strictEqual(env.users.calls.del, 0)
        assert.strictEqual(env.users.calls.insert, 0)
        //ADR-080 決策 1: 未進入寫入階段不撤銷
        assert.deepStrictEqual(tokenIdsOf(env.tokens, 'u-x'), ['t-x1', 't-x2'])
        //ADR-008 / ADR-080 決策 1: 資料庫未變不清快取 → 再讀快取不重抓
        let nSelectBefore = env.users.calls.select
        await env.p.getUsersListCache()
        assert.strictEqual(env.users.calls.select, nSelectBefore)
        assert.ok(nSelectBefore >= nSelect)
        //驗證失敗非寫入失敗, 不記寫入錯誤
        assert.strictEqual(errLogs(env.srLog, 'fun-updateTabItems-write').length, 0)
    })

    it('A4 全部成功: 刪除與停用皆落地, 其 token 皆撤銷, 快取已清, 無錯誤紀錄', async function() {
        let env = await mkEnv()
        await env.p.getUsersListCache()
        let rows = listRows(env.users)
            .filter((r) => r.id !== 'u-x')
            .map((r) => (r.id === 'u-z' ? { ...r, isActive: 'n' } : r))
        let rs = await env.p.checkTokenAndUpdateUsersList('tk-admin', 'eng', rows)
        //ADR-014: 回傳列不含 password
        assert.ok(rs.every((r) => !('password' in r)))
        assert.strictEqual(env.users.get('u-x'), undefined)
        assert.strictEqual(env.users.get('u-z').isActive, 'n')
        //ADR-037 / 刪除撤銷
        assert.deepStrictEqual(tokenIdsOf(env.tokens, 'u-x'), [])
        assert.deepStrictEqual(tokenIdsOf(env.tokens, 'u-z'), [])
        assert.deepStrictEqual(tokenIdsOf(env.tokens, 'u-y'), ['t-y1'])
        //ADR-008: 寫入後清快取
        let us = await env.p.getUsersListCache()
        assert.ok(!us.some((u) => u.id === 'u-x'))
        assert.strictEqual(env.srLog.logs.error.length, 0)
    })

    it('A5 刪除步驟整批性 reject: 回 saveWriteFail, 後續步驟不執行, 依意圖撤銷並清快取', async function() {
        let env = await mkEnv()
        await env.p.getUsersListCache()
        env.users.fail.batch.add('del')
        let rows = listRows(env.users)
            .filter((r) => r.id !== 'u-x')
            .map((r) => (r.id === 'u-z' ? { ...r, isActive: 'n' } : r))
        let err = await errOf(env.p.checkTokenAndUpdateUsersList('tk-admin', 'eng', rows))
        assert.strictEqual(err, 'saveWriteFail')
        //整批性錯誤: 該步未寫入任何筆; ADR-080 決策 2: 任一步失敗即停止後續步驟 → z 之停用未寫入
        assert.ok(env.users.get('u-x'))
        assert.strictEqual(env.users.get('u-z').isActive, 'y')
        assert.strictEqual(env.users.calls.save, 0)
        //ADR-080 決策 3(a): 寫入階段已進入 → 依意圖撤銷(fail closed)
        assert.deepStrictEqual(tokenIdsOf(env.tokens, 'u-x'), [])
        assert.deepStrictEqual(tokenIdsOf(env.tokens, 'u-z'), [])
        //ADR-080 決策 3(b): 寫入階段已進入 → 清快取(下次讀取重抓)
        let nSelect = env.users.calls.select
        await env.p.getUsersListCache()
        assert.strictEqual(env.users.calls.select, nSelect + 1)
    })

    it('A6 權杖清單與 IP 清單之寫入失敗: 同回 saveWriteFail 並清各自快取', async function() {
        let env = await mkEnv()

        //tokens: 刪除 t-a1(成功)、t-a2(失敗); 刪除之列為應用系統金鑰列——不帶基準之儲存只刪應用系統金鑰列, session 列不刪 (R-CONC-03, D3)
        env.tokens.kp.set('t-a1', { ...mkToken('t-a1', 'tk-a1', 'id-app-a'), isApp: 'y' })
        env.tokens.kp.set('t-a2', { ...mkToken('t-a2', 'tk-a2', 'id-app-a'), isApp: 'y' })
        await env.p.getTokensListCache()
        env.tokens.fail.del.add('t-a2')
        let rowsT = listRows(env.tokens).filter((r) => r.id !== 't-a1' && r.id !== 't-a2')
        let errT = await errOf(env.p.checkTokenAndUpdateTokensList('tk-admin', rowsT))
        assert.strictEqual(errT, 'saveWriteFail')
        assert.strictEqual(env.tokens.get('t-a1'), undefined)
        assert.ok(env.tokens.get('t-a2'))
        let ts = await env.p.getTokensListCache()
        assert.ok(!ts.some((t) => t.id === 't-a1'))

        //ips: 刪除 ip-1(成功)、ip-2(失敗)
        await env.p.getIpsListCache()
        env.ips.fail.del.add('ip-2')
        let errI = await errOf(env.p.checkTokenAndUpdateIpsList('tk-admin', []))
        assert.strictEqual(errI, 'saveWriteFail')
        assert.strictEqual(env.ips.get('ip-1'), undefined)
        assert.ok(env.ips.get('ip-2'))
        let oips = await env.p.getIpsListCache()
        assert.ok(!oips.some((o) => o.id === 'ip-1'))

        let es = errLogs(env.srLog, 'fun-updateTabItems-write')
        assert.deepStrictEqual(es.map((o) => o.woName), ['tokens', 'ips'])
    })

    it('A7 撤銷時其中一個 token 刪除失敗: 主流程成功, 其餘 token 已刪, 失敗記錄於 srLog.error', async function() {
        let env = await mkEnv()
        env.tokens.fail.del.add('t-x2')
        let rows = listRows(env.users).filter((r) => r.id !== 'u-x')
        await env.p.checkTokenAndUpdateUsersList('tk-admin', 'eng', rows)
        assert.strictEqual(env.users.get('u-x'), undefined)
        //ADR-080 決策 4: 一次刪除全部 token 並逐筆檢查, 單筆失敗不中斷其餘
        assert.deepStrictEqual(tokenIdsOf(env.tokens, 'u-x'), ['t-x2'])
        //ADR-037: 撤銷失敗只記 srLog.error 不阻斷主流程
        let es = errLogs(env.srLog, 'fun-updateTabItems-revokeTokenOnDelete')
        assert.strictEqual(es.length, 1)
        assert.strictEqual(es[0].userId, 'u-x')
        assert.ok(es[0].err.includes('id[t-x2]'), es[0].err)
    })

    it('A9 新增步驟整批性 reject(刪除已完成): 回 saveWriteFail, 刪除不回滾, 被刪者之 token 照撤, 快取已清', async function() {
        let env = await mkEnv()
        await env.p.getUsersListCache()
        env.users.fail.batch.add('insert')
        let rowNew = { ...ds.users.funNew({ account: 'nuser', name: 'nuser', email: 'nuser@example.com', isAdmin: 'n' }), id: 'u-new', password: 'Good@2468', _isNew: true }
        let rows = listRows(env.users).filter((r) => r.id !== 'u-x')
        rows.push(rowNew)
        let err = await errOf(env.p.checkTokenAndUpdateUsersList('tk-admin', 'eng', rows))
        //ADR-080 決策 2: 寫入階段任一步失敗回 saveWriteFail; ADR-044: 其前已寫入者不回滾
        assert.strictEqual(err, 'saveWriteFail')
        assert.strictEqual(env.users.get('u-x'), undefined)
        assert.strictEqual(env.users.get('u-new'), undefined)
        //ADR-080 決策 3
        assert.deepStrictEqual(tokenIdsOf(env.tokens, 'u-x'), [])
        let us = await env.p.getUsersListCache()
        assert.ok(!us.some((u) => u.id === 'u-x'))
    })

    it('A10 權杖權限縮短之前置清空(rowsClear)寫入失敗: 回 saveWriteFail, 整列修改不執行, 快取已清', async function() {
        let env = await mkEnv()
        //權限屬應用系統金鑰列(isApp='y')之欄位; 不帶基準之儲存不修改 session 列 (R-CONC-03, D3)
        env.tokens.kp.set('t-x1', { ...env.tokens.get('t-x1'), isApp: 'y', perms: ['readTokens', 'readStats'] })
        await env.p.getTokensListCache()
        env.tokens.fail.save.add('t-x1')
        let rows = listRows(env.tokens).map((r) => (r.id === 't-x1' ? { ...r, perms: ['readTokens'] } : r))
        let nSaveBefore = env.tokens.calls.save
        let err = await errOf(env.p.checkTokenAndUpdateTokensList('tk-admin', rows))
        //ADR-080 決策 2: 修改步驟之前置清空(陣列欄縮短, ADR-069)失敗即停止, 整列修改不執行
        assert.strictEqual(err, 'saveWriteFail')
        assert.strictEqual(env.tokens.calls.save - nSaveBefore, 1)
        //ADR-069: 唯一之寫入即前置清空(該欄存 null, procOrm 另補 timeUpdate), 非整列存入
        let payload = env.tokens.log.save[env.tokens.log.save.length - 1]
        assert.deepStrictEqual(payload.map((v) => [v.id, v.perms, 'token' in v]), [['t-x1', null, false]])
        assert.deepStrictEqual(env.tokens.get('t-x1').perms, ['readTokens', 'readStats'])
        //ADR-080 決策 3(b)
        let nSelect = env.tokens.calls.select
        await env.p.getTokensListCache()
        assert.strictEqual(env.tokens.calls.select, nSelect + 1)
    })

    it('A8 直接呼叫 updateUsersList(不經權杖檢查包裝): 停用者之 token 同樣撤銷, 快取同樣清除', async function() {
        let env = await mkEnv()
        await env.p.getUsersListCache()
        let rows = listRows(env.users).map((r) => (r.id === 'u-z' ? { ...r, isActive: 'n' } : r))
        await env.p.updateUsersList(rows, { lang: 'eng', operatorId: 'u-admin' })
        //ADR-080 決策 3: 撤銷與清快取皆屬 updateTabItems 寫入階段後之副作用, 與呼叫入口無關(刪除撤銷與停用撤銷同層)
        assert.deepStrictEqual(tokenIdsOf(env.tokens, 'u-z'), [])
        let us = await env.p.getUsersListCache()
        assert.strictEqual(us.find((u) => u.id === 'u-z').isActive, 'n')
    })

    //三清單之呼叫入口(經權杖檢查包裝, 同 kpfun 之下一層)
    let callOf = {
        users: (p, rows) => p.checkTokenAndUpdateUsersList('tk-admin', 'eng', rows),
        tokens: (p, rows) => p.checkTokenAndUpdateTokensList('tk-admin', rows),
        ips: (p, rows) => p.checkTokenAndUpdateIpsList('tk-admin', rows),
    }

    it('A11 新增列主鍵含 HTML 標記(會被 clearXSS 改寫)且與刪除同批: 回 htmlMarkupNotAllowed, 資料庫無變更、不撤銷、不清快取', async function() {
        let env = await mkEnv()
        await env.p.getUsersListCache()
        let before = snapTables(env)
        let rows = listRows(env.users).filter((r) => r.id !== 'u-x')
        rows.push(mkUserNew('<x>u-new', 'nuser'))
        let err = await errOf(env.p.checkTokenAndUpdateUsersList('tk-admin', 'eng', rows))
        //ADR-081 / ADR-021: 欄位值(含主鍵)會被 clearXSS 改寫之新增列屬驗證失敗, 於任何寫入之前拒絕(w-serv-orm 1.1.8 於新增時整批拒絕, 屆時同批之刪除已落地)
        assert.strictEqual(err, 'htmlMarkupNotAllowed')
        assert.deepStrictEqual(snapTables(env), before)
        assert.strictEqual(writesOf(env.users) + writesOf(env.tokens), 0)
        //ADR-080 決策 1: 未進入寫入階段不撤銷、不清快取、不記寫入錯誤
        let nSelect = env.users.calls.select
        await env.p.getUsersListCache()
        assert.strictEqual(env.users.calls.select, nSelect)
        assert.strictEqual(errLogs(env.srLog, 'fun-updateTabItems-write').length, 0)
    })

    it('A12 修改列主鍵含 HTML 標記(既有資料)且與刪除同批(三清單): 回 htmlMarkupNotAllowed, 資料庫無變更', async function() {
        let cases = [
            { woName: 'users', idDel: 'u-x', seed: () => mkUser('<x>h', 'huser', 6), edit: (r) => ({ ...r, name: 'huser2' }) },
            { woName: 'tokens', idDel: 't-z1', seed: () => ({ ...mkToken('<x>h', 'tk-h', 'u-y'), isApp: 'y' }), edit: (r) => ({ ...r, perms: ['readStats'] }) }, //應用系統金鑰列(不帶基準之儲存不修改 session 列)
            { woName: 'ips', idDel: 'ip-2', seed: () => mkIp('<x>h', '10.0.0.8'), edit: (r) => ({ ...r, ip: '10.0.0.9' }) },
        ]
        for (let c of cases) {
            let env = await mkEnv()
            let t = env[c.woName]
            t.kp.set('<x>h', c.seed())
            let before = snapTables(env)
            let rows = listRows(t)
                .filter((r) => r.id !== c.idDel)
                .map((r) => (r.id === '<x>h' ? c.edit(r) : r))
            let err = await errOf(callOf[c.woName](env.p, rows))
            //ADR-081: 修改列同一判準(w-serv-orm 1.1.8 之 save 同樣整批拒絕)
            assert.strictEqual(err, 'htmlMarkupNotAllowed', c.woName)
            assert.deepStrictEqual(snapTables(env), before, c.woName)
            assert.strictEqual(writesOf(t), 0, c.woName)
        }
    })

    it('A13 權杖清單與 IP 清單之新增列主鍵含 HTML 標記且與刪除同批: 同回 htmlMarkupNotAllowed, 資料庫無變更', async function() {
        let cases = [
            //權杖清單存檔只改不增(ADR-095): 新增應用系統金鑰列於標記判準之前即整批拒收 tokenAppAddNotAllowed, 主鍵標記判準對權杖清單不再可達(應用系統金鑰主鍵由伺服端產生)
            { woName: 'tokens', idDel: 't-z1', rowNew: { ...mkToken('<x>t-new', 'tk-new', 'u-z'), isApp: 'y', perms: [] }, expect: 'tokenAppAddNotAllowed' },
            { woName: 'ips', idDel: 'ip-2', rowNew: mkIp('<x>ip-new', '10.0.0.3') },
        ]
        for (let c of cases) {
            let env = await mkEnv()
            let t = env[c.woName]
            let before = snapTables(env)
            let rows = listRows(t).filter((r) => r.id !== c.idDel)
            rows.push(c.rowNew)
            let err = await errOf(callOf[c.woName](env.p, rows))
            //ADR-081: 判準位於 updateTabItems 驗證階段, 三種清單同一路徑
            assert.strictEqual(err, c.expect || 'htmlMarkupNotAllowed', c.woName)
            assert.deepStrictEqual(snapTables(env), before, c.woName)
            assert.strictEqual(writesOf(t), 0, c.woName)
        }
    })

    it('A14 對照(三清單): 主鍵含標記之既有列刪除或未變更、新增列主鍵為白名單標籤或不構成標記之 <: 照常寫入(判準同 w-serv-orm, 不多擋)', async function() {
        let cases = [
            { woName: 'users', mk: (id, s, order) => (order ? mkUser(id, `${s}user`, order) : mkUserNew(id, `${s}user`)), ord: [6, 7] },
            { woName: 'tokens', mk: (id, s) => ({ ...mkToken(id, `tk-${s}`, 'u-y'), isApp: 'y', perms: [] }), ord: [], noAdd: true }, //應用系統金鑰列(不帶基準之儲存只刪 / 改此類列, R-CONC-03); 權杖清單存檔只改不增(ADR-095), 僅驗刪除與未變更
            { woName: 'ips', mk: (id, s) => mkIp(id, `10.0.1.${s.length}`), ord: [] },
        ]
        for (let c of cases) {
            let env = await mkEnv()
            let t = env[c.woName]
            t.kp.set('<x>k', c.mk('<x>k', 'k', c.ord[0]))
            t.kp.set('<x>h', c.mk('<x>h', 'hh', c.ord[1]))
            if (c.woName === 'users') {
                env.tokens.kp.set('t-h1', mkToken('t-h1', 'tk-h1', '<x>h'))
            }
            //刪除排在最後之 <x>h、新增列接於尾端: users 之 order 依位置重編, <x>k 之 order 不變方屬未變更(見 A15)
            let rows = listRows(t).filter((r) => r.id !== '<x>h')
            if (!c.noAdd) {
                rows.push(c.mk('n<1', 'lll'), c.mk('<b>n</b>', 'bbbb'))
            }
            let err = await errOf(callOf[c.woName](env.p, rows))
            //ADR-081: 刪除不經 clearXSS 故不檢查; 比對後屬未變更之列不寫入; 'n<1' 與白名單標籤 '<b>n</b>' 不會被 clearXSS 改寫 → 皆照常
            assert.strictEqual(err, null, c.woName)
            assert.strictEqual(t.get('<x>h'), undefined, c.woName)
            assert.ok(t.get('<x>k'), c.woName)
            if (!c.noAdd) {
                assert.ok(t.get('n<1'), c.woName)
                assert.ok(t.get('<b>n</b>'), c.woName)
            }
            if (c.woName === 'users') {
                assert.deepStrictEqual(tokenIdsOf(env.tokens, '<x>h'), [])
            }
            assert.strictEqual(env.srLog.logs.error.length, 0, c.woName)
        }
    })

    it('A15 使用者清單既有列之主鍵含標記: 介面於最首新增列(order 依位置重編)即使該列落入修改而被拒; 同次刪除該列即可存回', async function() {
        let env = await mkEnv()
        env.users.kp.set('<x>h', mkUser('<x>h', 'huser', 6))
        let before = snapTables(env)
        //介面之新增列置於最首(src/components/LayoutContentUsers.vue 新增之「添加至最首」), resetOrder 依位置重編 order → 既有各列 order 皆變而屬修改
        let err = await errOf(env.p.checkTokenAndUpdateUsersList('tk-admin', 'eng', [mkUserNew('u-new', 'nuser'), ...listRows(env.users)]))
        assert.strictEqual(err, 'htmlMarkupNotAllowed')
        assert.deepStrictEqual(snapTables(env), before)
        assert.strictEqual(writesOf(env.users), 0)
        //處置: 同一次儲存刪除該列(刪除不經 clearXSS)即可存回
        await env.p.checkTokenAndUpdateUsersList('tk-admin', 'eng', [mkUserNew('u-new', 'nuser'), ...listRows(env.users).filter((r) => r.id !== '<x>h')])
        assert.ok(env.users.get('u-new'))
        assert.strictEqual(env.users.get('<x>h'), undefined)
    })

    it('A16 一般欄位含標記(會被 clearXSS 改寫)之修改列與合法新增同批、無刪除: 回 htmlMarkupNotAllowed, 新增亦未寫入', async function() {
        let env = await mkEnv()
        let before = snapTables(env)
        let rows = listRows(env.users).map((r) => (r.id === 'u-z' ? { ...r, name: 'Tom <CEO>' } : r))
        rows.push(mkUserNew('u-new', 'nuser'))
        let err = await errOf(env.p.checkTokenAndUpdateUsersList('tk-admin', 'eng', rows))
        //ADR-081: 一般欄位之改寫使儲存值與送入值不同(account / email 之登入與唯一性即以送入值比對), 同屬驗證失敗; 修改前之寫入順序為新增先於修改
        assert.strictEqual(err, 'htmlMarkupNotAllowed')
        assert.deepStrictEqual(snapTables(env), before)
        assert.strictEqual(writesOf(env.users), 0)
    })

    it('A17 權杖清單: 權限縮短(前置清空)與他列欄位含標記同批: 回 htmlMarkupNotAllowed, 前置清空亦未寫入', async function() {
        let env = await mkEnv()
        //t-x1 / t-y1 為應用系統金鑰列(不帶基準之儲存不修改 session 列, R-CONC-03, D3)
        env.tokens.kp.set('t-x1', { ...env.tokens.get('t-x1'), isApp: 'y', perms: ['readTokens', 'readStats'] })
        env.tokens.kp.set('t-y1', { ...env.tokens.get('t-y1'), isApp: 'y' })
        let before = snapTables(env)
        let rows = listRows(env.tokens).map((r) => {
            if (r.id === 't-x1') {
                return { ...r, perms: ['readTokens'] }
            }
            if (r.id === 't-y1') {
                return { ...r, timeCreate: '<x>2026-01-01' } //應用系統金鑰列之權杖字串不可變更(ADR-095), 以仍可修改之欄位 timeCreate 承載標記
            }
            return r
        })
        let w0 = writesOf(env.tokens)
        let err = await errOf(env.p.checkTokenAndUpdateTokensList('tk-admin', rows))
        assert.strictEqual(err, 'htmlMarkupNotAllowed')
        assert.deepStrictEqual(snapTables(env), before)
        assert.strictEqual(writesOf(env.tokens) - w0, 0)
    })

    it('A18 新增列主鍵超過 LMDB 鍵長上限(UTF-8 1978 位元組)且與刪除同批(三清單): 回 invalidRows, 資料庫無變更; 恰為上限者照常寫入', async function() {
        let idLong = 'k'.repeat(1979)
        let idMax = `${'中'.repeat(659)}k` //659 x 3 + 1 = 1978 位元組
        //權杖清單存檔只改不增(ADR-095), 新增列之主鍵鍵長判準對權杖清單不再可達(應用系統金鑰主鍵由伺服端產生), 本案只驗使用者與 IP 清單
        let cases = [
            { woName: 'users', idDel: 'u-x', mkNew: (id) => mkUserNew(id, 'luser') },
            { woName: 'ips', idDel: 'ip-2', mkNew: (id) => mkIp(id, '10.0.0.3') },
        ]
        for (let c of cases) {
            let env = await mkEnv()
            let before = snapTables(env)
            let rows = listRows(env[c.woName]).filter((r) => r.id !== c.idDel)
            rows.push(c.mkNew(idLong))
            let err = await errOf(callOf[c.woName](env.p, rows))
            //ADR-081 / ADR-021: 超過鍵長上限者寫入時才被 ORM 拒絕(屆時同批之刪除已落地), 於驗證階段拒絕
            assert.strictEqual(err, 'invalidRows', c.woName)
            assert.deepStrictEqual(snapTables(env), before, c.woName)
            let env2 = await mkEnv()
            await callOf[c.woName](env2.p, [...listRows(env2[c.woName]), c.mkNew(idMax)])
            assert.ok(env2[c.woName].get(idMax), c.woName)
        }
    })

    it('A19 本批主鍵重複(三清單): 回 invalidRows, 資料庫無變更', async function() {
        let cases = [
            { woName: 'users', dup: 'u-z', edit: (r) => ({ ...r, name: 'zuser2' }) },
            { woName: 'tokens', dup: 't-z1', edit: (r) => ({ ...r, perms: ['readStats'] }) },
            { woName: 'ips', dup: 'ip-1', edit: (r) => ({ ...r, ip: '10.0.0.9' }) },
        ]
        for (let c of cases) {
            let env = await mkEnv()
            let before = snapTables(env)
            let rows = listRows(env[c.woName])
            rows.push(c.edit(rows.find((r) => r.id === c.dup)))
            let err = await errOf(callOf[c.woName](env.p, rows))
            //ADR-081: 三清單同一列格式驗證(原只有 users 檢查且回原始字串; tokens / ips 之重複列於比對時後列覆蓋前列)
            assert.strictEqual(err, 'invalidRows', c.woName)
            assert.deepStrictEqual(snapTables(env), before, c.woName)
        }
    })

    it('A20 使用者清單之 email 為空或本批重複: 回語系鍵 userEmailEmpty / userEmailDuplicate, 資料庫無變更', async function() {
        let env = await mkEnv()
        let before = snapTables(env)
        let rowsEmpty = listRows(env.users).map((r) => (r.id === 'u-z' ? { ...r, email: '' } : r))
        //ADR-034 / ADR-081: 底層 reject 一律為語系鍵(原為含 email 值之原始字串, 經 kpfun 包裝寫入 srLog 並回前端)
        assert.strictEqual(await errOf(env.p.checkTokenAndUpdateUsersList('tk-admin', 'eng', rowsEmpty)), 'userEmailEmpty')
        let rowsDup = listRows(env.users).map((r) => (r.id === 'u-z' ? { ...r, email: 'xuser@example.com' } : r))
        assert.strictEqual(await errOf(env.p.checkTokenAndUpdateUsersList('tk-admin', 'eng', rowsDup)), 'userEmailDuplicate')
        assert.deepStrictEqual(snapTables(env), before)
    })

    it('A21 清單儲存之 rows 非陣列(不經 kpfun 守門之呼叫): 回 invalidRows, 不得把舊表全數視為刪除', async function() {
        let env = await mkEnv()
        let before = snapTables(env)
        assert.strictEqual(await errOf(env.p.updateUsersList({ id: 'u-z' }, { lang: 'eng', operatorId: 'u-admin' })), 'invalidRows')
        assert.strictEqual(await errOf(env.p.checkTokenAndUpdateIpsList('tk-admin', { id: 'ip-1' })), 'invalidRows')
        assert.deepStrictEqual(snapTables(env), before)
    })

    it('A22 判準與上游等價(語料): SSO 拒絕之主鍵即真 procOrm 新增時拒絕者, 拒絕之一般欄值即真 procOrm 會改寫者', async function() {
        let corpus = ['<x>u', '<b>u', '<b onclick=1>u', '<i>u</i>', 'u<1', 'a < b', 'u>1', 'a>b<c', 'u-new<', 'a<!--x-->b', 'a << b', '<!x', '</x', '<?x', '<img src=x onerror=1>', 'R&D', 'n-ok']
        for (let s of corpus) {
            //上游: 以真 w-serv-orm procOrm 新增(主鍵為 s 者看是否拒絕; 欄位 ip 為 s 者看儲存值是否被改寫)
            let tUp = mkTable([])
            let po = mkProcOrm(ds, { ips: tUp })
            let upRejectsId = (await errOf(po('', 'ips', 'insert', [{ id: s, ip: '10.0.0.5', timeBlocked: '' }]))) !== null
            await po('', 'ips', 'insert', [{ id: 'n-field', ip: s, timeBlocked: '' }])
            let upRewritesField = tUp.get('n-field').ip !== s
            //SSO: 經 IP 清單儲存送入同樣之新增列
            let envId = await mkEnv()
            let errId = await errOf(envId.p.checkTokenAndUpdateIpsList('tk-admin', [...listRows(envId.ips), mkIp(s, '10.0.0.5')]))
            let envF = await mkEnv()
            let errF = await errOf(envF.p.checkTokenAndUpdateIpsList('tk-admin', [...listRows(envF.ips), mkIp('n-field', s)]))
            assert.strictEqual(errId, upRejectsId ? 'htmlMarkupNotAllowed' : null, `id[${s}]`)
            assert.strictEqual(errF, upRewritesField ? 'htmlMarkupNotAllowed' : null, `ip[${s}]`)
        }
    })

    it('A23 鑄造應用系統金鑰(createAppToken, ADR-095; 取代 ADR-084 之清單新增列): 使用者用途擁有者為所綁使用者、系統服務用途擁有者為建立者(操作者), 皆不被 procOrm 之建立者戳記改寫; 權杖清單存檔新增列(session 列 / 應用系統金鑰列)整批拒收', async function() {
        let env = await mkEnv()
        let rows = listRows(env.tokens)
        //ADR-092(只收回、不放寬): 清單存檔不得新增 session 列——同批含之則整批拒收, 同批之應用系統金鑰列亦不寫
        let before = snapTables(env)
        let errU = await errOf(env.p.checkTokenAndUpdateTokensList('tk-admin', [...rows, { ...mkToken('t-new-u', 'tk-new-u', 'u-z'), perms: [] }, { ...mkToken('t-new-a0', 'tk-new-a0', 'id-app-new'), isApp: 'y', perms: [] }]))
        assert.strictEqual(errU, 'tokenSessionAddNotAllowed')
        assert.deepStrictEqual(snapTables(env), before)
        //ADR-095: 清單存檔只改不增, 應用系統金鑰列亦整批拒收(只能經 createAppToken 鑄造, 權杖字串由伺服端產生)
        let errA = await errOf(env.p.checkTokenAndUpdateTokensList('tk-admin', [...rows, { ...mkToken('t-new-a1', 'tk-new-a1', 'id-app-new'), isApp: 'y', perms: ['readStats'] }]))
        assert.strictEqual(errA, 'tokenAppAddNotAllowed')
        assert.deepStrictEqual(snapTables(env), before)
        //createAppToken: 系統服務用途(不綁使用者, 擁有者 userId 記建立者); 使用者用途(userId 為所綁使用者); 權杖字串與主鍵由伺服端產生
        let a1 = await env.p.createAppToken({ name: 'sys-1', usage: 'system', perms: ['readStats'] }, { operatorId: 'u-admin' })
        let a2 = await env.p.createAppToken({ name: 'usr-1', usage: 'user', userId: 'u-z' }, { operatorId: 'u-admin' })
        assert.strictEqual(env.tokens.get(a1.id).userId, 'u-admin', '系統服務用途之擁有者為建立者')
        assert.strictEqual(env.tokens.get(a2.id).userId, 'u-z', '使用者用途之擁有者為所綁使用者')
        assert.strictEqual(env.tokens.get(a1.id).userIdUpdate, 'u-admin')
        assert.strictEqual(env.tokens.get(a2.id).userIdUpdate, 'u-admin')
        assert.deepStrictEqual(env.tokens.get(a1.id).perms, ['readStats'])
        assert.deepStrictEqual(env.tokens.get(a2.id).perms, [])
        assert.strictEqual(env.tokens.get(a1.id).appUsage, 'system')
        assert.strictEqual(env.tokens.get(a2.id).appUsage, 'user')
        assert.strictEqual(env.tokens.get(a1.id).appName, 'sys-1')
        assert.strictEqual(env.tokens.get(a1.id).timeEnd, '', '不給期限')
        assert.strictEqual(env.tokens.get(a1.id).token, a1.token)
        assert.strictEqual(env.tokens.get('t-x1').userId, 'u-x', '既有列不受影響')
    })

})


describe('單筆寫入點之逐筆檢查 (ADR-080 決策 5)', function() {

    it('B1 verifyEmail 寫入失敗: 回 verifyEmailFailed, 未驗證; 恢復後再點同一連結即可完成', async function() {
        let env = await mkEnv()
        env.users.fail.save.add('u-v')
        let err = await errOf(env.p.verifyEmail('tv-1'))
        assert.strictEqual(err, 'verifyEmailFailed')
        assert.strictEqual(env.users.get('u-v').timeVerified, '')
        assert.strictEqual(errLogs(env.srLog, 'fun-verifyEmail-save').length, 1)
        //ADR-032 lazy clear: tokenVerify 未清, 同一連結可重試
        env.users.fail.save.delete('u-v')
        let r = await env.p.verifyEmail('tv-1')
        assert.strictEqual(r.state, 'success')
        assert.ok(istimemsTZ(env.users.get('u-v').timeVerified))
    })

    it('B2 resendVerifyEmail 寫入失敗: 回 userRegistrationResendFailed, 不寄信、不記節流; 恢復後立即重送可寄出有效連結', async function() {
        let env = await mkEnv()
        env.users.fail.save.add('u-v')
        let err = await errOf(env.p.resendVerifyEmail('eng', 'vuser', 'vuser@example.com'))
        assert.strictEqual(err, 'userRegistrationResendFailed')
        assert.strictEqual(env.mails.length, 0)
        assert.strictEqual(env.users.get('u-v').tokenVerify, 'tv-1')
        assert.strictEqual(errLogs(env.srLog, 'fun-resendVerifyEmail-save').length, 1)
        //節流只在寫入成功後記: 立即重送不回 userRegistrationResendThrottled
        env.users.fail.save.delete('u-v')
        let r = await env.p.resendVerifyEmail('eng', 'vuser', 'vuser@example.com')
        assert.strictEqual(r.state, 'success')
        assert.strictEqual(env.mails.length, 1)
        //端到端不變式: 信中連結之 token 即資料庫之 tokenVerify
        let tv = env.users.get('u-v').tokenVerify
        assert.notStrictEqual(tv, 'tv-1')
        assert.ok(env.mails[0].content.includes(`token=${tv}`), env.mails[0].content)
    })

    it('B3 changePassword 寫入失敗: 回 userChangePasswordFail, 不寄信, 密碼未變', async function() {
        let env = await mkEnv()
        env.users.fail.save.add('u-z')
        let err = await errOf(env.p.checkTokenAndChangePassword('tk-z1', 'eng', PW_INIT, 'New@5678'))
        assert.strictEqual(err, 'userChangePasswordFail')
        assert.strictEqual(env.mails.length, 0)
        assert.ok(verifyPassword(PW_INIT, env.users.get('u-z').password, SALT))
        assert.strictEqual(errLogs(env.srLog, 'fun-changePassword-save').length, 1)
    })

    it('B4 adminResetUserPassword 寫入失敗: 回 adminResetPasswordFailed, 不寄信、不記節流; 恢復後立即重設可登入信中密碼', async function() {
        let env = await mkEnv()
        env.users.fail.save.add('u-z')
        let err = await errOf(env.p.adminResetUserPassword('tk-admin', 'eng', 'u-z'))
        assert.strictEqual(err, 'adminResetPasswordFailed')
        assert.strictEqual(env.mails.length, 0)
        assert.ok(verifyPassword(PW_INIT, env.users.get('u-z').password, SALT))
        assert.strictEqual(errLogs(env.srLog, 'fun-adminResetUserPassword-save').length, 1)
        //節流只在寫入成功後記: 立即重設不回 adminResetPasswordAlreadyTriggered
        env.users.fail.save.delete('u-z')
        let r = await env.p.adminResetUserPassword('tk-admin', 'eng', 'u-z')
        assert.strictEqual(r.state, 'success')
        assert.strictEqual(env.mails.length, 1)
        //端到端不變式: 信中之新密碼(收信端呈現之文字)即資料庫之密碼; 隨機密碼含 & < > " ' 時內文為其 HTML 跳脫形式
        assert.ok(verifyPassword(htmlUnescape(env.mails[0].content), env.users.get('u-z').password, SALT), env.mails[0].content)
    })

    it('B5 refreshToken 寫入失敗: reject, 到期時間未變(不回報假的新到期時間)', async function() {
        let env = await mkEnv()
        let timeEnd = env.tokens.get('t-z1').timeEnd
        env.tokens.fail.save.add('t-z1')
        let err = await errOf(env.p.refreshToken('tk-z1'))
        assert.strictEqual(err, 'can not update timeEnd for token')
        assert.strictEqual(env.tokens.get('t-z1').timeEnd, timeEnd)
        assert.strictEqual(errLogs(env.srLog, 'fun-refreshToken-save').length, 1)
    })

    it('B7 單筆寫入點遇整批性 reject: 同回各自語系鍵(不回 ORM 原文), 不寄信', async function() {
        let cases = [
            { name: 'verifyEmail', key: 'verifyEmailFailed', call: (p) => p.verifyEmail('tv-1') },
            { name: 'resendVerifyEmail', key: 'userRegistrationResendFailed', call: (p) => p.resendVerifyEmail('eng', 'vuser', 'vuser@example.com') },
            { name: 'changePassword', key: 'userChangePasswordFail', call: (p) => p.checkTokenAndChangePassword('tk-z1', 'eng', PW_INIT, 'New@5678') },
            { name: 'adminResetUserPassword', key: 'adminResetPasswordFailed', call: (p) => p.adminResetUserPassword('tk-admin', 'eng', 'u-z') },
        ]
        for (let c of cases) {
            let env = await mkEnv()
            env.users.fail.batch.add('save')
            let err = await errOf(c.call(env.p))
            //ADR-080 決策 5: 整批與逐筆失敗同一路徑, 皆回語系鍵
            assert.strictEqual(err, c.key, c.name)
            assert.strictEqual(env.mails.length, 0, c.name)
            assert.strictEqual(env.srLog.logs.error.length, 1, c.name)
        }
    })

    it('B6 createUser 寫入失敗: 回 userRegistrationFailed(不回 ORM 原文), 不寄驗證信', async function() {
        let env = await mkEnv()
        env.users.fail.batch.add('insert')
        let err = await errOf(env.p.createUser('eng', {
            account: 'newbie',
            name: 'newbie',
            email: 'newbie@example.com',
            password: 'Pass@9876',
            confirmPassword: 'Pass@9876',
        }))
        //ADR-080 決策 7 / ADR-034: 回語系鍵
        assert.strictEqual(err, 'userRegistrationFailed')
        assert.strictEqual(env.mails.length, 0)
        assert.strictEqual(errLogs(env.srLog, 'fun-createUser-insert').length, 1)
    })

    it('B8 createUser 之帳號 / 姓名 / email 含 HTML 標記(會被 clearXSS 改寫): 回 htmlMarkupNotAllowed, 未新增、不寄驗證信', async function() {
        let cases = [
            { field: 'account', account: 'john<doe', name: 'john', email: 'john@example.com' },
            { field: 'name', account: 'tomceo', name: 'Tom <CEO>', email: 'tomceo@example.com' },
            { field: 'email', account: 'xmail', name: 'xmail', email: '<x>@example.com' },
        ]
        for (let c of cases) {
            let env = await mkEnv()
            let before = snapTables(env)
            let err = await errOf(env.p.createUser('eng', { account: c.account, name: c.name, email: c.email, password: 'Pass@9876', confirmPassword: 'Pass@9876' }))
            //ADR-081: procOrm 寫入時對各欄位 clearXSS, 儲存值將與送入值不同, 而唯一性、登入與重寄驗證信皆以送入值查詢 → 驗證階段拒絕
            assert.strictEqual(err, 'htmlMarkupNotAllowed', c.field)
            assert.deepStrictEqual(snapTables(env), before, c.field)
            assert.strictEqual(env.mails.length, 0, c.field)
        }
    })

})


describe('procProtect 封鎖寫入失敗 (ADR-080 決策 6)', function() {

    let optProtect = (srLog) => ({
        srLog,
        minForAccountLoginFailed: 10,
        numForAccountLoginFailed: 1,
        minBlockForAccountLoginFailed: 10,
        minForTokenCallApi: 10,
        numForTokenCallApi: 1,
        minBlockForTokenCallApi: 10,
        minForIpCallApi: 10,
        numForIpCallApi: 1,
        minBlockForIpCallApi: 10,
    })

    let loginFailTwice = async (pp, account) => {
        let errs = []
        for (let i = 0; i < 2; i++) {
            errs.push(await errOf(pp.loginByAccountAndPassword(account, 'Wrong@0000')))
        }
        return errs
    }

    it('C1 登入失敗達門檻、封鎖寫入失敗(逐筆與整批): 仍撤銷該帳號全部 token, 記錄失敗, 對外訊息不變', async function() {
        for (let mode of ['row', 'batch']) {
            let env = await mkEnv()
            let { pp, timers } = buildProtect(env.woItems, env.p, optProtect(env.srLog))
            assert.strictEqual(timers.length, 4, mode)
            if (mode === 'row') {
                env.users.fail.save.add('u-z')
            }
            else {
                env.users.fail.batch.add('save')
            }
            let errs = await loginFailTwice(pp, 'zuser')
            //ADR-036 / ADR-003: 對外一律 failedLoginForCatch
            assert.deepStrictEqual(errs, ['failedLoginForCatch', 'failedLoginForCatch'], mode)
            //封鎖未寫入
            assert.strictEqual(env.users.get('u-z').timeBlocked, '', mode)
            //ADR-080 決策 6: 依意圖撤銷(fail closed); 整批失敗原為例外中斷而令牌不刪
            assert.deepStrictEqual(tokenIdsOf(env.tokens, 'u-z'), [], mode)
            let es = errLogs(env.srLog, 'fun-blockAccount')
            assert.strictEqual(es.length, 1, mode)
            assert.strictEqual(es[0].userId, 'u-z', mode)
            if (mode === 'row') {
                assert.ok(es[0].errBlock.includes('id[u-z]'), es[0].errBlock)
            }
            else {
                //封鎖寫入改經 procOrm (R-CONC-01, 系統直寫統一經核心且 mustExist): 核心將 ORM 之整批性例外轉為固定字串 'failed to save data'(原文僅進 console), 不再回原例外訊息
                assert.ok(es[0].errBlock.includes('failed to save data'), es[0].errBlock)
            }
        }
    })

    it('C1b 登入失敗達門檻、封鎖寫入成功: 寫入封鎖時間並撤銷全部 token, 無錯誤紀錄', async function() {
        let env = await mkEnv()
        let { pp } = buildProtect(env.woItems, env.p, optProtect(env.srLog))
        await loginFailTwice(pp, 'zuser')
        assert.ok(istimemsTZ(env.users.get('u-z').timeBlocked))
        assert.deepStrictEqual(tokenIdsOf(env.tokens, 'u-z'), [])
        assert.strictEqual(errLogs(env.srLog, 'fun-blockAccount').length, 0)
    })

    it('C2 權杖呼叫次數超限、封鎖寫入失敗(逐筆與整批): 仍撤銷該使用者全部令牌並記錄失敗', async function() {
        for (let mode of ['row', 'batch']) {
            let env = await mkEnv()
            env.tokens.kp.set('t-z2', mkToken('t-z2', 'tk-z2', 'u-z')) //同一使用者另一裝置之令牌
            let { pp, timers } = buildProtect(env.woItems, env.p, optProtect(env.srLog))
            if (mode === 'row') {
                env.users.fail.save.add('u-z')
            }
            else {
                env.users.fail.batch.add('save')
            }
            await pp.callApiByToken('tk-z1')
            await pp.callApiByToken('tk-z1')
            await timers[1]() //限制 token 最大調用 API 次數之 timer
            assert.strictEqual(env.users.get('u-z').timeBlocked, '', mode)
            //ADR-080 決策 6: 封鎖寫入失敗仍撤銷(fail closed); spec 流程_自動封鎖機制 E2E-005: 刪除該使用者所有 tokens 紀錄
            assert.deepStrictEqual(tokenIdsOf(env.tokens, 'u-z'), [], mode)
            let es = errLogs(env.srLog, 'fun-blockAccountByToken')
            assert.strictEqual(es.length, 1, mode)
            assert.strictEqual(es[0].userId, 'u-z', mode)
        }
    })

    it('C2b 權杖呼叫次數超限、封鎖寫入成功: 寫入封鎖時間並撤銷該使用者全部令牌(含其他裝置), 無錯誤紀錄', async function() {
        let env = await mkEnv()
        env.tokens.kp.set('t-z2', mkToken('t-z2', 'tk-z2', 'u-z'))
        let { pp, timers } = buildProtect(env.woItems, env.p, optProtect(env.srLog))
        await pp.callApiByToken('tk-z1')
        await pp.callApiByToken('tk-z1')
        await timers[1]()
        assert.ok(istimemsTZ(env.users.get('u-z').timeBlocked))
        //spec 流程_自動封鎖機制 E2E-005 / B14: 刪除該使用者所有 tokens 紀錄(與登入失敗封鎖 A29 同)
        assert.deepStrictEqual(tokenIdsOf(env.tokens, 'u-z'), [])
        //其他使用者不受影響
        assert.deepStrictEqual(tokenIdsOf(env.tokens, 'u-y'), ['t-y1'])
        assert.strictEqual(errLogs(env.srLog, 'fun-blockAccountByToken').length, 0)
    })

    it('C3 IP 呼叫次數超限、封鎖寫入失敗: 記錄失敗, 封鎖時間未寫入', async function() {
        let env = await mkEnv()
        let { pp, timers } = buildProtect(env.woItems, env.p, optProtect(env.srLog))
        env.ips.fail.save.add('ip-1')
        await pp.callApiByIp('10.0.0.1')
        await pp.callApiByIp('10.0.0.1')
        await timers[3]() //限制 ip 最大調用 API 次數之 timer
        assert.strictEqual(env.ips.get('ip-1').timeBlocked, '')
        let es = errLogs(env.srLog, 'fun-blockIpByIp')
        assert.strictEqual(es.length, 1)
        assert.strictEqual(es[0].ip, '10.0.0.1')
        assert.ok(es[0].err.includes('id[ip-1]'), es[0].err)
    })

    it('C3b 未登記之 IP 呼叫次數超限、新增封鎖列失敗: 記錄失敗', async function() {
        let env = await mkEnv()
        let { pp, timers } = buildProtect(env.woItems, env.p, optProtect(env.srLog))
        env.ips.fail.batch.add('insert')
        await pp.callApiByIp('10.0.0.9')
        await pp.callApiByIp('10.0.0.9')
        await timers[3]()
        assert.strictEqual([...env.ips.kp.values()].some((o) => o.ip === '10.0.0.9'), false)
        //ADR-080 決策 6: 封鎖寫入失敗(新增列分支)亦記錄
        let es = errLogs(env.srLog, 'fun-blockIpByIp')
        assert.strictEqual(es.length, 1)
        assert.strictEqual(es[0].ip, '10.0.0.9')
    })

})
