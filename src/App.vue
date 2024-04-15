<template>
    <div
        v-domresize
        @domresize="resize"
    >

        <!-- <LayoutState :style="`opacity:${ready?0:1};`" v-if="!ready"></LayoutState> -->
        <PageLogin v-if="!ready"></PageLogin>

        <transition enter-active-class="fade-enter-active" leave-active-class="fade-leave-active">
            <Layout v-if="ready"></Layout>
        </transition>

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
import isDev from 'wsemi/src/isDev.mjs'
import wui from 'w-ui-loginout/src/WUiLoginout.mjs'
import LoadingWinBar from './components/Common/LoadingWinBar.vue'
import CheckYesNo from './components/Common/CheckYesNo.vue'
import CheckYes from './components/Common/CheckYes.vue'
// import LayoutState from './components/LayoutState.vue'
import PageLogin from './components/PageLogin.vue'
import Layout from './components/Layout.vue'
// import VeUser from './components/VeUser.vue'


export default {
    components: {
        LoadingWinBar,
        CheckYesNo,
        CheckYes,
        // LayoutState,
        PageLogin,
        Layout,
        // VeUser,
    },
    data: function() {
        return {

        }
    },
    beforeMount: function() {
        // console.log('methods beforeMount')

        let vo = this

        //setVo, 更換ui內vo, 才能使用廣播技術, 更換語系才能用廣播通知全部組件forceUpdate
        vo.$ui.setVo(vo)

    },
    computed: {

        ready: function() {
            // let connState = get(this, `$store.state.connState`)
            // return connState === '已連線'
            return false
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

.fade-enter-active {
  animation: go 1s;
}

.fade-leave-active {
  animation: back 1s;
}

@keyframes go {
  from { opacity: 0; }
  to {opacity: 1;}
}

@keyframes back {
  from { opacity: 1; }
  to { opacity: 0; }
}

</style>
