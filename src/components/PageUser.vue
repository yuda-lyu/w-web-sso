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

                    <div :style="`padding:${contentPadding}px;`">

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
                                                        @click="submitChangePassword"
                                                    ></WButtonChip>
                                                    <WButtonChip
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
                                :text="$t('logout')"
                                :textFontSize="'0.9rem'"
                                :paddingStyle="{v:6,h:20}"
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
        }
    },
    mounted: function() {
        let vo = this

        //showLangSelect
        let showLanguage = get(vo, 'webInfor.showLanguage', '')
        vo.showLangSelect = showLanguage === 'y'

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
        },

        cancelChangePassword: function() {
            let vo = this
            vo.showChangePassword = false
        },

        submitChangePassword: function() {
            let vo = this

            let core = async () => {

                //check oldPassword
                if (!isestr(vo.oldPassword)) {
                    vo.$alert(vo.$t('userChangePasswordForNoOldPassword'), { type: 'error' })
                    return
                }

                //check newPassword
                if (!isestr(vo.newPassword)) {
                    vo.$alert(vo.$t('userChangePasswordForNoNewPassword'), { type: 'error' })
                    return
                }

                //check confirmPassword
                if (!isestr(vo.confirmPassword)) {
                    vo.$alert(vo.$t('userChangePasswordForNoConfirmPassword'), { type: 'error' })
                    return
                }

                //check same
                if (vo.newPassword !== vo.confirmPassword) {
                    vo.$alert(vo.$t('userChangePasswordNotSame'), { type: 'error' })
                    return
                }

                //checkUserPassword
                let bCkPw = false
                await vo.$fapi.checkUserPassword(vo.lang, vo.newPassword)
                    .then((res) => {
                        if (res.state === 'success') {
                            bCkPw = true
                        }
                        else if (res.state === 'error') {
                            vo.$alert(res.msg, { type: 'error' })
                        }
                        else {
                            console.log('error[res]', res)
                            vo.$alert(vo.$t('userChangePasswordForNetError'), { type: 'error' })
                        }
                    })
                    .catch((err) => {
                        console.log('catch', err)
                        vo.$alert(vo.$t('userChangePasswordForNetError'), { type: 'error' })
                    })
                if (!bCkPw) {
                    return
                }

                //changeUserPassword
                let bChPw = false
                await vo.$fapi.changeUserPassword(vo.userToken, vo.lang, vo.oldPassword, vo.newPassword)
                    .then((res) => {
                        bChPw = true

                        //cancelChangePassword
                        vo.cancelChangePassword()

                        vo.$alert(vo.$t('userChangePasswordSuccess'))
                    })
                    .catch((err) => {
                        console.log('catch', err)
                        vo.$alert(vo.$t('userChangePasswordFail'), { type: 'error' })
                    })
                if (!bChPw) {
                    return
                }

                return 'ok'
            }

            //loading
            vo.$ui.updateLoading(true)

            //core
            core()
                .finally(() => {

                    //hide loading
                    vo.$ui.updateLoading(false)

                })

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
