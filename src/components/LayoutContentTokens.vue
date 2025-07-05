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
                        :icon="mdiShieldKeyOutline"
                        :color="'#000'"
                        :size="32"
                    ></WIcon>

                    <div style="padding-left:12px;">

                        <div style="font-size:1.4rem; color:#000;">
                            {{$t('mmTokensList')}}
                        </div>

                        <div style="padding-top:2px; font-size:0.8rem; color:#666;">
                            {{$t('mmTokensListMsg')}}
                        </div>

                    </div>

                </div>
            </div>

            <!-- 功能區 -->
            <div
                style="padding:5px; border-top:1px solid #ddd; display:flex; align-items:center;"
                _v-if="showIsEditable || isEditable"
            >

                <template v-if="showIsEditable">

                    <div style="padding:6px 0px 4px 4px;">
                        <WSwitch
                            v-model="isEditable"
                            :text="$t('modeEdit')"
                        ></WSwitch>
                    </div>

                    <div style="padding-left:10px;"></div>

                </template>

                <template v-if="true">

                    <WPopup
                        :isolated="true"
                        _show=""
                        _hide=""
                    >
                        <template v-slot:trigger>
                            <WButtonCircle
                                :paddingStyle="{v:6,h:6}"
                                :tooltip="$t('showTabCols')"
                                :icon="mdiTableHeadersEye"
                                :backgroundColor="'#fff'"
                                :backgroundColorHover="'#f2f2f2'"
                                :iconColor="'#444'"
                                :iconColorHover="'#222'"
                                :iconColorFocus="'#222'"
                                :shadow="false"
                                _click=""
                            ></WButtonCircle>
                        </template>

                        <template v-slot:content>
                            <div style="padding:10px 0px 10px 0px;">

                                <div style="padding:7px 10px; font-size:0.85rem; color:#222; background:#f2f2f2;">
                                    {{$t('showTabCols')}}
                                </div>

                                <div style="padding:7px 9px 0px 7px;">
                                    <WInputCheckbox
                                        :items="tabKeysPick"
                                        v-model="tabKeysShow"
                                        @input="toggleTabKeys"
                                    >
                                        <template v-slot="props">
                                            <div style="padding-left:3px; display:flex; align-items:center; font-size:0.85rem; height:24px; cursor:pointer;">
                                                {{getHead(props.item.data)}}
                                            </div>
                                        </template>
                                    </WInputCheckbox>
                                </div>

                            </div>
                        </template>
                    </WPopup>

                    <div style="padding-left:4px;"></div>

                </template>

                <template v-if="isEditable && hasItemsCheck">

                    <WButtonCircle
                        :paddingStyle="{v:6,h:6}"
                        :tooltip="$t('tokenDeleteCheckTokens')"
                        :icon="mdiTrashCanOutline"
                        :backgroundColor="'#fff'"
                        :backgroundColorHover="'#f2f2f2'"
                        :iconColor="'#444'"
                        :iconColorHover="'#222'"
                        :iconColorFocus="'#222'"
                        :shadow="false"
                        @click="deleteItemsCheck"
                    ></WButtonCircle>

                    <div style="padding-left:4px;"></div>

                </template>

                <template v-if="isEditable && isModified">

                    <WButtonCircle
                        :paddingStyle="{v:6,h:6}"
                        :tooltip="$t('saveChanges')"
                        :icon="mdiCloudUploadOutline"
                        :backgroundColor="'rgba(255,0,50,0.6)'"
                        :backgroundColorHover="'rgba(255,0,50,0.7)'"
                        :backgroundColorFocus="'rgba(255,0,50,0.7)'"
                        :iconColor="'#eee'"
                        :iconColorHover="'#fff'"
                        :iconColorFocus="'#fff'"
                        :shadow="false"
                        @click="saveTokens"
                    ></WButtonCircle>

                    <div style="padding-left:4px;"></div>

                </template>

            </div>

        </div>

        <template
            v-if="!isLoading"
        >

            <template v-if="items">
                <WAggridVueDyn
                    ref="rftable"
                    :style="`width:100%;`"
                    :height="contentHeight"
                    :opt="opt"
                >
                </WAggridVueDyn>
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
import { mdiShieldKeyOutline, mdiCloudUploadOutline, mdiTrashCanOutline, mdiTableHeadersEye } from '@mdi/js/mdi.js'
import ot from 'dayjs'
import get from 'lodash-es/get.js'
import set from 'lodash-es/set.js'
import each from 'lodash-es/each.js'
import size from 'lodash-es/size.js'
import filter from 'lodash-es/filter.js'
import sortBy from 'lodash-es/sortBy.js'
import cloneDeep from 'lodash-es/cloneDeep.js'
import isestr from 'wsemi/src/isestr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import istimemsTZ from 'wsemi/src/istimemsTZ.mjs'
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
            mdiShieldKeyOutline,
            mdiCloudUploadOutline,
            mdiTrashCanOutline,
            mdiTableHeadersEye,

            panelWidth: 100,
            panelHeight: 100,
            headHeight: 100,

            isLoading: true,
            firstSetting: true,
            showIsEditable: false,
            isEditable: false,
            isModified: false,

            tabKeys: [
                'id',
                'token',
                'userId',
                'isApp',
                'timeCreate',
                'timeEnd',
                'timeUpdate',
            ],
            tabKeysPick: [
                'token',
                'userId',
                'isApp',
                'timeCreate',
                'timeEnd',
                'timeUpdate',
            ],
            tabKeysShow: [
                'token',
                'userId',
                'isApp',
                'timeCreate',
                'timeEnd',
                'timeUpdate',
            ],

            tokens: [],
            items: [],
            itemsCheck: [],
            opt: null,

        }
    },
    mounted: function() {
        // console.log('mounted')

        let vo = this

        //註冊至$dg供使用
        vo.$dg.toggleItemIsAppById = vo.toggleItemIsAppById
        vo.$dg.modifyItemTimeCreateById = vo.modifyItemTimeCreateById
        vo.$dg.modifyItemTimeEndById = vo.modifyItemTimeEndById
        vo.$dg.modifyItemTimeUpdateById = vo.modifyItemTimeUpdateById

        //firstSetting
        if (vo.firstSetting) {
            // console.log('webInfor', vo.webInfor)

            let showModeEditTokens = get(vo, 'webInfor.showModeEditTokens', '')
            vo.showIsEditable = showModeEditTokens === 'y'
            let modeEditTokens = get(vo, 'webInfor.modeEditTokens', '')
            vo.isEditable = modeEditTokens === 'y'

            vo.firstSetting = false
        }

        //token
        let token = vo.userToken
        // console.log('token', token)

        //getTokensList
        vo.$fapi.getTokensList(token)
            .then((res) => {
                // console.log(res)
                res = sortBy(res, 'timeCreate').reverse()
                vo.tokens = res
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

            //trigger
            let isEditable = vo.isEditable

            //items
            let items = cloneDeep(vo.tokens)

            //save
            vo.items = items

            //genOpt
            vo.genOpt({ isEditable })

            //isLoading
            vo.isLoading = false

            return ''
        },

        contentHeight: function() {
            let vo = this

            //h
            let h = vo.panelHeight - vo.headHeight
            h = Math.max(h, 0)

            return h
        },

        hasItemsCheck: function() {
            let vo = this

            //h
            let b = size(vo.itemsCheck) > 0

            return b
        },

        hasItemCheckOne: function() {
            let vo = this

            //h
            let b = size(vo.itemsCheck) === 1

            return b
        },

        isError: function() {
            return ''
        },

        kpHead: function() {
            let vo = this

            let kp = {
                'id': vo.$t('id'),
                'token': vo.$t('token'),
                'userId': vo.$t('userId'),
                'isApp': vo.$t('isApp'),
                'timeCreate': vo.$t('tokenTimeCreate'),
                'timeEnd': vo.$t('tokenTimeEnd'),
                'timeUpdate': vo.$t('tokenTimeUpdate'),
            }

            return kp
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

        resizeHead: function(msg) {
            // console.log('methods resizeHead', msg)

            let vo = this

            //headHeight
            vo.headHeight = msg.snew.offsetHeight

        },

        getHead: function(key) {
            // console.log('methods getHead', key)

            let vo = this

            let head = get(vo, `kpHead.${key}`, '')

            return head
        },

        genOpt: function() {
            // console.log('methods genOpt')

            let vo = this

            //default
            vo.itemsCheck = []

            //opt
            let opt = null
            if (size(vo.items) > 0) {

                //ks
                let ks = vo.tabKeys
                // console.log('ks', ks)

                //kpHead
                let kpHead = vo.kpHead

                //kpCellEditable, kpRowDrag, kpHeadCheckBox
                let kpCellEditable = {}
                let kpRowDrag = {}
                let kpHeadCheckBox = {}
                if (vo.isEditable) {
                    kpCellEditable = {
                        'token': true,
                        'userId': (params) => {
                            // console.log('params', params)

                            //r
                            let r = get(params, 'data', {})

                            //isApp
                            let isApp = get(r, 'isApp', '')
                            // console.log('isApp', isApp)

                            //b
                            let b = isApp !== 'y'

                            return b
                        },
                    }
                    kpRowDrag = {
                        'token': true,
                    }
                    kpHeadCheckBox = {
                        'token': true,
                    }
                }

                //kpHeadHide
                let kpHeadHide = {
                    'id': true,
                }
                if (true) {
                    let tabKeysHide = arrPull(vo.tabKeysPick, vo.tabKeysShow)
                    each(tabKeysHide, (k) => {
                        kpHeadHide[k] = true
                    })
                }

                //opt
                opt = {
                    language: vo.$t('aggridLanguage'),
                    rows: vo.items,
                    keys: ks,
                    kpHead,
                    // autoFitColumn: true,
                    defCellEditable: false, //vo.isEditable
                    defHeadFilter: true,
                    defCellAlignH: 'left',
                    kpHeadHide,
                    kpHeadFixLeft: {
                        'token': true,
                    },
                    defHeadMinWidth: 150,
                    kpHeadWidth: {
                        'token': 300,
                        'userId': 300,
                        'isApp': 100,
                        'timeCreate': 220,
                        'timeEnd': 220,
                        'timeUpdate': 220,
                    },
                    kpHeadFilterType: {
                        'id': 'text',
                        'token': 'text',
                        'userId': 'text',
                        'isApp': 'text',
                        'timeCreate': 'text',
                        'timeEnd': 'text',
                        'timeUpdate': 'text',
                    },
                    kpCellEditable,
                    kpRowDrag,
                    kpHeadCheckBox,
                    kpHeadFilter: {
                    },
                    kpHeadSort: {
                    },
                    kpHeadFocusHighlight: { //雖然效果不完全, 但因按鈕與cell有padding可被點擊, 故還是需要開啟
                        'timeCreate': false,
                        'timeEnd': false,
                        'timeUpdate': false,
                    },
                    kpCellRender: {
                        'userId': (v, k, r) => {
                            // console.log('kpCellRender userId', v, k, r)

                            //isApp
                            let isApp = get(r, 'isApp', '')
                            // console.log('isApp', isApp, k, r)

                            //t
                            let t = ``
                            if (isApp !== 'y') {
                                t = v
                            }

                            return t
                        },
                        'isApp': (v, k, r) => {
                            // console.log('kpCellRender isApp', v, k, r)

                            //id
                            let id = get(r, 'id', '')
                            // console.log('id', id, k, r)

                            let t = `
                                <input type="checkbox" ${v === 'y' ? 'checked' : ''} onclick="$vo.$dg.toggleItemIsAppById('${id}')" ${vo.isEditable ? '' : 'disabled'} />
                            `

                            return t
                        },
                        'timeCreate': (v, k, r) => {
                            // console.log('kpCellRender timeCreate', v, k, r)

                            //id
                            let id = get(r, 'id', '')
                            // console.log('id', id, k, r)

                            //vv, vm
                            let vv = ''
                            let vm = vo.$t('tokenTimeEmpty')
                            if (istimemsTZ(v)) { //原始數據為timemsTZ格式
                                let vt = ot(v)
                                vv = vt.format('YYYY-MM-DDTHH:mm:ss.SSSZ')
                                vm = vt.format('YYYY-MM-DD HH:mm')
                            }
                            // console.log('vv', vv)
                            // console.log('vm', vm)

                            //t
                            let t = `
                                <div onclick="event.stopPropagation();event.preventDefault();" onmousedown="event.stopPropagation();event.preventDefault();">
                                    <button style="width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" onclick="$vo.$dg.modifyItemTimeCreateById(this,'${vv}','${id}')" ${vo.isEditable ? '' : 'disabled'}>${vm}</button>
                                </div>
                            `

                            return t
                        },
                        'timeEnd': (v, k, r) => {
                            // console.log('kpCellRender timeEnd', v, k, r)

                            //id
                            let id = get(r, 'id', '')
                            // console.log('id', id, k, r)

                            //vv, vm
                            let vv = ''
                            let vm = vo.$t('tokenTimeEmpty')
                            if (istimemsTZ(v)) { //原始數據為timemsTZ格式
                                let vt = ot(v)
                                vv = vt.format('YYYY-MM-DDTHH:mm:ss.SSSZ')
                                vm = vt.format('YYYY-MM-DD HH:mm')
                            }
                            // console.log('vv', vv)
                            // console.log('vm', vm)

                            //t
                            let t = `
                                <div onclick="event.stopPropagation();event.preventDefault();" onmousedown="event.stopPropagation();event.preventDefault();">
                                    <button style="width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" onclick="$vo.$dg.modifyItemTimeEndById(this,'${vv}','${id}')" ${vo.isEditable ? '' : 'disabled'}>${vm}</button>
                                </div>
                            `

                            return t
                        },
                        'timeUpdate': (v, k, r) => {
                            // console.log('kpCellRender timeUpdate', v, k, r)

                            //id
                            let id = get(r, 'id', '')
                            // console.log('id', id, k, r)

                            //vv, vm
                            let vv = ''
                            let vm = vo.$t('tokenTimeEmpty')
                            if (istimemsTZ(v)) { //原始數據為timemsTZ格式
                                let vt = ot(v)
                                vv = vt.format('YYYY-MM-DDTHH:mm:ss.SSSZ')
                                vm = vt.format('YYYY-MM-DD HH:mm')
                            }
                            // console.log('vv', vv)
                            // console.log('vm', vm)

                            //t
                            let t = `
                                <div onclick="event.stopPropagation();event.preventDefault();" onmousedown="event.stopPropagation();event.preventDefault();">
                                    <button style="width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" onclick="$vo.$dg.modifyItemTimeUpdateById(this,'${vv}','${id}')" ${vo.isEditable ? '' : 'disabled'}>${vm}</button>
                                </div>
                            `

                            return t
                        },
                    },
                    rowsChange: (rs) => {
                        // console.log('rowsChange', rs)
                        // console.log('rowsChange cloneDeep(vo.opt.rows)', cloneDeep(vo.opt.rows))

                        //isModified
                        vo.isModified = true

                    },
                    rowChecked: (rs) => {
                        // console.log('rowChecked', rs)
                        // console.log('rowChecked cloneDeep(vo.opt.rows)', cloneDeep(vo.opt.rows))

                        //save itemsCheck
                        vo.itemsCheck = cloneDeep(rs)

                    },
                }
                // console.log('opt', opt)

            }

            //save
            vo.opt = opt

        },

        refresh: function() {
            let vo = this

            //cmp
            let cmp = get(vo, '$refs.rftable.$refs.$self')
            // console.log('cmp', cmp)

            //refresh, 因set不會觸發kpCellRender, 故須另外調用組件函數refresh, 進而觸發kpCellRender, 使能更新數據
            cmp.refresh()

        },

        toggleTabKeys: function() {
            let vo = this

            //cmp
            let cmp = get(vo, '$refs.rftable.$refs.$self')
            // console.log('cmp', cmp)

            //showKeys
            cmp.showKeys(vo.tabKeysShow)
            // console.log('tabKeysShow', vo.tabKeysShow)

        },

        toggleItemByKeyAndId: function(key, id) {
            // console.log('toggleItemByKeyAndId', key, id)

            let vo = this

            //check
            if (!isestr(id)) {
                vo.$alert(`${vo.$t('userEditNoUserId')}`, { type: 'error' })
                return
            }

            //rows
            let rows = get(vo, 'opt.rows', [])

            //find
            let r = null
            let kr = null
            each(rows, (v, k) => {
                if (get(v, 'id', '') === id) {
                    r = v
                    kr = k
                    return false //跳出
                }
            })

            //check
            if (!iseobj(r)) {
                vo.$alert(`${vo.$t('userEditNoUserData')}`, { type: 'error' })
                return
            }

            //v
            let _v = get(r, key, 'n')
            let v = _v === 'y' ? 'n' : 'y'
            // console.log(key, v)

            //set
            set(vo, `opt.rows[${kr}].${key}`, v)
            // console.log('vo.opt.rows[kr]', cloneDeep(vo.opt.rows[kr]))

            //refresh
            vo.refresh()

            //isModified
            vo.isModified = true

        },

        toggleItemIsAppById: function(id) {
            // console.log('toggleItemIsAppById', id)

            let vo = this

            //toggleItemByKeyAndId
            vo.toggleItemByKeyAndId('isApp', id)

        },

        modifyItemByKeyAndId: function(key, ele, t, id) {
            // console.log('modifyItemByKeyAndId', ele, t, id)

            let vo = this

            //check
            if (!isestr(id)) {
                vo.$alert(`${vo.$t('tokenEditNoTokenId')}`, { type: 'error' })
                return
            }

            //timePrev, 須給予秒時間, 要滿足istime才能展示初始值
            let timePrev = ''
            if (istimemsTZ(t)) {
                timePrev = ot(t).format('YYYY-MM-DDTHH:mm:ss')
            }
            // console.log('timePrev', timePrev)

            //domShowInputDatatime
            let type = 'datetime-local' //'datetime-local', 'date'
            domShowInputDatatime(timePrev, { eleRef: ele, type })
                .then((timeNew) => {
                    // console.log(k, 'timeNew', timeNew)

                    //rows
                    let rows = get(vo, 'opt.rows', [])

                    //find
                    let r = null
                    let kr = null
                    each(rows, (v, k) => {
                        if (get(v, 'id', '') === id) {
                            r = v
                            kr = k
                            return false //跳出
                        }
                    })

                    //check
                    if (!iseobj(r)) {
                        vo.$alert(`${vo.$t('tokenEditNoTokenData')}`, { type: 'error' })
                        return
                    }

                    //v
                    let vt = ot(timeNew, 'YYYY-MM-DDTHH:mm') //domShowInputDatatime數據為年月日時分
                    let v = vt.format('YYYY-MM-DDTHH:mm:ss.SSSZ') //轉回原始數據為timemsTZ格式
                    // console.log('v', v)

                    //set
                    set(vo, `opt.rows[${kr}].${key}`, v)
                    // console.log('vo.opt.rows[kr]', cloneDeep(vo.opt.rows[kr]))

                    //refresh
                    vo.refresh()

                    //isModified
                    vo.isModified = true

                })

        },

        modifyItemTimeCreateById: function(ele, t, id) {
            // console.log('modifyItemTimeCreateById', ele, t, id)

            let vo = this

            //modifyItemByKeyAndId
            vo.modifyItemByKeyAndId('timeCreate', ele, t, id)

        },

        modifyItemTimeEndById: function(ele, t, id) {
            // console.log('modifyItemTimeEndById', ele, t, id)

            let vo = this

            //modifyItemByKeyAndId
            vo.modifyItemByKeyAndId('timeEnd', ele, t, id)

        },

        modifyItemTimeUpdateById: function(ele, t, id) {
            // console.log('modifyItemTimeUpdateById', ele, t, id)

            let vo = this

            //modifyItemByKeyAndId
            vo.modifyItemByKeyAndId('timeUpdate', ele, t, id)

        },

        deleteItemsCheck: function() {
            // console.log('method deleteItemsCheck')

            let vo = this

            //check
            if (size(vo.itemsCheck) === 0) {
                console.log(`size(vo.itemsCheck) === 0`, vo.itemsCheck)
                vo.$alert(`${vo.$t('anUnexpectedErrorOccurred')}`, { type: 'error' })
                return
            }

            //cloneDeep
            let rows = get(vo, 'opt.rows', [])

            //cloneDeep
            rows = cloneDeep(rows)

            //filter
            each(vo.itemsCheck, (v) => {
                // console.log('v', v)
                let id = get(v, 'data.id', '')
                if (!isestr(id)) {
                    console.log(`invalid id`)
                    return true //跳出換下一個
                }
                rows = filter(rows, (vv) => {
                    return vv.id !== id
                })
            })

            //clear
            vo.itemsCheck = []

            //save
            vo.tokens = cloneDeep(rows) //直接更新由getTokensList取得的tokens, 連帶驅動computed重算, 故不用另外更新vo.items與vo.opt.rows
            // console.log('cloneDeep(vo.tokens)', cloneDeep(vo.tokens))

            //isModified
            vo.isModified = true

        },

        saveTokens: function() {
            // console.log('method saveTokens')

            let vo = this

            async function core() {
                let errTemp = null

                //show loading
                vo.$ui.updateLoading(true)

                //check
                if (isestr(vo.isError)) {
                    vo.$alert(`${vo.isError}`, { type: 'error' })
                    return
                }

                //rows
                let rows = get(vo, 'opt.rows', [])

                //check
                if (size(rows) === 0) {
                    // vo.$alert(`${vo.$t('tokenAddEmpty')}`, { type: 'error' })
                    // return
                }

                //token
                let token = vo.userToken
                // console.log('token', token)

                //updateTokensList
                await vo.$fapi.updateTokensList(token, rows)
                    .catch((err) => {
                        errTemp = err
                    })

                //check
                if (errTemp !== null) {
                    vo.$alert(`${vo.$t('tokenSaveTokensFail')}: ${errTemp}`, { type: 'error' })
                    return
                }

                //isModified
                vo.isModified = false

                //alert
                vo.$alert(vo.$t('tokenSaveTokensSuccess'))

            }

            //core
            core()
                // .then((res) => {
                //     console.log('then', res)
                // })
                .catch((err) => {
                    console.log('catch', err)
                    vo.$alert(vo.$t('anUnexpectedErrorOccurred'), { type: 'error' })
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

