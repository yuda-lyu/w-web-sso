import axios from 'axios'
import get from 'lodash-es/get.js'
import size from 'lodash-es/size.js'
import isestr from 'wsemi/src/isestr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import ispm from 'wsemi/src/ispm.mjs'
import pmSeries from 'wsemi/src/pmSeries.mjs'


async function getUsersByToken(url, tokenSelf, opt = {}) {
    //url: http://localhost:11007/api/getSsoUsersList
    let errTemp = null

    //check
    if (!isestr(url)) {
        throw new Error('invalid url')
    }
    if (!isestr(tokenSelf)) {
        throw new Error('invalid tokenSelf')
    }

    //funConvertUser
    let funConvertUser = get(opt, 'funConvertUser')

    //url
    url = `${url}?token={sysToken}`
    url = url.replaceAll('{sysToken}', tokenSelf) //系統介接用ssoToken
    // console.log('getUsersByToken: url', url)

    //get
    let res = await axios.get(url)
        .catch((err) => {
            errTemp = err.toString()
        })

    //check
    if (errTemp !== null) {
        console.log('res', res)
        console.log('errTemp', errTemp)
        console.log(`can not get users by url[${url}]`)
        return Promise.reject(`can not get users by url[${url}]`) //由SSO取得使用者清單資訊錯誤
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
        console.log(`can not get users data by url[${url}]`)
        return Promise.reject(`can not get users data by url[${url}]`) //取得使用者清單資訊失敗
    }

    //us
    let us = msg
    // console.log('getUsersByToken us(msg)', us)

    //check
    if (size(us) === 0) {
        console.log(`no users data by url[${url}]`)
        return Promise.reject(`no users data by url[${url}]`)
    }

    //funConvertUser
    if (isfun(funConvertUser)) {
        us = await pmSeries(us, async(u) => {
            u = funConvertUser(u)
            if (ispm(u)) {
                u = await u
            }
            return u
        })
        // console.log('getUsersByToken us(funConvertUser)', us)
    }

    return us
}


export default getUsersByToken
