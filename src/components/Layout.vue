<template>
    <div style="height:100vh; background:#f5f5f5;">

        <!-- menu top, 因窄版導致名稱換行故須使用overflow-y:hidden -->
        <div :style="`height:${heightToolbar}px; overflow-y:hidden; padding:0px 10px; background:#fff; border-bottom:1px solid #ccc; display:flex; align-items:center;`">

            <WButtonCircle
                :icon="'mdi-menu'"
                :tooltip="'左側選單'"
                :shadow="false"
                @click="drawer=!drawer"
                v-if="false"
            ></WButtonCircle>

            <div style="padding-left:5px; white-space:nowrap">
                <div style="display:flex; align-items:center;">

                    <div style="padding-right:10px; display:flex; align-items:center;" v-if="webLogo">
                        <img style="width:36px; height:36px;" :src="webLogo" />
                    </div>

                    <div>
                        <div style="font-size:1.2rem; color:#000;">{{webName}}</div>
                        <div style="font-size:0.8rem; color:#666;">{{$t('webDescription')}}</div>
                    </div>

                </div>
            </div>

            <div style="width:100%;"></div>

            <div style="padding-right:10px; white-space:nowrap">
                <WTextSelect
                    style="width:100px;"
                    :items="tgLangs"
                    v-model="tgLangSelect"
                    @input="changeLang"
                ></WTextSelect>
            </div>

        </div>

        <div :style="`height:calc( 100% - ${heightToolbar}px );`">
            <LayoutContent
            ></LayoutContent>
        </div>


    </div>
</template>

<script>
import { mdiMenu } from '@mdi/js/mdi.js'
import get from 'lodash-es/get.js'
// import cloneDeep from 'lodash-es/cloneDeep.js'
import isestr from 'wsemi/src/isestr.mjs'
import WTextSelect from 'w-component-vue/src/components/WTextSelect.vue'
import WButtonCircle from 'w-component-vue/src/components/WButtonCircle.vue'
import LayoutContent from './LayoutContent.vue'


export default {
    components: {
        WTextSelect,
        WButtonCircle,
        LayoutContent,
    },
    props: {
    },
    data: function() {
        return {

            mdiMenu,
            // drawer: null, //null false
            // menuKey: 'blocks',
            userName: 'tester',

            drawer: true, //null,

            tgLangs: [
                {
                    id: 'cht',
                    text: '中文',
                },
                {
                    id: 'eng',
                    text: 'English',
                },
            ],
            tgLangSelect: {
                id: 'cht',
                text: '中文',
            },

        }
    },
    beforeMount: function() {
        // console.log('beforeMount')

        let vo = this

        //setLang
        vo.$ui.setLang(vo.tgLangSelect.id)

    },
    computed: {

        viewState: function() {
            return get(this, `$store.state.viewState`, '')
        },

        heightToolbar: function() {
            //console.log('computed heightToolbar')

            let vo = this

            return get(vo, `$store.state.heightToolbar`, 0)
        },

        webName: {
            get() {
                let vo = this
                let c = vo.$t('webName')
                // console.log('get webName1', c)
                if (!isestr(c)) {
                    c = vo.$t('waitingData')
                }
                // console.log('get webName2', c)
                document.title = c //更換網頁title
                return c
            },
            // set(value) {
            //     return value
            // },
        },

        webLogo: function() {
            //console.log('computed webLogo')

            let vo = this

            return get(vo, `$store.state.webInfor.webLogo`, '')
        },

    },
    methods: {

        changeLang: function(msg) {
            // console.log('methods changeLang', msg)
            let vo = this
            let lang = msg.id
            vo.$ui.setLang(lang)
        },

    }
}
</script>

<style scoped>
</style>
