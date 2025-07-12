import Vue from 'vue'
import min from 'lodash-es/min.js'
import size from 'lodash-es/size.js'
import take from 'lodash-es/take.js'
import isEqual from 'lodash-es/isEqual.js'
import uniq from 'lodash-es/uniq.js'
import set from 'lodash-es/set.js'
import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import map from 'lodash-es/map.js'
import filter from 'lodash-es/filter.js'
import last from 'lodash-es/last.js'
import split from 'lodash-es/split.js'
import join from 'lodash-es/join.js'
import drop from 'lodash-es/drop.js'
import dropRight from 'lodash-es/dropRight.js'
import groupBy from 'lodash-es/groupBy.js'
import sortBy from 'lodash-es/sortBy.js'
import cloneDeep from 'lodash-es/cloneDeep.js'
import cint from 'wsemi/src/cint.mjs'
import delay from 'wsemi/src/delay.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isearr from 'wsemi/src/isearr.mjs'
import isEle from 'wsemi/src/isEle.mjs'
import strleft from 'wsemi/src/strleft.mjs'
import strdelleft from 'wsemi/src/strdelleft.mjs'
import sep from 'wsemi/src/sep.mjs'
import aes2str from 'wsemi/src/aes2str.mjs'
import str2aes from 'wsemi/src/str2aes.mjs'
import haskey from 'wsemi/src/haskey.mjs'
import genPm from 'wsemi/src/genPm.mjs'
import pmSeries from 'wsemi/src/pmSeries.mjs'
import waitFun from 'wsemi/src/waitFun.mjs'
import browserView from 'wsemi/src/browserView.mjs'
import arrHas from 'wsemi/src/arrHas.mjs'
import arrSort from 'wsemi/src/arrSort.mjs'
import arrInsert from 'wsemi/src/arrInsert.mjs'
import replace from 'wsemi/src/replace.mjs'
import timemsTZ2past from 'wsemi/src/timemsTZ2past.mjs'
import convertToTree from 'wsemi/src/convertToTree.mjs'
// import WUiDwload from 'w-ui-dwload/src/WUiDwload.mjs'
import kpLang from './mLang.mjs'


let vo = Vue.prototype


function setVo(vObj) {
    vo = vObj
}


// function updateConnState(connState) {
//     vo.$store.commit(vo.$store.types.UpdateConnState, connState)
// }


function updateLoading(loading) {
    vo.$store.commit(vo.$store.types.UpdateLoading, loading)
}


function updateViewState(viewState) {
    vo.$store.commit(vo.$store.types.UpdateViewState, viewState)
}


function updateUserToken(userToken) {
    vo.$store.commit(vo.$store.types.UpdateUserToken, userToken)
}


function updateUserSelf(userSelf) {
    vo.$store.commit(vo.$store.types.UpdateUserSelf, userSelf)
}


function forceUpdate() {
    // console.log('call forceUpdate')

    function broadcast(chs) {
        each(chs, (v) => {
            // console.log(v.$el)
            v.$forceUpdate()
            if (v.$children) {
                broadcast(v.$children)
            }
        })
    }

    //broadcast, 注意此處需使用更換ui內vo為mounted後的vo, 也就是含元素, 才能使用廣播技術
    broadcast(vo.$children)

}


function validLang(lang) {
    if (lang !== 'eng' && lang !== 'cht') {
        // console.log(`invalid lang[${lang}]`)
        lang = 'eng'
    }
    return lang
}


function getLang() {
    let lang = ''

    //from window
    if (!isestr(lang)) {
        let _lang = get(window, '___pmwsso___.language', '')
        // console.log('_lang(from window)', _lang)
        if (isestr(_lang)) {
            lang = validLang(_lang) //有可能取到未取代前模板符號
        }
    }

    //from store
    if (!isestr(lang)) {
        let _lang = get(vo, '$store.state.lang', '')
        // console.log('_lang(from store)', _lang)
        if (isestr(_lang)) {
            lang = validLang(_lang) //有可能給予非預期lang
        }
    }

    //return
    if (!isestr(lang)) {
        return 'eng'
    }
    return lang
}


function setLang(lang = null, from = '') {
    // console.log('setLang', lang, from)

    //check
    if (!isestr(lang)) {
        lang = getLang()
    }
    else {
        lang = validLang(lang)
    }
    // console.log('get lang', lang)

    //check, 若有變更才commit
    if (true) {
        let _lang = get(vo, '$store.state.lang', '')
        if (lang !== _lang) {
            vo.$store.commit(vo.$store.types.UpdateLang, lang)
            // console.log('commit lang', lang)
        }
    }

    //genKpText, 切換lang得調用getKpLang重算kpText
    genKpText(lang)

    //forceUpdate
    forceUpdate()

}


function genKpText(lang) {
    // console.log('genKpText', lang)

    //kp
    let kp = {}

    //kpLang
    kp = {
        ...kp,
        ...kpLang,
    }

    //kpLangExt
    let kpLangExt = get(vo, '$store.state.webInfor.kpLangExt', {})
    // console.log('kpLangExt', kpLangExt)
    if (iseobj(kpLangExt)) {
        kp = {
            ...kp,
            ...kpLangExt,
        }
    }

    //webName
    let webName = get(vo, '$store.state.webInfor.webName', {})
    // console.log('webName', webName)
    if (iseobj(webName)) {
        kp = {
            ...kp,
            webName: {
                ...webName,
            },
        }
    }

    //webDescription
    let webDescription = get(vo, '$store.state.webInfor.webDescription', {})
    // console.log('webDescription', webDescription)
    if (iseobj(webDescription)) {
        kp = {
            ...kp,
            webDescription: {
                ...webDescription,
            },
        }
    }

    //kpText
    let kpText = {}
    each(kp, (v, k) => {
        kpText[k] = v[lang]
    })
    // console.log('kp', kp)
    // console.log('kpText', kpText)

    //commit
    vo.$store.commit(vo.$store.types.UpdateKpText, kpText)
    // console.log('commit kpText', kpText)

}


function getKpText(key) {
    // console.log('getKpText', key)

    //kpText
    let kpText = get(vo, '$store.state.kpText')
    // console.log('kpText', cloneDeep(kpText))

    //t
    let t = get(kpText, key, '')
    if (!isestr(t)) {
        t = key
    }

    return t
}


function gv(o, k, cv = null) {
    let r = get(o, k, '')
    if (!isestr(r)) {
        let def = getKpText('empty')
        return def
    }
    if (isfun(cv)) {
        r = cv(r)
    }
    return r
}


function syncHeight() {

    //heightToolbar
    let heightToolbar = get(vo, '$store.state.heightToolbar')

    //heightAppEff
    let heightAppEff = window.innerHeight - heightToolbar

    //commit
    // vo.$store.commit(vo.$store.types.UpdateHeightToolbar, heightToolbar)
    vo.$store.commit(vo.$store.types.UpdateHeightApp, window.innerHeight)
    vo.$store.commit(vo.$store.types.UpdateHeightAppEff, heightAppEff)

    return ''
}


// async function waitData(t = 0) {

//     //delay
//     if (t > 0) {
//         await delay(t)
//     }

//     // //waitFun, 等待dsrl模組掛載
//     // await waitFun(() => {
//     //     return iseobj(get(vo, '$dsrl'))
//     // })

//     //等待前端第一次同步完畢數據
//     await waitFun(() => {
//         return get(vo, '$store.state.syncState')
//     })

// }


function parseUrlParams() {

    //kp
    let kp = {}
    try {

        //ulps
        let ulps = new URLSearchParams(window.location.search)
        // console.log('ulps', ulps, window.location.search, window.location.href)

        //forEach
        ulps.forEach((v, k) => {
            // console.log(k, v)
            kp[k] = v
        })

    }
    catch (err) {
        console.log('err', err)
    }
    // console.log('kp', kp)

    return kp
}


function getUrlView() {

    //parseUrlParams
    let kp = parseUrlParams()
    // console.log('kp', kp)
    //http://localhost:8080/?view=backstage => {view: 'backstage'}

    //view
    let view = get(kp, 'view', '')
    if (view === '') {
        view = 'login'
    }
    if (view !== 'login' && view !== 'backstage') {
        console.log(`invalid view[${view}]`)
        view = 'login'
    }
    // console.log('view', view)

    return view
}


function goUrl(url, token) {

    //replace
    url = url.replaceAll('{token}', token)

    //href
    // if (isDev()) {
    //     console.log('10s後重導至:', url)
    //     setTimeout(() => {
    //         window.location.href = url
    //     }, 10 * 1000)
    // }
    // else {
    //     window.location.href = url
    // }
    window.location.href = url

}


function login(account, password, opt = {}) {

    //login測試
    //http://localhost:8080/ => 登入後轉至指定頁
    //http://localhost:8080/?token=sys => 網址給予token但不使用, 登入後轉至指定頁
    //http://localhost:8080/?view=backstage => 登入後轉至後台
    //http://localhost:8080/?view=backstage&token=sys => 網址給予token但不使用, 登入後轉至後台

    //useRedir
    let useRedir = get(opt, 'useRedir', false)
    // console.log('useRedir', useRedir)

    //pm
    let pm = genPm()

    async function core() {

        //show loading
        updateLoading(true)

        //delay
        await delay(1000)

        //$keyLS
        let $keyLS = get(vo, '$store.state.webInfor.webKey', '')

        //check
        if (!isestr($keyLS)) {

            //alert
            vo.$alert(vo.$t('failedLoginForNoWebKey'), { type: 'error' })

            //reject
            pm.reject('invalid $keyLS')

            return
        }

        //loginByAccountAndPassword
        let u = await vo.$fapi.loginByAccountAndPassword(account, password)
        // console.log('u', u)

        //key
        let key = `${$keyLS}:userToken`
        // console.log('key', key)

        //setItem, 須先清空token
        await localStorage.setItem(key, '')

        //check
        if (!iseobj(u)) {
            // console.log('invalid user')

            //reject
            pm.reject('invalid user')

            return
        }

        //token
        let token = get(u, 'token', '')
        // console.log('token', token)

        //check
        if (!isestr(token)) {

            //alert
            vo.$alert(vo.$t('failedLoginForNoToken'), { type: 'error' })

            //reject
            pm.reject('invalid token')

            return
        }

        //setItem
        await localStorage.setItem(key, token)

        //update token and user
        updateUserToken(token)
        updateUserSelf(u)

        //useRedir
        if (useRedir) {

            //redir
            let redir = get(u, 'redir', '')
            // console.log('redir', redir)

            //check
            if (!isestr(redir)) {

                //alert
                vo.$alert(vo.$t('failedLoginForNoRedir'), { type: 'error' })

                //reject
                pm.reject('invalid redir')

                return
            }

            //goUrl
            goUrl(redir, token)
            // console.log('goUrl', redir, 'token', token)

            //resolve
            pm.resolve('redir')

            // //hide loading, 登入成功不能先隱藏loading, 開始轉址到轉跳會有一段時間, 持續顯示loading不隱藏, 避免使用者誤會登入失敗
            // updateLoading(false)

            return
        }

        //hide loading, 登入成功後且非轉址時隱藏loading
        updateLoading(false)

        //resolve
        pm.resolve('done')

    }

    //core
    core()
        .catch((err) => {
            // console.log('login', err)

            //alert
            vo.$alert(vo.$t('failedLoginForCatch'), { type: 'error' })

            //reject
            pm.reject(err)

            //hide loading, 登入失敗後隱藏loading
            updateLoading(false)

        })

    return pm
}


function autoLogin(opt = {}) {

    //autoLogin測試
    //http://localhost:8080/ => 無token須轉至登入頁
    //http://localhost:8080/?token=sys => 雖網址有token但cache無token, 須轉至登入頁
    //http://localhost:8080/?view=backstage => 無token須轉至登入頁
    //http://localhost:8080/?view=backstage&token=sys => 雖網址有token但cache無token, 須轉至登入頁
    //http://localhost:8080/, with cache token => 有cache內token可至指定頁
    //http://localhost:8080/?view=backstage, with cache token => 有cache內token可至後台
    //http://localhost:8080/?view=backstage&token=sys, with cache token => 雖網址有token但須以cache內token為主, 有cache內token可至後台

    //useRedir
    let useRedir = get(opt, 'useRedir', false)
    // console.log('useRedir', useRedir)

    //pm
    let pm = genPm()

    async function core() {
        let errTemp = null

        //waitFun, 因須使用webKey故須等待syncState
        // console.log('wait syncState...')
        await waitFun(() => {
            return get(vo, '$store.state.syncState', false)
        })
        // console.log('wait syncState done', vo.syncState)

        //$keyLS
        let $keyLS = get(vo, '$store.state.webInfor.webKey', '')
        // console.log('$keyLS', $keyLS)

        //check
        if (!isestr($keyLS)) {
            // console.log('invalid $keyLS')

            //alert
            vo.$alert(vo.$t('failedLoginForNoWebKey'), { type: 'error' })

            //reject
            pm.reject('invalid $keyLS')

            return
        }

        //key
        let key = `${$keyLS}:userToken`
        // console.log('key', key)

        //getItem
        let token = await localStorage.getItem(key)
        // console.log('token', token)

        //check
        if (!isestr(token)) {
            // console.log('invalid token')

            //reject
            pm.reject('invalid token')

            return
        }

        //checkToken
        await vo.$fapi.checkToken(token) //斷線有重試機制, resolve僅回傳true, reject代表無效token或檢測token發生錯誤
            .catch((err) => {
                // console.log('checkToken catch', err)
                errTemp = err
            })

        //check
        if (errTemp) {

            //setItem, 清空token
            await localStorage.setItem(key, '')

            //reject
            pm.reject('token error')

            return
        }

        //getUserByToken
        let u = await vo.$fapi.getUserByToken(token)
        // console.log('getUserByToken u', u)

        //check
        if (!iseobj(u)) {
            // console.log('invalid user')

            //reject
            pm.reject('invalid user')

            return
        }

        //update token and user
        updateUserToken(token)
        updateUserSelf(u)

        //useRedir
        if (useRedir) {

            //redir
            let redir = get(u, 'redir', '')
            // console.log('redir', redir)

            //check
            if (!isestr(redir)) {
                // console.log('invalid redir')

                //alert
                vo.$alert(vo.$t('failedLoginForNoRedir'), { type: 'error' })

                //reject
                pm.reject('invalid redir')

                return
            }

            //goUrl
            goUrl(redir, token)
            // console.log('goUrl', redir, 'token', token)

            //resolve
            pm.resolve('redir')

            return
        }

        //resolve
        pm.resolve('done')

    }

    //core
    core()
        .catch((err) => {
            // console.log('autoLogin', err)

            //alert
            vo.$alert(vo.$t('failedLoginForCatch'), { type: 'error' })

            //reject
            pm.reject(err)

        })

    return pm
}


function logout() {

    //pm
    let pm = genPm()

    async function core() {

        //$keyLS
        let $keyLS = get(vo, '$store.state.webInfor.webKey', '')

        //check
        if (!isestr($keyLS)) {

            //alert
            vo.$alert(vo.$t('failedLogoutForNoWebKey'), { type: 'error' })

            return Promise.reject(`invalid $keyLS`)
        }

        //key
        let key = `${$keyLS}:userToken`
        // console.log('key', key)

        //getItem
        let token = await localStorage.getItem(key)
        // console.log('token', token)

        //logoutByToken
        await vo.$fapi.logoutByToken(token)
            .catch(() => {}) //屏蔽伺服器端logout失敗訊息, 避免斷線時無限報錯

        //setItem, 清空token
        await localStorage.setItem(key, '')

    }

    //core
    core()
        .then(() => {

            //resolve
            pm.resolve('done')

        })
        .catch((err) => {
            // console.log('logout', err)

            //alert
            vo.$alert(vo.$t('failedLogoutForCatch'), { type: 'error' })

            //reject
            pm.reject(err)

        })

    return pm
}


let kpIcon = {
    warning: `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACQAAAAhCAYAAACxzQkrAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAOwwAADsMBx2+oZAAAABZ0RVh0Q3JlYXRpb24gVGltZQAwOS8xOS8yNP52YhIAAAAcdEVYdFNvZnR3YXJlAEFkb2JlIEZpcmV3b3JrcyBDUzbovLKMAAADMklEQVRYha2WTWgTQRiGn0k2SU2KNQjmoiL+gGAVD/5gEelAkSKOiILei+hBRAQv/tBDsQiK1CJFDz331tNePAjRm60eBL0pXsSDF+dimmzbZDzsRJNmm+xPXliyOzP7zrNfvpn5hDGGJNJSHQJmAQHcLpbdL0n8RBIgLdVhYBHYb5u+AZeLZfdzXM9UbBpfC8AB/OgIe7+QxDA2kJZqAhgO6Bq2fbEU6y/TUuWB70BpkyG/gL3FsrsS1TtuhO53gcH23Y9jHDlCWqqd+Mmb6zHUA/YVy+7PKP5xIvQkBAx2zNOo5pEipKU6Bnzo6Kg3/N904PcdL5bdj2HniBqh2bYnITDVGmQcyDj+vRDd3+kXkJbqEjDS2mYqK2THTjO0MMfQwhzZsdOYSsfCGrHv9g9IS+UAz9oajUFkHPITV0mVSqRKJfITVxAZBzrT4Jn16A8QcBvY0w4EZDL+/mw8/xIpv60zLfdYj+RAWqrtwGRgpzHQaJm90QiKTlOT1isZEPAI2BpiXC9ttV5d1RVIS3UQuN4HmKZuWM94QMBMiDFRJKznptp0Mi3VGDDeR5imxq13eCB95iz0+JKEmtFj58IDkc5dI7jWaZcQ7cdFOhW0UwdpmHr6WiggLVUBmO4NA6bmYSpVEIMgBjGVKqbm+ZnSW9N2ru5AwANgR28gf9bKzDxry+9ZW35PZWa+ra+Hdti52m1bT3st1S7gK+HKi/+Ha73uP6fTiC0D3TbHjfKAA8Wy+6PZsDFCT0PDAGAQ2Qys12G97t8HnBtd1FEz/YuQluoEsBTFjXoDnDQ5u4o9940PF1wXddPJYtldBmg9gZ9HdTG1GoMPb5G9cBEAZ+9u/ky/QBTyUa2eY0ubFICWSgGnotEYxEAO59gRoAJUcI4fQQzkouRQU6csAykt1TZgKqqDn9Aeq6/fAQWgwOrrt5iqF3aVbdSUlmpI/B49vwiErujaZAxmbZ3syaMArC598gu0eEAAi+L36PkakVZWANRKFQCR35IEBqCaAl4mcUAIRCHvJ3IyGIBXjhHcEYYGcJMkkUomD5gziLut+9Bj4DKQJeLulkACWAUWi2X3HsBfLU4ARuGaUEMAAAAASUVORK5CYII=`,
}
function getIcon(icon) {
    let c = get(kpIcon, icon, '')
    if (!isestr(c)) {
        console.log(`invalid icon[${icon}]`)
    }
    return c
}


let mUI = {

    setVo,

    // updateConnState,
    updateLoading,
    updateViewState,
    updateUserToken,
    updateUserSelf,
    forceUpdate,

    setLang,
    getKpText,

    gv,
    syncHeight,

    // waitData,

    parseUrlParams,
    getUrlView,
    goUrl,

    login,
    autoLogin,
    logout,

    getIcon,

}


export default mUI
