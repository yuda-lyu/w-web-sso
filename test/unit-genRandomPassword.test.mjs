import assert from 'assert'
import fs from 'fs'
import path from 'path'
import isUserPw from 'wsemi/src/isUserPw.mjs'
import genRandomPassword from '../server/genRandomPassword.mjs'


//
// UNIT-001-random-password-policy-compliance (a-d):
//   對應 spec/流程_後台重設使用者密碼.md 「四、隨機密碼產生器」
//   驗證 genRandomPassword(passwordPolicy, account) 產出之密碼符合策略.
//
// 採 unit-test 性質 (無 server / 無 browser), 與 e2e-resetpassword.test.mjs 分檔.
// 跑法: npx mocha test/unit-genRandomPassword.test.mjs --timeout 30000
//


//從 settings.json 讀正式 passwordPolicy
function loadPasswordPolicy() {
    let fp = path.resolve('./settings.json')
    let txt = fs.readFileSync(fp, 'utf8')
    //settings.json 採 JS-object literal (有註解 + trailing comma + 無 quote key), 不可直接 JSON.parse
    //此處改 eval 模式: 用 new Function 包成回傳該物件
    let obj = new Function(`return ${txt}`)()
    return obj.passwordPolicy
}


//用 isUserPw 同款檢查驗證 genRandomPassword 產出是否確實符合策略
function verifyCompliesPolicy(pw, policy, account) {
    isUserPw(pw, {
        useKeyForError: true,
        useOnlyOneError: true,
        numLenMin: policy.minLength,
        numLenMax: policy.maxLength,
        requireLetter: policy.requireLetter,
        requireUppercase: policy.requireUppercase,
        requireLowercase: policy.requireLowercase,
        requireDigit: policy.requireDigit,
        requireSpecial: policy.requireSpecial,
        noSpace: policy.noSpace,
        onlyAscii: policy.onlyAscii,
        forbiddenChars: policy.forbiddenChars,
        commonPasswordBlacklist: policy.commonPasswordBlacklist,
        account,
        noConsecutiveCharsFromAccount: policy.noConsecutiveCharsFromAccount,
        consecutiveCharsMinMatch: policy.consecutiveCharsMinMatch,
    })
}


describe('genRandomPassword unit test (UNIT-001)', function() {
    this.timeout(30000)

    let policy

    before(function() {
        policy = loadPasswordPolicy()
    })

    it('UNIT-001a-random-password-policy-compliance: 跑 100 次, 每次產出皆符合 settings.json 之 passwordPolicy', function() {
        let n = 100
        let account = 'unit-rp-test-account'
        let failures = []
        for (let i = 0; i < n; i++) {
            let pw
            try {
                pw = genRandomPassword(policy, account)
            }
            catch (err) {
                failures.push({ attempt: i, type: 'gen-throw', err: err.message })
                continue
            }
            try {
                verifyCompliesPolicy(pw, policy, account)
            }
            catch (err) {
                failures.push({ attempt: i, type: 'verify-fail', pw, err: err.message })
            }
        }
        assert.strict.equal(failures.length, 0, `${failures.length}/${n} 次 genRandomPassword 產出不符策略, 前 5 筆: ${JSON.stringify(failures.slice(0, 5))}`)
    })

    it('UNIT-001b-random-password-length-bounds: 產出長度介於 [minLength, maxLength]', function() {
        let n = 50
        let account = 'unit-rp-test'
        for (let i = 0; i < n; i++) {
            let pw = genRandomPassword(policy, account)
            assert.strict.equal(pw.length >= policy.minLength, true, `attempt ${i}: pw 長度 ${pw.length} < minLength ${policy.minLength}`)
            assert.strict.equal(pw.length <= policy.maxLength, true, `attempt ${i}: pw 長度 ${pw.length} > maxLength ${policy.maxLength}`)
        }
    })

    it('UNIT-001c-random-password-no-forbidden-chars: 產出不含 forbiddenChars', function() {
        let n = 50
        let account = 'unit-rp-test'
        let forbidden = policy.forbiddenChars || []
        for (let i = 0; i < n; i++) {
            let pw = genRandomPassword(policy, account)
            for (let c of forbidden) {
                assert.strict.equal(pw.includes(c), false, `attempt ${i}: pw "${pw}" 含禁用字元 "${c}"`)
            }
        }
    })

    it('UNIT-001d-random-password-policy-conflict-throws: 不可能策略 (minLength > maxLength) 拋 "cannot generate random password matching policy"', function() {
        let impossible = {
            ...policy,
            minLength: 100,
            maxLength: 8,
        }
        assert.throws(
            () => genRandomPassword(impossible, 'x'),
            /cannot generate random password matching policy/,
            '不可能策略應拋 cannot generate random password matching policy'
        )
    })

})
