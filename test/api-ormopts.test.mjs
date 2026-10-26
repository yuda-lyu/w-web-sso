//api-ormopts.test.mjs — 部署設定給予 w-serv-orm 已移除之使用者檢查設定(useCheckUser 等)時, 照常啟動、啟動時記警告且各寫入點照常 (ADR-083 / ADR-085)
//
// 依據: spec/設計要點與取捨.md ADR-083、ADR-085; CLAUDE_rulebook.md R-ORM-02
//   - WWebSso 不轉交此三鍵(WServOrm 不傳 opt); settings / optExt 給予上游會拒絕之值者忽略, 並於啟動時記警告(console 與 srLog 之 boot 事件, warn),
//     只列出被忽略之鍵、未給者不出現(server/getIgnoredOrmKeys.mjs)
//   - 寫入之授權由各功能自行負責(checkToken: 使用者須為系統管理者、應用系統金鑰須具對應寫入權限; 自助註冊為公開流程), 故下列寫入照常:
//     自助註冊、使用者清單(系統管理者 / writeUsers)、金鑰清單(系統管理者 / writeTokens)、IP 清單(系統管理者 / writeIps)
//   - 本檔為「舊設定不使後端啟動失敗」之端到端守護: 若改為轉交, w-serv-orm 1.1.10 起於建構時拋錯, before 之重啟即逾時而 8 案全紅
//   - 2026-10-12 修改前(w-serv-orm 1.1.8 透傳): useCheckUser:true(未給 getUserById)時上列寫入皆失敗(自助註冊回 userRegistrationFailed, 清單儲存回 saveWriteFail)
// 作法: 真後端(11007)以臨時 settings(useCheckUser:true、useExcludeWhenNotAdmin:true)重啟; SMTP 導向 127.0.0.1:1(註冊驗證信必敗而不外寄, 寄信失敗不阻斷註冊, 既有契約).
//   每案例前重置 base seed + 本檔 fixture, 案例後只刪非 base seed(對齊其他 api 檔); 檔尾以預設 settings 重啟.

import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { woItems } from '../g_mOrm.mjs'
import ds from '../src/schema/index.mjs'
import { startServersOnce, callFapi } from './tools/api-setup.mjs'
import { resetToBaseSeed, deleteNonBaseSeed, restartBackend, genTempSettings } from './tools/e2e-setup.mjs'


let TIME_END = '2030-01-01T00:00:00.000+08:00'
let logFd = './logs' //與 settings.json 之 logFd 一致
let APP_TOKEN = 'ormopts-app'
let APP_USER_ID = 'app:id-ormopts-app' //系統服務用途應用系統金鑰之身分 id(app:<tokens.id>, users 表無此列; ADR-095, procCore getUserByToken)


//fixture: 具三項寫入權限之應用系統金鑰、兩筆供刪除之使用者 token、一筆 ip
async function insertFixtures() {
    let app = ds.tokens.funNew({ userId: APP_USER_ID, isApp: 'y' })
    app.id = `id-${APP_TOKEN}`
    app.token = APP_TOKEN
    app.isApp = 'y'
    app.perms = ['writeUsers', 'writeTokens', 'writeIps']
    app.timeEnd = TIME_END
    //供刪除之金鑰列為應用系統金鑰列(isApp='y'): 不帶基準之清單儲存(此處 kpfun 直呼)只刪應用系統金鑰列, session 列(isApp 非 'y')不刪 (R-CONC-03, D3);
    //系統管理者於後台刪除 session 列走帶基準之路徑(強制登出, e2e-tokens E2E-003 與 unit-saveBaseline SB-T06)
    let dels = ['del-a', 'del-b'].map((k) => {
        let t = ds.tokens.funNew({ userId: 'id-for-viewer', isApp: 'y' })
        t.id = `id-ormopts-${k}`
        t.token = `ormopts-${k}`
        t.timeEnd = TIME_END
        return t
    })
    await woItems.tokens.insert([app, ...dels])

    let ip = ds.ips.funNew({ ip: '192.0.2.20', timeBlocked: '' })
    ip.id = 'id-ormopts-ip'
    await woItems.ips.insert([ip])
}


async function getRowsForSave(tableName) {
    let rs = await woItems[tableName].select()
    return rs.map((r) => {
        let v = { ...r }
        delete v.password //比照後台前端: 清單不含 password, 後端存回時自 DB 補回
        return v
    })
}


//t0 之後寫入之 srLog 行(JSON lines; pino 之 level 40 為 warn)
function readLogLinesSince(t0) {
    let out = []
    for (let f of fs.readdirSync(logFd)) {
        let p = path.join(logFd, f)
        if (fs.statSync(p).mtimeMs < t0 - 1000) {
            continue
        }
        for (let line of fs.readFileSync(p, 'utf8').split('\n')) {
            let o = null
            try {
                o = JSON.parse(line)
            }
            catch (err) {
                continue
            }
            if (o.time >= t0) {
                out.push(o)
            }
        }
    }
    return out
}


describe('部署設定給予 w-serv-orm 之使用者檢查(useCheckUser 等)時之寫入 (ADR-083)', function() {
    this.timeout(180000)

    let t0 = 0

    before(async function() {
        await startServersOnce()
        t0 = Date.now()
        await restartBackend(genTempSettings({ useCheckUser: true, useExcludeWhenNotAdmin: true }), {
            EM_SRC_HOST: '127.0.0.1',
            EM_SRC_PORT: '1',
            EM_SRC_PW: 'x',
            EM_SRC_EMAIL: 'example@gmail.com',
        })
    })

    after(async function() {
        await deleteNonBaseSeed()
        await restartBackend('./settings.json') //還原預設 settings 與環境
    })

    beforeEach(async function() {
        await resetToBaseSeed()
        await insertFixtures()
    })

    afterEach(async function() {
        await deleteNonBaseSeed()
    })


    it('ORMOPT-001 啟動時記警告(srLog boot 事件, warn)一筆, 列出被忽略之 useCheckUser 與 useExcludeWhenNotAdmin(未給之 getUserById 不列)', async function() {
        let ws = readLogLinesSince(t0).filter((o) => o.event === 'boot' && o.level === 40 && String(o.msg || '').includes('useCheckUser'))
        assert.strict.equal(ws.length, 1, `boot 警告應恰 1 筆: ${JSON.stringify(ws)}`)
        assert.ok(ws[0].msg.includes('useExcludeWhenNotAdmin'), ws[0].msg)
        assert.ok(!ws[0].msg.includes('getUserById'), `未給 getUserById 不應列出: ${ws[0].msg}`)
    })


    it('ORMOPT-002 自助註冊照常; 建立者與更新者仍為自身 id(修改前回 userRegistrationFailed)', async function() {
        let account = 'ormopts-reg'
        let pw = 'Pw@xkRb91!' //不含帳號之連續 2 字(密碼政策 noConsecutiveCharsFromAccount), 同 api-doubleclick DC-02
        let r = await callFapi('createUser', ['eng', account, pw, pw, 'ORMOPT Reg', 'ormopts-reg@test.com'])
        assert.strict.equal(r.ok, true, JSON.stringify(r))
        let us = await woItems.users.select({ account })
        assert.strict.equal(us.length, 1, '應已建立使用者')
        //procCore createUser 之自我參照慣例: userId === id 即自助註冊
        assert.strict.equal(us[0].userId, us[0].id)
        assert.strict.equal(us[0].userIdUpdate, us[0].id)
    })


    it('ORMOPT-003 系統管理者儲存使用者清單照常; 更新者為系統管理者 id(修改前回 saveWriteFail)', async function() {
        let rows = await getRowsForSave('users')
        rows.find((u) => u.id === 'id-for-viewer').description = 'desc-by-admin'
        let r = await callFapi('updateUsersList', ['token-for-admin', 'eng', rows])
        assert.strict.equal(r.ok, true, JSON.stringify(r))
        let u = (await woItems.users.select({ id: 'id-for-viewer' }))[0]
        assert.strict.equal(u.description, 'desc-by-admin')
        assert.strict.equal(u.userIdUpdate, 'id-for-admin')
    })


    it('ORMOPT-004 具 writeUsers 之應用系統金鑰儲存使用者清單照常; 更新者為其虛擬使用者 id(修改前回 saveWriteFail)', async function() {
        let rows = await getRowsForSave('users')
        rows.find((u) => u.id === 'id-for-viewer').description = 'desc-by-app'
        let r = await callFapi('updateUsersList', [APP_TOKEN, 'eng', rows])
        assert.strict.equal(r.ok, true, JSON.stringify(r))
        let u = (await woItems.users.select({ id: 'id-for-viewer' }))[0]
        assert.strict.equal(u.description, 'desc-by-app')
        assert.strict.equal(u.userIdUpdate, APP_USER_ID)
    })


    it('ORMOPT-005 系統管理者於金鑰清單刪除列照常(修改前回 saveWriteFail)', async function() {
        let rows = (await getRowsForSave('tokens')).filter((t) => t.id !== 'id-ormopts-del-a')
        let r = await callFapi('updateTokensList', ['token-for-admin', 'eng', rows])
        assert.strict.equal(r.ok, true, JSON.stringify(r))
        assert.deepStrictEqual(await woItems.tokens.select({ id: 'id-ormopts-del-a' }), [])
        assert.strict.equal((await woItems.tokens.select({ id: 'id-ormopts-del-b' })).length, 1, '他列不受影響')
    })


    it('ORMOPT-006 具 writeTokens 之應用系統金鑰於金鑰清單刪除列照常(修改前回 saveWriteFail)', async function() {
        let rows = (await getRowsForSave('tokens')).filter((t) => t.id !== 'id-ormopts-del-b')
        let r = await callFapi('updateTokensList', [APP_TOKEN, 'eng', rows])
        assert.strict.equal(r.ok, true, JSON.stringify(r))
        assert.deepStrictEqual(await woItems.tokens.select({ id: 'id-ormopts-del-b' }), [])
        assert.strict.equal((await woItems.tokens.select({ id: 'id-ormopts-del-a' })).length, 1, '他列不受影響')
    })


    it('ORMOPT-007 系統管理者於 IP 清單修改列照常(修改前回 saveWriteFail)', async function() {
        let rows = await getRowsForSave('ips')
        rows.find((v) => v.id === 'id-ormopts-ip').ip = '192.0.2.21'
        let r = await callFapi('updateIpsList', ['token-for-admin', 'eng', rows])
        assert.strict.equal(r.ok, true, JSON.stringify(r))
        assert.strict.equal((await woItems.ips.select({ id: 'id-ormopts-ip' }))[0].ip, '192.0.2.21')
    })


    it('ORMOPT-008 具 writeIps 之應用系統金鑰於 IP 清單修改列照常(修改前回 saveWriteFail)', async function() {
        let rows = await getRowsForSave('ips')
        rows.find((v) => v.id === 'id-ormopts-ip').ip = '192.0.2.22'
        let r = await callFapi('updateIpsList', [APP_TOKEN, 'eng', rows])
        assert.strict.equal(r.ok, true, JSON.stringify(r))
        assert.strict.equal((await woItems.ips.select({ id: 'id-ormopts-ip' }))[0].ip, '192.0.2.22')
    })

})
