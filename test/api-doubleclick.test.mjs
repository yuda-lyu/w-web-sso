import assert from 'assert'
import ot from 'dayjs'
import obj2u8arr from 'wsemi/src/obj2u8arr.mjs'
import u8arr2obj from 'wsemi/src/u8arr2obj.mjs'
import ds from '../src/schema/index.mjs'
import hashPassword, { verifyPassword } from '../server/hashPassword.mjs'
import { woItems } from '../g_mOrm.mjs'
import { startServersOnce, cleanup, apiUrl, resetToBaseSeed, deleteNonBaseSeed } from './tools/e2e-setup.mjs'


//
// E2E doubleclick test — 4 個雙擊防護議題之 backend mutex 序列化回歸測試
//
// 對應後端 server/procCore.mjs 之 mutex / cacheSt / throttle 機制:
//   - withLock(`adminResetUserPassword:${targetUserId}`) / withLock(`resendVerifyEmail:${account}`) /
//     withLock(`changeUserPassword:${userId}`) ← 用 wsemi pmKeyMutex (原 server/procMutex.mjs 已抽至套件)
//   - cs.setWithFree([`createUser:account:<a>`, `createUser:email:<e>`], fn) ← 用 wsemi cacheSt
//     (R2L1-001 fix: 複合 key 無法擋同 account 不同 email 之繞鎖雙重 insert, 改 cacheSt 兩段獨立 key 原子占位)
//
// 本檔為 API-only 測試 (無 UI / 無 Playwright / 無 baseline 截圖):
//   - 不走 Playwright UI (前端 promiseUnlock 已防 race; 測試重點是 backend mutex 在 API 直打場景仍守)
//   - 用 Node 18+ 內建 fetch + wsemi 之 obj2u8arr / u8arr2obj 編碼後直打 POST {apiUrl}/api/main
//     payload 格式對齊 w-converhp client 之 sendPkg('basic'):
//       body = obj2u8arr({ func, input: { __sysInputArgs__: [args...], __sysToken__: token } })
//     response (Content-Type: application/octet-stream) decode 為:
//       { success: { func, output: { state, msg } } }  或  { error: <permission-denied-msg> }
//   - 同步使用 Promise.allSettled (而非 Promise.all): 中途若 server 開始 reject 不中斷, 保留兩方
//     response 以驗證 DB 終態與「兩條中至少一條為 success / 至少一條為 error」之 mutex 序列化效果
//
// 使用方式：
//   npx mocha test/api-doubleclick.test.mjs --timeout 90000 --reporter list
//
// 4 個 case (對應 spec/流程_*.md 涉及 mutex 之 4 條 RPC):
//   E2E-DC-01-admin-reset-double:   並行 2 次 adminResetUserPassword 同 targetUserId
//                                   → mutex 序列化, 第 2 次撞 throttle 30s reject
//                                     'reset already triggered, please wait'
//                                     DB user.password 只更新一次 (lost-update 防護)
//   E2E-DC-02-create-user-double:   並行 2 次 createUser 同 account / 同 email
//                                   → mutex 序列化, 第 2 次 select 看到第 1 次 insert
//                                     → reject 'account already exists'
//                                     DB users 表只 1 筆同 account (雙重 insert 防護)
//   E2E-DC-03-resend-verify-double: 並行 2 次 resendVerifyEmail 同 account
//                                   → mutex 序列化, 第 2 次撞 throttle 30s reject
//                                     'resend throttled'
//   E2E-DC-04-change-password-double: 並行 2 次 changeUserPassword 同 token
//                                   → mutex 序列化, 第 2 次 oldPassword 比對 (已被改) 失敗
//                                     reject 'incorrect old password'
//                                     DB user.password 與第 1 次新值一致 (只改一次, 防 lost update)
//
// 另 4 個 case (清單儲存, ADR-074; 後端以「操作:操作者 id」原子占位 server/lockSave.mjs + 使用者新增列標記):
//   E2E-DC-05-update-users-new-row-double: 並行 2 次同一包含新增使用者 → 1 成功 1 拒絕(saveInProgress / saveNewRowExists), 新使用者未被覆寫
//   E2E-DC-06-update-users-new-row-resend: 依序 2 次同一包 → 第 2 次 saveNewRowExists, 新使用者未被覆寫
//   E2E-DC-07-update-tokens-double:        並行 2 次同一包 updateTokensList → 拒絕者只能是 saveInProgress, 權杖表不變
//   E2E-DC-08-update-ips-double:           並行 2 次同一包含新列 → 拒絕者只能是 saveInProgress, 新列只 1 筆
//

let salt = '{salt}'


// ===================================================================
// 測試使用者 seed (每個 case 各自獨立, account / userId 不衝突)
// ===================================================================

//用於 E2E-DC-01-admin-reset: 需要 admin token + 目標 user
let dc01Admin = {
    id: 'id-dc01-admin',
    account: 'dc01-admin',
    rawPassword: 'Pw@dcadm1!',
    name: 'DC01 Admin',
    email: 'dc01-admin@test.com',
    isAdmin: 'y',
}
let dc01Target = {
    id: 'id-dc01-target',
    account: 'dc01-target',
    rawPassword: 'Pw@dctg1!a',
    name: 'DC01 Target',
    email: 'dc01-target@test.com',
    isAdmin: 'n',
}

//用於 E2E-DC-02-create-user: 直接打 createUser, user 由 RPC 自助註冊產生 (不預先 seed)
let dc02NewAccount = 'dc02-target'
let dc02NewEmail = 'dc02-target@test.com'
let dc02NewName = 'DC02 NewUser'
let dc02NewPassword = 'Pw@xkRb91!'  //不含 dc02target 任何連續 2 字, 通過 noConsecutiveCharsFromAccount=2

//用於 E2E-DC-03-resend-verify: 需要未驗證 (timeVerified='') 的 user, 才能進 resendVerifyEmail
let dc03Target = {
    id: 'id-dc03-target',
    account: 'dc03-target',
    rawPassword: 'Pw@dctg3!a',
    name: 'DC03 Target',
    email: 'dc03-target@test.com',
    isAdmin: 'n',
    //timeVerified 留空 → resendVerifyEmail 才不會被 'account already verified' 擋
}

//用於 E2E-DC-04-change-password: 需要 user + 有效 token
let dc04Target = {
    id: 'id-dc04-target',
    account: 'dc04-target',
    rawPassword: 'Pw@Yza91!',   //舊密碼 (不含 dc04target 任何連續 2 字)
    newPassword: 'Pw@Lmb73!',   //新密碼 (不含 dc04target / 舊密碼任何連續 2 字)
    name: 'DC04 Target',
    email: 'dc04-target@test.com',
    isAdmin: 'n',
}

//用於 RPC __sysToken__ 與 API call 之 token 存放 (beforeEach 重設)
let dc01AdminToken = ''
let dc04TargetToken = ''


// ===================================================================
// 共用 seed 插入 / 清理 helper
// ===================================================================

async function insertTestUsersAndTokens() {
    //先 wipe 全表並重置為 canonical base seed, 再插入本檔專屬資料
    await resetToBaseSeed()

    //users: dc01Admin + dc01Target + dc03Target (未驗證) + dc04Target
    let order = 700
    let rows = []
    for (let u of [dc01Admin, dc01Target, dc03Target, dc04Target]) {
        let v = ds.users.funNew({
            order: order++,
            account: u.account,
            password: hashPassword(u.rawPassword, salt),
            name: u.name,
            email: u.email,
            description: '',
            from: 'test',
            redir: '',
            isAdmin: u.isAdmin,
            timeVerified: u === dc03Target ? '' : '2025-01-01T00:00:00.000+08:00',
            timeExpired: '2030-01-01T00:00:00.000+08:00',
            timeBlocked: '',
            isActive: 'y',
        })
        v.id = u.id
        v.isAdmin = u.isAdmin
        v.timeVerified = u === dc03Target ? '' : '2025-01-01T00:00:00.000+08:00'
        v.timeExpired = '2030-01-01T00:00:00.000+08:00'
        v.timeBlocked = ''
        rows.push(v)
    }
    await woItems.users.insert(rows)

    //tokens: 給 dc01Admin (admin reset 操作者) + dc04Target (change password 持有者)
    let tokenRows = []
    let tEnd = ot().add(60, 'minute').format('YYYY-MM-DDTHH:mm:ss.SSSZ')
    let tAdmin = ds.tokens.funNew({ userId: dc01Admin.id })
    tAdmin.timeEnd = tEnd
    dc01AdminToken = tAdmin.token
    tokenRows.push(tAdmin)
    let tDc04 = ds.tokens.funNew({ userId: dc04Target.id })
    tDc04.timeEnd = tEnd
    dc04TargetToken = tDc04.token
    tokenRows.push(tDc04)
    await woItems.tokens.insert(tokenRows)
}


async function deleteTestUsersAndTokens() {
    //刪除所有非 base seed 的專屬資料 (含本檔所有特化 user / token / ips)
    await deleteNonBaseSeed()
    dc01AdminToken = ''
    dc04TargetToken = ''
}


// ===================================================================
// RPC 直打 helper
// ===================================================================

//送 POST {apiUrl}/api/main 帶 obj2u8arr payload, 走 w-converhp client 同款編碼.
//
//回傳 normalized { ok: boolean, state, msg }
//   - ok=true:  RPC 成功 (server 端 pmm.resolve, output.state='success')
//   - ok=false: RPC 失敗 (output.state='error' 或 verifyConn 拒絕)
//     msg 為失敗訊息字串 (用於 includes 比對)
//
//token: 用於 (1) Authorization header (verifyConn 不檢, 任意非空字串可)
//       (2) __sysToken__ 內嵌 input (kpFunExt handler 由此取得 caller token)
async function callRpc(funcName, args, token = 'dummy') {
    let payload = {
        func: funcName,
        input: {
            __sysInputArgs__: args,
            __sysToken__: token,
        },
    }
    let u8a = obj2u8arr(payload)
    let body = Buffer.from(u8a)

    let r = await fetch(`${apiUrl}/api/main`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/octet-stream',
        },
        body,
    })

    //response 為 application/octet-stream, 須 arrayBuffer + u8arr2obj
    let ab = await r.arrayBuffer()
    let respU8a = new Uint8Array(ab)
    let respObj = u8arr2obj(respU8a)

    //respObj 可能型態:
    //  - { success: { func, output: { state, msg } } }
    //  - { error: <permission-denied-msg> }  (verifyConn 失敗時走此路徑)
    if (respObj && typeof respObj === 'object') {
        if ('error' in respObj) {
            return { ok: false, state: 'error', msg: String(respObj.error) }
        }
        if ('success' in respObj) {
            let out = respObj.success?.output
            if (out && typeof out === 'object') {
                let state = out.state
                let msg = out.msg
                if (state === 'success') {
                    return { ok: true, state, msg }
                }
                //pmm.reject → output.state='error'
                let msgStr = (typeof msg === 'string') ? msg : (msg?.key ?? msg?.message ?? JSON.stringify(msg))
                return { ok: false, state, msg: msgStr }
            }
        }
    }
    //fallback: 無法解析的 response
    return { ok: false, state: 'error', msg: `unparseable response: ${JSON.stringify(respObj)}` }
}


//從一對 [r1, r2] (Promise.allSettled 之結果序列化後) 整理出 successCount / errorCount + 所有 reject 訊息
function summarize(results) {
    let successCount = 0
    let errorCount = 0
    let msgs = []
    for (let r of results) {
        if (r.status !== 'fulfilled') {
            //不預期: 我們的 callRpc 內部已把 reject 收斂為 resolved { ok:false }
            //真的拋例外 (網路斷線 / fetch fail) 才會走這
            errorCount++
            msgs.push(`unfulfilled: ${String(r.reason)}`)
            continue
        }
        let v = r.value
        if (v.ok) {
            successCount++
        }
        else {
            errorCount++
        }
        msgs.push(v.msg)
    }
    return { successCount, errorCount, msgs }
}


// ===================================================================
// mocha 測試
// ===================================================================

describe('doubleclick API E2E — backend mutex 並行序列化回歸', function() {
    this.timeout(90000)

    beforeEach(async function() {
        this.timeout(90000)
        await startServersOnce()
        await deleteTestUsersAndTokens()
        await insertTestUsersAndTokens()
    })

    afterEach(async function() {
        await deleteTestUsersAndTokens()
    })


    it('E2E-DC-01-admin-reset-double: 並行 2 次 adminResetUserPassword 同 targetUserId → mutex 序列化 + throttle reject', async function() {
        //取得插入前的 password (用於比對「只更新一次」)
        let usBefore = await woItems.users.select({ id: dc01Target.id })
        let pwBefore = usBefore[0].password

        //並行 2 次 adminResetUserPassword(token, lang, targetUserId)
        let results = await Promise.allSettled([
            callRpc('adminResetUserPassword', [dc01AdminToken, 'eng', dc01Target.id], dc01AdminToken),
            callRpc('adminResetUserPassword', [dc01AdminToken, 'eng', dc01Target.id], dc01AdminToken),
        ])
        let { successCount, errorCount, msgs } = summarize(results)

        //驗證 1: 一成功一失敗 (mutex 序列化後第 2 次撞 throttle)
        assert.strict.equal(successCount, 1, `預期 1 次成功 (mutex 第 1 次通過), 實際 ${successCount}, msgs=${JSON.stringify(msgs)}`)
        assert.strict.equal(errorCount, 1, `預期 1 次失敗 (mutex 第 2 次撞 throttle), 實際 ${errorCount}, msgs=${JSON.stringify(msgs)}`)

        //驗證 2: 失敗訊息含 throttle 標識
        //對應 procCore.mjs line 1158: reject('reset already triggered, please wait')
        let errMsg = msgs.find((m) => !m || m === 'ok' ? false : true) //取出 error 訊息 (非 'ok')
        let combined = msgs.join(' | ')
        assert.strict.equal(
            combined.includes('adminResetPasswordAlreadyTriggered'),
            true,
            `預期失敗訊息含 'reset already triggered' / 'please wait' (throttle), 實際: ${combined}`
        )

        //驗證 3: DB password 只更新一次 (跟初始值不同, 但兩條 RPC 沒有產生「先 A 後 B」的 lost-update)
        let usAfter = await woItems.users.select({ id: dc01Target.id })
        let pwAfter = usAfter[0].password
        assert.strict.notEqual(pwAfter, pwBefore, `預期 password 已被 reset 改變, 實際未變`)
        assert.strict.equal(usAfter.length, 1, `預期 user 仍只 1 筆, 實際 ${usAfter.length}`)
    })


    it('E2E-DC-02-create-user-double: 並行 2 次 createUser 同 account → mutex 序列化 + account-exists reject', async function() {
        //確認插入前 DB 沒有 dc02NewAccount
        let usBefore = await woItems.users.select({ account: dc02NewAccount })
        assert.strict.equal(usBefore.length, 0, `預期 dc02NewAccount 不存在, 實際 ${usBefore.length} 筆`)

        //並行 2 次 createUser(lang, account, password, confirmPassword, name, email)
        //注意 createUser 不需 token (kpfun 內 _t 帶 userId 但不使用), 用 dummy token 即可
        let args = ['eng', dc02NewAccount, dc02NewPassword, dc02NewPassword, dc02NewName, dc02NewEmail]
        let results = await Promise.allSettled([
            callRpc('createUser', args, 'dummy'),
            callRpc('createUser', args, 'dummy'),
        ])
        let { successCount, errorCount, msgs } = summarize(results)

        //驗證 1: 一成功一失敗 (mutex 序列化, 第 2 次 select 看到第 1 次 insert)
        assert.strict.equal(successCount, 1, `預期 1 次成功 (mutex 第 1 次 insert), 實際 ${successCount}, msgs=${JSON.stringify(msgs)}`)
        assert.strict.equal(errorCount, 1, `預期 1 次失敗 (mutex 第 2 次 select 看到已存在), 實際 ${errorCount}, msgs=${JSON.stringify(msgs)}`)

        //驗證 2: 失敗訊息為 'account already exists' (procLang i18n eng key=userRegistrationAccountExists)
        //對應 procCore.mjs line 770: reject(get(kpLang, `${lang}.userRegistrationAccountExists`, 'account already exists'))
        let combined = msgs.join(' | ')
        assert.strict.equal(
            combined.toLowerCase().includes('account') && combined.toLowerCase().includes('exists'),
            true,
            `預期失敗訊息含 'account' + 'exists', 實際: ${combined}`
        )

        //驗證 3: DB users 表 dc02NewAccount 只 1 筆 (雙重 insert 防護)
        let usAfter = await woItems.users.select({ account: dc02NewAccount })
        assert.strict.equal(usAfter.length, 1, `預期 dc02NewAccount 只 1 筆, 實際 ${usAfter.length}, users=${JSON.stringify(usAfter.map((u) => u.id))}`)
    })


    it('E2E-DC-03-resend-verify-double: 並行 2 次 resendVerifyEmail 同 account → mutex 序列化 + throttle reject', async function() {
        //確認 dc03Target 仍未驗證 (resendVerifyEmail 條件)
        let usBefore = await woItems.users.select({ id: dc03Target.id })
        assert.strict.equal(usBefore[0].timeVerified, '', `預期 dc03Target.timeVerified 為空, 實際: ${usBefore[0].timeVerified}`)
        let tokenVerifyBefore = usBefore[0].tokenVerify

        //並行 2 次 resendVerifyEmail(lang, account, email)
        let args = ['eng', dc03Target.account, dc03Target.email]
        let results = await Promise.allSettled([
            callRpc('resendVerifyEmail', args, 'dummy'),
            callRpc('resendVerifyEmail', args, 'dummy'),
        ])
        let { successCount, errorCount, msgs } = summarize(results)

        //驗證 1: mutex 序列化 → 第 2 次並行呼叫「必」撞 throttle reject 'userRegistrationResendThrottled'.
        //此為本 case 核心契約, 且與 SMTP 是否配置「無關」: throttle 寫入 (lastResendTime.set) 在 srEmail.send 之前
        //(procCore ~line 913), 故即使第 1 次因本專案預設無 SMTP 而寄信失敗, throttle 仍已被第 1 次寫入,
        //第 2 次 (mutex 序列化後執行) 一定看到 throttle → reject 'userRegistrationResendThrottled'.
        //(第 1 次本身 success 或 send-email-failed 視 SMTP 而定, 故不硬斷 successCount; 但 throttle 必出現.
        //  — 舊斷言放寬成「throttle 或 send-email-failed」會讓「throttle 根本沒 engage」之 mutex bug 矇過, 故收緊.)
        let combined = msgs.join(' | ')
        assert.strict.equal(errorCount >= 1, true, `預期至少 1 次失敗, 實際 errorCount=${errorCount}, msgs=${JSON.stringify(msgs)}`)
        assert.strict.equal(
            combined.includes('userRegistrationResendThrottled'),
            true,
            `預期至少一條為 throttle reject 'userRegistrationResendThrottled' (mutex 序列化後第 2 次必撞 throttle, 與 SMTP 配置無關), 實際: ${combined}`
        )

        //驗證 2: 兩條序列化 (mutex 排他): 不會同時跑進 procCore line 906~911 的 tokenVerify 重產 + save.
        //   → DB tokenVerify 要嘛還是原值 (兩條都失敗), 要嘛改一次 (第 1 次 SMTP 也算成功 path 改完).
        //   不可能出現「先改成 A 又被覆蓋成 B」的 lost-update 痕跡. 此處單純驗 user 仍只 1 筆 (sanity).
        let usAfter = await woItems.users.select({ id: dc03Target.id })
        assert.strict.equal(usAfter.length, 1, `預期 dc03Target 仍只 1 筆, 實際 ${usAfter.length}`)
        //tokenVerifyBefore 可能未變 (兩條都失敗) 或變了一次 (第 1 次成功 path), 都接受
        void tokenVerifyBefore
    })


    it('E2E-DC-04-change-password-double: 並行 2 次 changeUserPassword 同 token → mutex 序列化 + incorrect-old-password reject', async function() {
        //取得插入前的 password hash (用於比對「只改了一次」)
        let usBefore = await woItems.users.select({ id: dc04Target.id })
        let pwBefore = usBefore[0].password
        assert.strict.equal(verifyPassword(dc04Target.newPassword, pwBefore, salt), false, `seed 防呆: 舊 hash 不該由新密碼驗證通過`)

        //並行 2 次 changeUserPassword(token, lang, oldPassword, newPassword)
        //兩條 RPC 拿同一個 oldPassword 與 newPassword. mutex 序列化後:
        //  - 第 1 次: 比對 oldPassword 通過 → save 新 password → resolve
        //  - 第 2 次: 比對 oldPassword 不通過 (DB 已是新 hash) → reject 'incorrect old password'
        let args = [dc04TargetToken, 'eng', dc04Target.rawPassword, dc04Target.newPassword]
        let results = await Promise.allSettled([
            callRpc('changeUserPassword', args, dc04TargetToken),
            callRpc('changeUserPassword', args, dc04TargetToken),
        ])
        let { successCount, errorCount, msgs } = summarize(results)

        //驗證 1: 一成功一失敗 (mutex 序列化)
        assert.strict.equal(successCount, 1, `預期 1 次成功 (mutex 第 1 次改 password), 實際 ${successCount}, msgs=${JSON.stringify(msgs)}`)
        assert.strict.equal(errorCount, 1, `預期 1 次失敗 (mutex 第 2 次 oldPassword 比對失敗), 實際 ${errorCount}, msgs=${JSON.stringify(msgs)}`)

        //驗證 2: 失敗訊息含 'incorrect old password'
        //對應 procCore.mjs line 1043: reject('incorrect old password')
        let combined = msgs.join(' | ')
        assert.strict.equal(
            combined.includes('userChangePasswordIncorrectOld'),
            true,
            `預期失敗訊息含 'incorrect old password', 實際: ${combined}`
        )

        //驗證 3: DB password 已改為 newPassword hash (只改一次, 第 2 次因 oldPassword 不符自然不會再 save)
        let usAfter = await woItems.users.select({ id: dc04Target.id })
        let pwAfter = usAfter[0].password
        assert.strict.equal(verifyPassword(dc04Target.newPassword, pwAfter, salt), true, `預期 password 已改為 newPassword hash, 實際: pwAfter ${pwAfter === pwBefore ? '== pwBefore (未改)' : '!= 預期'}`)
    })


    // ===================================================================
    // DC-05～08: 清單儲存之雙擊防護 (ADR-074)
    //   後端以「操作:操作者 id」原子占位(server/lockSave.mjs): 同一操作者之同一儲存處理中再送出 → reject 'saveInProgress';
    //   使用者清單另以新增列標記(_isNew)擋依序重送 → reject 'saveNewRowExists'.
    //   兩次請求是否重疊取決於時序, 故以下只斷言與時序無關之不變式(占位機制本身由 unit-lockSave 以受控 deferred 驗).
    // ===================================================================

    //newUserRow: 模擬後台「新增使用者」送出之新列 (前端佔位字 + 空 timeVerified + _isNew, 對齊 LayoutContentUsers.addItem)
    function newUserRow(id, account) {
        let nu = ds.users.funNew({
            order: 0,
            account,
            password: 'Pw@xkRb91!', //不含 account 任何連續 2 字, 通過 noConsecutiveCharsFromAccount=2
            name: `${account} name`,
            email: `${account}@test.com`,
            description: '',
            from: '',
            redir: '',
            isAdmin: 'n',
            timeVerified: '',
            timeExpired: '',
            timeBlocked: '',
            isActive: 'y',
        })
        nu.id = id
        nu.userId = '{New}'
        nu.timeCreate = '{New}'
        nu.userIdUpdate = '{New}'
        nu.timeUpdate = '{New}'
        nu._isNew = true
        return nu
    }

    //usersPayload: 目前 DB 之使用者清單(剝除 password, 對齊 getUsersList 回傳) + 新列
    async function usersPayload(nu) {
        let base = (await woItems.users.select()).map((r) => {
            let c = { ...r }
            delete c.password
            return c
        })
        return [nu, ...base]
    }

    //assertNewUserIntact: 新使用者只 1 筆, 且伺服器於新增時填入之欄位未被第 2 次送出之空值 / 佔位字覆寫
    async function assertNewUserIntact(id) {
        let us = await woItems.users.select({ id })
        assert.strict.equal(us.length, 1, `新使用者應只 1 筆, 實際 ${us.length}`)
        let u = us[0]
        assert.strict.equal(typeof u.timeVerified === 'string' && u.timeVerified !== '', true, `timeVerified 應為新增時自動填入之時間, 實際「${u.timeVerified}」(被清空即無法登入)`)
        assert.strict.equal(u.userId, dc01Admin.id, `建立者應為操作之管理者, 實際「${u.userId}」`)
        assert.strict.equal(u.timeCreate !== '{New}' && u.timeCreate !== '', true, `建立時間不得為前端佔位字, 實際「${u.timeCreate}」`)
    }


    it('E2E-DC-05-update-users-new-row-double: 並行 2 次同一包「含新增使用者」之 updateUsersList → 1 成功 1 拒絕, 新使用者未被覆寫', async function() {
        let nid = 'id-dc05-new'
        let rows = await usersPayload(newUserRow(nid, 'dc05-new'))

        let results = await Promise.allSettled([
            callRpc('updateUsersList', [dc01AdminToken, 'eng', rows], dc01AdminToken),
            callRpc('updateUsersList', [dc01AdminToken, 'eng', rows], dc01AdminToken),
        ])
        let { successCount, errorCount, msgs } = summarize(results)

        //驗證 1: 一成功一拒絕; 拒絕為「處理中」(兩次重疊) 或「新增列已存在」(第 2 次於第 1 次完成後才處理), 視時序而定
        assert.strict.equal(successCount, 1, `預期 1 次成功, 實際 ${successCount}, msgs=${JSON.stringify(msgs)}`)
        assert.strict.equal(errorCount, 1, `預期 1 次拒絕, 實際 ${errorCount}, msgs=${JSON.stringify(msgs)}`)
        let errMsg = results.map((r) => r.value).find((v) => !v.ok).msg
        assert.strict.equal(['saveInProgress', 'saveNewRowExists'].includes(errMsg), true, `拒絕之 key 應為 saveInProgress 或 saveNewRowExists, 實際: ${errMsg}`)

        //驗證 2: 新使用者未被第 2 次覆寫 (未修前實測: timeVerified 清空、建立者 / 建立時間寫成佔位字)
        await assertNewUserIntact(nid)
    })


    it('E2E-DC-06-update-users-new-row-resend: 依序 2 次同一包「含新增使用者」之 updateUsersList → 第 2 次 saveNewRowExists, 新使用者未被覆寫', async function() {
        let nid = 'id-dc06-new'
        let rows = await usersPayload(newUserRow(nid, 'dc06-new'))

        let r1 = await callRpc('updateUsersList', [dc01AdminToken, 'eng', rows], dc01AdminToken)
        let r2 = await callRpc('updateUsersList', [dc01AdminToken, 'eng', rows], dc01AdminToken)

        assert.strict.equal(r1.ok, true, `第 1 次應成功, 實際 ${JSON.stringify(r1)}`)
        assert.strict.equal(r2.ok, false, `第 2 次應被拒絕, 實際 ${JSON.stringify(r2)}`)
        assert.strict.equal(r2.msg, 'saveNewRowExists', `第 2 次之 key 應為 saveNewRowExists, 實際: ${r2.msg}`)
        await assertNewUserIntact(nid)
    })


    it('E2E-DC-07-update-tokens-double: 並行 2 次同一包 updateTokensList → 拒絕者只能是 saveInProgress, 權杖表不變', async function() {
        let tsBefore = await woItems.tokens.select()
        let rows = tsBefore.map((t) => ({ ...t }))

        let results = await Promise.allSettled([
            callRpc('updateTokensList', [dc01AdminToken, 'eng', rows], dc01AdminToken),
            callRpc('updateTokensList', [dc01AdminToken, 'eng', rows], dc01AdminToken),
        ])
        let vs = results.map((r) => r.value)
        assert.strict.equal(vs.filter((v) => v.ok).length >= 1, true, `至少 1 次成功, 實際 ${JSON.stringify(vs)}`)
        for (let v of vs.filter((v) => !v.ok)) {
            assert.strict.equal(v.msg, 'saveInProgress', `拒絕之 key 應為 saveInProgress, 實際: ${v.msg}`)
        }

        let tsAfter = await woItems.tokens.select()
        assert.strict.deepEqual(tsAfter.map((t) => t.id).sort(), tsBefore.map((t) => t.id).sort(), '權杖表之列不變(無重複、無遺失)')
    })


    it('E2E-DC-08-update-ips-double: 並行 2 次同一包「含新列」之 updateIpsList → 拒絕者只能是 saveInProgress, 新列只 1 筆', async function() {
        let o = ds.ips.funNew({ ip: '10.9.9.9', timeBlocked: '' })
        o.id = 'id-dc08-ip'
        let rows = [o]

        let results = await Promise.allSettled([
            callRpc('updateIpsList', [dc01AdminToken, 'eng', rows], dc01AdminToken),
            callRpc('updateIpsList', [dc01AdminToken, 'eng', rows], dc01AdminToken),
        ])
        let vs = results.map((r) => r.value)
        assert.strict.equal(vs.filter((v) => v.ok).length >= 1, true, `至少 1 次成功, 實際 ${JSON.stringify(vs)}`)
        for (let v of vs.filter((v) => !v.ok)) {
            assert.strict.equal(v.msg, 'saveInProgress', `拒絕之 key 應為 saveInProgress, 實際: ${v.msg}`)
        }

        let ips = await woItems.ips.select({ id: o.id })
        assert.strict.equal(ips.length, 1, `新列應只 1 筆, 實際 ${ips.length}`)
    })

})


//手動觸發 cleanup (僅在直接 node 跑時; mocha 環境由 e2e-setup 的 root after() 觸發)
//本檔無 --baseline 直跑模式 (純 verify, 無 baseline), 不需 main(), cleanup 由 mocha after() 處理.
void cleanup
