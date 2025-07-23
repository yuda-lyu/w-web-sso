import axios from 'axios'
import get from 'lodash-es/get.js'
import isestr from 'wsemi/src/isestr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import ispm from 'wsemi/src/ispm.mjs'


async function getUserByToken(url, tokenSelf, tokenTar, opt = {}) {
    //url: http://localhost:11007/api/getSsoUserInfor?token={sysToken}&key=token&value={token}
    let errTemp = null

    //check
    if (!isestr(url)) {
        return Promise.reject('invalid url')
    }
    if (!isestr(tokenSelf)) {
        return Promise.reject('invalid tokenSelf')
    }
    if (!isestr(tokenTar)) {
        return Promise.reject('invalid tokenTar')
    }

    //funConvertUser
    let funConvertUser = get(opt, 'funConvertUser')

    //url
    if (url.indexOf('token={sysToken}') < 0 && url.indexOf('key=token') < 0 && url.indexOf('value={token}') < 0) {
        return Promise.reject(`no 'token={sysToken}', 'key=token', 'value={token}' in url`)
    }
    url = url.replaceAll('{sysToken}', tokenSelf) //系統介接用ssoToken
    url = url.replaceAll('{token}', tokenTar)
    // console.log('getUserByToken: url', url)

    //get
    let res = await axios.get(url)
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
    // console.log('getUserByToken u(msg)', u)

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
        // console.log('getUserByToken u(funConvertUser)', u)

        //check
        if (!iseobj(u)) {
            console.log(`no user data after funConvertUser`)
            return Promise.reject(`no user data after funConvertUser`)
        }

    }

    return u
}


export default getUserByToken
