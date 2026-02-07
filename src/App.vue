<template>
    <div
        v-domresize
        @domresize="resize"
    >

        <template v-if="!autoLogining">

            <PageLogin v-if="viewState==='login'"></PageLogin>

            <Layout v-if="viewState==='backstage'"></Layout>

            <PageUser v-if="viewState==='user'"></PageUser>



        </template>

        <div
            style="position:absolute; top:0px; left:0px; width:100%; height:100%; display:flex; align-items:center; justify-content:center;"
            v-else
        >
            <svg xmlns="http://www.w3.org/2000/svg" width="30px" height="30px" viewBox="0 0 24 24"><rect width="9" height="9" x="1.5" y="1.5" fill="currentColor" rx="1"><animate id="svgSpinnersBlocksScale0" attributeName="x" begin="0;svgSpinnersBlocksScale1.end+0.15s" dur="0.6s" keyTimes="0;.2;1" values="1.5;.5;1.5"/><animate attributeName="y" begin="0;svgSpinnersBlocksScale1.end+0.15s" dur="0.6s" keyTimes="0;.2;1" values="1.5;.5;1.5"/><animate attributeName="width" begin="0;svgSpinnersBlocksScale1.end+0.15s" dur="0.6s" keyTimes="0;.2;1" values="9;11;9"/><animate attributeName="height" begin="0;svgSpinnersBlocksScale1.end+0.15s" dur="0.6s" keyTimes="0;.2;1" values="9;11;9"/></rect><rect width="9" height="9" x="13.5" y="1.5" fill="currentColor" rx="1"><animate attributeName="x" begin="svgSpinnersBlocksScale0.begin+0.15s" dur="0.6s" keyTimes="0;.2;1" values="13.5;12.5;13.5"/><animate attributeName="y" begin="svgSpinnersBlocksScale0.begin+0.15s" dur="0.6s" keyTimes="0;.2;1" values="1.5;.5;1.5"/><animate attributeName="width" begin="svgSpinnersBlocksScale0.begin+0.15s" dur="0.6s" keyTimes="0;.2;1" values="9;11;9"/><animate attributeName="height" begin="svgSpinnersBlocksScale0.begin+0.15s" dur="0.6s" keyTimes="0;.2;1" values="9;11;9"/></rect><rect width="9" height="9" x="13.5" y="13.5" fill="currentColor" rx="1"><animate attributeName="x" begin="svgSpinnersBlocksScale0.begin+0.3s" dur="0.6s" keyTimes="0;.2;1" values="13.5;12.5;13.5"/><animate attributeName="y" begin="svgSpinnersBlocksScale0.begin+0.3s" dur="0.6s" keyTimes="0;.2;1" values="13.5;12.5;13.5"/><animate attributeName="width" begin="svgSpinnersBlocksScale0.begin+0.3s" dur="0.6s" keyTimes="0;.2;1" values="9;11;9"/><animate attributeName="height" begin="svgSpinnersBlocksScale0.begin+0.3s" dur="0.6s" keyTimes="0;.2;1" values="9;11;9"/></rect><rect width="9" height="9" x="1.5" y="13.5" fill="currentColor" rx="1"><animate id="svgSpinnersBlocksScale1" attributeName="x" begin="svgSpinnersBlocksScale0.begin+0.45s" dur="0.6s" keyTimes="0;.2;1" values="1.5;.5;1.5"/><animate attributeName="y" begin="svgSpinnersBlocksScale0.begin+0.45s" dur="0.6s" keyTimes="0;.2;1" values="13.5;12.5;13.5"/><animate attributeName="width" begin="svgSpinnersBlocksScale0.begin+0.45s" dur="0.6s" keyTimes="0;.2;1" values="9;11;9"/><animate attributeName="height" begin="svgSpinnersBlocksScale0.begin+0.45s" dur="0.6s" keyTimes="0;.2;1" values="9;11;9"/></rect></svg>
        </div>

        <LoadingWinBar></LoadingWinBar>
        <CheckYesNo></CheckYesNo>
        <CheckYes></CheckYes>

        <!-- <VeUser></VeUser> -->

    </div>
</template>

<script>
import get from 'lodash-es/get.js'
import cloneDeep from 'lodash-es/cloneDeep.js'
import isestr from 'wsemi/src/isestr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isDev from 'wsemi/src/isDev.mjs'
import waitFun from 'wsemi/src/waitFun.mjs'
import LoadingWinBar from './components/Common/LoadingWinBar.vue'
import CheckYesNo from './components/Common/CheckYesNo.vue'
import CheckYes from './components/Common/CheckYes.vue'
// import LayoutState from './components/LayoutState.vue'
import PageLogin from './components/PageLogin.vue'
import Layout from './components/Layout.vue'
import PageUser from './components/PageUser.vue'

// import VeUser from './components/VeUser.vue'


export default {
    components: {
        LoadingWinBar,
        CheckYesNo,
        CheckYes,
        // LayoutState,
        PageLogin,
        Layout,
        PageUser,

        // VeUser,
    },
    data: function() {
        return {

            autoLogining: true,

        }
    },
    beforeMount: function() {
        // console.log('beforeMount')

        let vo = this

        //setVo, 更換ui內vo, 才能使用廣播技術, 更換語系才能用廣播通知全部組件forceUpdate
        vo.$ui.setVo(vo)

        //setLang
        let lang = get(window, '___pmwsso___.language', '')
        vo.$ui.setLang(lang, 'app init') //初始化先讀取html內語系設定進行變更
        // console.log('lang', lang)

    },
    mounted: function() {
        // console.log('mounted')

        let vo = this

        //set, 把目前vo儲存至window供外部非vue環境使用
        window.$vo = vo

        //autoLogin
        if (vo.autoLogining) {

            //view
            let view = vo.$ui.getUrlView()
            // console.log('view', view)



            //autoLogin
            vo.$ui.autoLogin({ useRedir: view === 'login' })
                .then(() => {

                    //提交變更viewState前往指定功能頁
                    vo.$ui.updateViewState(view)
                    vo.autoLogining = false
                    console.log(`autoLogin, goto view[${view}] page`)

                })
                .catch((err) => {

                    //錯誤發生時提交變更viewState返回登入頁
                    vo.$ui.updateViewState('login')
                    vo.autoLogining = false
                    console.log(`autoLogin err[${err}], goto view['login'] page`)

                })
        }

    },
    computed: {

        syncState: function() {
            let vo = this
            return get(vo, '$store.state.syncState')
        },

        viewState: function() {
            let vo = this
            return get(vo, '$store.state.viewState', '')
        },

        webKey: function() {
            let vo = this
            return get(vo, '$store.state.webInfor.webKey', '')
        },

    },
    methods: {

        resize: function(msg) {
            // console.log('methods resize', msg)

            let vo = this

            //syncHeight
            vo.$ui.syncHeight()

        },

    },
}
</script>

<style>
html,
body {
    font-family: '微軟正黑體', 'Microsoft JhengHei', 'MicrosoftJhengHeiRegular', 'Avenir', Helvetica, Arial, sans-serif;
    overflow-y: hidden;
}

div,
p,
span,
a,
pre,
input,
textarea,
button {
    font-family: inherit;
}

</style>
