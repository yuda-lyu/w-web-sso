import assert from 'assert'
import ds from '../src/schema/index.mjs'
import hashPassword, { verifyPassword } from '../server/hashPassword.mjs'
import { mkOpt, buildProc, mkSrLog, mkTable, mkProcOrm, passwordPolicy } from './tools/unitProc.mjs'


//
// 信件內文之置換值代入 (procCore.renderEmailText; 規則帳本 R-VAL-03, 規格 spec/流程_後台重設使用者密碼.md〈信件對照〉)
//
// 信件內文以語系鍵為字串模板, 發信時將 {sender} {name} {account} {newPassword} {verifyUrl} 等置換符代入值 (值先經 HTML 跳脫).
// 代入值為使用者自填之文字或隨機新密碼, 其中的 $& $' $` $$ $<x> 在 String.prototype.replaceAll 的「替換字串」中是特殊樣式,
// 會被展開成匹配文字或前後文 (實測: 'x{newPassword}'.replaceAll('{newPassword}', 'FbA$&gt;bHv42=D') → 'xFbA{newPassword}gt;bHv42=D'),
// 使信中的值與寫入資料庫的值不同 (重設密碼信: 信中密碼無法登入). 本檔斷言: 四個寄信點的信件內文含「逐字等於 HTML 跳脫後之值」,
// 且重設密碼後信中密碼即資料庫可登入之密碼. 不起 server、不碰資料庫 (真實 procCore 工廠 + 記憶體資料表, 同 unit-ormWriteFail).
//


let SALT = mkOpt().salt
let PW_INIT = 'Init@1234'
let HASH_INIT = hashPassword(PW_INIT, SALT)


//esc: 測試端獨立的 HTML 跳脫參考實作 (& < > " ' 五字元; 以函數式替換, 不重用 procCore 內部實作, 也不用字串替換值)
let ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }
let esc = (s) => s.replace(/[&<>"']/g, (c) => ESC_MAP[c])

//unesc: 收信端呈現時還原跳脫 (函數式替換)
let UNESC_MAP = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': '\'', '&amp;': '&' }
let unesc = (s) => s.replace(/&(?:lt|gt|quot|#39|amp);/g, (m) => UNESC_MAP[m])

//sp: 含全部特殊樣式之值: $& $' $` $$ $<x>; tag 區分不同置換符, 以偵測錯位代入
//noMarkup 為 true 時不含 < > (自助註冊的帳號 / 姓名 / email 含 HTML 標記會被拒收, 見 B8)
let sp = (tag, noMarkup = false) => {
    return noMarkup ? `${tag}$&A$'B$\`C$$D` : `${tag}$&A$'B$\`C$$D$<x>E`
}


//mkUser
let mkUser = (id, account, ext = {}) => {
    let u = ds.users.funNew({
        account,
        name: account,
        email: `${account}@example.com`,
        password: HASH_INIT,
        isAdmin: 'n',
        timeVerified: '2026-01-01T00:00:00.000+08:00',
    })
    return { ...u, id, ...ext }
}


//mkEnv: 每案例獨立之資料表與 procCore; 信件模板含該寄信點的全部置換符 (並重複 {name} 以驗證全部置換)
async function mkEnv({ webName, verifyBaseUrl, userExt = {}, policy = passwordPolicy } = {}) {
    let users = mkTable([
        mkUser('u-admin', 'admin1', { isAdmin: 'y', order: 1 }),
        mkUser('u-z', 'zuser', { order: 2, ...userExt }),
        mkUser('u-v', 'vuser', { order: 3, tokenVerify: 'tv-1', timeVerified: '', ...userExt }),
    ])
    let tokens = mkTable([
        { ...ds.tokens.funNew({ userId: 'u-admin' }), id: 't-admin', token: 'tk-admin', isApp: 'n', timeEnd: '2099-01-01T00:00:00.000+08:00' },
        { ...ds.tokens.funNew({ userId: 'u-z' }), id: 't-z1', token: 'tk-z1', isApp: 'n', timeEnd: '2099-01-01T00:00:00.000+08:00' },
    ])
    let ips = mkTable([])
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
            webName: webName || 'Test',
            regVerifyEmTitle: 'Verify',
            regVerifyEmContent: 'S[{sender}]N[{name}]U[{verifyUrl}]N2[{name}]',
            chpwEmTitle: 'Changed',
            chpwEmContent: 'S[{sender}]N[{name}]N2[{name}]',
            resetPwEmTitle: 'Reset',
            resetPwEmContent: 'S[{sender}]N[{name}]A[{account}]P[{newPassword}]P2[{newPassword}]',
        },
    }
    let over = { srLog, srEmail, kpLang, passwordPolicy: policy }
    if (verifyBaseUrl !== undefined) {
        over.verifyBaseUrl = verifyBaseUrl
    }
    let p = buildProc(woItems, procOrm, over)
    return { users, tokens, woItems, srLog, mails, p }
}


//policyOnly: 字元池只剩指定特殊字元之密碼策略 (其餘特殊字元列入 forbiddenChars; 無字母 / 數字要求), 密碼固定 12 字元
//genRandomPassword 的特殊字元池為 '!@#$%^&*()_+-=[]{}|;:,.<>?', 池內無字母數字時全由 requireSpecial 之池產生
let ALL_SPECIALS = '!@#$%^&*()_+-=[]{}|;:,.<>?'.split('')
let policyOnly = (chars) => ({
    minLength: 12,
    maxLength: 12,
    requireLetter: false,
    requireUppercase: false,
    requireLowercase: false,
    requireDigit: false,
    requireSpecial: true,
    noSpace: true,
    onlyAscii: true,
    forbiddenChars: ['\\', ...ALL_SPECIALS.filter((c) => !chars.includes(c))],
    noConsecutiveCharsFromAccount: false,
    consecutiveCharsMinMatch: 2,
    commonPasswordBlacklist: [],
})


describe('信件內文之置換值代入 (renderEmailText)', function() {

    it('ER-01 自助註冊驗證信 (createUser): sender / name / verifyUrl 含 $& $\' $` $$ 時, 內文逐字等於 HTML 跳脫後之值, 重複置換符全部置換', async function() {
        let webName = sp('W')
        let verifyBaseUrl = `http://h.example/${sp('B')}`
        let env = await mkEnv({ webName, verifyBaseUrl })
        let name = sp('N', true)
        let r = await env.p.createUser('eng', {
            account: 'newbie',
            name,
            email: 'newbie@example.com',
            password: 'Pass@9876',
            confirmPassword: 'Pass@9876',
        })
        assert.strictEqual(r.state, 'success')
        assert.strictEqual(env.mails.length, 1)
        let tokenVerify = [...env.users.kp.values()].find((u) => u.account === 'newbie').tokenVerify
        let verifyUrl = `${verifyBaseUrl}/api/verifyEmail?token=${tokenVerify}&lang=eng`
        //spec 〈信件對照〉: 置換值經 HTML 跳脫後逐字代入
        assert.strictEqual(env.mails[0].content, `S[${esc(webName)}]N[${esc(name)}]U[${esc(verifyUrl)}]N2[${esc(name)}]`)
    })

    it('ER-02 重寄驗證信 (resendVerifyEmail): sender / name / verifyUrl 含特殊樣式時, 內文逐字等於 HTML 跳脫後之值', async function() {
        let webName = sp('W')
        let verifyBaseUrl = `http://h.example/${sp('B')}`
        let name = sp('N')
        let env = await mkEnv({ webName, verifyBaseUrl, userExt: { name } })
        let r = await env.p.resendVerifyEmail('eng', 'vuser', 'vuser@example.com')
        assert.strictEqual(r.state, 'success')
        assert.strictEqual(env.mails.length, 1)
        let tokenVerify = env.users.get('u-v').tokenVerify
        let verifyUrl = `${verifyBaseUrl}/api/verifyEmail?token=${tokenVerify}&lang=eng`
        assert.strictEqual(env.mails[0].content, `S[${esc(webName)}]N[${esc(name)}]U[${esc(verifyUrl)}]N2[${esc(name)}]`)
    })

    it('ER-03 變更密碼通知信 (checkTokenAndChangePassword): sender / name 含特殊樣式時, 內文逐字等於 HTML 跳脫後之值', async function() {
        let webName = sp('W')
        let name = sp('N')
        let env = await mkEnv({ webName, userExt: { name } })
        await env.p.checkTokenAndChangePassword('tk-z1', 'eng', PW_INIT, 'New@5678')
        assert.strictEqual(env.mails.length, 1)
        assert.strictEqual(env.mails[0].content, `S[${esc(webName)}]N[${esc(name)}]N2[${esc(name)}]`)
    })

    it('ER-04 重設密碼信 (adminResetUserPassword): sender / name / account 含特殊樣式、新密碼為 12 個 $ 時, 內文逐字等於跳脫後之值, 信中密碼即資料庫可登入之密碼', async function() {
        let webName = sp('W')
        let name = sp('N')
        let account = sp('A')
        //字元池只剩 $: genRandomPassword 必產生 '$$$$$$$$$$$$' (修前 $$ 被摺成 $, 信中只剩 6 個)
        let env = await mkEnv({ webName, userExt: { name, account }, policy: policyOnly(['$']) })
        let r = await env.p.adminResetUserPassword('tk-admin', 'eng', 'u-z')
        assert.strictEqual(r.state, 'success')
        assert.strictEqual(env.mails.length, 1)
        let pw = '$'.repeat(12)
        assert.strictEqual(env.mails[0].content, `S[${esc(webName)}]N[${esc(name)}]A[${esc(account)}]P[${esc(pw)}]P2[${esc(pw)}]`)
        //端到端不變式: 信中之新密碼 (收信端還原跳脫後) 即資料庫之密碼
        let m = env.mails[0].content.match(/P\[(.*?)\]P2\[/)
        assert.ok(verifyPassword(unesc(m[1]), env.users.get('u-z').password, SALT), env.mails[0].content)
    })

    it('ER-05 重設密碼信: 字元池為 $ & < > 時重設 20 次, 每次信中密碼 (還原跳脫後) 皆可登入 (修前 $ 後接 & < > $ 即展開, 幾乎必紅)', async function() {
        for (let i = 0; i < 20; i++) {
            let env = await mkEnv({ policy: policyOnly(['$', '&', '<', '>']) })
            let r = await env.p.adminResetUserPassword('tk-admin', 'eng', 'u-z')
            assert.strictEqual(r.state, 'success', `round ${i}`)
            let m = env.mails[0].content.match(/P\[(.*?)\]P2\[/)
            assert.ok(m, `round ${i}: ${env.mails[0].content}`)
            assert.ok(verifyPassword(unesc(m[1]), env.users.get('u-z').password, SALT), `round ${i}: ${env.mails[0].content}`)
            //兩處 {newPassword} 內容相同
            let m2 = env.mails[0].content.match(/P2\[(.*?)\]$/)
            assert.strictEqual(m2[1], m[1], `round ${i}`)
        }
    })

    it('ER-06 對照: 不含特殊樣式之值代入結果不變 (一般字元、{}、[]、中文)', async function() {
        let env = await mkEnv({ webName: '站台 Site', userExt: { name: '王小明 [A]{B}', account: 'ac.1' }, policy: policyOnly(['#', '%']) })
        let r = await env.p.adminResetUserPassword('tk-admin', 'eng', 'u-z')
        assert.strictEqual(r.state, 'success')
        let m = env.mails[0].content.match(/P\[(.*?)\]P2\[/)
        assert.ok(/^[#%]{12}$/.test(m[1]), env.mails[0].content)
        assert.strictEqual(env.mails[0].content, `S[站台 Site]N[王小明 [A]{B}]A[ac.1]P[${m[1]}]P2[${m[1]}]`)
        assert.ok(verifyPassword(m[1], env.users.get('u-z').password, SALT))
    })

})
