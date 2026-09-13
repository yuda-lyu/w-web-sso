import get from 'lodash-es/get.js'
import isestr from 'wsemi/src/isestr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import ispm from 'wsemi/src/ispm.mjs'
import httpGetJson from './httpGetJson.mjs'


async function getUserByUserId(url, tokenSelf, userIdTar, opt = {}) {
    //供外部系統直接調用
    //url: http://localhost:11007/api/getSsoUserInfor?token={sysToken}&key=id&value={userId} (後端查詢鍵為 id, 非 userId)
    let errTemp = null

    //check
    if (!isestr(url)) {
        return Promise.reject('invalid url')
    }
    if (!isestr(tokenSelf)) {
        return Promise.reject('invalid tokenSelf')
    }
    if (!isestr(userIdTar)) {
        return Promise.reject('invalid userIdTar')
    }

    //funConvertUser
    let funConvertUser = get(opt, 'funConvertUser')

    //url
    if (url.indexOf('token={sysToken}') < 0 || url.indexOf('key=id') < 0 || url.indexOf('value={userId}') < 0) { //三者缺一即拒 (原以 && 串接, 只在三者全缺時才拒, 與訊息不符)
        return Promise.reject(`no 'token={sysToken}', 'key=id', 'value={userId}' in url`)
    }
    url = url.replaceAll('{sysToken}', tokenSelf) //系統介接用ssoToken
    url = url.replaceAll('{userId}', userIdTar)
    // console.log('getUserByUserId: url', url)

    //get, 內建fetch(語意比照axios.get, 見httpGetJson)
    let res = await httpGetJson(url)
        .catch((err) => {
            errTemp = err.toString()
        })

    //check
    if (errTemp !== null) {
        console.log('res', res)
        console.log('errTemp', errTemp)
        console.log(`can not get user by url[${url}]`)
        return Promise.reject(`can not get user by url[${url}]`) //由SSO取得使用者資訊錯誤
    }

    //data
    let data = get(res, 'data')

    //state
    let state = get(data, 'state', '')

    //msg
    let msg = get(data, 'msg')

    //check
    if (state !== 'success') {
        console.log('res', res)
        console.log('data', data)
        console.log('state', state)
        console.log('errTemp', msg)
        console.log(`can not get user data by url[${url}]`)
        return Promise.reject(`can not get user data by url[${url}]`) //取得使用者資訊失敗
    }

    //u
    let u = msg
    // console.log('getUserByUserId u(msg)', u)

    //check
    if (!iseobj(u)) {
        console.log(`no user data by url[${url}]`)
        return Promise.reject(`no user data by url[${url}]`)
    }

    //check
    if (isfun(funConvertUser)) {

        //funConvertUser
        u = funConvertUser(u)
        if (ispm(u)) {
            u = await u
        }
        // console.log('getUserByUserId u(funConvertUser)', u)

        //check
        if (!iseobj(u)) {
            console.log(`no user data after funConvertUser`)
            return Promise.reject(`no user data after funConvertUser`)
        }

    }

    return u
}


export default getUserByUserId
