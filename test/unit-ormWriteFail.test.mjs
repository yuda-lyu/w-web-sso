import assert from 'assert'
import ot from 'dayjs'
import cloneDeep from 'lodash-es/cloneDeep.js'
import istimemsTZ from 'wsemi/src/istimemsTZ.mjs'
import ds from '../src/schema/index.mjs'
import hashPassword, { verifyPassword } from '../server/hashPassword.mjs'
import ormWrite from '../server/ormWrite.mjs'
import { mkOpt, buildProc, buildProtect, mkSrLog, mkTable, loadMapOrm } from './tools/unitProc.mjs'


//
// ORM 寫入失敗之處理 (spec: spec/設計要點與取捨.md ADR-080, 並對齊 ADR-021 / ADR-037 / ADR-044)
//
// w-orm 系列規格: save、del 遇單筆失敗時整批仍 resolve, 該筆以 ok 為 0 回報; w-serv-orm 1.1.7 起 procOrm 遇逐筆失敗即 reject,
// 且其餘筆已寫入. 本檔以真實 procCore / procProtect 工廠、真實 w-serv-orm mapOrm, 搭配可注入失敗之記憶體資料表(test/tools/unitProc.mjs mkTable),
// 驗證寫入失敗時之回應、撤銷 token、清快取、寄信與節流. 不起 server、不碰資料庫.
//


let SALT = mkOpt().salt
let PW_INIT = 'Init@1234'
let HASH_INIT = hashPassword(PW_INIT, SALT)
let nEnv = 0


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


//mkEnv: 每案例獨立之資料表、mapOrm 實例(帶唯一查詢字串另載, 互不共用模組單例)與 procCore
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
    nEnv++
    let procOrm = await loadMapOrm(ds, woItems, `unit-ormWriteFail-${nEnv}`)
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

        //tokens: 刪除 t-z1(成功)、t-y1(失敗)
        await env.p.getTokensListCache()
        env.tokens.fail.del.add('t-y1')
        let rowsT = listRows(env.tokens).filter((r) => r.id !== 't-z1' && r.id !== 't-y1')
        let errT = await errOf(env.p.checkTokenAndUpdateTokensList('tk-admin', rowsT))
        assert.strictEqual(errT, 'saveWriteFail')
        assert.strictEqual(env.tokens.get('t-z1'), undefined)
        assert.ok(env.tokens.get('t-y1'))
        let ts = await env.p.getTokensListCache()
        assert.ok(!ts.some((t) => t.id === 't-z1'))

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
        env.tokens.kp.set('t-x1', { ...env.tokens.get('t-x1'), perms: ['readTokens', 'readStats'] })
        await env.p.getTokensListCache()
        env.tokens.fail.save.add('t-x1')
        let rows = listRows(env.tokens).map((r) => (r.id === 't-x1' ? { ...r, perms: ['readTokens'] } : r))
        let nSaveBefore = env.tokens.calls.save
        let err = await errOf(env.p.checkTokenAndUpdateTokensList('tk-admin', rows))
        //ADR-080 決策 2: 修改步驟之前置清空(陣列欄縮短, ADR-069)失敗即停止, 整列修改不執行
        assert.strictEqual(err, 'saveWriteFail')
        assert.strictEqual(env.tokens.calls.save - nSaveBefore, 1)
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
                assert.ok(es[0].errBlock.includes('injected save batch fail'), es[0].errBlock)
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
