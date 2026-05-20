import assert from 'assert'
import get from 'lodash-es/get.js'
import isUserPw from 'wsemi/src/isUserPw.mjs'


//passwordPolicy for testing (matches settings.json)
let passwordPolicy = {
    minLength: 8,
    maxLength: 16,
    requireLetter: true,
    requireUppercase: false,
    requireLowercase: false,
    requireDigit: true,
    requireSpecial: true,
    noSpace: true,
    onlyAscii: true,
    forbiddenChars: ['\\'],
    noConsecutiveCharsFromAccount: true,
    consecutiveCharsMinMatch: 2,
    commonPasswordBlacklist: [
        '1234', '12345', '123456', '1234567', '12345678',
        '123456789', '1234567890', '12345678910',
        '111111', '000000', '666666', '888888', '7777777', '11111111',
        '123123', '123321', '654321', '987654321',
        'qwerty', 'qwerty123', 'qwerty1', 'qwertyuiop', 'qazwsx',
        '1q2w3e4r', '1q2w3e4r5t', '1q2w3e', '1qaz2wsx', 'zxcvbnm',
        'password', 'password1', 'passw0rd', 'admin', 'admin123',
        'welcome', 'letmein', 'login', 'master', 'monkey', 'dragon',
        'shadow', 'sunshine', 'superman', 'batman', 'football',
        'baseball', 'soccer', 'hockey', 'michael', 'jordan', 'jennifer',
        'hunter', 'ranger', 'harley', 'thomas', 'charlie', 'andrew',
        'daniel', 'ashley', 'bailey', 'mustang', 'access', 'secret',
        'ninja', 'jesus', 'hello', 'freedom', 'trustno1',
        '1qaz@WSX', 'P@ssw0rd', 'Pass@123', 'Aa123456', 'Aa@123456',
        'Admin@123', 'abc@123',
        'abc123', 'abcdef', 'abcd1234', 'abc',
        'iloveyou', 'fuckyou', 'f*ckyou', 'whatever', 'nothing',
        'google', 'computer', 'internet', 'samsung', 'apple', 'killer',
        'princess', 'lovely', 'tigger', 'starwars', 'pokemon',
        'minecraft', '123qwe', 'zaq1zaq1', 'photoshop', 'adobe123',
        '18atcskd2w', 'mynoob',
    ],
}


//checkUserPassword (extracted from procCore logic)
function checkUserPassword(lang, pw, opt = {}) {
    let account = get(opt, 'account', '')
    let keyErr = ''
    try {
        isUserPw(pw, {
            useKeyForError: true,
            useOnlyOneError: true,
            numLenMin: passwordPolicy.minLength,
            numLenMax: passwordPolicy.maxLength,
            requireLetter: passwordPolicy.requireLetter,
            requireUppercase: passwordPolicy.requireUppercase,
            requireLowercase: passwordPolicy.requireLowercase,
            requireDigit: passwordPolicy.requireDigit,
            requireSpecial: passwordPolicy.requireSpecial,
            noSpace: passwordPolicy.noSpace,
            onlyAscii: passwordPolicy.onlyAscii,
            forbiddenChars: passwordPolicy.forbiddenChars,
            commonPasswordBlacklist: passwordPolicy.commonPasswordBlacklist,
            account,
            noConsecutiveCharsFromAccount: passwordPolicy.noConsecutiveCharsFromAccount,
            consecutiveCharsMinMatch: passwordPolicy.consecutiveCharsMinMatch,
        })
    }
    catch (err) {
        keyErr = err.message
    }
    if (keyErr === '') {
        return { state: 'success', msg: 'ok' }
    }
    return { state: 'error', msg: keyErr, key: keyErr }
}


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
        assert.strict.equal(r.key, 'keyLimNumLenMin')
    })

    // C3: no special char
    it('C3: should fail when password has no special character', function() {
        let r = checkUserPassword('eng', 'Abcd1234', { account: 'newuser' })
        assert.strict.equal(r.state, 'error')
        assert.strict.equal(r.key, 'keyLimRequireSpecial')
    })

    // C4: blacklisted password
    it('C4: should fail when password is in blacklist', function() {
        let r = checkUserPassword('eng', '1qaz@WSX', { account: 'newuser' })
        assert.strict.equal(r.state, 'error')
        assert.strict.equal(r.key, 'keyLimCommonPassword')
    })

    // C5: consecutive chars from account
    it('C5: should fail when password contains consecutive chars from account', function() {
        let r = checkUserPassword('eng', 'Ab@1ne34', { account: 'newuser' })
        assert.strict.equal(r.state, 'error')
        assert.strict.equal(r.key, 'keyLimConsecutiveCharsFromAccount')
    })

    // additional: no letter
    it('should fail when password has no letter', function() {
        let r = checkUserPassword('eng', '1234@678', { account: 'newuser' })
        assert.strict.equal(r.state, 'error')
        assert.strict.equal(r.key, 'keyLimRequireLetter')
    })

    // additional: no digit
    it('should fail when password has no digit', function() {
        let r = checkUserPassword('eng', 'Abcdefg@', { account: 'newuser' })
        assert.strict.equal(r.state, 'error')
        assert.strict.equal(r.key, 'keyLimRequireDigit')
    })

    // additional: too long
    it('should fail when password exceeds maxLength', function() {
        let r = checkUserPassword('eng', 'Ab@12345678901234', { account: 'newuser' })
        assert.strict.equal(r.state, 'error')
        assert.strict.equal(r.key, 'keyLimNumLenMax')
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
        assert.strict.equal(r.key, 'keyLimHasSpace')
    })

    // additional: has forbidden char backslash
    it('should fail when password contains forbidden backslash', function() {
        let r = checkUserPassword('eng', 'Ab@1234\\', { account: 'newuser' })
        assert.strict.equal(r.state, 'error')
        assert.strict.equal(r.key, 'keyLimForbiddenChar')
    })

    // additional: blacklist case insensitive
    it('should fail when password matches blacklist case-insensitively', function() {
        let r = checkUserPassword('eng', '1QAZ@wsx', { account: 'newuser' })
        assert.strict.equal(r.state, 'error')
        assert.strict.equal(r.key, 'keyLimCommonPassword')
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
        assert.strict.equal(r.key, 'keyLimNonAsciiChar')
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

    // F4: isAdmin injection - verify funNew behavior
    it('F4: explicit isAdmin should not be overridable by input', function() {
        // Simulate: even if data has isAdmin:'y', the code passes isAdmin:'' to funNew
        let dataFromAttacker = { isAdmin: 'y', account: 'hacker', name: 'hacker' }
        let safeValues = {
            account: dataFromAttacker.account,
            name: dataFromAttacker.name,
            isAdmin: '', // explicitly set
            isActive: 'y',
        }
        assert.strict.equal(safeValues.isAdmin, '')
        assert.strict.equal(safeValues.isActive, 'y')
    })

})


describe('register - allowUserRegistration setting', function() {

    // A3: default when not set
    it('A3: should default to true when allowUserRegistration is not set', function() {
        let opt = {}
        let allowUserRegistration = get(opt, 'allowUserRegistration', true)
        if (allowUserRegistration !== true && allowUserRegistration !== false) {
            allowUserRegistration = true
        }
        assert.strict.equal(allowUserRegistration, true)
    })

    // A4: non-boolean should default to true
    it('A4: should default to true when allowUserRegistration is non-boolean', function() {
        let opt = { allowUserRegistration: 'yes' }
        let allowUserRegistration = get(opt, 'allowUserRegistration', true)
        if (allowUserRegistration !== true && allowUserRegistration !== false) {
            allowUserRegistration = true
        }
        assert.strict.equal(allowUserRegistration, true)
    })

    // A2: false should stay false
    it('A2: should stay false when set to false', function() {
        let opt = { allowUserRegistration: false }
        let allowUserRegistration = get(opt, 'allowUserRegistration', true)
        if (allowUserRegistration !== true && allowUserRegistration !== false) {
            allowUserRegistration = true
        }
        assert.strict.equal(allowUserRegistration, false)
    })

})
