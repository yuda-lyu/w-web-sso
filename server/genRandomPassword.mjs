import crypto from 'node:crypto'
import isUserPw from 'wsemi/src/isUserPw.mjs'


function pick(arr) {
    return arr[crypto.randomInt(arr.length)]
}


function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        let j = crypto.randomInt(i + 1)
        let t = arr[i]
        arr[i] = arr[j]
        arr[j] = t
    }
    return arr
}


//產生符合 passwordPolicy 的隨機密碼
//
//參數:
//  passwordPolicy: 同 settings.json 的 passwordPolicy 結構
//  account: 帳號 (用於 noConsecutiveCharsFromAccount 檢查)
//
//回傳: 隨機密碼字串
//例外: 若 20 輪嘗試仍無法產出符合策略的密碼則 throw (極少發生, 除非 policy 設定衝突)
function genRandomPassword(passwordPolicy, account = '') {

    let minLen = passwordPolicy.minLength || 8
    let maxLen = passwordPolicy.maxLength || 16
    //目標長度: 至少 12, 不超過 maxLength, 也不低於 minLength
    let targetLen = Math.min(Math.max(minLen, 12), maxLen)

    let lowers = 'abcdefghijklmnopqrstuvwxyz'.split('')
    let uppers = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
    let digits = '0123456789'.split('')
    //排除可能引發 escaping 麻煩的反斜線, 並依 policy.forbiddenChars 再過濾
    let specials = '!@#$%^&*()_+-=[]{}|;:,.<>?'.split('')
    let forbidden = passwordPolicy.forbiddenChars || []
    specials = specials.filter((c) => !forbidden.includes(c))

    let pool = []
    if (passwordPolicy.requireLowercase || passwordPolicy.requireLetter) {
        pool = pool.concat(lowers)
    }
    if (passwordPolicy.requireUppercase) {
        pool = pool.concat(uppers)
    }
    //requireLetter 但無大小寫硬性需求, 至少要含小寫 (上面已加), 大寫也納入字元池增加亂度
    if (passwordPolicy.requireLetter && !passwordPolicy.requireUppercase && !passwordPolicy.requireLowercase) {
        pool = pool.concat(uppers)
    }
    if (passwordPolicy.requireDigit) {
        pool = pool.concat(digits)
    }
    if (passwordPolicy.requireSpecial) {
        pool = pool.concat(specials)
    }
    if (pool.length === 0) {
        //無任何 require 條件: 預設用 letters + digits
        pool = lowers.concat(uppers).concat(digits)
    }

    let maxAttempts = 20
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        let chars = []
        if (passwordPolicy.requireLetter) {
            chars.push(pick(lowers.concat(uppers)))
        }
        if (passwordPolicy.requireUppercase) {
            chars.push(pick(uppers))
        }
        if (passwordPolicy.requireLowercase) {
            chars.push(pick(lowers))
        }
        if (passwordPolicy.requireDigit) {
            chars.push(pick(digits))
        }
        if (passwordPolicy.requireSpecial) {
            chars.push(pick(specials))
        }
        while (chars.length < targetLen) {
            chars.push(pick(pool))
        }
        shuffle(chars)
        let pw = chars.join('')

        //復用既有 isUserPw 檢查 (含 blacklist / consecutive chars from account 等)
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
            return pw
        }
        catch (err) {
            //continue: 多半為 blacklist 或與 account 連續字元衝突, 重抽
        }
    }

    throw new Error('cannot generate random password matching policy')
}


export default genRandomPassword
