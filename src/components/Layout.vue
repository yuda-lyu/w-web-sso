<template>
    <div style="height:100svh; background:#f5f5f5;">

        <!-- menu top, 因窄版導致名稱換行故須使用overflow-y:hidden -->
        <div :style="`height:${heightToolbar}px; overflow-y:hidden; padding:0px 10px; background:#fff; border-bottom:1px solid #ccc; display:flex; align-items:center;`">

            <div style="padding-left:5px;">
                <div style="display:flex; align-items:center;">

                    <div
                        style="padding-right:10px; display:flex; align-items:center;"
                        v-if="webLogo"
                    >
                        <!-- 因chrome渲染機制變更須添加min-width避免被壓縮至無寬度 -->
                        <img style="width:36px; min-width:36px; height:36px;" :src="webLogo" />
                    </div>

                    <div style="white-space:nowrap;">
                        <div style="font-size:1.2rem; color:#000;">{{webName}}</div>
                        <div style="font-size:0.8rem; color:#666;">{{$t('webDescription')}}</div>
                    </div>

                </div>
            </div>

            <div style="width:100%;"></div>

            <div
                style="padding-right:10px; white-space:nowrap;"
                v-if="showLangSelect"
            >
                <WTextSelect
                    style="width:100px;"
                    :items="keysLang"
                    :value="lang"
                    @input="toggleLang"
                >
                    <template v-slot:select="props">
                        {{getLangText(props.item)}}
                    </template>
                    <template v-slot:item="props">
                        {{getLangText(props.item)}}
                    </template>
                </WTextSelect>
            </div>

            <div style="padding-right:10px; display:flex; align-items:center;">

                <WPopup
                    :isolated="true"
                    _show=""
                    _hide=""
                >
                    <template v-slot:trigger>

                        <div style="display:flex; align-items:center; white-space:nowrap; user-select:none; cursor:pointer;">
                            <div style="padding-top:2px;">
                                <WIcon
                                    :icon="mdiAccountCircleOutline"
                                    :size="20"
                                ></WIcon>
                            </div>
                            <div style="padding-left:5px; font-size:0.85rem;">
                                {{userName}}
                            </div>
                        </div>

                    </template>
                    <template v-slot:content>
                        <div style="padding:10px;">

                            <div
                                style="display:flex; align-items:center; white-space:nowrap; user-select:none; cursor:pointer;"
                                @click="logout"
                            >
                                <div style="padding-top:2px;">
                                    <WIcon
                                        :icon="mdiLogoutVariant"
                                        :size="18"
                                    ></WIcon>
                                </div>
                                <div style="padding-left:5px; font-size:0.8rem;">
                                    {{$t('logout')}}
                                </div>
                            </div>

                        </div>
                    </template>
                </WPopup>

            </div>

        </div>

        <div :style="`height:calc( 100% - ${heightToolbar}px );`">
            <LayoutContent
            ></LayoutContent>
        </div>

    </div>
</template>

<script>
import { mdiAccountCircleOutline, mdiLogoutVariant } from '@mdi/js/mdi.js'
import get from 'lodash-es/get.js'
// import cloneDeep from 'lodash-es/cloneDeep.js'
import isestr from 'wsemi/src/isestr.mjs'
import WIcon from 'w-component-vue/src/components/WIcon.vue'
import WPopup from 'w-component-vue/src/components/WPopup.vue'
import WButtonCircle from 'w-component-vue/src/components/WButtonCircle.vue'
import WTextSelect from 'w-component-vue/src/components/WTextSelect.vue'
import LayoutContent from './LayoutContent.vue'


export default {
    components: {
        WIcon,
        WPopup,
        WButtonCircle,
        WTextSelect,
        LayoutContent,
    },
    props: {
    },
    data: function() {
        return {
            mdiAccountCircleOutline,
            mdiLogoutVariant,

            t: null,

            firstSetting: true,

            showLangSelect: false,

            keysLang: [
                'eng',
                'cht',
            ],
            kpLangSelect: {
                'eng': 'English',
                'cht': '中文',
            },

            drawer: true, //null,

        }
    },
    mounted: function() {
        // console.log('mounted')

        let vo = this

        //firstSetting
        if (vo.firstSetting) {
            // console.log('webInfor', vo.webInfor)
            let showLanguage = get(vo, 'webInfor.showLanguage', '')
            // console.log('showLanguage', showLanguage)
            vo.showLangSelect = showLanguage === 'y'
            let language = get(vo, 'webInfor.language', '')
            // console.log('language', language)
            vo.$ui.setLang(language, 'layout mounted')
            vo.firstSetting = false
        }

        //setInterval
        vo.t = setInterval(() => {
            if (isestr(vo.userToken)) {

                // console.log('refreshToken...', vo.userToken)
                // vo.$fapi.refreshToken(vo.userToken)
                //     .then((timeEnd) => {
                //         console.log('refreshToken then', timeEnd)
                //     })
                //     .catch((err) => {
                //         console.log('refreshToken catch', err)

                //         //logout, 登出與轉跳登入頁
                //         vo.logout()

                //     })

                // console.log('checkToken...', vo.userToken)
                vo.$fapi.checkToken(vo.userToken) //斷線有重試機制, resolve僅回傳true, reject代表無效token或檢測token發生錯誤
                    .catch((err) => {
                        console.log('checkToken catch', err)
                        vo.logout() //登出與轉跳登入頁
                    })

            }
        }, 1 * 1000) //每1min更新

    },
    beforeDestroy: function() {
        // console.log('beforeDestroy')

        let vo = this

        //clearInterval
        clearInterval(vo.t)

    },
    computed: {

        viewState: function() {
            let vo = this
            return get(vo, '$store.state.viewState', '')
        },

        heightToolbar: function() {
            let vo = this
            return get(vo, `$store.state.heightToolbar`, 0)
        },

        userToken: function() {
            let vo = this
            return get(vo, `$store.state.userToken`)
        },

        webInfor: function() {
            let wi = get(this, `$store.state.webInfor`)
            return wi
        },

        webName: {
            get() {
                let vo = this
                let c = vo.$t('webName', '')
                // console.log('get webName1', c)
                if (!isestr(c)) {
                    c = vo.$t('waitingData', '')
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
            let vo = this
            return get(vo, `$store.state.webInfor.webLogo`, '')
        },

        lang: function() {
            let vo = this
            return get(vo, `$store.state.lang`, '')
        },

        userSelf: function() {
            let vo = this
            return get(vo, `$store.state.userSelf`, '')
        },

        userName: function() {
            let vo = this
            return get(vo, `userSelf.name`, '')
        },

    },
    methods: {

        getLangText: function(lang) {
            // console.log('methods getLangText', lang)

            let vo = this

            let t = get(vo, `kpLangSelect.${lang}`, '')

            return t
        },

        toggleLang: function(lang) {
            // console.log('methods toggleLang', lang)

            let vo = this

            //setLang
            vo.$ui.setLang(lang, 'toggle')

        },

        logout: function() {
            // console.log('methods logout')

            let vo = this

            //logout
            vo.$ui.logout()
                .then(() => {

                    //登出時提交變更viewState返回登入頁
                    vo.$ui.updateViewState('login')
                    console.log(`logout, goto view['login'] page`)

                })
                .catch((err) => {
                    console.log(`logout err[${err}]`)
                })

        },

    }
}
</script>

<style scoped>
</style>
