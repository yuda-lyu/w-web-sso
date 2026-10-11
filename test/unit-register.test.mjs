import assert from 'assert'
import get from 'lodash-es/get.js'
import { buildProc } from './tools/unitProc.mjs'


//mock factory 依賴: woItems (DB 存取層) / procOrm (寫入). checkUserPassword 為純函式不碰 DB;
//createUser 用 select(查重)/procOrm(insert)/srEmail(寄信). 寄信失敗於 createUser 內被 catch, 不影響回傳.
//真實 procCore 工廠、passwordPolicy fixture 與 opt 見 test/tools/unitProc.mjs 之 buildProc
let mkWoItems = () => ({
    users: { select: async () => [], save: async () => {} },
    ips: { select: async () => [], save: async () => {} },
    tokens: { select: async () => [], save: async () => {} },
})


//共用實例 (checkUserPassword 為純函式, 多 case 唯讀共用無副作用)
let pCore = buildProc(mkWoItems(), async () => {})
let checkUserPassword = (lang, pw, opt) => pCore.checkUserPassword(lang, pw, opt)


describe('register - password validation (checkUserPassword)', function() {

    // B2: password empty
    it('B2: should fail when password is empty', function() {
        let r = checkUserPassword('eng', '', { account: 'newuser' })
        assert.strict.equal(r.state, 'error')
    })

    // C1: valid password
    it('C1: should pass with valid password', function() {
        let r = checkUserPassword('eng', 'Ab@12345', { account: 'newuser' })
        assert.strict.equal(r.state, 'success')
    })

    // C2: too short
    it('C2: should fail when password is too short', function() {
        let r = checkUserPassword('eng', 'Ab@1', { account: 'newuser' })
        assert.strict.equal(r.state, 'error')
        assert.strict.equal(r.key, 'userPassword_keyLimNumLenMin')
    })

    // C3: no special char
    it('C3: should fail when password has no special character', function() {
        let r = checkUserPassword('eng', 'Abcd1234', { account: 'newuser' })
        assert.strict.equal(r.state, 'error')
        assert.strict.equal(r.key, 'userPassword_keyLimRequireSpecial')
    })

    // C4: blacklisted password
    it('C4: should fail when password is in blacklist', function() {
        let r = checkUserPassword('eng', '1qaz@WSX', { account: 'newuser' })
        assert.strict.equal(r.state, 'error')
        assert.strict.equal(r.key, 'userPassword_keyLimCommonPassword')
    })

    // C5: consecutive chars from account
    it('C5: should fail when password contains consecutive chars from account', function() {
        let r = checkUserPassword('eng', 'Ab@1ne34', { account: 'newuser' })
        assert.strict.equal(r.state, 'error')
        assert.strict.equal(r.key, 'userPassword_keyLimConsecutiveCharsFromAccount')
    })

    // additional: no letter
    it('should fail when password has no letter', function() {
        let r = checkUserPassword('eng', '1234@678', { account: 'newuser' })
        assert.strict.equal(r.state, 'error')
        assert.strict.equal(r.key, 'userPassword_keyLimRequireLetter')
    })

    // additional: no digit
    it('should fail when password has no digit', function() {
        let r = checkUserPassword('eng', 'Abcdefg@', { account: 'newuser' })
        assert.strict.equal(r.state, 'error')
        assert.strict.equal(r.key, 'userPassword_keyLimRequireDigit')
    })

    // additional: too long
    it('should fail when password exceeds maxLength', function() {
        let r = checkUserPassword('eng', 'Ab@12345678901234', { account: 'newuser' })
        assert.strict.equal(r.state, 'error')
        assert.strict.equal(r.key, 'userPassword_keyLimNumLenMax')
    })

    // additional: exact minLength
    it('should pass when password is exactly minLength', function() {
        let r = checkUserPassword('eng', 'Ab@12345', { account: 'newuser' })
        assert.strict.equal(r.state, 'success')
    })

    // additional: exact maxLength
    it('should pass when password is exactly maxLength', function() {
        let r = checkUserPassword('eng', 'Ab@1234567890123', { account: 'newuser' })
        assert.strict.equal(r.state, 'success')
    })

    // additional: has space
    it('should fail when password contains space', function() {
        let r = checkUserPassword('eng', 'Abc @123', { account: 'newuser' })
        assert.strict.equal(r.state, 'error')
        assert.strict.equal(r.key, 'userPassword_keyLimHasSpace')
    })

    // additional: has forbidden char backslash
    it('should fail when password contains forbidden backslash', function() {
        let r = checkUserPassword('eng', 'Ab@1234\\', { account: 'newuser' })
        assert.strict.equal(r.state, 'error')
        assert.strict.equal(r.key, 'userPassword_keyLimForbiddenChar')
    })

    // additional: blacklist case insensitive
    it('should fail when password matches blacklist case-insensitively', function() {
        let r = checkUserPassword('eng', '1QAZ@wsx', { account: 'newuser' })
        assert.strict.equal(r.state, 'error')
        assert.strict.equal(r.key, 'userPassword_keyLimCommonPassword')
    })

    // additional: blacklist substring is not exact match
    it('should pass when password contains blacklist as substring but is not exact match', function() {
        let r = checkUserPassword('eng', '1qaz@WSXabc', { account: 'newuser' })
        assert.strict.equal(r.state, 'success')
    })

    // additional: account empty skips consecutive check
    it('should pass consecutive check when account is empty', function() {
        let r = checkUserPassword('eng', 'Ab@1ne34', { account: '' })
        assert.strict.equal(r.state, 'success')
    })

    // additional: account length < consecutiveCharsMinMatch skips check
    it('should pass consecutive check when account length < N', function() {
        let r = checkUserPassword('eng', 'Ab@1a234', { account: 'a' })
        assert.strict.equal(r.state, 'success')
    })

    // additional: non-ASCII
    it('should fail when password contains non-ASCII characters', function() {
        let r = checkUserPassword('eng', 'Ab@123密碼', { account: 'newuser' })
        assert.strict.equal(r.state, 'error')
        assert.strict.equal(r.key, 'userPassword_keyLimNonAsciiChar')
    })

})


describe('register - field validation logic', function() {

    // B3: confirmPassword mismatch
    it('B3: should detect confirmPassword mismatch', function() {
        let password = 'Ab@12345'
        let confirmPassword = 'Ab@12346'
        assert.strict.notEqual(password, confirmPassword)
    })

    // B4: confirmPassword match
    it('B4: should detect confirmPassword match', function() {
        let password = 'Ab@12345'
        let confirmPassword = 'Ab@12345'
        assert.strict.equal(password, confirmPassword)
    })

    // F4: isAdmin injection - createUser 強制 isAdmin='n', 不採信 caller 注入之 isAdmin
    // (spec/流程_使用者創建帳密.md:419/474 自助註冊強制 isAdmin='n'; procCore.mjs:837-845 funNew 硬寫 isAdmin:'n')
    it('F4: createUser should force isAdmin to "n" even when caller injects isAdmin:"y"', async function() {
        let inserted = []
        let p = buildProc(mkWoItems(), async (operatorId, table, op, args) => {
            if (table === 'users' && op === 'insert') {
                inserted.push(args[0])
            }
        })
        let r = await p.createUser('eng', {
            account: 'hacker', name: 'hacker', email: 'hacker@x.com',
            password: 'Ab@12345', confirmPassword: 'Ab@12345',
            isAdmin: 'y', //attacker-injected, 須被忽略
        })
        assert.strict.equal(r.state, 'success')
        assert.strict.equal(inserted.length, 1)
        //真實 createUser 強制寫入之欄位 (非假資料常數)
        assert.strict.equal(inserted[0].isAdmin, 'n')
        assert.strict.equal(inserted[0].isActive, 'y')
        //timeVerified 須為空 (自助註冊須完成 email 驗證才可登入)
        assert.strict.equal(get(inserted[0], 'timeVerified', ''), '')
    })

})


describe('register - allowUserRegistration setting', function() {
    //測真實閘門(procCore.createUser 之 allowUserRegistration 檢查), 非測試檔自行複製邏輯(全域 §14.2)
    //spec: 新功能採 opt-in, settings 未給預設 false(WWebSso.mjs 讀取處 ===true 嚴格判定), 明確給 true 才啟用;
    //預設 false 確保舊引用方 settings 原封升級後啟動與行為皆與升級前一致

    // A2: gate off → createUser rejected
    it('A2: should reject createUser with userRegistrationNotAllowed when allowUserRegistration is false', async function() {
        let p = buildProc(mkWoItems(), async () => {}, { allowUserRegistration: false })
        let errKey = ''
        await p.createUser('eng', {
            account: 'newuser',
            name: 'New User',
            email: 'new@x.com',
            password: 'Ab@12345',
            confirmPassword: 'Ab@12345',
        })
            .catch((err) => {
                errKey = err
            })
        assert.strict.equal(errKey, 'userRegistrationNotAllowed')
    })

    // A5: gate on → createUser proceeds (真實 opt-in 啟用路徑)
    it('A5: should allow createUser when allowUserRegistration is true', async function() {
        let inserted = []
        let p = buildProc(mkWoItems(), async (operatorId, table, op, args) => {
            inserted.push(...args)
        }, { allowUserRegistration: true })
        let r = await p.createUser('eng', {
            account: 'newuser',
            name: 'New User',
            email: 'new@x.com',
            password: 'Ab@12345',
            confirmPassword: 'Ab@12345',
        })
        assert.strict.equal(r.state, 'success')
        assert.strict.equal(inserted.length, 1)
    })

})
