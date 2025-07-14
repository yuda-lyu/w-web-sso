<template>
    <div style="position:relative; width:100vw; height:100svh;">

        <div
            :style="`
                position:absolute; top:0px; left:0px; width:100%; height:100%; display:flex; align-items:center; justify-content:center;
                background-image: linear-gradient(-225deg, ${c1} 0%, ${c2} 50%, ${c3} 100%);
            `"
        >

            <div style="">

                <div :style="`padding-top:${logoSize/2}px;`"></div>

                <div
                    :style="`
                        position:relative;
                        width:${contentWidth}px; padding:10px; border-radius:30px; background:${c4};
                        box-shadow: rgb(0 0 0 / 2%) 2.76726px 2.76726px 2.21381px 0px, rgb(0 0 0 / 3%) 6.6501px 6.6501px 5.32008px 0px, rgb(0 0 0 / 4%) 12.5216px 12.5216px 10.0172px 0px, rgb(0 0 0 / 4%) 22.3363px 22.3363px 17.869px 0px, rgb(0 0 0 / 5%) 41.7776px 41.7776px 33.4221px 0px, rgb(0 0 0 / 7%) 100px 100px 80px 0px;
                    `"
                >

                    <div :style="`position:absolute; top:0px; left:50%; transform:translateX(-50%) translateY(-50%); padding:15px 15px 10px 15px; border-radius:50%; background:${c5};`">
                        <img :width="logoSize" :height="logoSize" :src="webLogo">
                    </div>

                    <div :style="`padding:${logoSize/2+contentPadding}px ${contentPadding}px ${contentPadding}px ${contentPadding}px;`">

                        <div style="padding-bottom:20px; text-align:center; font-size:1.3rem;">
                            {{webName}}
                        </div>

                        <div style="display:flex; align-items:stretch;">

                            <div style="display:flex; align-items:center; padding:0px 10px; background:rgba(34, 44, 77, 0.9);">
                                <WIcon
                                    :icon="'mdi-account'"
                                    :color="'#ddd'"
                                    :colorHover="'#eee'"
                                    :size="24"
                                ></WIcon>
                            </div>

                            <div style="width:100%; padding:5px 10px; background:rgba(34, 44, 77, 0.8);">

                                <div :style="`font-size:0.8rem; color:#eee;`">
                                    {{$t('account')}}
                                </div>

                                <WText
                                    :textColor="'#fff'"
                                    :bottomLineBorderColor="'#b6b6b6'"
                                    :bottomLineBorderColorHover="'#ccc'"
                                    :bottomLineBorderColorFocus="'#ddd'"
                                    v-model="account"
                                    @enter="login"
                                ></WText>

                            </div>

                        </div>

                        <div style="padding-top:10px"></div>

                        <div style="display:flex; align-items:stretch;">

                            <div style="display:flex; align-items:center; padding:0px 10px; background:rgba(34, 44, 77, 0.9);">
                                <WIcon
                                    :icon="'mdi-lock'"
                                    :color="'#ddd'"
                                    :colorHover="'#eee'"
                                    :size="24"
                                ></WIcon>
                            </div>

                            <div style="width:100%; padding:5px 10px; background:rgba(34, 44, 77, 0.8);">

                                <div :style="`font-size:0.8rem; color:#eee;`">
                                    {{$t('password')}}
                                </div>

                                <WText
                                    :textColor="'#fff'"
                                    :bottomLineBorderColor="'#b6b6b6'"
                                    :bottomLineBorderColorHover="'#ccc'"
                                    :bottomLineBorderColorFocus="'#ddd'"
                                    :rightIcon="showPassword ? 'mdi-eye' : 'mdi-eye-off'"
                                    :rightIconColor="'#ddd'"
                                    :rightIconColorHover="'#eee'"
                                    :rightIconColorFocus="'#ddd'"
                                    :rightIconTooltip="showPassword ? $t('toggleToHidePassword') : $t('toggleToShowPassword')"
                                    :password="!showPassword"
                                    v-model="password"
                                    @click-right="showPassword=!showPassword"
                                    @enter="login"
                                ></WText>

                            </div>

                        </div>

                        <div style="padding-top:30px"></div>

                        <div style="padding:5px 0px; text-align:center;">
                            <WButtonChip
                                :style="`opacity:${hasAcPw?1:0.5};`"
                                :text="$t('login')"
                                :textFontSize="'1.0rem'"
                                :paddingStyle="{v:8,h:130}"
                                :backgroundColor="'rgba(255,255,255,0.5)'"
                                :backgroundColorHover="'rgba(255,255,255,0.7)'"
                                _shadow="false"
                                :editable="hasAcPw"
                                @click="login"
                            ></WButtonChip>
                        </div>

                    </div>

                </div>

            </div>

        </div>

        <div style="position:absolute; top:10px; right:10px;">

            <div
                style="white-space:nowrap;"
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

        </div>

    </div>
</template>

<script>
import get from 'lodash-es/get.js'
import isestr from 'wsemi/src/isestr.mjs'
import isDev from 'wsemi/src/isDev.mjs'
import delay from 'wsemi/src/delay.mjs'
import waitFun from 'wsemi/src/waitFun.mjs'
import WIcon from 'w-component-vue/src/components/WIcon.vue'
import WText from 'w-component-vue/src/components/WText.vue'
import WTextSelect from 'w-component-vue/src/components/WTextSelect.vue'
import WButtonChip from 'w-component-vue/src/components/WButtonChip.vue'


export default {
    components: {
        WIcon,
        WText,
        WTextSelect,
        WButtonChip,
    },
    props: {
    },
    data: function() {
        return {

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

            logoSize: 120,

            contentWidth: 380,
            contentPadding: 30,

            account: '',

            showPassword: false,
            password: '',

            //待加入 申請註冊使用者 bbb

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

    },
    computed: {

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

        webInfor: function() {
            let wi = get(this, `$store.state.webInfor`)
            return wi
        },

        webLogo: function() {
            let vo = this
            return get(vo, `webInfor.webLogo`, '')
        },

        webBackgoundGradientColors: function() {
            let vo = this
            return get(vo, `webInfor.webBackgoundGradientColors`, [])
        },

        c1: function() {
            let vo = this
            let c = get(vo, 'webBackgoundGradientColors.0', '#fff')
            return c
        },

        c2: function() {
            let vo = this
            let c = get(vo, 'webBackgoundGradientColors.1', '#fff')
            return c
        },

        c3: function() {
            let vo = this
            let c = get(vo, 'webBackgoundGradientColors.2', '#fff')
            return c
        },

        c4: function() {
            let vo = this
            let c = get(vo, 'webBackgoundGradientColors.3', '#fff')
            return c
        },

        c5: function() {
            let vo = this
            let c = get(vo, 'webBackgoundGradientColors.4', '#fff')
            return c
        },

        webKey: function() {
            let vo = this
            return get(vo, '$store.state.webInfor.webKey', '')
        },

        lang: function() {
            let vo = this
            return get(vo, '$store.state.lang', '')
        },

        hasAcPw: function() {
            let vo = this
            return isestr(vo.account) && isestr(vo.password)
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

        login: function() {
            // console.log('methods login')

            let vo = this

            //view
            let view = vo.$ui.getUrlView()

            //login
            vo.$ui.login(vo.account, vo.password, { useRedir: view === 'login' })
                .then(() => {

                    //提交變更viewState前往指定功能頁
                    vo.$ui.updateViewState(view)
                    console.log(`login, goto view[${view}] page`)

                })
                .catch((err) => {

                    //錯誤發生時提交變更viewState返回登入頁
                    vo.$ui.updateViewState('login')
                    console.log(`login err[${err}], goto view['login'] page`)

                })

        },

    }
}
</script>

<style scoped>
</style>
