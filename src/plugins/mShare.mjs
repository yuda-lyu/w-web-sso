//前後端共用函數區
import ot from 'dayjs'
import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import isestr from 'wsemi/src/isestr.mjs'
import istimemsTZ from 'wsemi/src/istimemsTZ.mjs'


function getNameNew(rows, key = 'name', nameBase = '', nameExt = '') {

    //hasName
    let hasName = (name) => {
        let b = false
        each(rows, (r) => {
            let _name = get(r, key, '')
            if (_name === name) {
                b = true
                return false //跳出
            }
        })
        return b
    }

    //nameNew
    let nameNew = ''
    let b = true
    let i = 0
    while (b) {
        i++
        let pre = ''
        if (isestr(nameBase)) {
            pre = `${nameBase} - `
        }
        nameNew = `${pre}${nameExt}(${i})` //vo.$t('pemiAddNameNew') vo.$t('pemiCopyNameNew')
        b = hasName(nameNew)
    }

    return nameNew
}


function getIsVerified(v) {

    //timeVerified
    let timeVerified = get(v, 'timeVerified', '')
    // console.log('timeVerified', timeVerified)

    return istimemsTZ(timeVerified) //有驗證時間, 代表已驗證
}


function getIsExpired(v) {

    //timeExpired
    let timeExpired = get(v, 'timeExpired', '')
    // console.log('timeExpired', timeExpired)

    //check
    if (!istimemsTZ(timeExpired)) {
        return false //無過期時間, 代表未過期
    }

    //tn
    let tn = ot().format('YYYY-MM-DDTHH:mm:ss.SSSZ')

    return tn >= timeExpired //現在時間>=過期時間, 代表已過期
}


function getIsBlocked(v) {

    //timeBlocked
    let timeBlocked = get(v, 'timeBlocked', '')
    // console.log('timeBlocked', timeBlocked)

    //check
    if (!istimemsTZ(timeBlocked)) {
        return false //無封鎖時間, 代表未封鎖
    }

    //tn
    let tn = ot().format('YYYY-MM-DDTHH:mm:ss.SSSZ')

    return tn <= timeBlocked //現在時間<=封鎖時間, 代表封鎖中
}


function getIsEnded(v) {

    //timeEnd
    let timeEnd = get(v, 'timeEnd', '')
    // console.log('timeEnd', timeEnd)

    //check
    if (!istimemsTZ(timeEnd)) {
        return false //無到期時間, 代表未失效
    }

    //tn
    let tn = ot().format('YYYY-MM-DDTHH:mm:ss.SSSZ')

    return tn > timeEnd //現在時間>到期時間, 代表失效
}


function getIsAdmin(v) {

    //isAdmin
    let isAdmin = get(v, 'isAdmin', '')
    // console.log('isAdmin', isAdmin)

    return isAdmin === 'y'
}


function getIsActive(v) {

    //isActive
    let isActive = get(v, 'isActive', '')
    // console.log('isActive', isActive)

    return isActive === 'y'
}


function checkUserBasic(u) {
    //須保留, 供內外部調用
    let b1 = getIsVerified(u) //須已驗證
    let b2 = !getIsExpired(u) //不能過期
    let b3 = !getIsBlocked(u) //不能封鎖中
    let b4 = getIsActive(u) //須有效
    let b = b1 && b2 && b3 && b4
    return b
}


function checkUserAdmin(u) {
    //須保留, 供內外部調用
    let b1 = getIsVerified(u) //須已驗證
    let b2 = !getIsExpired(u) //不能過期
    let b3 = !getIsBlocked(u) //不能封鎖中
    let b4 = getIsAdmin(u) //須為系統管理員
    let b5 = getIsActive(u) //須有效
    let b = b1 && b2 && b3 && b4 && b5
    return b
}


export {
    getNameNew,
    getIsVerified,
    getIsExpired,
    getIsBlocked,
    getIsEnded,
    getIsAdmin,
    getIsActive,
    checkUserBasic,
    checkUserAdmin
}
