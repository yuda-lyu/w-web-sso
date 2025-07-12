<template>
    <div
        style="height:100%;"
        v-domresize
        @domresize="resizePanel"
    >

        <div
            style="height:100%; background:#fff; overflow-y:auto;"
            v-if="!isLoading && !errMsg"
        >

            <div style="padding:40px;">


                <div style="display:flex; align-items:center;">

                    <div style="display:inline-block; padding:0px; _border:1px solid #ddd; border-radius:50%;" v-if="false">
                        <svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 24 24"><path fill="currentColor" d="M6.196 17.485q1.275-.918 2.706-1.451Q10.332 15.5 12 15.5t3.098.534t2.706 1.45q.99-1.025 1.593-2.42Q20 13.667 20 12q0-3.325-2.337-5.663T12 4T6.337 6.338T4 12q0 1.667.603 3.064q.603 1.396 1.593 2.42m5.805-4.984q-1.264 0-2.133-.868T9 9.501t.868-2.133T12 6.5t2.132.868T15 9.5t-.868 2.132t-2.131.868M12 21q-1.883 0-3.525-.701t-2.858-1.916t-1.916-2.858T3 12t.701-3.525t1.916-2.858q1.216-1.215 2.858-1.916T12 3t3.525.701t2.858 1.916t1.916 2.858T21 12t-.701 3.525t-1.916 2.858q-1.216 1.215-2.858 1.916T12 21m0-1q1.383 0 2.721-.484q1.338-.483 2.313-1.324q-.974-.783-2.255-1.237T12 16.5t-2.789.445t-2.246 1.247q.975.84 2.314 1.324T12 20m0-8.5q.842 0 1.421-.579T14 9.5t-.579-1.421T12 7.5t-1.421.579T10 9.5t.579 1.421T12 11.5m0 6.75"/></svg>
                    </div>

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
                                <i :class="`mdi ${isBlocked?'mdi-lock':'mdi-lock-open-variant'} mdi-24px mr-3 flex-shrink-0`"></i>
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
                                <i :class="`mdi ${isExpired?'mdi-calendar-lock':'mdi-calendar-check'} mdi-24px mr-3 flex-shrink-0`"></i>
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
                                <i :class="`mdi ${isVerified?'mdi-check-decagram':'mdi-alert-decagram-outline'} mdi-24px mr-3 flex-shrink-0`"></i>
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
                                <i :class="`mdi ${$ui.gv(user,'isActive','')==='y'?'mdi-toggle-switch':'mdi-toggle-switch-off-outline'} mdi-24px mr-3 flex-shrink-0`"></i>
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
                                <i class="mdi mdi-account-circle text-gray-400 mdi-20px mt-1 flex-shrink-0"></i>
                                <div>
                                    <div class="text-sm text-gray-500">{{$t('account')}}</div>
                                    <div class="text-base font-medium text-gray-900">
                                        {{$ui.gv(user,'account')}}
                                    </div>
                                </div>
                            </div>

                            <!-- 描述 -->
                            <div class="flex items-start gap-3">
                                <i class="mdi mdi-comment-text-outline text-gray-400 mdi-20px mt-1 flex-shrink-0"></i>
                                <div>
                                    <div class="text-sm text-gray-500">{{$t('description')}}</div>
                                    <div class="text-base font-medium text-gray-900">
                                        {{$ui.gv(user,'description')}}
                                    </div>
                                </div>
                            </div>

                            <!-- 電子郵件 -->
                            <div class="flex items-start gap-3">
                                <i class="mdi mdi-email-outline text-gray-400 mdi-20px mt-1 flex-shrink-0"></i>
                                <div>
                                    <div class="text-sm text-gray-500">{{$t('email')}}</div>
                                    <div class="inline-block text-base bg-gray-100 mt-1 px-2 py-1 rounded-md text-gray-700 break-all text-sm">
                                        {{$ui.gv(user,'email')}}
                                    </div>
                                </div>
                            </div>

                            <!-- 來源 -->
                            <div class="flex items-start gap-3">
                                <i class="mdi mdi-source-branch text-gray-400 mdi-20px mt-1 flex-shrink-0"></i>
                                <div>
                                    <div class="text-sm text-gray-500">{{$t('from')}}</div>
                                    <div class="inline-block text-base bg-gray-100 mt-1 px-2 py-1 rounded-md text-gray-700 break-all text-sm">
                                        {{$ui.gv(user,'from')}}
                                    </div>
                                </div>
                            </div>

                            <!-- 身份 -->
                            <div class="flex items-start gap-3">
                                <i class="mdi mdi-id-card text-gray-400 mdi-20px mt-1 flex-shrink-0"></i>
                                <div>
                                    <div class="text-sm text-gray-500">{{$t('userRole')}}</div>
                                    <div class="inline-block text-base bg-blue-100 mt-1 px-2 py-1 rounded-md text-blue-700 break-all text-sm">
                                        {{$ui.gv(user,'isAdmin','')==='y'?$t('userRoleAdmin'):$t('userRoleGeneral')}}
                                    </div>
                                </div>
                            </div>

                            <!-- 登入後轉址 -->
                            <div class="flex items-start gap-3 md:col-span-2">
                                <i class="mdi mdi-link-variant text-gray-400 mdi-20px mt-1 flex-shrink-0"></i>
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


                <div v-if="false">

                    <WPanelLabelItem
                        style="padding:5px 0px;"
                        :label="$t('account')"
                    >
                        <template v-slot:item>

                            <div style="font-size:0.9rem;">
                                {{$ui.gv(user,'account')}}
                            </div>

                            <!-- <WText
                                :value="'Adelina'"
                                :text-font-size="'0.85rem'"
                            ></WText> -->
                        </template>
                    </WPanelLabelItem>

                    <WPanelLabelItem
                        style="padding:5px 0px;"
                        :label="$t('description')"
                    >
                        <template v-slot:item>

                            <div style="font-size:0.9rem;">
                                {{$ui.gv(user,'description')}}
                            </div>

                            <!-- <WText
                                :value="'Adelina'"
                                :text-font-size="'0.85rem'"
                            ></WText> -->
                        </template>
                    </WPanelLabelItem>

                    <WPanelLabelItem
                        style="padding:5px 0px;"
                        :label="$t('email')"
                    >
                        <template v-slot:item>

                            <div style="font-size:0.9rem;">
                                {{$ui.gv(user,'email')}}
                            </div>

                            <!-- <WText
                                :value="'Adelina'"
                                :text-font-size="'0.85rem'"
                            ></WText> -->
                        </template>
                    </WPanelLabelItem>

                    <WPanelLabelItem
                        style="padding:5px 0px;"
                        :label="$t('from')"
                    >
                        <template v-slot:item>

                            <div style="font-size:0.9rem;">
                                {{$ui.gv(user,'from')}}
                            </div>

                            <!-- <WText
                                :value="'Adelina'"
                                :text-font-size="'0.85rem'"
                            ></WText> -->
                        </template>
                    </WPanelLabelItem>

                    <WPanelLabelItem
                        style="padding:5px 0px;"
                        :label="$t('isAdmin')"
                    >
                        <template v-slot:item>

                            <div style="font-size:0.9rem;">
                                {{$ui.gv(user,'isAdmin','')==='y'?$t('isAdminY'):$t('isAdminN')}}
                            </div>

                            <!-- <WText
                                :value="'Adelina'"
                                :text-font-size="'0.85rem'"
                            ></WText> -->
                        </template>
                    </WPanelLabelItem>

                    <WPanelLabelItem
                        style="padding:5px 0px;"
                        :label="$t('isVerified')"
                    >
                        <template v-slot:item>

                            <div style="font-size:0.9rem;">
                                {{isVerified?$t('isVerifiedY'):$t('isVerifiedN')}}
                            </div>

                            <!-- <WText
                                :value="'Adelina'"
                                :text-font-size="'0.85rem'"
                            ></WText> -->
                        </template>
                    </WPanelLabelItem>

                    <WPanelLabelItem
                        style="padding:5px 0px;"
                        :label="$t('timeVerified')"
                    >
                        <template v-slot:item>

                            <div style="font-size:0.9rem;">
                                {{$ui.gv(user,'timeVerified')}}
                            </div>

                            <!-- <WText
                                :value="'Adelina'"
                                :text-font-size="'0.85rem'"
                            ></WText> -->
                        </template>
                    </WPanelLabelItem>

                    <WPanelLabelItem
                        style="padding:5px 0px;"
                        :label="$t('isExpired')"
                    >
                        <template v-slot:item>

                            <div style="font-size:0.9rem;">
                                {{isExpired?$t('isExpiredY'):$t('isExpiredN')}}
                            </div>

                            <!-- <WText
                                :value="'Adelina'"
                                :text-font-size="'0.85rem'"
                            ></WText> -->
                        </template>
                    </WPanelLabelItem>

                    <WPanelLabelItem
                        style="padding:5px 0px;"
                        :label="$t('timeExpired')"
                    >
                        <template v-slot:item>

                            <div style="font-size:0.9rem;">
                                {{$ui.gv(user,'timeExpired')}}
                            </div>

                            <!-- <WText
                                :value="'Adelina'"
                                :text-font-size="'0.85rem'"
                            ></WText> -->
                        </template>
                    </WPanelLabelItem>

                    <WPanelLabelItem
                        style="padding:5px 0px;"
                        :label="$t('isBlocked')"
                    >
                        <template v-slot:item>

                            <div style="font-size:0.9rem;">
                                {{isBlocked?$t('isBlockedY'):$t('isBlockedN')}}
                            </div>

                            <!-- <WText
                                :value="'Adelina'"
                                :text-font-size="'0.85rem'"
                            ></WText> -->
                        </template>
                    </WPanelLabelItem>

                    <WPanelLabelItem
                        style="padding:5px 0px;"
                        :label="$t('userTimeBlocked')"
                    >
                        <template v-slot:item>

                            <div style="font-size:0.9rem;">
                                {{$ui.gv(user,'timeBlocked')}}
                            </div>

                            <!-- <WText
                                :value="'Adelina'"
                                :text-font-size="'0.85rem'"
                            ></WText> -->
                        </template>
                    </WPanelLabelItem>

                    <WPanelLabelItem
                        style="padding:5px 0px;"
                        :label="$t('redir')"
                    >
                        <template v-slot:item>

                            <div style="font-size:0.9rem;">
                                {{$ui.gv(user,'redir')}}
                            </div>

                            <!-- <WText
                                :value="'Adelina'"
                                :text-font-size="'0.85rem'"
                            ></WText> -->
                        </template>
                    </WPanelLabelItem>

                    <WPanelLabelItem
                        style="padding:5px 0px;"
                        :label="$t('isActive')"
                    >
                        <template v-slot:item>

                            <div style="font-size:0.9rem;">
                                {{$ui.gv(user,'isActive','')==='y'?$t('isActiveY'):$t('isActiveN')}}
                            </div>

                            <!-- <WText
                                :value="'Adelina'"
                                :text-font-size="'0.85rem'"
                            ></WText> -->
                        </template>
                    </WPanelLabelItem>

                </div>


            </div>

        </div>
        <template v-else>
            <div
                style="padding:10px 15px; font-size:0.8rem;"
                v-if="isLoading"
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
import { mdiAccountCircleOutline } from '@mdi/js/mdi.js'
import ot from 'dayjs'
import get from 'lodash-es/get.js'
import istimemsTZ from 'wsemi/src/istimemsTZ.mjs'
import WPanelLabelItem from 'w-component-vue/src/components/WPanelLabelItem.vue'


export default {
    components: {
        WPanelLabelItem,
    },
    props: {
    },
    data: function() {
        return {
            mdiAccountCircleOutline,
            // mdiAccountPlusOutline,
            // mdiCheckboxMarkedCircle,
            // mdiChessRook,

            panelWidth: 100,
            panelHeight: 100,
            headHeight: 100,
            // groupInforHeight: 100,

            isLoading: true,
            errMsg: '',
            isOperatable: true,
            // isModified: false,

            user: null,

        }
    },
    mounted: function() {
        let vo = this

        //isLoading, errMsg
        vo.isLoading = true
        vo.errMsg = ''

        //token
        let token = vo.userToken
        // console.log('token', token)

        //getUserByToken
        vo.$fapi.getUserByToken(token)
            .then((res) => {
                // console.log(res)
                // if (Math.random() < 0.5) {
                //     res.timeBlocked = '2026-01-01T00:00:00.000+08:00'
                // }
                // if (Math.random() < 0.5) {
                //     res.timeExpired = '2020-01-01T00:00:00.000+08:00'
                // }
                // if (Math.random() < 0.5) {
                //     res.timeVerified = ''
                // }
                // if (Math.random() < 0.5) {
                //     res.isActive = 'n'
                // }
                vo.user = res
            })
            .catch((err) => {
                console.log(err)
                vo.errMsg = vo.$t('getDataError')
            })
            .finally(() => {
                vo.isLoading = false
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

            // //timeVerified
            // let timeVerified = get(vo, 'user.timeVerified', '')
            // // console.log('timeVerified', timeVerified)

            // // //check
            // // if (istimemsTZ(timeVerified)) {
            // //     return true //有驗證時間, 代表已驗證
            // // }

            // // //tt
            // // let tt = ot(timeVerified, 'YYYY-MM-DDTHH:mm:ss.SSSZ')
            // // // console.log('tt', tt)

            // // //tn
            // // let tn = ot()

            // // //tds
            // // let tds = tt.diff(tn, 'second')
            // // // console.log('tds', tds)

            // // //check
            // // if (tds > 0) {
            // //     return false
            // // }

            // return istimemsTZ(timeVerified) //有驗證時間, 代表已驗證
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

            // //timeExpired
            // let timeExpired = get(vo, 'user.timeExpired', '')
            // // console.log('timeExpired', timeExpired)

            // //check
            // if (!istimemsTZ(timeExpired)) {
            //     return false //無過期時間, 代表未過期
            // }

            // // //tt
            // // let tt = ot(timeExpired, 'YYYY-MM-DDTHH:mm:ss.SSSZ')
            // // // console.log('tt', tt)

            // //tn
            // let tn = ot().format('YYYY-MM-DDTHH:mm:ss.SSSZ')

            // // //tds
            // // let tds = tt.diff(tn, 'second')
            // // // console.log('tds', tds)

            // // //check
            // // if (tn > timeExpired) {
            // //     return true
            // // }

            // return tn >= timeExpired //現在時間>=過期時間, 代表已過期
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

            // //timeBlocked
            // let timeBlocked = get(vo, 'user.timeBlocked', '')
            // // console.log('timeBlocked', timeBlocked)

            // //check
            // if (!istimemsTZ(timeBlocked)) {
            //     return false //無封鎖時間, 代表未封鎖
            // }

            // // //tt
            // // let tt = ot(timeBlocked, 'YYYY-MM-DDTHH:mm:ss.SSSZ')
            // // // console.log('tt', tt)

            // //tn
            // let tn = ot().format('YYYY-MM-DDTHH:mm:ss.SSSZ')

            // // //tds
            // // let tds = tt.diff(tn, 'second')
            // // // console.log('tds', tds)

            // // //check
            // // if (tn > timeBlocked) {
            // //     return false
            // // }

            // return tn <= timeBlocked //現在時間<=封鎖時間, 代表封鎖中
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

        // users: function() {
        //     return get(this, `$store.state.users`)
        // },

        // usersGroups: function() {
        //     let gs = groupBy(this.users, 'from')
        //     let ks = keys(gs)
        //     ks = sortBy(ks)
        //     let gsTemp = {}
        //     each(ks, (k) => {
        //         gsTemp[k] = gs[k]
        //     })
        //     gs = gsTemp
        //     return gs
        // },

        // changeParams: function() {
        //     // console.log('computed changeParams')

        //     let vo = this

        //     // //check
        //     // if (size(vo.users) === 0) {
        //     //     return ''
        //     // }

        //     // //firstLoading
        //     // vo.firstLoading = false

        //     return ''
        // },

        // spacePading: function() {
        //     let vo = this
        //     if (vo.panelWidth < 400) {
        //         return 0
        //     }
        //     else if (vo.panelWidth < 800) {
        //         return 10
        //     }
        //     return 20
        // },

        // usersGroupsHeight: function() {
        //     let vo = this

        //     //h
        //     let h = vo.panelHeight - vo.headHeight - 2 * vo.spacePading - vo.groupInforHeight
        //     h = Math.max(h, 0)

        //     return h
        // },

    },
    methods: {

        resizePanel: function(msg) {
            // console.log('methods resizePanel', msg)

            let vo = this

            //panelWidth, panelHeight
            vo.panelWidth = msg.snew.offsetWidth
            vo.panelHeight = msg.snew.offsetHeight

        },

        // resizeHead: function(msg) {
        //     // console.log('methods resizeHead', msg)

        //     let vo = this

        //     //headHeight
        //     vo.headHeight = msg.snew.offsetHeight

        // },

        // resizeGroupInfor: function(msg) {
        //     // console.log('methods resizeGroupInfor', msg)

        //     let vo = this

        //     //groupInforHeight
        //     vo.groupInforHeight = msg.snew.offsetHeight

        // },

        // getFrom: function(kus) {
        //     // console.log('methods getFrom', kus)
        //     let vo = this
        //     if (!isestr(kus)) {
        //         kus = vo.$t('empty')
        //     }
        //     return kus
        // },

        // getIsAdmin: function(u) {
        //     return get(u, 'isAdmin') === 'y'
        // },

        // getIsNotActive: function(u) {
        //     return get(u, 'isActive') === 'n'
        // },

        // clickAddUser: function() {
        //     // console.log('methods clickAddUser')

        //     let vo = this

        //     async function core() {
        //         let errTemp = null

        //         //show loading
        //         vo.$ui.updateLoading(true)

        //         //u
        //         let u = {
        //             id: genID(),
        //             name: vo.$t('newUser'),
        //             from: '',
        //             isAdmin: 'n',
        //             isActive: 'y',
        //         }

        //         //save
        //         await vo.$fapi.users.insert(u)
        //             .catch((err) => {
        //                 errTemp = err
        //             })

        //         //check
        //         if (errTemp !== null) {
        //             vo.$alert(`${vo.$t('failedToAddUser')}: ${errTemp}`, { type: 'error' })
        //         }

        //         //un
        //         let un = null
        //         await waitFun(() => {
        //             un = find(vo.users, { id: u.id })
        //             return iseobj(un) //確認g.id已存在
        //         })
        //         // console.log('un', un)

        //         //showVeUser
        //         vo.$dg.showVeUser(un)
        //             .catch(() => {})

        //         //alert
        //         vo.$alert(vo.$t('successfulToAddUser'))

        //     }

        //     //core
        //     core()
        //         // .then((res) => {
        //         //     console.log('then', res)
        //         // })
        //         .catch((err) => {
        //             console.log('catch', err)
        //             vo.$alert(vo.$t('anUnexpectedErrorOccurred'), { type: 'error' })
        //         })
        //         .finally(() => {

        //             //hide loading
        //             vo.$ui.updateLoading(false)

        //         })

        // },

        // clickRemoveUser: function(u) {
        //     // console.log('methods clickRemoveUser', u)

        //     let vo = this

        //     async function core() {
        //         let errTemp = null

        //         //showCheckYesNo
        //         let bExit = false
        //         let t_confirmToDeleteUser = vo.$t('confirmToDeleteUser')
        //         t_confirmToDeleteUser = t_confirmToDeleteUser.replace('{name}', u.name)
        //         await vo.$dg.showCheckYesNo(t_confirmToDeleteUser)
        //             .catch(() => {
        //                 bExit = true
        //             })
        //         if (bExit) {
        //             return
        //         }

        //         //show loading
        //         vo.$ui.updateLoading(true)

        //         //save
        //         await vo.$fapi.users.del(u)
        //             .catch((err) => {
        //                 errTemp = err
        //             })

        //         //check
        //         if (errTemp !== null) {
        //             vo.$alert(`${vo.$t('failedToDeleteUser')}: ${errTemp}`, { type: 'error' })
        //             return
        //         }

        //         //un
        //         let un = null
        //         await waitFun(() => {
        //             un = find(vo.users, (v) => {
        //                 return v.id === u.id
        //             })
        //             return !iseobj(un) //確認g.id已不存在
        //         })
        //         // console.log('un', un)

        //         //alert
        //         vo.$alert(vo.$t('successfulToDeleteUser'))

        //     }

        //     //core
        //     core()
        //         // .then((res) => {
        //         //     console.log('then', res)
        //         // })
        //         .catch((err) => {
        //             console.log('catch', err)
        //             vo.$alert(vo.$t('anUnexpectedErrorOccurred'), { type: 'error' })
        //         })
        //         .finally(() => {

        //             //hide loading
        //             vo.$ui.updateLoading(false)

        //         })

        // },

        // clickEditUser: function(u) {
        //     // console.log('clickEditGroup', u)

        //     let vo = this

        //     //check
        //     if (!vo.isOperatable) {
        //         vo.$alert(vo.$t('cannotShowUserDetailsInViewMode'), { type: 'error' })
        //         return
        //     }

        //     //showVeUser
        //     vo.$dg.showVeUser(u)
        //         .catch(() => {})

        // },

    }
}
</script>

<style scoped>
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
