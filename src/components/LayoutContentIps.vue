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
                        :icon="mdiIpNetwork"
                        :color="'#000'"
                        :size="32"
                    ></WIcon>

                    <div style="padding-left:12px;">

                        <div style="font-size:1.4rem; color:#000;">
                            {{$t('mmIpsList')}}
                        </div>

                        <div style="padding-top:2px; font-size:0.8rem; color:#666;">
                            {{$t('mmIpsListMsg')}}
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
                        :tooltip="$t('ipDeleteCheckIps')"
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
                        @click="saveIps"
                    ></WButtonCircle>

                    <div style="padding-left:4px;"></div>

                </template>

            </div>

        </div>

        <template
            v-if="!firstLoading"
        >

            <template v-if="items">
                <WAggridVue
                    ref="rftable"
                    :style="`width:100%;`"
                    :height="contentHeight"
                    :opt="opt"
                >
                    <template v-slot:cell-render="props">
                        <template v-if="props.key === 'timeBlocked'">
                            <div @click.stop.prevent @mousedown.stop.prevent style="display:flex; align-items:center;">
                                <WTimeminute
                                    :style="`line-height:1.1rem;`"
                                    :value="cellTimeForInput(props.value)"
                                    @input="handleCellTimeInput('timeBlocked', $ui.gv(props.row, 'id'), $event)"
                                    :editable="isEditable"
                                    :textEmpty="$t('selectDate')"
                                    :paddingStyle="{v:1,h:8}"
                                    :placementDistY="3"
                                    :textFontSize="'0.8rem'"
                                    :backgroundColor="'#f0f0f0'"
                                    :backgroundColorHover="'#e5e5e5'"
                                    :backgroundColorFocus="'#e5e5e5'"
                                    :borderColor="'#767676'"
                                    :borderColorHover="'#767676'"
                                    :borderColorFocus="'#767676'"
                                    :borderRadius="4"
                                    :minuteInter="1"
                                    :hourMin="0"
                                    :hourMax="23"
                                    :shadow="false"
                                    icon=""
                                >
                                </WTimeminute>
                            </div>
                        </template>
                        <template v-else>{{ props.value }}</template>
                    </template>
                </WAggridVue>
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
import { mdiIpNetwork, mdiCloudUploadOutline, mdiTrashCanOutline, mdiTableHeadersEye } from '@mdi/js/mdi.js'
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
import WIcon from 'w-component-vue/src/components/WIcon.vue'
import WSwitch from 'w-component-vue/src/components/WSwitch.vue'
import WButtonCircle from 'w-component-vue/src/components/WButtonCircle.vue'
import WPopup from 'w-component-vue/src/components/WPopup.vue'
import WInputCheckbox from 'w-component-vue/src/components/WInputCheckbox.vue'
import WAggridVue from 'w-aggrid-vue/src/components/WAggridVue.vue'
import WTimeminute from 'w-component-vue/src/components/WTimeminute.vue'


export default {
    components: {
        WIcon,
        WSwitch,
        WButtonCircle,
        WPopup,
        WInputCheckbox,
        WAggridVue,
        WTimeminute,
    },
    props: {
        drawer: {
            type: Boolean,
            default: false,
        },
    },
    data: function() {
        return {
            mdiIpNetwork,
            mdiCloudUploadOutline,
            mdiTrashCanOutline,
            mdiTableHeadersEye,

            panelWidth: 100,
            panelHeight: 100,
            headHeight: 100,

            firstLoading: true,
            firstSetting: true,
            showIsEditable: false,
            isEditable: false,
            isModified: false,

            tabKeys: [
                'id',
                'ip',
                'timeBlocked',
            ],
            tabKeysPick: [
                'ip',
                'timeBlocked',
            ],
            tabKeysShow: [
                'ip',
                'timeBlocked',
            ],

            ips: [],
            items: [],
            itemsCheck: [],
            opt: null,

        }
    },
    mounted: function() {
        // console.log('mounted')

        let vo = this

        //註冊至$dg供使用

        //firstSetting
        if (vo.firstSetting) {
            // console.log('webInfor', vo.webInfor)

            let showModeEditIps = get(vo, 'webInfor.showModeEditIps', '')
            vo.showIsEditable = showModeEditIps === 'y'
            let modeEditIps = get(vo, 'webInfor.modeEditIps', '')
            vo.isEditable = modeEditIps === 'y'

            //會觸發數據變更再導致opt變更導致觸發rowsChange等事件, 故得要延遲, 供組件偵測初始設定數據初始化之用
            setTimeout(() => {
                vo.firstSetting = false
                // console.log('firstSetting', vo.firstSetting)
            }, 1)

        }

        //token
        let token = vo.userToken
        // console.log('token', token)

        //getIpsList
        vo.$fapi.getIpsList(token)
            .then((res) => {
                // console.log(res)
                res = sortBy(res, 'ip').reverse()
                vo.ips = res
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

        syncState: function() {
            let vo = this
            return get(vo, '$store.state.syncState')
        },

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
            let items = cloneDeep(vo.ips)

            //save
            vo.items = items

            //genOpt
            vo.genOpt({ isEditable })

            //firstLoading
            vo.firstLoading = false

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
            //待日後擴充, 先不刪
            return ''
        },

        kpHead: function() {
            let vo = this

            let kp = {
                'id': vo.$t('id'),
                'ip': vo.$t('ip'),
                'timeBlocked': vo.$t('ipTimeBlocked'),
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
            //  - firstLoading=true (尚未完成第一次載入) + items=0: opt=null, 允許 loading state
            //  - firstLoading=false (已載入過) + items=0: opt 仍須有效, rows=空 array
            //    這對應 "使用者把 row 全刪光" 的合理 UI 操作; 缺這條會撞 w-aggrid-vue 的 changeOpt
            //    在 opt=null 時 early return 不清空 ag-grid 的 bug, 導致 stale rowData 殘留畫面.
            let opt = null
            if (size(vo.items) > 0 || !vo.firstLoading) {

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
                        'ip': true,
                    }
                    kpRowDrag = {
                        'ip': true,
                    }
                    kpHeadCheckBox = {
                        'ip': true,
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
                        'ip': true,
                    },
                    defHeadMinWidth: 150,
                    kpHeadWidth: {
                        'ip': 300,
                        'timeBlocked': 220,
                    },
                    kpHeadFilterType: {
                        'id': 'text',
                        'ip': 'text',
                        'timeBlocked': 'text',
                    },
                    kpCellEditable,
                    kpRowDrag,
                    kpHeadCheckBox,
                    kpHeadFilter: {
                    },
                    kpHeadSort: {
                    },
                    kpHeadFocusHighlight: { //雖然效果不完全, 但因按鈕與cell有padding可被點擊, 故還是需要開啟
                        'timeBlocked': false,
                    },
                    rowsChange: (rs) => {
                        // console.log('rowsChange', rs)
                        // console.log('rowsChange cloneDeep(vo.opt.rows)', cloneDeep(vo.opt.rows))

                        //check
                        if (!vo.syncState || vo.firstLoading || vo.firstSetting) {
                            return
                        }

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
            let cmp = get(vo, '$refs.rftable')
            // console.log('cmp', cmp)

            //refresh, 因set不會觸發kpCellRender, 故須另外調用組件函數refresh, 進而觸發kpCellRender, 使能更新數據
            cmp.refresh()

        },

        toggleTabKeys: function() {
            let vo = this

            //cmp
            let cmp = get(vo, '$refs.rftable')
            // console.log('cmp', cmp)

            //showKeys
            cmp.showKeys(vo.tabKeysShow)
            // console.log('tabKeysShow', vo.tabKeysShow)

        },

        cellTimeForInput: function(v) {
            if (istimemsTZ(v)) {
                return ot(v).format('YYYY-MM-DDTHH:mm:ss')
            }
            return ''
        },

        handleCellTimeInput: function(key, id, timeNew) {
            let vo = this

            //check
            if (!isestr(id)) {
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
                return
            }

            //v
            let vt = ot(timeNew)
            let v = vt.format('YYYY-MM-DDTHH:mm:ss.SSSZ') //轉回原始數據為timemsTZ格式

            //set
            set(vo, `opt.rows[${kr}].${key}`, v)

            //refresh
            vo.refresh()

            //isModified
            vo.isModified = true

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
            vo.ips = cloneDeep(rows) //直接更新由getIpsList取得的ips, 連帶驅動computed重算, 故不用另外更新vo.items與vo.opt.rows
            // console.log('cloneDeep(vo.ips)', cloneDeep(vo.ips))

            //isModified
            vo.isModified = true

        },

        saveIps: function() {
            // console.log('method saveIps')

            let vo = this

            async function core() {
                let errTemp = null

                //本函式之 updateLoading(false) 多處散落 + finally 一處收尾為刻意設計 (非 §5.1 canonical):
                //每個 await $dg.showCheckYes(...) 前先關 loading, 避免 modal 等待期間 loading spinner 疊在底下
                //造成 UX 怪 (使用者見 modal 但底下還轉圈). finally 統一保險, 即使中間漏關亦保證最終關閉.
                //對應 ADR-002 訊息呈現分流之 showCheckYes modal 持久阻塞語意.

                //show loading
                vo.$ui.updateLoading(true)

                //check
                if (isestr(vo.isError)) {
                    vo.$ui.updateLoading(false)
                    await vo.$dg.showCheckYes(`${vo.isError}`)
                    return
                }

                //rows
                let rows = get(vo, 'opt.rows', [])

                // //check, 可允許全刪除
                // if (size(rows) === 0) {
                //     vo.$alert(`${vo.$t('ipAddEmpty')}`, { type: 'error' })
                //     return
                // }

                //token
                let token = vo.userToken
                // console.log('token', token)

                //updateIpsList
                await vo.$fapi.updateIpsList(token, rows)
                    .catch((err) => {
                        errTemp = err
                    })

                //check
                if (errTemp !== null) {
                    vo.$ui.updateLoading(false)
                    await vo.$dg.showCheckYes(`${vo.$t('ipSaveIpsFail')}: ${errTemp}`)
                    return
                }

                //isModified
                vo.isModified = false

                //alert
                vo.$ui.updateLoading(false)
                await vo.$dg.showCheckYes(vo.$t('ipSaveIpsSuccess'))

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

