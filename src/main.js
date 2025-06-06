import Vue from 'vue'
import get from 'lodash-es/get.js'
import WServHapiClient from 'w-serv-hapi/src/WServHapiClient.mjs'
import WAlert from 'w-component-vue/src/components/WAlert.mjs'
import domMutation from 'w-component-vue/src/js/domMutation.mjs'
import domResize from 'w-component-vue/src/js/domResize.mjs'
import domDragDrop from 'w-component-vue/src/js/domDragDrop.mjs'
import App from './App.vue'
import store from './store/index.mjs'
import ui from './plugins/mUI.mjs'
import mDataSelectorSchema from './plugins/mDataSelectorSchema.mjs'
// import mDataSupport from './plugins/mDataSupport.mjs'
import * as s from './plugins/mShare.mjs'
import ds from './schema/index.mjs'
// console.log('ds', ds)


//不提示vue產品
Vue.config.productionTip = false

//$alert
Vue.prototype.$alert = function() {
    let [msg, type] = arguments
    console.log(msg, type)
    if (msg !== 'close') {
        WAlert(msg, type)
    }
}

//dssm
let dssm = mDataSelectorSchema(ds)

// //dspt
// let dspt = mDataSupport(Vue.prototype)

//prototype
Vue.prototype.$ui = ui
Vue.prototype.$t = ui.getKpText
Vue.prototype.$s = s
Vue.prototype.$dssm = dssm
// Vue.prototype.$dspt = dspt
Vue.prototype.$ds = ds
Vue.prototype.$dg = {}

//directive
Vue.directive('domresize', domResize())
Vue.directive('dommutation', domMutation())
Vue.directive('domdragdrop', domDragDrop())

//WServHapiClient
// let bFirstSync = false
WServHapiClient({
    showLog: false,
    url: window.location.origin + window.location.pathname,
    useWaitToken: false,
    apiName: 'api',
    getToken: () => {
        let token = get(Vue.prototype, `$store.state.userToken`, '')
        // console.log('getToken', token)
        return token
    },
    getServerMethods: (_fapi) => {
        // console.log('$fapi', _fapi)

        //save $fapi
        Vue.prototype.$fapi = _fapi

        //getWebInfor
        _fapi.getWebInfor() //已有fapi時優先取得web資訊
            .then((wi) => {
                // console.log('$fapi getWebInfor', wi)
                Vue.prototype.$store.commit(Vue.prototype.$store.types.UpdateWebInfor, wi)
                ui.setLang(null, 'get webInfor') //因更新webInfor可取得webName與webDescription, 得要重刷語系才能依照語言取得顯示文字
            })
            .catch((err) => {
                console.log(err)
            })

        //commit syncState
        Vue.prototype.$store.commit(Vue.prototype.$store.types.UpdateSyncState, true)

    },
    recvData: (r) => {
        // console.log('sync data', r.tableName, r.data)
        Vue.prototype.$store.commit(Vue.prototype.$store.types.UpdateTableData, r)
    },
    // getAfterUpdateTableTags: (r) => {
    //     // console.log('getAfterUpdateTableTags', r, 'needToRefresh', JSON.stringify(r.oldTableTags) !== JSON.stringify(r.newTableTags))
    //     if (bFirstSync) {
    //         return
    //     }
    //     bFirstSync = true
    //     // console.log('first-sync')
    //     Vue.prototype.$store.commit(Vue.prototype.$store.types.UpdateSyncState, true)
    // },
})

//new
new Vue({
    store,
    render: h => h(App)
}).$mount('#app')

