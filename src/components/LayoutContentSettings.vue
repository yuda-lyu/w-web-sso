<template>
    <div
        style="height:100%;"
        v-domresize
        @domresize="resizePanel"
        :changeParams="changeParams"
    >

        <div
            style="background:#fff;"
            v-domresize
            @domresize="resizeHead"
        >

            <!-- 標題區 -->
            <div style="padding:10px 10px 10px 20px;">
                <div :style="`display:flex; align-items:center; padding:${drawer?'5px':'5px 5px 5px 20px'};`">

                    <WIcon
                        :icon="mdiCogOutline"
                        :color="'#000'"
                        :size="32"
                    ></WIcon>

                    <div style="padding-left:12px;">

                        <div style="font-size:1.4rem; color:#000;">
                            {{$t('mmSettings')}}
                        </div>

                        <div style="padding-top:2px; font-size:0.8rem; color:#666;">
                            {{$t('mmSettingsMsg')}}
                        </div>

                    </div>

                </div>
            </div>

        </div>

        <template
            v-if="!isLoading"
        >

            <template v-if="true">
                bbb
            </template>

        </template>

        <div
            style="padding:10px 15px; font-size:0.8rem;"
            v-else
        >
            {{$t('waitingData')}}
        </div>

    </div>
</template>

<script>
import { mdiCogOutline, mdiVectorPolylinePlus, mdiCheckboxMarkedCircle, mdiCloudUploadOutline, mdiTrashCanOutline, mdiTableHeadersEye, mdiPlus, mdiPencilOutline, mdiContentCopy } from '@mdi/js/mdi.js'
import JSON5 from 'json5'
import ot from 'dayjs'
import get from 'lodash-es/get.js'
import set from 'lodash-es/set.js'
import each from 'lodash-es/each.js'
import size from 'lodash-es/size.js'
import filter from 'lodash-es/filter.js'
import sortBy from 'lodash-es/sortBy.js'
import cloneDeep from 'lodash-es/cloneDeep.js'
import haskey from 'wsemi/src/haskey.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isnum from 'wsemi/src/isnum.mjs'
import istime from 'wsemi/src/istime.mjs'
import istimeTZ from 'wsemi/src/istimeTZ.mjs'
import isEmail from 'wsemi/src/isEmail.mjs'
import cdbl from 'wsemi/src/cdbl.mjs'
import cstr from 'wsemi/src/cstr.mjs'
import arrPull from 'wsemi/src/arrPull.mjs'
import domShowInputDatatime from 'wsemi/src/domShowInputDatatime.mjs'
import WIcon from 'w-component-vue/src/components/WIcon.vue'
import WSwitch from 'w-component-vue/src/components/WSwitch.vue'
import WButtonCircle from 'w-component-vue/src/components/WButtonCircle.vue'
import WPopup from 'w-component-vue/src/components/WPopup.vue'
import WInputCheckbox from 'w-component-vue/src/components/WInputCheckbox.vue'
import WAggridVueDyn from 'w-component-vue/src/components/WAggridVueDyn.vue'


export default {
    components: {
        WIcon,
        WSwitch,
        WButtonCircle,
        WPopup,
        WInputCheckbox,
        WAggridVueDyn,
    },
    props: {
        drawer: {
            type: Boolean,
            default: false,
        },
    },
    data: function() {
        return {
            mdiCogOutline,
            mdiVectorPolylinePlus,
            mdiCheckboxMarkedCircle,
            mdiCloudUploadOutline,
            mdiTrashCanOutline,
            mdiTableHeadersEye,
            mdiPlus,
            mdiPencilOutline,
            mdiContentCopy,

            ttt: '',

            panelWidth: 100,
            panelHeight: 100,
            headHeight: 100,

            isLoading: true,
            firstSetting: true,
            showIsEditable: false,
            isEditable: false,
            // isModified: false,

        }
    },
    mounted: function() {
        // console.log('mounted')

        let vo = this

        // //註冊至$dg供使用
        // vo.$dg.toggleItemIsAdminById = vo.toggleItemIsAdminById
        // vo.$dg.toggleItemIsVerifiedById = vo.toggleItemIsVerifiedById
        // vo.$dg.toggleItemIsActiveById = vo.toggleItemIsActiveById
        // vo.$dg.modifyItemPasswordById = vo.modifyItemPasswordById
        // vo.$dg.modifyItemTimeVerifiedById = vo.modifyItemTimeVerifiedById
        // vo.$dg.modifyItemTimeExpiredById = vo.modifyItemTimeExpiredById
        // vo.$dg.modifyItemTimeBlockedById = vo.modifyItemTimeBlockedById

        //firstSetting
        if (vo.firstSetting) {
            // console.log('webInfor', vo.webInfor)

            let showModeEditUsers = get(vo, 'webInfor.showModeEditUsers', '')
            vo.showIsEditable = showModeEditUsers === 'y'
            let modeEditUsers = get(vo, 'webInfor.modeEditUsers', '')
            vo.isEditable = modeEditUsers === 'y'

            // vo.widthUsersName = get(vo, 'webInfor.widthUsersName', '')
            // vo.widthUsersEmail = get(vo, 'webInfor.widthUsersEmail', '')
            // vo.widthUsersDescription = get(vo, 'webInfor.widthUsersDescription', '')

            vo.firstSetting = false
        }
        vo.isEditable = true //bbb

        //token
        let token = vo.userToken
        // console.log('token', token)

        // //getUsersList
        // vo.$fapi.getUsersList(token)
        //     .then((res) => {
        //         // console.log(res)
        //         res = sortBy(res, 'order')
        //         vo.users = res
        //     })
        //     .catch((err) => {
        //         console.log(err)
        //         vo.errMsg = vo.$t('getDataError')
        //     })
        //     .finally(() => {
        //         vo.isLoading = false
        //     })

    },
    computed: {

        webInfor: function() {
            let wi = get(this, `$store.state.webInfor`)
            return wi
        },

        userToken: function() {
            let vo = this
            return get(vo, `$store.state.userToken`)
        },

        changeParams: function() {
            // console.log('computed changeParams')

            let vo = this

            // //trigger
            // let isEditable = vo.isEditable

            // //items
            // let items = cloneDeep(vo.users)

            // //save
            // vo.items = items

            // //genOpt
            // vo.genOpt({ isEditable })

            // //isLoading
            // vo.isLoading = false

            return ''
        },

        // contentHeight: function() {
        //     let vo = this

        //     //h
        //     let h = vo.panelHeight - vo.headHeight
        //     h = Math.max(h, 0)

        //     return h
        // },

        // hasItemsCheck: function() {
        //     let vo = this

        //     //h
        //     let b = size(vo.itemsCheck) > 0

        //     return b
        // },

        // hasItemCheckOne: function() {
        //     let vo = this

        //     //h
        //     let b = size(vo.itemsCheck) === 1

        //     return b
        // },

        // errItemsByAccount: function() {
        //     let vo = this

        //     //rows
        //     let rows = get(vo, 'opt.rows', [])

        //     //kpErr
        //     let kpErr = {}
        //     let kpAccount = {}
        //     each(rows, (v, k) => {

        //         //account
        //         let account = get(v, 'account', '')

        //         //check
        //         if (!isestr(account)) {

        //             //kpErr
        //             kpErr[account] = vo.$t(`userAccountEmpty`)

        //             return true //跳出換下一個
        //         }

        //         //check
        //         if (haskey(kpAccount, account)) {

        //             //kpErr
        //             kpErr[account] = vo.$t(`userAccountDuplicate`)

        //             return true //跳出換下一個
        //         }

        //         //kpAccount
        //         kpAccount[account] = true

        //     })

        //     return kpErr
        // },

        // errItemsByEmail: function() {
        //     let vo = this

        //     //rows
        //     let rows = get(vo, 'opt.rows', [])

        //     //kpErr
        //     let kpErr = {}
        //     let kpEmail = {}
        //     each(rows, (v, k) => {

        //         //email
        //         let email = get(v, 'email', '')

        //         //check
        //         if (!isestr(email)) {

        //             //kpErr
        //             kpErr[email] = vo.$t(`userEmailEmpty`)

        //             return true //跳出換下一個
        //         }

        //         //check
        //         if (!isEmail(email)) {

        //             //kpErr
        //             kpErr[email] = vo.$t(`userEmailError`)

        //             return true //跳出換下一個
        //         }

        //         //check
        //         if (haskey(kpEmail, email)) {

        //             //kpErr
        //             kpErr[email] = vo.$t(`userEmailDuplicate`)

        //             return true //跳出換下一個
        //         }

        //         //kpEmail
        //         kpEmail[email] = true

        //     })

        //     return kpErr
        // },

        // errItemsByRedir: function() {
        //     let vo = this

        //     //rows
        //     let rows = get(vo, 'opt.rows', [])

        //     //kpErr
        //     let kpErr = {}
        //     each(rows, (v, k) => {

        //         //redir
        //         let redir = get(v, 'redir', '')

        //         //check
        //         if (!isestr(redir)) {

        //             //kpErr
        //             kpErr[redir] = vo.$t(`userRedirEmpty`)

        //             return true //跳出換下一個
        //         }

        //     })

        //     return kpErr
        // },

        // isError: function() {
        //     let vo = this

        //     let c = ''
        //     let b = false
        //     b = iseobj(vo.errItemsByAccount)
        //     if (b) {
        //         c = vo.$t('errInAccounts')
        //         return c
        //     }
        //     b = iseobj(vo.errItemsByEmail)
        //     if (b) {
        //         c = vo.$t('errInEmails')
        //         return c
        //     }
        //     b = iseobj(vo.errItemsByRedir)
        //     if (b) {
        //         c = vo.$t('errInRedir')
        //         return c
        //     }

        //     return ''
        // },

        // kpHead: function() {
        //     let vo = this

        //     let kp = {
        //         'id': vo.$t('id'),
        //         'order': vo.$t('order'),
        //         'account': vo.$t('account'),
        //         'password': vo.$t('password'),
        //         'name': vo.$t('name'),
        //         'email': vo.$t('email'),
        //         'description': vo.$t('description'),
        //         'from': vo.$t('from'),
        //         'redir': vo.$t('redir'),
        //         'isAdmin': vo.$t('isAdmin'),
        //         'isVerified': vo.$t('isVerified'),
        //         'timeVerified': vo.$t('timeVerified'),
        //         'timeExpired': vo.$t('timeExpired'),
        //         'timeBlocked': vo.$t('timeBlocked'),
        //         'userId': vo.$t('userId'),
        //         'timeCreate': vo.$t('timeCreate'),
        //         'userIdUpdate': vo.$t('userIdUpdate'),
        //         'timeUpdate': vo.$t('timeUpdate'),
        //         'isActive': vo.$t('isActive'),
        //     }

        //     return kp
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

        resizeHead: function(msg) {
            // console.log('methods resizeHead', msg)

            let vo = this

            //headHeight
            vo.headHeight = msg.snew.offsetHeight

        },

        // getHead: function(key) {
        //     // console.log('methods getHead', key)

        //     let vo = this

        //     let head = get(vo, `kpHead.${key}`, '')

        //     return head
        // },

        // genOpt: function() {
        //     // console.log('methods genOpt')

        //     let vo = this

        //     //default
        //     vo.itemsCheck = []

        //     //opt
        //     let opt = null
        //     if (size(vo.items) > 0) {

        //         //ks
        //         let ks = vo.tabKeys
        //         // console.log('ks', ks)

        //         //kpHead
        //         let kpHead = vo.kpHead

        //         //kpCellEditable, kpRowDrag, kpHeadCheckBox
        //         let kpCellEditable = {}
        //         let kpRowDrag = {}
        //         let kpHeadCheckBox = {}
        //         if (vo.isEditable) {
        //             kpCellEditable = {
        //                 'account': true,
        //                 'name': true,
        //                 'email': true,
        //                 'description': true,
        //                 'from': true,
        //                 'redir': true,
        //             }
        //             kpRowDrag = {
        //                 'account': true,
        //             }
        //             kpHeadCheckBox = {
        //                 'account': true,
        //             }
        //         }

        //         //kpHeadHide
        //         let kpHeadHide = {
        //             'id': true,
        //             'order': true,
        //         }
        //         if (true) {
        //             let tabKeysHide = arrPull(vo.tabKeysPick, vo.tabKeysShow)
        //             each(tabKeysHide, (k) => {
        //                 kpHeadHide[k] = true
        //             })
        //         }

        //         //opt
        //         opt = {
        //             language: vo.$t('aggridLanguage'),
        //             rows: vo.items,
        //             keys: ks,
        //             kpHead,
        //             // autoFitColumn: true,
        //             defCellEditable: false, //vo.isEditable
        //             defHeadFilter: true,
        //             defCellAlignH: 'left',
        //             kpHeadHide,
        //             kpHeadFixLeft: {
        //                 'account': true,
        //             },
        //             defHeadMinWidth: 150,
        //             kpHeadWidth: {
        //                 // 'name': isnum(vo.widthUsersName) ? cdbl(vo.widthUsersName) : 200,
        //                 // 'email': isnum(vo.widthUsersEmail) ? cdbl(vo.widthUsersEmail) : 300,
        //                 // 'description': isnum(vo.widthUsersDescription) ? cdbl(vo.widthUsersDescription) : 300,
        //                 // 'cgrups': 300,
        //                 // 'isAdmin': 100,
        //                 // 'isActive': 100,
        //                 // 'timeCreate': 220,
        //                 // 'timeUpdate': 220,
        //             },
        //             kpHeadFilterType: {
        //                 'id': 'text',
        //                 'order': 'text',
        //                 'account': 'text',
        //                 'password': 'text',
        //                 'name': 'text',
        //                 'email': 'text',
        //                 'description': 'text',
        //                 'from': 'text',
        //                 'redir': 'text',
        //                 'isAdmin': 'text',
        //                 'isVerified': 'text',
        //                 'timeVerified': 'text',
        //                 'timeExpired': 'text',
        //                 'timeBlocked': 'text',
        //                 'userId': 'text',
        //                 'timeCreate': 'text',
        //                 'userIdUpdate': 'text',
        //                 'timeUpdate': 'text',
        //                 'isActive': 'text',
        //             },
        //             kpCellEditable,
        //             kpRowDrag,
        //             kpHeadCheckBox,
        //             kpHeadFilter: {
        //                 'password': false,
        //             },
        //             kpHeadSort: {
        //                 'password': false,
        //             },
        //             kpHeadFocusHighlight: { //雖然效果不完全, 但因按鈕與cell有padding可被點擊, 故還是需要開啟
        //                 'password': false,
        //                 'timeVerified': false,
        //                 'timeExpired': false,
        //                 'timeBlocked': false,
        //             },
        //             kpCellRender: {
        //                 'account': (v) => {
        //                     // console.log('kpCellRender account', v)

        //                     //err
        //                     let err = get(vo.errItemsByAccount, v, '')
        //                     // console.log(v, err)

        //                     //check
        //                     if (isestr(err)) {
        //                         v = `
        //                             <span title="${err}">
        //                                 <span style="color:#F57C00;">${cstr(v)}</span>
        //                                 <img style="vertical-align:sub; width:16px; height:16px;" src="${vo.$ui.getIcon('warning')}" />
        //                             </span>
        //                         `
        //                     }

        //                     return v
        //                 },
        //                 'password': (v, k, r) => {
        //                     // console.log('kpCellRender password', v, k, r)

        //                     //id
        //                     let id = get(r, 'id', '')
        //                     // console.log('id', id, k, r)

        //                     // `
        //                     let t = `
        //                         <div onclick="event.stopPropagation();event.preventDefault();" onmousedown="event.stopPropagation();event.preventDefault();">
        //                             <button style="width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" onclick="$vo.$dg.modifyItemPasswordById('${id}')">${vo.$t('userResetPassword')}</button>
        //                         </div>
        //                     `

        //                     return t
        //                 },
        //                 'email': (v) => {
        //                     // console.log('kpCellRender email', v)

        //                     //err
        //                     let err = get(vo.errItemsByEmail, v, '')
        //                     // console.log(v, err)

        //                     //check
        //                     if (isestr(err)) {
        //                         v = `
        //                             <span title="${err}">
        //                                 <span style="color:#F57C00;">${cstr(v)}</span>
        //                                 <img style="vertical-align:sub; width:16px; height:16px;" src="${vo.$ui.getIcon('warning')}" />
        //                             </span>
        //                         `
        //                     }

        //                     return v
        //                 },
        //                 'redir': (v) => {
        //                     // console.log('kpCellRender redir', v)

        //                     //err
        //                     let err = get(vo.errItemsByRedir, v, '')
        //                     // console.log(v, err)

        //                     //check
        //                     if (isestr(err)) {
        //                         v = `
        //                             <span title="${err}">
        //                                 <span style="color:#F57C00;">${cstr(v)}</span>
        //                                 <img style="vertical-align:sub; width:16px; height:16px;" src="${vo.$ui.getIcon('warning')}" />
        //                             </span>
        //                         `
        //                     }

        //                     return v
        //                 },
        //                 'isAdmin': (v, k, r) => {
        //                     // console.log('kpCellRender isAdmin', v, k, r)

        //                     //id
        //                     let id = get(r, 'id', '')
        //                     // console.log('id', id, k, r)

        //                     let t = `
        //                         <input type="checkbox" ${v === 'y' ? 'checked' : ''} onclick="$vo.$dg.toggleItemIsAdminById('${id}')" ${vo.isEditable ? '' : 'disabled'} />
        //                     `

        //                     return t
        //                 },
        //                 'isVerified': (v, k, r) => {
        //                     // console.log('kpCellRender isAdmin', v, k, r)

        //                     //id
        //                     let id = get(r, 'id', '')
        //                     // console.log('id', id, k, r)

        //                     let t = `
        //                         <input type="checkbox" ${v === 'y' ? 'checked' : ''} onclick="$vo.$dg.toggleItemIsVerifiedById('${id}')" ${vo.isEditable ? '' : 'disabled'} />
        //                     `

        //                     return t
        //                 },
        //                 'isActive': (v, k, r) => {
        //                     // console.log('kpCellRender isActive', v, k, r)

        //                     //id
        //                     let id = get(r, 'id', '')
        //                     // console.log('id', id, k, r)

        //                     let t = `
        //                         <input type="checkbox" ${v === 'y' ? 'checked' : ''} onclick="$vo.$dg.toggleItemIsActiveById('${id}')" ${vo.isEditable ? '' : 'disabled'} />
        //                     `

        //                     return t
        //                 },
        //                 'timeVerified': (v, k, r) => {
        //                     // console.log('kpCellRender timeVerified', v, k, r)

        //                     //id
        //                     let id = get(r, 'id', '')
        //                     // console.log('id', id, k, r)

        //                     //vv, vm
        //                     let vv = ''
        //                     let vm = vo.$t('userTimeEmpty')
        //                     if (istimeTZ(v)) { //原始數據為timeTZ格式
        //                         let vt = ot(v)
        //                         vv = vt.format('YYYY-MM-DDTHH:mm')
        //                         vm = vt.format('YYYY-MM-DD HH:mm')
        //                     }
        //                     // console.log('vv', vv)
        //                     // console.log('vm', vm)

        //                     // `
        //                     let t = `
        //                         <div onclick="event.stopPropagation();event.preventDefault();" onmousedown="event.stopPropagation();event.preventDefault();">
        //                             <button style="width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" onclick="$vo.$dg.modifyItemTimeVerifiedById(this,'${vv}','${id}')">${vm}</button>
        //                         </div>
        //                     `

        //                     return t
        //                 },
        //                 'timeExpired': (v, k, r) => {
        //                     // console.log('kpCellRender timeExpired', v, k, r)

        //                     //id
        //                     let id = get(r, 'id', '')
        //                     // console.log('id', id, k, r)

        //                     //vv, vm
        //                     let vv = ''
        //                     let vm = vo.$t('userTimeEmpty')
        //                     if (istimeTZ(v)) { //原始數據為timeTZ格式
        //                         let vt = ot(v)
        //                         vv = vt.format('YYYY-MM-DDTHH:mm')
        //                         vm = vt.format('YYYY-MM-DD HH:mm')
        //                     }
        //                     // console.log('vv', vv)
        //                     // console.log('vm', vm)

        //                     // `
        //                     let t = `
        //                         <div onclick="event.stopPropagation();event.preventDefault();" onmousedown="event.stopPropagation();event.preventDefault();">
        //                             <button style="width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" onclick="$vo.$dg.modifyItemTimeExpiredById(this,'${vv}','${id}')">${vm}</button>
        //                         </div>
        //                     `

        //                     return t
        //                 },
        //                 'timeBlocked': (v, k, r) => {
        //                     // console.log('kpCellRender timeBlocked', v, k, r)

        //                     //id
        //                     let id = get(r, 'id', '')
        //                     // console.log('id', id, k, r)

        //                     //vv, vm
        //                     let vv = ''
        //                     let vm = vo.$t('userTimeEmpty')
        //                     if (istimeTZ(v)) { //原始數據為timeTZ格式
        //                         let vt = ot(v)
        //                         vv = vt.format('YYYY-MM-DDTHH:mm')
        //                         vm = vt.format('YYYY-MM-DD HH:mm')
        //                     }
        //                     // console.log('vv', vv)
        //                     // console.log('vm', vm)

        //                     // `
        //                     let t = `
        //                         <div onclick="event.stopPropagation();event.preventDefault();" onmousedown="event.stopPropagation();event.preventDefault();">
        //                             <button style="width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" onclick="$vo.$dg.modifyItemTimeBlockedById(this,'${vv}','${id}')">${vm}</button>
        //                         </div>
        //                     `

        //                     return t
        //                 },
        //             },
        //             rowsChange: (rs) => {
        //                 // console.log('rowsChange', rs)
        //                 // console.log('rowsChange cloneDeep(vo.opt.rows)', cloneDeep(vo.opt.rows))

        //                 //isModified
        //                 vo.isModified = true

        //             },
        //             rowChecked: (rs) => {
        //                 // console.log('rowChecked', rs)
        //                 // console.log('rowChecked cloneDeep(vo.opt.rows)', cloneDeep(vo.opt.rows))

        //                 //save itemsCheck
        //                 vo.itemsCheck = cloneDeep(rs)

        //             },
        //         }
        //         // console.log('opt', opt)

        //     }

        //     //save
        //     vo.opt = opt

        // },

        // refresh: function() {
        //     let vo = this

        //     //cmp
        //     let cmp = get(vo, '$refs.rftable.$refs.$self')
        //     // console.log('cmp', cmp)

        //     //refresh, 因set不會觸發kpCellRender, 故須另外調用組件函數refresh, 進而觸發kpCellRender, 使能更新數據
        //     cmp.refresh()

        // },

        // toggleTabKeys: function() {
        //     let vo = this

        //     //cmp
        //     let cmp = get(vo, '$refs.rftable.$refs.$self')
        //     // console.log('cmp', cmp)

        //     //showKeys
        //     cmp.showKeys(vo.tabKeysShow)
        //     // console.log('tabKeysShow', vo.tabKeysShow)

        // },

        // modifyItemPasswordById: function(id) {
        //     // console.log('modifyItemPasswordById', id)

        //     let vo = this

        //     vo.$alert(`尚待開發`, { type: 'error' }) //bbb

        //     // //k
        //     // let k = 'password'

        //     // //check
        //     // if (!isestr(id)) {
        //     //     vo.$alert(`${vo.$t('userEditNoUserId')}`, { type: 'error' })
        //     //     return
        //     // }

        //     // //rows
        //     // let rows = get(vo, 'opt.rows', [])

        //     // //find
        //     // let r = null
        //     // let kr = null
        //     // each(rows, (v, k) => {
        //     //     if (get(v, 'id', '') === id) {
        //     //         r = v
        //     //         kr = k
        //     //         return false //跳出
        //     //     }
        //     // })

        //     // //check
        //     // if (!iseobj(r)) {
        //     //     vo.$alert(`${vo.$t('userEditNoUserData')}`, { type: 'error' })
        //     //     return
        //     // }

        //     // //v
        //     // let _v = get(r, k, 'n')
        //     // let v = _v === 'y' ? 'n' : 'y'
        //     // // console.log(k, v)

        //     // //set
        //     // set(vo, `opt.rows[${kr}].${k}`, v)
        //     // // console.log('vo.opt.rows[kr]', cloneDeep(vo.opt.rows[kr]))

        //     // //refresh
        //     // vo.refresh()

        //     // //isModified
        //     // vo.isModified = true

        // },

        // toggleItemByKeyAndId: function(key, id) {
        //     // console.log('toggleItemByKeyAndId', key, id)

        //     let vo = this

        //     //check
        //     if (!isestr(id)) {
        //         vo.$alert(`${vo.$t('userEditNoUserId')}`, { type: 'error' })
        //         return
        //     }

        //     //rows
        //     let rows = get(vo, 'opt.rows', [])

        //     //find
        //     let r = null
        //     let kr = null
        //     each(rows, (v, k) => {
        //         if (get(v, 'id', '') === id) {
        //             r = v
        //             kr = k
        //             return false //跳出
        //         }
        //     })

        //     //check
        //     if (!iseobj(r)) {
        //         vo.$alert(`${vo.$t('userEditNoUserData')}`, { type: 'error' })
        //         return
        //     }

        //     //v
        //     let _v = get(r, key, 'n')
        //     let v = _v === 'y' ? 'n' : 'y'
        //     // console.log(key, v)

        //     //set
        //     set(vo, `opt.rows[${kr}].${key}`, v)
        //     // console.log('vo.opt.rows[kr]', cloneDeep(vo.opt.rows[kr]))

        //     //refresh
        //     vo.refresh()

        //     //isModified
        //     vo.isModified = true

        // },

        // toggleItemIsAdminById: function(id) {
        //     // console.log('toggleItemIsAdminById', id)

        //     let vo = this

        //     //toggleItemByKeyAndId
        //     vo.toggleItemByKeyAndId('isAdmin', id)

        // },

        // toggleItemIsVerifiedById: function(id) {
        //     // console.log('toggleItemIsVerifiedById', id)

        //     let vo = this

        //     //toggleItemByKeyAndId
        //     vo.toggleItemByKeyAndId('isVerified', id)

        // },

        // toggleItemIsActiveById: function(id) {
        //     // console.log('toggleItemIsActiveById', id)

        //     let vo = this

        //     //toggleItemByKeyAndId
        //     vo.toggleItemByKeyAndId('isActive', id)

        // },

        // modifyItemByKeyAndId: function(key, ele, t, id) {
        //     // console.log('modifyItemTimeVerifiedById', ele, t, id)

        //     let vo = this

        //     //check
        //     if (!isestr(id)) {
        //         vo.$alert(`${vo.$t('userEditNoUserId')}`, { type: 'error' })
        //         return
        //     }

        //     //timePrev
        //     let timePrev = ''
        //     if (istime(t)) {
        //         timePrev = t
        //     }

        //     //domShowInputDatatime
        //     let type = 'datetime-local' //'datetime-local', 'date'
        //     domShowInputDatatime(timePrev, { eleRef: ele, type })
        //         .then((timeNew) => {
        //             // console.log(k, 'timeNew', timeNew)

        //             //rows
        //             let rows = get(vo, 'opt.rows', [])

        //             //find
        //             let r = null
        //             let kr = null
        //             each(rows, (v, k) => {
        //                 if (get(v, 'id', '') === id) {
        //                     r = v
        //                     kr = k
        //                     return false //跳出
        //                 }
        //             })

        //             //check
        //             if (!iseobj(r)) {
        //                 vo.$alert(`${vo.$t('userEditNoUserData')}`, { type: 'error' })
        //                 return
        //             }

        //             //v
        //             let vt = ot(timeNew, 'YYYY-MM-DDTHH:mm') //domShowInputDatatime數據為年月日時分
        //             let v = vt.format('YYYY-MM-DDTHH:mm:ssZ') //轉回原始數據為timeTZ格式
        //             // console.log('v', v)

        //             //set
        //             set(vo, `opt.rows[${kr}].${key}`, v)
        //             // console.log('vo.opt.rows[kr]', cloneDeep(vo.opt.rows[kr]))

        //             //refresh
        //             vo.refresh()

        //             //isModified
        //             vo.isModified = true

        //         })

        // },

        // modifyItemTimeVerifiedById: function(ele, t, id) {
        //     // console.log('modifyItemTimeVerifiedById', ele, t, id)

        //     let vo = this

        //     //modifyItemByKeyAndId
        //     vo.modifyItemByKeyAndId('timeVerified', ele, t, id)

        // },

        // modifyItemTimeExpiredById: function(ele, t, id) {
        //     // console.log('modifyItemTimeExpiredById', ele, t, id)

        //     let vo = this

        //     //modifyItemByKeyAndId
        //     vo.modifyItemByKeyAndId('timeExpired', ele, t, id)

        // },

        // modifyItemTimeBlockedById: function(ele, t, id) {
        //     // console.log('modifyItemTimeBlockedById', ele, t, id)

        //     let vo = this

        //     //modifyItemByKeyAndId
        //     vo.modifyItemByKeyAndId('timeBlocked', ele, t, id)

        // },

        // addItem: function() {
        //     // console.log('method addItem')

        //     let vo = this

        //     //cloneDeep
        //     let rows = get(vo, 'opt.rows', [])

        //     //cloneDeep
        //     rows = cloneDeep(rows)

        //     //r
        //     let r = vo.$ds.users.funNew()
        //     r.name = vo.$s.getNameNew(rows, 'name', '', vo.$t('userAddNameNew'))
        //     r.userId = `{${vo.$t('userAddIdNew')}}`
        //     r.timeCreate = `{${vo.$t('userAddIdNew')}}`
        //     r.userIdUpdate = `{${vo.$t('userAddIdNew')}}`
        //     r.timeUpdate = `{${vo.$t('userAddIdNew')}}`
        //     // console.log('r', r)

        //     //添加至最首
        //     rows = [
        //         r,
        //         ...rows,
        //     ]

        //     //save
        //     vo.users = cloneDeep(rows) //直接更新由getUsersList取得的users, 連帶驅動computed重算, 故不用另外更新vo.items與vo.opt.rows
        //     // console.log('cloneDeep(vo.users)', cloneDeep(vo.users))

        //     //isModified
        //     vo.isModified = true

        // },

        // copyItem: function() {
        //     // console.log('method copyItem')

        //     let vo = this

        //     //check
        //     if (size(vo.itemsCheck) !== 1) {
        //         console.log(`size(vo.itemsCheck) !== 1`, vo.itemsCheck)
        //         vo.$alert(`${vo.$t('anUnexpectedErrorOccurred')}`, { type: 'error' })
        //         return
        //     }

        //     //cloneDeep
        //     let rows = get(vo, 'opt.rows', [])

        //     //cloneDeep
        //     rows = cloneDeep(rows)

        //     //find
        //     let tar = vo.itemsCheck[0]
        //     let tarId = get(tar, 'data.id', '')
        //     let row = null
        //     each(rows, (v) => {
        //         let id = get(v, 'id', '')
        //         if (id === tarId) {
        //             row = v
        //             return false //跳出
        //         }
        //     })
        //     // console.log('tar', tar)
        //     // console.log('row', row)

        //     //check
        //     if (!iseobj(row)) {
        //         console.log(`!iseobj(row)`, row)
        //         vo.$alert(`${vo.$t('anUnexpectedErrorOccurred')}`, { type: 'error' })
        //         return
        //     }

        //     //r
        //     let r = cloneDeep(row)
        //     // let nameOld = r.name
        //     let _r = vo.$ds.users.funNew()
        //     r.id = _r.id //使用新建方式預先產生id避免重複
        //     // r.name = vo.$s.getNameNew(rows, 'name', nameOld, vo.$t('userCopyNameNew'))
        //     r.userId = `{${vo.$t('userAddIdNew')}}`
        //     r.timeCreate = `{${vo.$t('userAddIdNew')}}`
        //     r.userIdUpdate = `{${vo.$t('userAddIdNew')}}`
        //     r.timeUpdate = `{${vo.$t('userAddIdNew')}}`
        //     // console.log('r', r)

        //     //添加至最首
        //     rows = [
        //         r,
        //         ...rows,
        //     ]

        //     //save
        //     vo.users = cloneDeep(rows) //直接更新由getUsersList取得的users, 連帶驅動computed重算, 故不用另外更新vo.items與vo.opt.rows
        //     // console.log('cloneDeep(vo.users)', cloneDeep(vo.users))

        //     //isModified
        //     vo.isModified = true

        // },

        // deleteItemsCheck: function() {
        //     // console.log('method deleteItemsCheck')

        //     let vo = this

        //     //check
        //     if (size(vo.itemsCheck) === 0) {
        //         console.log(`size(vo.itemsCheck) === 0`, vo.itemsCheck)
        //         vo.$alert(`${vo.$t('anUnexpectedErrorOccurred')}`, { type: 'error' })
        //         return
        //     }

        //     //cloneDeep
        //     let rows = get(vo, 'opt.rows', [])

        //     //cloneDeep
        //     rows = cloneDeep(rows)

        //     //filter
        //     each(vo.itemsCheck, (v) => {
        //         // console.log('v', v)
        //         let id = get(v, 'data.id', '')
        //         if (!isestr(id)) {
        //             console.log(`invalid id`)
        //             return true //跳出換下一個
        //         }
        //         rows = filter(rows, (vv) => {
        //             return vv.id !== id
        //         })
        //     })

        //     //clear
        //     vo.itemsCheck = []

        //     //save
        //     vo.users = cloneDeep(rows) //直接更新由getUsersList取得的users, 連帶驅動computed重算, 故不用另外更新vo.items與vo.opt.rows
        //     // console.log('cloneDeep(vo.users)', cloneDeep(vo.users))

        //     //isModified
        //     vo.isModified = true

        // },

        // saveUsers: function() {
        //     // console.log('method saveUsers')

        //     let vo = this

        //     async function core() {
        //         let errTemp = null

        //         //show loading
        //         vo.$ui.updateLoading(true)

        //         //check
        //         if (isestr(vo.isError)) {
        //             vo.$alert(`${vo.isError}`, { type: 'error' })
        //             return
        //         }

        //         //rows
        //         let rows = get(vo, 'opt.rows', [])

        //         //check
        //         if (size(rows) === 0) {
        //             vo.$alert(`${vo.$t('userAddEmpty')}`, { type: 'error' })
        //             return
        //         }

        //         //token
        //         let token = vo.userToken
        //         // console.log('token', token)

        //         //updateUsersList
        //         await vo.$fapi.updateUsersList(token, rows)
        //             .catch((err) => {
        //                 errTemp = err
        //             })

        //         //check
        //         if (errTemp !== null) {
        //             vo.$alert(`${vo.$t('userSaveUsersFail')}: ${errTemp}`, { type: 'error' })
        //             return
        //         }

        //         //isModified
        //         vo.isModified = false

        //         //alert
        //         vo.$alert(vo.$t('userSaveUsersSuccess'))

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

    }
}
</script>

<style scoped>
</style>
