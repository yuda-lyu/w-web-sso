<template>
    <div style="position:relative; width:100vw; height:100svh;">

        <template v-if="!autoLogining">

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
                                        :rightIconTooltip="showPassword ? '顯示密碼':'隱藏密碼'"
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
                <div style="_white-space:nowrap">
                    <WTextSelect
                        style="width:100px;"
                        :items="tgLangs"
                        v-model="tgLangSelect"
                        @input="changeLang"
                    ></WTextSelect>
                </div>
            </div>

        </template>

        <div
            style="position:absolute; top:0px; left:0px; width:100%; height:100%; display:flex; align-items:center; justify-content:center;"
            v-else
        >
            <svg xmlns="http://www.w3.org/2000/svg" width="30px" height="30px" viewBox="0 0 24 24"><rect width="9" height="9" x="1.5" y="1.5" fill="currentColor" rx="1"><animate id="svgSpinnersBlocksScale0" attributeName="x" begin="0;svgSpinnersBlocksScale1.end+0.15s" dur="0.6s" keyTimes="0;.2;1" values="1.5;.5;1.5"/><animate attributeName="y" begin="0;svgSpinnersBlocksScale1.end+0.15s" dur="0.6s" keyTimes="0;.2;1" values="1.5;.5;1.5"/><animate attributeName="width" begin="0;svgSpinnersBlocksScale1.end+0.15s" dur="0.6s" keyTimes="0;.2;1" values="9;11;9"/><animate attributeName="height" begin="0;svgSpinnersBlocksScale1.end+0.15s" dur="0.6s" keyTimes="0;.2;1" values="9;11;9"/></rect><rect width="9" height="9" x="13.5" y="1.5" fill="currentColor" rx="1"><animate attributeName="x" begin="svgSpinnersBlocksScale0.begin+0.15s" dur="0.6s" keyTimes="0;.2;1" values="13.5;12.5;13.5"/><animate attributeName="y" begin="svgSpinnersBlocksScale0.begin+0.15s" dur="0.6s" keyTimes="0;.2;1" values="1.5;.5;1.5"/><animate attributeName="width" begin="svgSpinnersBlocksScale0.begin+0.15s" dur="0.6s" keyTimes="0;.2;1" values="9;11;9"/><animate attributeName="height" begin="svgSpinnersBlocksScale0.begin+0.15s" dur="0.6s" keyTimes="0;.2;1" values="9;11;9"/></rect><rect width="9" height="9" x="13.5" y="13.5" fill="currentColor" rx="1"><animate attributeName="x" begin="svgSpinnersBlocksScale0.begin+0.3s" dur="0.6s" keyTimes="0;.2;1" values="13.5;12.5;13.5"/><animate attributeName="y" begin="svgSpinnersBlocksScale0.begin+0.3s" dur="0.6s" keyTimes="0;.2;1" values="13.5;12.5;13.5"/><animate attributeName="width" begin="svgSpinnersBlocksScale0.begin+0.3s" dur="0.6s" keyTimes="0;.2;1" values="9;11;9"/><animate attributeName="height" begin="svgSpinnersBlocksScale0.begin+0.3s" dur="0.6s" keyTimes="0;.2;1" values="9;11;9"/></rect><rect width="9" height="9" x="1.5" y="13.5" fill="currentColor" rx="1"><animate id="svgSpinnersBlocksScale1" attributeName="x" begin="svgSpinnersBlocksScale0.begin+0.45s" dur="0.6s" keyTimes="0;.2;1" values="1.5;.5;1.5"/><animate attributeName="y" begin="svgSpinnersBlocksScale0.begin+0.45s" dur="0.6s" keyTimes="0;.2;1" values="13.5;12.5;13.5"/><animate attributeName="width" begin="svgSpinnersBlocksScale0.begin+0.45s" dur="0.6s" keyTimes="0;.2;1" values="9;11;9"/><animate attributeName="height" begin="svgSpinnersBlocksScale0.begin+0.45s" dur="0.6s" keyTimes="0;.2;1" values="9;11;9"/></rect></svg>
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

            logoSize: 120,

            contentWidth: 380,
            contentPadding: 30,

            autoLogining: true,

            account: '',

            showPassword: false,
            password: '',

        }
    },
    mounted: function() {
        let vo = this

        //autoLogin
        vo.autoLogin()

    },
    computed: {

        connState: function() {
            //console.log('computed loading')

            let vo = this

            return get(vo, `$store.state.connState`)
        },

        syncState: function() {
            //console.log('computed syncState')

            let vo = this

            return get(vo, '$store.state.syncState')
        },

        viewState: function() {
            //console.log('computed viewState')

            let vo = this

            return get(vo, `$store.state.viewState`, '')
        },

        heightToolbar: function() {
            //console.log('computed heightToolbar')

            let vo = this

            return get(vo, `$store.state.heightToolbar`, 0)
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
            //console.log('computed webLogo')

            let vo = this

            return get(vo, `$store.state.webInfor.webLogo`, '')
        },

        webBackgoundGradientColors: function() {
            //console.log('computed webBackgoundGradientColors')

            let vo = this

            return get(vo, `$store.state.webInfor.webBackgoundGradientColors`, [])
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
            //console.log('computed webKey')

            let vo = this

            return get(vo, `$store.state.webInfor.webKey`, '')
        },

        hasAcPw: function() {
            //console.log('computed loading')

            let vo = this

            return isestr(vo.account) && isestr(vo.password)
        },

    },
    methods: {

        changeLang: function(msg) {
            // console.log('methods changeLang', msg)
            let vo = this
            let lang = msg.id
            vo.$ui.setLang(lang)
        },

        goUrl: function(url, token) {
            // let vo = this

            //replace
            url = url.replaceAll('{token}', token)

            //href
            if (isDev()) {
                console.log('60s後重導至:', url)
                setTimeout(() => {
                    window.location.href = url
                }, 60 * 1000)
            }
            else {
                window.location.href = url
            }

        },

        autoLogin: function() {
            let vo = this

            async function core() {
                let errTemp = null

                //check
                if (!vo.autoLogining) {
                    return
                }

                //waitFun, 因須使用webKey故須等待syncState
                await waitFun(() => {
                    return vo.syncState
                })

                //$keyLS
                let $keyLS = vo.webKey

                //check
                if (!isestr($keyLS)) {
                    vo.autoLogining = false

                    //alert
                    vo.$alert(vo.$t('failedLoginForNoWebKey'), { type: 'error' })

                    return
                }

                //key
                let key = `${$keyLS}:userToken`
                // console.log('key', key)

                //getItem
                let token = await localStorage.getItem(key)
                // console.log('token', token)

                //checkToken
                await vo.$fapi.checkToken(token)
                    .catch((err) => {
                        errTemp = err
                        //無有效token改為提供使用者進行帳密登入
                    })
                if (errTemp) {
                    vo.autoLogining = false
                    return
                }

                //getUserByToken
                let u = await vo.$fapi.getUserByToken(token)
                // console.log('getUserByToken u', u)

                //redir
                let redir = get(u, 'redir', '')
                // console.log('redir', redir)

                //check
                if (!isestr(redir)) {
                    vo.autoLogining = false

                    //alert
                    vo.$alert(vo.$t('failedLoginForNoRedir'), { type: 'error' })

                    return
                }

                //goUrl
                vo.goUrl(redir, token)

                //autoLogining
                vo.autoLogining = false

            }

            //core
            core()
                .catch((err) => {
                    console.log('autoLogin', err)

                    //alert
                    vo.$alert(vo.$t('failedLoginForCatch'), { type: 'error' })

                })
                .finally(() => {

                    //hide loading
                    vo.$ui.updateLoading(false)

                })

        },

        login: function() {
            let vo = this

            async function core() {

                //show loading
                vo.$ui.updateLoading(true)

                //delay
                await delay(1000)

                //$keyLS
                let $keyLS = vo.webKey

                //check
                if (!isestr($keyLS)) {
                    return Promise.reject(vo.$t('failedLoginForNoWebKey'))
                }

                //key
                let key = `${$keyLS}:userToken`
                // console.log('key', key)

                //loginByAccountAndPassword
                let u = await vo.$fapi.loginByAccountAndPassword(vo.account, vo.password)
                // console.log('u', u)

                //setItem
                await localStorage.setItem(key, '')

                //token
                let token = get(u, 'token', '')
                // console.log('token', token)

                //check
                if (!isestr(token)) {
                    return Promise.reject(vo.$t('failedLoginForNoToken'))
                }

                //setItem
                await localStorage.setItem(key, token)

                //redir
                let redir = get(u, 'redir', '')
                // console.log('redir', redir)

                //check
                if (!isestr(redir)) {
                    return Promise.reject(vo.$t('failedLoginForNoRedir'))
                }

                //goUrl
                vo.goUrl(redir, token)

            }

            //core
            core()
                .catch((err) => {
                    console.log('login', err)

                    //alert
                    vo.$alert(vo.$t('failedLoginForCatch'), { type: 'error' })

                })
                .finally(() => {

                    //hide loading
                    vo.$ui.updateLoading(false)

                })

        },

    }
}
</script>

<style scoped>
</style>
