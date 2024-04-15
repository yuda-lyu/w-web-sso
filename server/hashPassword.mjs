import get from 'lodash-es/get.js'
import isestr from 'wsemi/src/isestr.mjs'
import str2sha512 from 'wsemi/src/str2sha512.mjs'


function hashPassword(pw, salt, opt = {}) {

    //mode
    let mode = get(opt, 'mode', '')
    if (!isestr(mode)) {
        mode = 'sha512'
    }
    if (mode !== 'sha512') {
        throw new Error(`暫時不支援sha512以外方法`)
    }

    //加鹽
    let t = `${pw}:${salt}`

    //str2sha512
    t = str2sha512(t)

    return t
}


export default hashPassword
