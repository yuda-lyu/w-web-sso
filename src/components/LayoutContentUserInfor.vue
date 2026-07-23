<template>
    <div
        style="height:100%;"
        v-domresize
        @domresize="resizePanel"
    >

        <div
            style="height:100%; background:#fff; overflow-y:auto;"
            v-if="!firstLoading && !errMsg"
        >

            <div style="padding:40px;">


                <div style="display:flex; align-items:center;">

                    <div
                        style="display:inline-block; padding:0px; _border:1px solid #ddd; border-radius:50%;"
                        v-if="userLogo"
                    >
                        <img style="width:120px; height:120px;" :src="userLogo" />
                    </div>

                    <div style="padding-left:15px;">

                        <div style="font-size:3.0rem;">
                            {{$ui.gv(user,'name')}}
                        </div>

                        <div style="margin-top:-5px; padding-left:2px; font-size:1.5rem;">
                            {{$ui.gv(user,'account')}}
                        </div>

                    </div>

                </div>


                <div class="pt-6 space-y-8">

                    <!-- 帳號狀態區塊：RWD 網格佈局，會根據螢幕寬度自動調整欄數 -->
                    <div>

                        <div class="mb-2 text-xs text-gray-500">{{$t('userStatus')}}</div>

                        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

                            <!-- 帳號封鎖 -->
                            <div v-show="false">
                                {{$t('isBlocked')}}
                            </div>
                            <div :class="`status-${isBlocked?'danger':'success'} flex items-center p-3 rounded-lg`">
                                <WIcon :icon="isBlocked?mdiLock:mdiLockOpenVariant" :size="24" :color="'currentColor'" :colorHover="'currentColor'" class="mr-3 flex-shrink-0"></WIcon>
                                <div>
                                    <div class="font-semibold">
                                        {{isBlocked?$t('isBlockedY'):$t('isBlockedN')}}
                                    </div>
                                    <div :class="`text-xs text-${isBlocked?'red':'green'}-800/80`">
                                        {{
                                            isBlocked
                                                ?
                                                    timeBlockedToDay===''
                                                        ?
                                                            $t('unknow')
                                                        :
                                                            $t('to')+' '+timeBlockedToDay
                                                :
                                                    $t('isBlockedNormalStatus')
                                        }}
                                    </div>
                                </div>
                            </div>

                            <!-- 帳號過期 -->
                            <div v-show="false">
                                {{$t('isExpired')}}
                                {{$t('timeExpired')}}
                            </div>
                            <div :class="`status-${isExpired?'danger':'success'} flex items-center p-3 rounded-lg`">
                                <WIcon :icon="isExpired?mdiCalendarLock:mdiCalendarCheck" :size="24" :color="'currentColor'" :colorHover="'currentColor'" class="mr-3 flex-shrink-0"></WIcon>
                                <div>
                                    <div class="font-semibold">
                                        {{isExpired?$t('isExpiredY'):$t('isExpiredN')}}
                                    </div>
                                    <div :class="`text-xs text-${isExpired?'red':'green'}-800/80`">
                                        {{
                                            isExpired
                                                ?
                                                    $t('isExpiredDeny')
                                                :
                                                    timeExpiredToDay===''
                                                        ?
                                                            $t('isExpiredNever')
                                                        :
                                                            $t('to')+' '+timeExpiredToDay
                                        }}
                                    </div>
                                </div>
                            </div>

                            <!-- 帳號驗證 -->
                            <div v-show="false">
                                {{$t('isVerified')}}
                                {{$t('timeVerified')}}
                            </div>
                            <div :class="`status-${isVerified?'success':'danger'} flex items-center p-3 rounded-lg`">
                                <WIcon :icon="isVerified?mdiCheckDecagram:mdiAlertDecagramOutline" :size="24" :color="'currentColor'" :colorHover="'currentColor'" class="mr-3 flex-shrink-0"></WIcon>
                                <div>
                                    <div class="font-semibold">
                                        {{isVerified?$t('isVerifiedY'):$t('isVerifiedN')}}
                                    </div>
                                    <div :class="`text-xs text-${isVerified?'green':'red'}-800/80`">
                                        {{
                                            isVerified
                                                ?
                                                    timeVerifiedToDay===''
                                                        ?
                                                            $t('unknow')
                                                        :
                                                            $t('at')+' '+timeVerifiedToDay
                                                :
                                                    $t('isVerifiedWaiting')
                                        }}
                                    </div>
                                </div>
                            </div>

                            <!-- 帳號有效 -->
                            <div v-show="false">
                                {{$t('isActive')}}
                            </div>
                            <div :class="`status-${$ui.gv(user,'isActive','')==='y'?'success':'danger'} flex items-center p-3 rounded-lg`">
                                <WIcon :icon="$ui.gv(user,'isActive','')==='y'?mdiToggleSwitch:mdiToggleSwitchOffOutline" :size="24" :color="'currentColor'" :colorHover="'currentColor'" class="mr-3 flex-shrink-0"></WIcon>
                                <div>
                                    <div class="font-semibold">
                                        {{$ui.gv(user,'isActive','')==='y'?$t('isActiveY'):$t('isActiveN')}}
                                    </div>
                                    <div :class="`text-xs text-${$ui.gv(user,'isActive','')==='y'?'green':'red'}-800/80`">
                                        {{$ui.gv(user,'isActive','')==='y'?$t('isActiveMsgY'):$t('isActiveMsgN')}}
                                    </div>
                                </div>
                            </div>

                        </div>
                    </div>

                    <!-- 詳細資訊區塊：同樣採用 RWD 網格佈局 -->
                    <div>

                        <div class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6 pt-6 border-t border-gray-200">

                            <!-- 帳號 -->
                            <div class="flex items-start gap-3">
                                <WIcon :icon="mdiAccountCircle" :size="20" :color="'currentColor'" :colorHover="'currentColor'" class="text-gray-400 mt-1 flex-shrink-0"></WIcon>
                                <div>
                                    <div class="text-sm text-gray-500">{{$t('account')}}</div>
                                    <div class="text-base font-medium text-gray-900">
                                        {{$ui.gv(user,'account')}}
                                    </div>
                                </div>
                            </div>

                            <!-- 描述 -->
                            <div class="flex items-start gap-3">
                                <WIcon :icon="mdiCommentTextOutline" :size="20" :color="'currentColor'" :colorHover="'currentColor'" class="text-gray-400 mt-1 flex-shrink-0"></WIcon>
                                <div>
                                    <div class="text-sm text-gray-500">{{$t('description')}}</div>
                                    <div class="text-base font-medium text-gray-900">
                                        {{$ui.gv(user,'description')}}
                                    </div>
                                </div>
                            </div>

                            <!-- 電子郵件 -->
                            <div class="flex items-start gap-3">
                                <WIcon :icon="mdiEmailOutline" :size="20" :color="'currentColor'" :colorHover="'currentColor'" class="text-gray-400 mt-1 flex-shrink-0"></WIcon>
                                <div>
                                    <div class="text-sm text-gray-500">{{$t('email')}}</div>
                                    <div class="inline-block text-base bg-gray-100 mt-1 px-2 py-1 rounded-md text-gray-700 break-all text-sm">
                                        {{$ui.gv(user,'email')}}
                                    </div>
                                </div>
                            </div>

                            <!-- 來源 -->
                            <div class="flex items-start gap-3">
                                <WIcon :icon="mdiSourceBranch" :size="20" :color="'currentColor'" :colorHover="'currentColor'" class="text-gray-400 mt-1 flex-shrink-0"></WIcon>
                                <div>
                                    <div class="text-sm text-gray-500">{{$t('from')}}</div>
                                    <div class="inline-block text-base bg-gray-100 mt-1 px-2 py-1 rounded-md text-gray-700 break-all text-sm">
                                        {{$ui.gv(user,'from')}}
                                    </div>
                                </div>
                            </div>

                            <!-- 身份 -->
                            <div class="flex items-start gap-3">
                                <WIcon :icon="mdiIdCard" :size="20" :color="'currentColor'" :colorHover="'currentColor'" class="text-gray-400 mt-1 flex-shrink-0"></WIcon>
                                <div>
                                    <div class="text-sm text-gray-500">{{$t('userRole')}}</div>
                                    <div class="inline-block text-base bg-blue-100 mt-1 px-2 py-1 rounded-md text-blue-700 break-all text-sm">
                                        {{$ui.gv(user,'isAdmin','')==='y'?$t('userRoleAdmin'):$t('userRoleGeneral')}}
                                    </div>
                                </div>
                            </div>

                            <!-- 登入後轉址 -->
                            <div class="flex items-start gap-3 md:col-span-2">
                                <WIcon :icon="mdiLinkVariant" :size="20" :color="'currentColor'" :colorHover="'currentColor'" class="text-gray-400 mt-1 flex-shrink-0"></WIcon>
                                <div>
                                    <div class="text-sm text-gray-500">{{$t('redir')}}</div>
                                    <div class="inline-block text-base bg-gray-100 mt-1 px-2 py-1 rounded-md text-gray-700 break-all text-sm">
                                        {{$ui.gv(user,'redir')}}
                                    </div>
                                </div>
                            </div>

                        </div>

                    </div>

                </div>


            </div>

        </div>
        <template v-else>
            <div
                style="padding:10px 15px; font-size:0.8rem;"
                v-if="firstLoading"
            >
                {{$t('waitingData')}}
            </div>
            <div
                style="padding:10px 15px; font-size:0.8rem;"
                v-if="errMsg"
            >
                {{errMsg}}
            </div>
        </template>

    </div>
</template>

<script>
import { mdiLock, mdiLockOpenVariant, mdiCalendarLock, mdiCalendarCheck, mdiCheckDecagram, mdiAlertDecagramOutline, mdiToggleSwitch, mdiToggleSwitchOffOutline, mdiAccountCircle, mdiCommentTextOutline, mdiEmailOutline, mdiSourceBranch, mdiIdCard, mdiLinkVariant } from '@mdi/js/mdi.js'
import WIcon from 'w-component-vue/src/components/WIcon.vue'
import ot from 'dayjs'
import get from 'lodash-es/get.js'
import istimemsTZ from 'wsemi/src/istimemsTZ.mjs'


export default {
    components: {
        WIcon,
    },
    props: {
    },
    data: function() {
        return {
            mdiLock,
            mdiLockOpenVariant,
            mdiCalendarLock,
            mdiCalendarCheck,
            mdiCheckDecagram,
            mdiAlertDecagramOutline,
            mdiToggleSwitch,
            mdiToggleSwitchOffOutline,
            mdiAccountCircle,
            mdiCommentTextOutline,
            mdiEmailOutline,
            mdiSourceBranch,
            mdiIdCard,
            mdiLinkVariant,
            // mdiAccountPlusOutline,
            // mdiCheckboxMarkedCircle,
            // mdiChessRook,

            panelWidth: 100,
            panelHeight: 100,
            headHeight: 100,
            // groupInforHeight: 100,

            firstLoading: true,
            errMsg: '',
            // isModified: false,

            user: null,

        }
    },
    mounted: function() {
        let vo = this

        //firstLoading, errMsg
        vo.firstLoading = true
        vo.errMsg = ''

        //token
        let token = vo.userToken
        // console.log('token', token)

        //getUserByToken
        vo.$fapi.getUserByToken(token)
            .then((res) => {
                // console.log(res)
                vo.user = res
            })
            .catch((err) => {
                console.log(err)
                vo.errMsg = vo.$t('getDataError')
            })
            .finally(() => {
                vo.firstLoading = false
            })

    },
    computed: {

        userToken: function() {
            let vo = this
            return get(vo, `$store.state.userToken`)
        },

        userLogo: function() {
            let vo = this
            return get(vo, `$store.state.webInfor.userLogo`, '')
        },

        isVerified: function() {
            let vo = this

            //user
            let user = get(vo, 'user')

            //getIsVerified
            let b = vo.$s.getIsVerified(user)

            return b
        },

        timeVerifiedToDay: function() {
            let vo = this

            //timeVerified
            let timeVerified = get(vo, 'user.timeVerified', '')
            // console.log('timeVerified', timeVerified)

            //check
            if (!istimemsTZ(timeVerified)) {
                return '' //無驗證時間, 代表未驗證
            }

            //tt
            let tt = ot(timeVerified, 'YYYY-MM-DDTHH:mm:ss.SSSZ')
            // console.log('tt', tt)

            //t
            let t = tt.format('YYYY-MM-DD')

            return t
        },

        isExpired: function() {
            let vo = this

            //user
            let user = get(vo, 'user')

            //getIsExpired
            let b = vo.$s.getIsExpired(user)

            return b
        },

        timeExpiredToDay: function() {
            let vo = this

            //timeExpired
            let timeExpired = get(vo, 'user.timeExpired', '')
            // console.log('timeExpired', timeExpired)

            //check
            if (!istimemsTZ(timeExpired)) {
                return '' //無過期時間, 代表未過期
            }

            //tt
            let tt = ot(timeExpired, 'YYYY-MM-DDTHH:mm:ss.SSSZ')
            // console.log('tt', tt)

            //t
            let t = tt.format('YYYY-MM-DD')

            return t
        },

        isBlocked: function() {
            let vo = this

            //user
            let user = get(vo, 'user')

            //getIsBlocked
            let b = vo.$s.getIsBlocked(user)

            return b
        },

        timeBlockedToDay: function() {
            let vo = this

            //timeBlocked
            let timeBlocked = get(vo, 'user.timeBlocked', '')
            // console.log('timeBlocked', timeBlocked)

            //check
            if (!istimemsTZ(timeBlocked)) {
                return '' //無封鎖時間, 代表未封鎖
            }

            //tt
            let tt = ot(timeBlocked, 'YYYY-MM-DDTHH:mm:ss.SSSZ')
            // console.log('tt', tt)

            //t
            let t = tt.format('YYYY-MM-DD')

            return t
        },

    },
    methods: {

        resizePanel: function(msg) {
            // console.log('methods resizePanel', msg)

            let vo = this

            //panelWidth, panelHeight
            vo.panelWidth = msg.snew.offsetWidth
            vo.panelHeight = msg.snew.offsetHeight

        },

    }
}
</script>

<style scoped>
/* === Tailwind utility (非響應式) 同名定義: LayoutContentUserInfor; 由實際 Tailwind v3 產生規則抽出, 與 CDN 逐字一致 === */
.bg-blue-100 { --tw-bg-opacity: 1; background-color: rgb(219 234 254 / var(--tw-bg-opacity, 1)); }
.bg-gray-100 { --tw-bg-opacity: 1; background-color: rgb(243 244 246 / var(--tw-bg-opacity, 1)); }
.border-gray-200 { --tw-border-opacity: 1; border-color: rgb(229 231 235 / var(--tw-border-opacity, 1)); }
.border-t { border-top-width: 1px; }
.break-all { word-break: break-all; }
.flex { display: flex; }
.flex-shrink-0 { flex-shrink: 0; }
.font-medium { font-weight: 500; }
.font-semibold { font-weight: 600; }
.gap-3 { gap: 0.75rem; }
.gap-4 { gap: 1rem; }
.gap-x-8 { column-gap: 2rem; }
.gap-y-6 { row-gap: 1.5rem; }
.inline-block { display: inline-block; }
.items-center { align-items: center; }
.items-start { align-items: flex-start; }
.mb-2 { margin-bottom: 0.5rem; }
.mr-3 { margin-right: 0.75rem; }
.mt-1 { margin-top: 0.25rem; }
.p-3 { padding: 0.75rem; }
.pt-6 { padding-top: 1.5rem; }
.px-2 { padding-left: 0.5rem; padding-right: 0.5rem; }
.py-1 { padding-top: 0.25rem; padding-bottom: 0.25rem; }
.rounded-lg { border-radius: 0.5rem; }
.rounded-md { border-radius: 0.375rem; }
.space-y-8 > :not([hidden]) ~ :not([hidden]) { --tw-space-y-reverse: 0; margin-top: calc(2rem * calc(1 - var(--tw-space-y-reverse))); margin-bottom: calc(2rem * var(--tw-space-y-reverse)); }
.text-base { font-size: 1rem; line-height: 1.5rem; }
.text-blue-700 { --tw-text-opacity: 1; color: rgb(29 78 216 / var(--tw-text-opacity, 1)); }
.text-gray-400 { --tw-text-opacity: 1; color: rgb(156 163 175 / var(--tw-text-opacity, 1)); }
.text-gray-500 { --tw-text-opacity: 1; color: rgb(107 114 128 / var(--tw-text-opacity, 1)); }
.text-gray-700 { --tw-text-opacity: 1; color: rgb(55 65 81 / var(--tw-text-opacity, 1)); }
.text-gray-900 { --tw-text-opacity: 1; color: rgb(17 24 39 / var(--tw-text-opacity, 1)); }
.text-sm { font-size: 0.875rem; line-height: 1.25rem; }
.text-xs { font-size: 0.75rem; line-height: 1rem; }
.text-red-800\/80 { color: rgba(153, 27, 27, 0.8); }
.text-green-800\/80 { color: rgba(22, 101, 52, 0.8); }

.grid { display: grid; }
.grid-cols-1 { grid-template-columns: repeat(1, minmax(0px, 1fr)); }
@media (min-width: 640px) {
    .sm\:grid-cols-2 { grid-template-columns: repeat(2, minmax(0px, 1fr)); }
}
@media (min-width: 768px) {
    .md\:grid-cols-2 { grid-template-columns: repeat(2, minmax(0px, 1fr)); }
    .md\:col-span-2 { grid-column: span 2 / span 2; }
}
@media (min-width: 1024px) {
    .lg\:grid-cols-4 { grid-template-columns: repeat(4, minmax(0px, 1fr)); }
}

.status-danger {
    background-color: #fef2f2; color: #b91c1c; border: 1px solid #fecaca;
}
.status-warning {
    background-color: #fffbeb; color: #b45309; border: 1px solid #fde68a;
}
.status-success {
    background-color: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0;
}
.status-info {
    background-color: #f8fafc; color: #475569; border: 1px solid #e2e8f0;
}
</style>
