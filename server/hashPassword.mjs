import crypto from 'crypto'
import get from 'lodash-es/get.js'
import isestr from 'wsemi/src/isestr.mjs'


//[密碼雜湊設計說明]
//本模組採用 Node 內建 crypto.scryptSync (記憶體困難 KDF) 進行密碼雜湊.
//
//salt 參數定位:
//  - 原本 salt 為「全系統共用全域值」, 既是 KDF 的鹽又是唯一防護, 弱點是共用鹽無法防 rainbow table / precompute.
//  - 改寫後 salt 參數轉為「可選 pepper」(伺服器端額外祕密, 通常存於設定檔而非 DB), 只與明文混合.
//  - 真正防 precompute / rainbow table 的, 是每位使用者各自獨立的 per-user 隨機 salt (crypto.randomBytes(16)),
//    它會被嵌入回傳字串內, 故每筆密碼雜湊用的鹽皆不同, 即使 DB 外洩亦無法以單一 rainbow table 一次破解全表.
//
//自描述格式:
//  - 回傳字串為 `scrypt:${saltHex}:${hashHex}`, 把演算法標記 + per-user 鹽 + 雜湊值打包成單一字串,
//    驗證時 (verifyPassword) 可自字串自行解析出鹽與雜湊, 不需另外於 DB 多開欄位存鹽, 也便於日後演算法遷移辨識.
//
//同步 API:
//  - 使用 scryptSync (同步), 回傳字串 / bool, 呼叫端不需 await.


//scrypt 輸出位元組長度 (雜湊與重算須一致)
const KEYLEN = 64

//per-user 隨機鹽位元組長度
const SALTLEN = 16


function hashPassword(pw, salt, opt = {}) {

    //mode (沿用現有防呆風格: 預設 'scrypt', 非 'scrypt' 才 throw)
    let mode = get(opt, 'mode', '')
    if (!isestr(mode)) {
        mode = 'scrypt'
    }
    if (mode !== 'scrypt') {
        throw new Error(`暫時不支援scrypt以外方法`)
    }

    //per-user 隨機 salt (真正防 precompute 的鹽)
    let saltBuf = crypto.randomBytes(SALTLEN)

    //明文混入 pepper (salt 參數現為可選 pepper), 再以 per-user saltBuf 做 scrypt
    let t = `${pw}:${salt || ''}`
    let hashBuf = crypto.scryptSync(t, saltBuf, KEYLEN)

    //自描述字串: scrypt:saltHex:hashHex
    return `scrypt:${saltBuf.toString('hex')}:${hashBuf.toString('hex')}`
}


function verifyPassword(pw, stored, salt) {

    //格式檢查: 須為字串
    if (!isestr(stored)) {
        return false
    }

    //解析 'scrypt:saltHex:hashHex'
    let parts = stored.split(':')
    if (parts.length !== 3) {
        return false
    }
    let [tag, saltHex, hashHex] = parts
    if (tag !== 'scrypt') {
        return false
    }
    if (!isestr(saltHex) || !isestr(hashHex)) {
        return false
    }

    //還原 per-user salt 與原雜湊值
    let saltBuf
    let hashBuf
    try {
        saltBuf = Buffer.from(saltHex, 'hex')
        hashBuf = Buffer.from(hashHex, 'hex')
    }
    catch (err) {
        return false
    }

    //鹽 / 雜湊長度不符 (損壞或非本格式) 先擋, 避免 scrypt 拋錯或長度不一無法比對
    if (saltBuf.length !== SALTLEN || hashBuf.length !== KEYLEN) {
        return false
    }

    //以相同方式 (明文混 pepper + per-user 鹽) 重算
    let t = `${pw}:${salt || ''}`
    let testBuf = crypto.scryptSync(t, saltBuf, KEYLEN)

    //長度不符先擋 (timingSafeEqual 要求等長), 再以固定時間比對防 timing attack
    if (testBuf.length !== hashBuf.length) {
        return false
    }
    return crypto.timingSafeEqual(testBuf, hashBuf)
}


export default hashPassword
export { hashPassword, verifyPassword }
