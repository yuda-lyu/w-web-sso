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

                    <div :style="`padding:${logoSize/2+contentPadding/2}px ${contentPadding/2-10}px ${contentPadding/2}px ${contentPadding/2-10}px;`">
                        <div class="sb" :style="`padding:${contentPadding/2}px ${contentPadding/2+10}px ${contentPadding/2}px ${contentPadding/2+10}px; max-height:calc(100svh - ${logoSize/2 + 240}px); overflow-y:auto;`">

                        <div style="padding-bottom:20px; text-align:center; font-size:1.3rem;">
                            {{webName}}
                        </div>

                        <div style="display:flex; align-items:stretch;">

                            <div style="display:flex; align-items:center; padding:0px 10px; background:rgba(34, 44, 77, 0.9);">
                                <WIcon
                                    :icon="mdiAccount"
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
                                    :icon="mdiLock"
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
                                    :rightIcon="showPassword ? mdiEye : mdiEyeOff"
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

                        <template v-if="viewMode==='register'">

                            <div style="padding-top:4px; min-height:18px;" v-if="regPasswordErrors.length > 0">
                                <div style="font-size:0.75rem; color:#c62828;" v-for="(err, i) in regPasswordErrors" :key="'pwerr'+i">
                                    {{err}}
                                </div>
                            </div>

                            <div style="padding-top:10px"></div>

                            <div style="display:flex; align-items:stretch;">
                                <div style="display:flex; align-items:center; padding:0px 10px; background:rgba(34, 44, 77, 0.9);">
                                    <WIcon
                                        :icon="mdiLockCheck"
                                        :color="'#ddd'"
                                        :colorHover="'#eee'"
                                        :size="24"
                                    ></WIcon>
                                </div>
                                <div style="width:100%; padding:5px 10px; background:rgba(34, 44, 77, 0.8);">
                                    <div :style="`font-size:0.8rem; color:#eee;`">{{$t('userRegistrationConfirmPassword')}}</div>
                                    <WText
                                        :textColor="'#fff'"
                                        :bottomLineBorderColor="'#b6b6b6'"
                                        :bottomLineBorderColorHover="'#ccc'"
                                        :bottomLineBorderColorFocus="'#ddd'"
                                        :rightIcon="showPassword ? mdiEye : mdiEyeOff"
                                        :rightIconColor="'#ddd'"
                                        :rightIconColorHover="'#eee'"
                                        :rightIconColorFocus="'#ddd'"
                                        :rightIconTooltip="showPassword ? $t('toggleToHidePassword') : $t('toggleToShowPassword')"
                                        :password="!showPassword"
                                        v-model="regConfirmPassword"
                                        @click-right="showPassword=!showPassword"
                                    ></WText>
                                </div>
                            </div>

                            <div style="padding-top:4px; min-height:18px;" v-if="regConfirmPasswordError">
                                <div style="font-size:0.75rem; color:#c62828;">
                                    {{regConfirmPasswordError}}
                                </div>
                            </div>

                            <div style="padding-top:10px"></div>

                            <div style="display:flex; align-items:stretch;">
                                <div style="display:flex; align-items:center; padding:0px 10px; background:rgba(34, 44, 77, 0.9);">
                                    <WIcon
                                        :icon="mdiRenameBox"
                                        :color="'#ddd'"
                                        :colorHover="'#eee'"
                                        :size="24"
                                    ></WIcon>
                                </div>
                                <div style="width:100%; padding:5px 10px; background:rgba(34, 44, 77, 0.8);">
                                    <div :style="`font-size:0.8rem; color:#eee;`">{{$t('userRegistrationName')}}</div>
                                    <WText
                                        :textColor="'#fff'"
                                        :bottomLineBorderColor="'#b6b6b6'"
                                        :bottomLineBorderColorHover="'#ccc'"
                                        :bottomLineBorderColorFocus="'#ddd'"
                                        v-model="regName"
                                    ></WText>
                                </div>
                            </div>

                            <div style="padding-top:10px"></div>

                            <div style="display:flex; align-items:stretch;">
                                <div style="display:flex; align-items:center; padding:0px 10px; background:rgba(34, 44, 77, 0.9);">
                                    <WIcon
                                        :icon="mdiEmail"
                                        :color="'#ddd'"
                                        :colorHover="'#eee'"
                                        :size="24"
                                    ></WIcon>
                                </div>
                                <div style="width:100%; padding:5px 10px; background:rgba(34, 44, 77, 0.8);">
                                    <div :style="`font-size:0.8rem; color:#eee;`">{{$t('userRegistrationEmail')}}</div>
                                    <WText
                                        :textColor="'#fff'"
                                        :bottomLineBorderColor="'#b6b6b6'"
                                        :bottomLineBorderColorHover="'#ccc'"
                                        :bottomLineBorderColorFocus="'#ddd'"
                                        v-model="regEmail"
                                    ></WText>
                                </div>
                            </div>

                            <div style="padding-top:20px"></div>

                            <div style="padding:5px 0px; text-align:center;">
                                <WButtonChip
                                    :displayType="'line'"
                                    :style="`opacity:${hasRegFields?1:0.5};`"
                                    :text="$t('userRegistrationSubmit')"
                                    :textFontSize="'1.0rem'"
                                    :paddingStyle="{v:8,h:0}"
                                    :backgroundColor="'rgba(255,255,255,0.5)'"
                                    :backgroundColorHover="'rgba(255,255,255,0.7)'"
                                    _shadow="false"
                                    :editable="hasRegFields"
                                    :promiseUnlock="true"
                                    @click="onClickRegisterBtn"
                                ></WButtonChip>
                            </div>

                            <div style="padding-top:8px; font-size:0.85rem; color:#c62828; text-align:center; font-weight:500;" v-if="viewMode==='register' && regError">
                                {{regError}}
                            </div>

                            <div style="padding:5px 0px; text-align:center;">
                                <div style="padding-top:10px;">
                                    <span style="font-size:0.85rem; color:rgba(80,60,40,0.7); cursor:pointer; text-decoration:underline;" @click="viewMode='login'">{{$t('userRegistrationBackToLogin')}}</span>
                                </div>
                            </div>

                        </template>

                        <div style="padding-top:30px" v-if="viewMode==='login'"></div>

                        <div style="padding:5px 0px; text-align:center;" v-if="viewMode==='login'">
                            <WButtonChip
                                :displayType="'line'"
                                :style="`opacity:${hasAcPw?1:0.5};`"
                                :text="$t('login')"
                                :textFontSize="'1.0rem'"
                                :paddingStyle="{v:8,h:0}"
                                :backgroundColor="'rgba(255,255,255,0.5)'"
                                :backgroundColorHover="'rgba(255,255,255,0.7)'"
                                _shadow="false"
                                :editable="hasAcPw"
                                :promiseUnlock="true"
                                @click="onClickLoginBtn"
                            ></WButtonChip>
                        </div>

                        <div style="padding-top:8px; font-size:0.85rem; color:#c62828; text-align:center; font-weight:500;" v-if="viewMode==='login' && loginError">
                            {{loginError}}
                        </div>

                        <div style="padding:5px 0px; text-align:center;" v-if="viewMode==='login' && allowUserRegistration && !showResendVerify">
                            <div style="padding-top:10px;">
                                <span style="font-size:0.85rem; color:rgba(80,60,40,0.7); cursor:pointer; text-decoration:underline;" @click="viewMode='register'">{{$t('userRegistration')}}</span>
                            </div>
                        </div>

                        <div style="padding:5px 0px; text-align:center;" v-if="viewMode==='login' && showResendVerify">
                            <div style="padding-top:10px;">
                                <span style="font-size:0.85rem; color:rgba(80,60,40,0.7); cursor:pointer; text-decoration:underline;" @click="viewMode='resend'">{{$t('userRegistrationResendVerify')}}</span>
                            </div>
                        </div>

                        <template v-if="viewMode==='resend'">

                            <div style="padding-top:10px"></div>

                            <div style="display:flex; align-items:stretch;">
                                <div style="display:flex; align-items:center; padding:0px 10px; background:rgba(34, 44, 77, 0.9);">
                                    <WIcon
                                        :icon="mdiEmail"
                                        :color="'#ddd'"
                                        :colorHover="'#eee'"
                                        :size="24"
                                    ></WIcon>
                                </div>
                                <div style="width:100%; padding:5px 10px; background:rgba(34, 44, 77, 0.8);">
                                    <div :style="`font-size:0.8rem; color:#eee;`">{{$t('userRegistrationEmail')}}</div>
                                    <WText
                                        :textColor="'#fff'"
                                        :bottomLineBorderColor="'#b6b6b6'"
                                        :bottomLineBorderColorHover="'#ccc'"
                                        :bottomLineBorderColorFocus="'#ddd'"
                                        v-model="resendEmail"
                                    ></WText>
                                </div>
                            </div>

                            <div style="padding-top:20px"></div>

                            <div style="padding:5px 0px; text-align:center;">
                                <WButtonChip
                                    :displayType="'line'"
                                    :text="$t('userRegistrationResendSubmit')"
                                    :textFontSize="'1.0rem'"
                                    :paddingStyle="{v:8,h:0}"
                                    :backgroundColor="'rgba(255,255,255,0.5)'"
                                    :backgroundColorHover="'rgba(255,255,255,0.7)'"
                                    _shadow="false"
                                    :promiseUnlock="true"
                                    @click="onClickResendVerifyBtn"
                                ></WButtonChip>
                            </div>

                            <div style="padding-top:8px; font-size:0.85rem; color:#c62828; text-align:center; font-weight:500;" v-if="resendError">
                                {{resendError}}
                            </div>

                            <div style="padding:5px 0px; text-align:center;">
                                <div style="padding-top:10px;">
                                    <span style="font-size:0.85rem; color:rgba(80,60,40,0.7); cursor:pointer; text-decoration:underline;" @click="viewMode='login'">{{$t('userRegistrationBackToLogin')}}</span>
                                </div>
                            </div>

                        </template>

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
import WIcon from 'w-component-vue/src/components/WIcon.vue'
import WText from 'w-component-vue/src/components/WText.vue'
import WTextSelect from 'w-component-vue/src/components/WTextSelect.vue'
import WButtonChip from 'w-component-vue/src/components/WButtonChip.vue'
import { mdiAccount, mdiLock, mdiEye, mdiEyeOff, mdiLockCheck, mdiRenameBox, mdiEmail } from '@mdi/js/mdi.js'


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

            mdiAccount,
            mdiLock,
            mdiEye,
            mdiEyeOff,
            mdiLockCheck,
            mdiRenameBox,
            mdiEmail,

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

            viewMode: 'login', // 'login' or 'register'
            regName: '',
            regEmail: '',
            regConfirmPassword: '',

            showResendVerify: false,
            resendEmail: '',
            resendError: '',

            regError: '',

            loginError: '',

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
            //setLang(null) 走 getLang 的優先序（URL > store > window），不會被 webInfor 預設覆蓋
            //store 在 App.vue beforeMount 已依 URL/window 設好；使用者後續切語系也存於 store
            vo.$ui.setLang(null, 'layout mounted')

            //會觸發數據變更再導致opt變更導致觸發rowsChange等事件, 故得要延遲, 供組件偵測初始設定數據初始化之用
            setTimeout(() => {
                vo.firstSetting = false
                // console.log('firstSetting', vo.firstSetting)
            }, 1)

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

        lang: function() {
            let vo = this
            return get(vo, '$store.state.lang', '')
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

        hasAcPw: function() {
            let vo = this
            return isestr(vo.account) && isestr(vo.password)
        },

        allowUserRegistration: function() {
            let vo = this
            return get(vo, 'webInfor.allowUserRegistration', false)
        },

        passwordPolicyInfo: function() {
            let vo = this
            return get(vo, 'webInfor.passwordPolicyInfo', {})
        },

        hasRegFields: function() {
            let vo = this
            return isestr(vo.account) && isestr(vo.password) && isestr(vo.regConfirmPassword) && isestr(vo.regName) && isestr(vo.regEmail)
        },

        regPasswordErrors: function() {
            let vo = this
            let pw = vo.password
            if (!isestr(pw)) return []
            if (vo.viewMode !== 'register') return []
            let p = vo.passwordPolicyInfo
            if (!p || !p.minLength) return []
            let errs = []
            if (pw.length < p.minLength) {
                errs.push(vo.$t('userPassword_keyLimNumLenMin').replace('{minLength}', p.minLength))
            }
            if (pw.length > p.maxLength) {
                errs.push(vo.$t('userPassword_keyLimNumLenMax').replace('{maxLength}', p.maxLength))
            }
            if (p.requireLetter && !/[a-zA-Z]/.test(pw)) {
                errs.push(vo.$t('userPassword_keyLimRequireLetter'))
            }
            if (p.requireUppercase && !/[A-Z]/.test(pw)) {
                errs.push(vo.$t('userPassword_keyLimRequireUppercase'))
            }
            if (p.requireLowercase && !/[a-z]/.test(pw)) {
                errs.push(vo.$t('userPassword_keyLimRequireLowercase'))
            }
            if (p.requireDigit && !/[0-9]/.test(pw)) {
                errs.push(vo.$t('userPassword_keyLimRequireDigit'))
            }
            if (p.requireSpecial && !/[^a-zA-Z0-9]/.test(pw)) {
                errs.push(vo.$t('userPassword_keyLimRequireSpecial'))
            }
            return errs
        },

        regConfirmPasswordError: function() {
            let vo = this
            if (!isestr(vo.regConfirmPassword)) return ''
            if (vo.viewMode !== 'register') return ''
            if (vo.password !== vo.regConfirmPassword) {
                return vo.$t('userChangePasswordNotSame')
            }
            return ''
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

        register: function() {
            let vo = this
            let lang = get(vo, '$store.state.lang', 'eng')

            let core = async () => {

                //1) 初始化：清空上次 inline 錯誤
                vo.regError = ''

                //2) 事先檢測 (D12: 同步 early-return, 在開 loading 之前) — 密碼不符 / 密碼政策不過則不送出
                if (vo.password !== vo.regConfirmPassword) {
                    vo.regError = vo.$t('userChangePasswordNotSame') //與後端 createUser 同 key, 防帳號列舉前先擋
                    return
                }
                if (vo.regPasswordErrors.length > 0) {
                    vo.regError = vo.regPasswordErrors[0] //顯示首條密碼政策錯誤 (與 reactive 提示同源)
                    return
                }

                //3) 確定要打 API 才開 loading
                vo.$ui.updateLoading(true)

                let ok = false
                await vo.$fapi.createUser(lang, vo.account, vo.password, vo.regConfirmPassword, vo.regName, vo.regEmail)
                    .then(() => {
                        ok = true
                    })
                    .catch((err) => {
                        //後端統一 reject { key, msg }: msg 已依 lang 翻譯, 直接顯示 (不再以 raw 英文字串判斷種類)
                        vo.regError = isestr(err) ? vo.$tErr(err) : vo.$t('loginUnknownError')
                    })

                //API 有錯 (catch 已設 vo.regError inline 紅字) → 中止, 不往下走成功流程
                if (!ok) {
                    return
                }

                //4) 成功 (非重導, 僅切回 login viewMode)
                //close before showCheckYes (ADR-002 modal 等待期避免 loading 疊著);
                //finally 仍會再呼叫一次當作兜底, updateLoading 對重複關閉是 idempotent
                vo.$ui.updateLoading(false)
                await vo.$dg.showCheckYes(vo.$t('userRegistrationSuccess'), { type: 'success' })
                vo.regName = ''
                vo.regEmail = ''
                vo.regConfirmPassword = ''
                vo.viewMode = 'login'

                return 'ok'
            }

            //core
            return core()
                .catch((err) => {
                    console.log('catch', err)
                    vo.$alert(vo.$t('anUnexpectedErrorOccurred'), { type: 'error' })
                })
                .finally(() => {

                    //hide loading
                    vo.$ui.updateLoading(false)

                })

        },

        onClickRegisterBtn: function(msg) {
            //pm.resolve 立即釋放 button 視覺鎖 (對齊 w-component-vue「需使用promise解鎖」設計意圖).
            //同步雙擊由 WButtonChip clickBtn `if (loadingTrans) return` 擋, 非同步雙擊由 register 內部
            //updateLoading 全頁 overlay 接管. 詳見 PageUser.onClickSubmitChangePasswordBtn 註解.
            let vo = this
            msg.pm.resolve()
            vo.register()
        },

        resendVerify: function() {
            let vo = this
            let lang = get(vo, '$store.state.lang', 'eng')

            let core = async () => {

                //1) 初始化：清空上次 inline 錯誤
                vo.resendError = ''

                //2) 事先檢測：email 為空不送出 (送出鈕未 disabled, 須在此擋, 避免空 email 打 API)
                if (!isestr(vo.resendEmail)) {
                    vo.resendError = vo.$t('userRegistrationResendInvalidEmail')
                    return
                }

                //3) 確定要打 API 才開 loading
                vo.$ui.updateLoading(true)

                //4) 執行: 用 okX 旗標 + 短路 (canonical §5.1 style, 與 submitRegister 對齊)
                let ok = false
                await vo.$fapi.resendVerifyEmail(lang, vo.account, vo.resendEmail)
                    .then(() => {
                        ok = true
                    })
                    .catch((err) => {
                        //後端統一 reject key 字串: 以 $t(key) 顯示 (字典查無回 key 本身); 非字串 (網路錯) 回通用訊息
                        vo.resendError = isestr(err) ? vo.$tErr(err) : vo.$t('loginUnknownError')
                    })
                if (!ok) {
                    return
                }

                //5) 成功 (非重導, 僅切回 login viewMode)
                //close before showCheckYes (ADR-002 modal 等待期避免 loading 疊著);
                //finally 仍會再呼叫一次當作兜底, updateLoading 對重複關閉是 idempotent
                vo.$ui.updateLoading(false)
                await vo.$dg.showCheckYes(vo.$t('userRegistrationResendSuccess'), { type: 'success' })
                vo.showResendVerify = false
                vo.loginError = ''
                vo.viewMode = 'login'

                return 'ok'
            }

            //core
            return core()
                .catch((err) => {
                    console.log('catch', err)
                    vo.$alert(vo.$t('anUnexpectedErrorOccurred'), { type: 'error' })
                })
                .finally(() => {

                    //hide loading
                    vo.$ui.updateLoading(false)

                })

        },

        onClickResendVerifyBtn: function(msg) {
            //同 onClickRegisterBtn: handler 立刻 pm.resolve, fire-and-forget resendVerify.
            let vo = this
            msg.pm.resolve()
            vo.resendVerify()
        },

        onClickLoginBtn: function(msg) {
            //同 onClickRegisterBtn: handler 第一行立即 pm.resolve 釋放 button 視覺鎖, fire-and-forget login.
            //同步雙擊由 WButtonChip clickBtn `if (loadingTrans) return` 擋, 非同步雙擊由 mUI.login 內部
            //updateLoading 全頁 overlay 接管 (登入特例: 成功轉址路徑不關 loading, 見 mUI.login hideLoadingForEnd).
            let vo = this
            msg.pm.resolve()
            vo.login()
        },

        login: function() {
            // console.log('methods login')

            let vo = this

            //view
            let view = vo.$ui.getUrlView()

            //清除上次錯誤
            vo.loginError = ''
            vo.showResendVerify = false

            //login
            //強制變更密碼模式: 若 userSelf.isForceChangePw === 'y', 不走 useRedir,
            //而是登入後 showCheckYes 提示再進 user view (見 .then 內部讀最新 userSelf 處理)
            vo.$ui.login(vo.account, vo.password, { useRedir: view === 'login' })
                .then(async () => {

                    //login 成功後 store.userSelf 已被 mUI updateUserSelf 寫入
                    let userSelf = get(vo, '$store.state.userSelf', {})
                    let isForce = get(userSelf, 'isForceChangePw', '') === 'y'

                    if (isForce) {
                        //不論原本 view 是哪種, 一律導去 user view + 顯示提示
                        await vo.$dg.showCheckYes(vo.$t('userForceChangePwPrompt'))
                        vo.$ui.updateViewState('user')
                        console.log(`login, isForceChangePw=y, goto user view`)
                    }
                    else {
                        //提交變更viewState前往指定功能頁
                        vo.$ui.updateViewState(view)
                        console.log(`login, goto view[${view}] page`)
                    }

                })
                .catch((err) => {

                    //err 一律為 key 字串 (key-only 契約):
                    //(1) 後端登入失敗之 key (failedLoginForCatch / userRegistrationNotVerified / loginAccountBlocked
                    //    / loginAccountExpired) — 於 procLang 字典內, $t 可譯
                    //(2) mUI 前端層 reject 之字串 (invalid redir / invalid user / invalid token / invalid $keyLS)
                    //    — 非字典 key, $t 查無會回原字串
                    if (err === 'userRegistrationNotVerified') {
                        //未驗證帳號: 以 key 判斷 → 顯示「重寄驗證信」連結
                        vo.showResendVerify = true
                        vo.loginError = vo.$tErr(err)
                    }
                    else if (err === 'invalid redir') {
                        //view=login 模式下 user.redir 為空, mUI 已 alert 但 4s 後消失;
                        //inline 紅字保留訊息與設計意圖一致 (參見 spec/流程_使用者一般登入.md)
                        vo.loginError = vo.$t('failedLoginForNoRedir')
                    }
                    else {
                        //字典查得到 (後端 key) → 顯示翻譯; 查不到 (mUI 內部字串 / 非字串) → 通用訊息
                        let t = isestr(err) ? vo.$tErr(err) : ''
                        vo.loginError = (isestr(t) && t !== err) ? t : vo.$t('loginUnknownError')
                        if (!isestr(t) || t === err) {
                            console.log('login unknown error', err)
                        }
                    }

                    //錯誤發生時提交變更viewState返回登入頁
                    vo.$ui.updateViewState('login')
                    console.log(`login err[${JSON.stringify(err)}], goto view['login'] page`)

                })

        },

    }
}
</script>

<style scoped>
</style>
