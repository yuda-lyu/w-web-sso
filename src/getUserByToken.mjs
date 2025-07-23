import axios from 'axios'
import get from 'lodash-es/get.js'
import isestr from 'wsemi/src/isestr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import ispm from 'wsemi/src/ispm.mjs'


async function getUserByToken(url, tokenSelf, tokenTar, opt = {}) {
    //url: http://localhost:11007/api/getSsoUserInfor
    let errTemp = null

    //check
    if (!isestr(url)) {
        throw new Error('invalid url')
    }
    if (!isestr(tokenSelf)) {
        throw new Error('invalid tokenSelf')
    }
    if (!isestr(tokenTar)) {
        throw new Error('invalid tokenTar')
    }

    //funConvertUser
    let funConvertUser = get(opt, 'funConvertUser')

    //url
    url = `${url}?token={sysToken}&key=token&value={token}`
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

    //funConvertUser
    if (isfun(funConvertUser)) {
        u = funConvertUser(u)
        if (ispm(u)) {
            u = await u
        }
        // console.log('getUserByToken u(funConvertUser)', u)
    }

    return u
}


export default getUserByToken
