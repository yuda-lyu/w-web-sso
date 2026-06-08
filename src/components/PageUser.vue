<template>
    <div style="position:relative; width:100vw; height:100svh;">

        <div
            :style="`
                position:absolute; top:0px; left:0px; width:100%; height:100%; display:flex; align-items:center; justify-content:center;
                background-image: linear-gradient(-225deg, ${c1} 0%, ${c2} 50%, ${c3} 100%);
            `"
        >

            <div style="">

                <div
                    :style="`
                        position:relative;
                        width:${contentWidth}px; padding:10px; border-radius:30px; background:${c4};
                        box-shadow: rgb(0 0 0 / 2%) 2.76726px 2.76726px 2.21381px 0px, rgb(0 0 0 / 3%) 6.6501px 6.6501px 5.32008px 0px, rgb(0 0 0 / 4%) 12.5216px 12.5216px 10.0172px 0px, rgb(0 0 0 / 4%) 22.3363px 22.3363px 17.869px 0px, rgb(0 0 0 / 5%) 41.7776px 41.7776px 33.4221px 0px, rgb(0 0 0 / 7%) 100px 100px 80px 0px;
                    `"
                >

                    <div :style="`padding:${contentPadding/2}px ${contentPadding/2-10}px ${contentPadding/2}px ${contentPadding/2-10}px;`">
                        <div class="sb" :style="`padding:${contentPadding/2}px ${contentPadding/2+10}px ${contentPadding/2}px ${contentPadding/2+10}px; max-height:calc(100svh - 240px); overflow-y:auto;`">

                        <div style="padding-bottom:20px; text-align:center; font-size:1.3rem;">
                            {{$t('mmUserInfor')}}
                        </div>

                        <div style="background:rgba(255,255,255,0.4); border-radius:10px; padding:15px;">
                            <div v-for="(v,k) in displayUser" :key="k" style="display:flex; align-items:center; margin-bottom:10px; border-bottom:1px solid rgba(0,0,0,0.1); padding-bottom:5px;">
                                <div style="padding-right:15px;">
                                    <WIcon :icon="v.icon" :size="20" :color="'#555'"></WIcon>
                                </div>
                                <div style="flex:1;">
                                    <div style="font-size:0.8rem; color:#666; margin-bottom:2px;">
                                        <template v-if="k === 'password' && showChangePassword">
                                            {{$t('userChangePassword')}}
                                        </template>
                                        <template v-else>
                                            {{$t(k)}}
                                        </template>
                                    </div>
                                    <div style="font-size:1.0rem; color:#222;">
                                        <template v-if="k === 'password'">
                                            <div v-if="!showChangePassword">
                                                <WButtonChip
                                                    :text="$t('userChangePassword')"
                                                    :textFontSize="'0.8rem'"
                                                    :paddingStyle="{v:4,h:15}"
                                                    :backgroundColor="'rgba(255,255,255,0.5)'"
                                                    :backgroundColorHover="'rgba(255,255,255,0.7)'"
                                                    :borderRadius="4"
                                                    _shadow="false"
                                                    @click="clickChangePassword"
                                                ></WButtonChip>
                                            </div>
                                            <div v-else style="padding:10px; margin-top:5px;">
                                                <div style="margin-bottom:10px;">
                                                    <div style="font-size:0.8rem; color:#444; margin-bottom:2px;">{{$t('userChangePasswordOldPassword')}}</div>
                                                    <WText
                                                        :textColor="'#000'"
                                                        :bottomLineBorderColor="'#888'"
                                                        :bottomLineBorderColorHover="'#888'"
                                                        :bottomLineBorderColorFocus="'#888'"
                                                        :rightIcon="showOldPassword ? 'mdi-eye' : 'mdi-eye-off'"
                                                        :rightIconColor="'#777'"
                                                        :rightIconColorHover="'#666'"
                                                        :rightIconColorFocus="'#555'"
                                                        :rightIconTooltip="showOldPassword ? $t('toggleToHidePassword') : $t('toggleToShowPassword')"
                                                        :password="!showOldPassword"
                                                        v-model="oldPassword"
                                                        @click-right="showOldPassword=!showOldPassword"
                                                    ></WText>
                                                    <div style="padding-top:4px; font-size:0.75rem; color:#c62828;" v-if="chPwOldError">
                                                        {{chPwOldError}}
                                                    </div>
                                                </div>
                                                <div style="margin-bottom:10px;">
                                                    <div style="font-size:0.8rem; color:#444; margin-bottom:2px;">{{$t('userChangePasswordNewPassword')}}</div>
                                                    <WText
                                                        :textColor="'#000'"
                                                        :bottomLineBorderColor="'#888'"
                                                        :bottomLineBorderColorHover="'#888'"
                                                        :bottomLineBorderColorFocus="'#888'"
                                                        :rightIcon="showNewPassword ? 'mdi-eye' : 'mdi-eye-off'"
                                                        :rightIconColor="'#777'"
                                                        :rightIconColorHover="'#666'"
                                                        :rightIconColorFocus="'#555'"
                                                        :rightIconTooltip="showNewPassword ? $t('toggleToHidePassword') : $t('toggleToShowPassword')"
                                                        :password="!showNewPassword"
                                                        v-model="newPassword"
                                                        @click-right="showNewPassword=!showNewPassword"
                                                    ></WText>
                                                    <div style="padding-top:4px; font-size:0.75rem; color:#c62828;" v-if="chPwNewError">
                                                        {{chPwNewError}}
                                                    </div>
                                                </div>
                                                <div style="margin-bottom:15px;">
                                                    <div style="font-size:0.8rem; color:#444; margin-bottom:2px;">{{$t('userChangePasswordConfirmPassword')}}</div>
                                                    <WText
                                                        :textColor="'#000'"
                                                        :bottomLineBorderColor="'#888'"
                                                        :bottomLineBorderColorHover="'#888'"
                                                        :bottomLineBorderColorFocus="'#888'"
                                                        :rightIcon="showConfirmPassword ? 'mdi-eye' : 'mdi-eye-off'"
                                                        :rightIconColor="'#777'"
                                                        :rightIconColorHover="'#666'"
                                                        :rightIconColorFocus="'#555'"
                                                        :rightIconTooltip="showConfirmPassword ? $t('toggleToHidePassword') : $t('toggleToShowPassword')"
                                                        :password="!showConfirmPassword"
                                                        v-model="confirmPassword"
                                                        @click-right="showConfirmPassword=!showConfirmPassword"
                                                    ></WText>
                                                    <div style="padding-top:4px; font-size:0.75rem; color:#c62828;" v-if="chPwConfirmError">
                                                        {{chPwConfirmError}}
                                                    </div>
                                                </div>
                                                <div style="display:flex; gap:10px;">
                                                    <WButtonChip
                                                        :text="$t('send')"
                                                        :textFontSize="'0.8rem'"
                                                        :paddingStyle="{v:4,h:15}"
                                                        :backgroundColor="'rgba(255,255,255,0.5)'"
                                                        :backgroundColorHover="'rgba(255,255,255,0.7)'"
                                                        :borderRadius="4"
                                                        _shadow="false"
                                                        :promiseUnlock="true"
                                                        @click="onClickSubmitChangePasswordBtn"
                                                    ></WButtonChip>
                                                    <WButtonChip
                                                        v-if="!isForceChangePw"
                                                        :text="$t('cancel')"
                                                        :textFontSize="'0.8rem'"
                                                        :paddingStyle="{v:4,h:15}"
                                                        :backgroundColor="'rgba(255,255,255,0.5)'"
                                                        :backgroundColorHover="'rgba(255,255,255,0.7)'"
                                                        :borderRadius="4"
                                                        _shadow="false"
                                                        @click="cancelChangePassword"
                                                    ></WButtonChip>
                                                </div>
                                            </div>
                                        </template>
                                        <template v-else>
                                            <template v-if="v.enumerable">
                                                {{$t(v.value)}}
                                            </template>
                                            <template v-else>
                                                {{v.value}}
                                            </template>
                                        </template>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div style="padding-top:30px"></div>

                        <div style="padding:5px 0px; text-align:center;">
                            <WButtonChip
                                :displayType="'line'"
                                :text="$t('logout')"
                                :textFontSize="'0.9rem'"
                                :paddingStyle="{v:6,h:0}"
                                :backgroundColor="'rgba(255,255,255,0.5)'"
                                :backgroundColorHover="'rgba(255,255,255,0.7)'"
                                _shadow="false"
                                @click="logout"
                            ></WButtonChip>
                        </div>

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
import WButtonChip from 'w-component-vue/src/components/WButtonChip.vue'
import WTextSelect from 'w-component-vue/src/components/WTextSelect.vue'
import WIcon from 'w-component-vue/src/components/WIcon.vue'
import WText from 'w-component-vue/src/components/WText.vue'

export default {
    components: {
        WButtonChip,
        WTextSelect,
        WIcon,
        WText,
    },
    props: {
    },
    data: function() {
        return {
            contentWidth: 450,
            contentPadding: 30,

            showLangSelect: false,

            keysLang: [
                'eng',
                'cht',
            ],
            kpLangSelect: {
                'eng': 'English',
                'cht': '中文',
            },

            showChangePassword: false,
            oldPassword: '',
            newPassword: '',
            confirmPassword: '',
            showOldPassword: false,
            showNewPassword: false,
            showConfirmPassword: false,
            //inline 錯誤訊息（顯示於對應輸入框下方紅字，取代 alert）
            chPwOldError: '',
            chPwNewError: '',
            chPwConfirmError: '',
        }
    },
    mounted: function() {
        let vo = this

        //showLangSelect
        let showLanguage = get(vo, 'webInfor.showLanguage', '')
        vo.showLangSelect = showLanguage === 'y'

        //強制變更密碼模式: userSelf.isForceChangePw === 'y' 時自動展開變更密碼表單
        //(取消按鈕在 template 內以 v-if="!isForceChangePw" 隱藏)
        let userSelf = get(vo, '$store.state.userSelf', {})
        if (get(userSelf, 'isForceChangePw', '') === 'y') {
            vo.clickChangePassword()
        }

    },
    computed: {

        userToken: function() {
            let vo = this
            return get(vo, '$store.state.userToken', '')
        },

        lang: function() {
            let vo = this
            return get(vo, `$store.state.lang`, '')
        },

        webInfor: function() {
            let wi = get(this, `$store.state.webInfor`)
            return wi
        },

        webBackgoundGradientColors: function() {
            let vo = this
            return get(vo, `webInfor.webBackgoundGradientColors`, [])
        },

        c1: function() {
            let vo = this
            return get(vo, 'webBackgoundGradientColors.0', '#fff')
        },

        c2: function() {
            let vo = this
            return get(vo, 'webBackgoundGradientColors.1', '#fff')
        },

        c3: function() {
            let vo = this
            return get(vo, 'webBackgoundGradientColors.2', '#fff')
        },

        c4: function() {
            let vo = this
            return get(vo, 'webBackgoundGradientColors.3', '#fff')
        },

        userSelf: function() {
            let vo = this
            return get(vo, '$store.state.userSelf', {})
        },

        isForceChangePw: function() {
            let vo = this
            return get(vo, 'userSelf.isForceChangePw', '') === 'y'
        },

        displayUser: function() {
            let vo = this
            let u = vo.userSelf
            return {
                'account': {
                    value: u.account,
                    icon: 'fas fa-user-circle',
                },
                'name': {
                    value: u.name,
                    icon: 'fas fa-user',
                },
                'email': {
                    value: u.email,
                    icon: 'fas fa-envelope',
                },
                'password': {
                    value: '',
                    icon: 'fas fa-key',
                },
                'description': {
                    value: u.description,
                    icon: 'fas fa-file-alt',
                },
                'from': {
                    value: u.from,
                    icon: 'fas fa-globe',
                },
                'isAdmin': {
                    value: u.isAdmin,
                    icon: 'fas fa-shield-alt',
                    enumerable: true,
                },
                'isActive': {
                    value: u.isActive,
                    icon: 'fas fa-toggle-on',
                    enumerable: true,
                },
            }
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

        clickChangePassword: function() {
            let vo = this
            vo.showChangePassword = true
            vo.oldPassword = ''
            vo.newPassword = ''
            vo.confirmPassword = ''
            vo.showOldPassword = false
            vo.showNewPassword = false
            vo.showConfirmPassword = false
            //清空 inline 錯誤訊息
            vo.chPwOldError = ''
            vo.chPwNewError = ''
            vo.chPwConfirmError = ''
        },

        cancelChangePassword: function() {
            let vo = this
            vo.showChangePassword = false
            //清空 inline 錯誤訊息
            vo.chPwOldError = ''
            vo.chPwNewError = ''
            vo.chPwConfirmError = ''
        },

        submitChangePassword: function() {
            let vo = this

            let core = async () => {

                //每次送出先清空舊的 inline 錯誤訊息
                vo.chPwOldError = ''
                vo.chPwNewError = ''
                vo.chPwConfirmError = ''

                //check oldPassword
                if (!isestr(vo.oldPassword)) {
                    vo.chPwOldError = vo.$t('userChangePasswordForNoOldPassword')
                    return
                }

                //check newPassword
                if (!isestr(vo.newPassword)) {
                    vo.chPwNewError = vo.$t('userChangePasswordForNoNewPassword')
                    return
                }

                //check confirmPassword
                if (!isestr(vo.confirmPassword)) {
                    vo.chPwConfirmError = vo.$t('userChangePasswordForNoConfirmPassword')
                    return
                }

                //check same
                if (vo.newPassword !== vo.confirmPassword) {
                    vo.chPwConfirmError = vo.$t('userChangePasswordNotSame')
                    return
                }

                //同步驗證全通過、確定要打 API 才開 loading (放 core 外會在 early-return 時閃 loading)
                vo.$ui.updateLoading(true)

                //checkUserPassword
                let okCkPw = false
                await vo.$fapi.checkUserPassword(vo.lang, vo.newPassword)
                    .then((res) => {
                        if (res.state === 'success') {
                            okCkPw = true
                        }
                        else if (res.state === 'error') {
                            vo.chPwNewError = res.msg
                        }
                        else {
                            console.log('error[res]', res)
                            vo.chPwNewError = vo.$t('userChangePasswordForNetError')
                        }
                    })
                    .catch((err) => {
                        console.log('catch', err)
                        vo.chPwNewError = vo.$t('userChangePasswordForNetError')
                    })
                if (!okCkPw) {
                    return
                }

                //changeUserPassword
                let okChPw = false
                await vo.$fapi.changeUserPassword(vo.userToken, vo.lang, vo.oldPassword, vo.newPassword)
                    .then(() => {
                        okChPw = true
                    })
                    .catch((err) => {
                        console.log('catch', err)
                        //變更失敗（incorrect old password / token 失效等）統一訊息顯示於舊密碼下方
                        //最常見原因為舊密碼錯，放此位置最直覺；其他原因（如 token 失效）顯示同一訊息
                        vo.chPwOldError = vo.$t('userChangePasswordFail')
                    })
                if (!okChPw) {
                    return
                }

                //成功後 isForceChangePw 已被後端清為 'n', 同步刷新 store.userSelf,
                //讓 isForceChangePw computed 重新求值, 解除強制變更模式
                let u = { ...vo.$store.state.userSelf, isForceChangePw: 'n' }
                vo.$store.commit(vo.$store.types.UpdateUserSelf, u)

                //cancelChangePassword
                vo.cancelChangePassword()

                //close before showCheckYes (ADR-002 modal 等待期避免 loading 疊著);
                //finally 仍會再呼叫一次當作兜底, updateLoading 對重複關閉是 idempotent
                vo.$ui.updateLoading(false)
                await vo.$dg.showCheckYes(vo.$t('userChangePasswordSuccess'))

                return 'ok'
            }

            //core
            core()
                .catch((err) => {
                    console.log('catch', err)
                    vo.$alert(vo.$t('anUnexpectedErrorOccurred'), { type: 'error' })
                })
                .finally(() => {

                    //hide loading
                    vo.$ui.updateLoading(false)

                })

        },

        onClickSubmitChangePasswordBtn: async function(msg) {
            let vo = this
            try {
                await vo.submitChangePassword()
                msg.pm.resolve()
            }
            catch (e) {
                msg.pm.reject(e)
            }
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
