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

            <div style="padding:20px;">

                <div style="display:flex; align-items:center;">

                    <div style="display:inline-block; padding:0px; border:1px solid #ddd; border-radius:50%;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 24 24"><path fill="currentColor" d="M6.196 17.485q1.275-.918 2.706-1.451Q10.332 15.5 12 15.5t3.098.534t2.706 1.45q.99-1.025 1.593-2.42Q20 13.667 20 12q0-3.325-2.337-5.663T12 4T6.337 6.338T4 12q0 1.667.603 3.064q.603 1.396 1.593 2.42m5.805-4.984q-1.264 0-2.133-.868T9 9.501t.868-2.133T12 6.5t2.132.868T15 9.5t-.868 2.132t-2.131.868M12 21q-1.883 0-3.525-.701t-2.858-1.916t-1.916-2.858T3 12t.701-3.525t1.916-2.858q1.216-1.215 2.858-1.916T12 3t3.525.701t2.858 1.916t1.916 2.858T21 12t-.701 3.525t-1.916 2.858q-1.216 1.215-2.858 1.916T12 21m0-1q1.383 0 2.721-.484q1.338-.483 2.313-1.324q-.974-.783-2.255-1.237T12 16.5t-2.789.445t-2.246 1.247q.975.84 2.314 1.324T12 20m0-8.5q.842 0 1.421-.579T14 9.5t-.579-1.421T12 7.5t-1.421.579T10 9.5t.579 1.421T12 11.5m0 6.75"/></svg>
                    </div>

                    <div style="padding-left:20px;">

                        <div style="font-size:3.0rem;">
                            {{$ui.gv(user,'name')}}
                        </div>

                        <div style="font-size:1.5rem;">
                            {{$ui.gv(user,'account')}}
                        </div>

                    </div>

                </div>

                <div style="padding-top:20px;"></div>

                <div style="">

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
                        :label="$t('timeBlocked')"
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
import { mdiAccountCircleOutline, mdiAccountPlusOutline, mdiCheckboxMarkedCircle, mdiChessRook } from '@mdi/js/mdi.js'
import ot from 'dayjs'
import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import keys from 'lodash-es/keys.js'
import sortBy from 'lodash-es/sortBy.js'
import find from 'lodash-es/find.js'
import size from 'lodash-es/size.js'
import groupBy from 'lodash-es/groupBy.js'
import genID from 'wsemi/src/genID.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import istimeTZ from 'wsemi/src/istimeTZ.mjs'
import waitFun from 'wsemi/src/waitFun.mjs'
import WIcon from 'w-component-vue/src/components/WIcon.vue'
import WButtonChip from 'w-component-vue/src/components/WButtonChip.vue'
import WSwitch from 'w-component-vue/src/components/WSwitch.vue'
import WText from 'w-component-vue/src/components/WText.vue'
import WPanelLabelItem from 'w-component-vue/src/components/WPanelLabelItem.vue'
import WPanelScrolly from 'w-component-vue/src/components/WPanelScrolly.vue'


export default {
    components: {
        WIcon,
        WButtonChip,
        WSwitch,
        WText,
        WPanelLabelItem,
        WPanelScrolly,
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

        isVerified: function() {
            let vo = this

            //timeVerified
            let timeVerified = get(vo, 'user.timeVerified', '')
            // console.log('timeVerified', timeVerified)

            //check
            if (!istimeTZ(timeVerified)) {
                return true
            }

            //tt
            let tt = ot(timeVerified, 'YYYY-MM-DDTHH:mm:ssZ')
            // console.log('tt', tt)

            //tn
            let tn = ot()

            //tds
            let tds = tt.diff(tn, 'second')
            // console.log('tds', tds)

            //check
            if (tds > 0) {
                return false
            }

            return true
        },

        isExpired: function() {
            let vo = this

            //timeExpired
            let timeExpired = get(vo, 'user.timeExpired', '')
            // console.log('timeExpired', timeExpired)

            //check
            if (!istimeTZ(timeExpired)) {
                return true
            }

            //tt
            let tt = ot(timeExpired, 'YYYY-MM-DDTHH:mm:ssZ')
            // console.log('tt', tt)

            //tn
            let tn = ot()

            //tds
            let tds = tt.diff(tn, 'second')
            // console.log('tds', tds)

            //check
            if (tds > 0) {
                return false
            }

            return true
        },

        isBlocked: function() {
            let vo = this

            //timeBlocked
            let timeBlocked = get(vo, 'user.timeBlocked', '')
            // console.log('timeBlocked', timeBlocked)

            //check
            if (!istimeTZ(timeBlocked)) {
                return true
            }

            //tt
            let tt = ot(timeBlocked, 'YYYY-MM-DDTHH:mm:ssZ')
            // console.log('tt', tt)

            //tn
            let tn = ot()

            //tds
            let tds = tt.diff(tn, 'second')
            // console.log('tds', tds)

            //check
            if (tds > 0) {
                return false
            }

            return true
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
        //         await vo.$fapi.users.insert(u) //bbb 待改為後端fun
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
</style>
