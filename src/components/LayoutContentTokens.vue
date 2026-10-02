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
                        :promiseUnlock="true"
                        @click="onClickSaveTokensBtn"
                    ></WButtonCircle>

                    <div style="padding-left:4px;"></div>

                </template>

            </div>

        </div>

        <template
            v-if="!firstLoading && !errMsg"
        >

            <template v-if="items">
                <WAggridVue
                    ref="rftable"
                    :style="`width:100%;`"
                    :height="contentHeight"
                    :opt="opt"
                >
                    <template v-slot:cell-render="props">
                        <template v-if="props.key === 'userId'">
                            <span v-if="$ui.gv(props.row, 'isApp') !== 'y'">{{ props.value }}</span>
                        </template>
                        <template v-else-if="props.key === 'isApp'">
                            <input type="checkbox" :checked="props.value === 'y'" @click="$dg.toggleItemIsAppById($ui.gv(props.row, 'id'))" :disabled="!isEditable" />
                        </template>
                        <template v-else-if="props.key === 'perms'">
                            <!-- 應用系統權限僅適用於 app token (ADR-069); 點擊開啟清單, 編輯模式可勾選, 關閉清單時寫回該列 -->
                            <div
                                style="display:flex; align-items:center; height:100%;"
                                @click.stop.prevent
                                @mousedown.stop.prevent
                                v-if="$ui.gv(props.row, 'isApp') === 'y'"
                            >
                                <WPopup
                                    style="flex:1; min-width:0px;"
                                    :displayType="'line'"
                                    :isolated="true"
                                    @show="() => openPermsDraft($ui.gv(props.row, 'id'))"
                                    @hide="closePermsDraft"
                                >
                                    <template v-slot:trigger>
                                        <div class="perms-trigger">
                                            <AppPermsTags
                                                style="flex:1; min-width:0px;"
                                                :texts="getPermsTexts(props.row)"
                                            ></AppPermsTags>
                                        </div>
                                    </template>
                                    <template v-slot:content>
                                        <div style="padding:10px 0px 10px 0px;">

                                            <div style="padding:7px 10px; font-size:0.85rem; color:#222; background:#f2f2f2;">
                                                {{$t('tokenPerms')}}
                                            </div>

                                            <div style="padding:7px 9px 0px 7px;">

                                                <WInputCheckbox
                                                    :items="keysAppPermBase"
                                                    :value="keysAppPermBase"
                                                    :editable="false"
                                                >
                                                    <template v-slot="p">
                                                        <div style="padding-left:3px; display:flex; align-items:center; font-size:0.85rem; height:24px;">
                                                            {{$t(`appPerm_${p.item.data}`)}}
                                                            <span style="padding-left:6px; font-size:0.75rem;">({{$t('tokenPermsBase')}})</span>
                                                        </div>
                                                    </template>
                                                </WInputCheckbox>

                                                <WInputCheckbox
                                                    :items="keysAppPermOpt"
                                                    :value="permsDraft"
                                                    @input="setPermsDraft"
                                                    :editable="isEditable"
                                                >
                                                    <template v-slot="p">
                                                        <div :style="`padding-left:3px; display:flex; align-items:center; font-size:0.85rem; height:24px; ${isEditable?'cursor:pointer;':''}`">
                                                            {{$t(`appPerm_${p.item.data}`)}}
                                                            <span
                                                                style="padding-left:6px; font-size:0.75rem; color:#D81B60;"
                                                                v-if="keysAppPermHigh.includes(p.item.data)"
                                                            >({{$t('tokenPermsHigh')}})</span>
                                                        </div>
                                                    </template>
                                                </WInputCheckbox>

                                            </div>

                                        </div>
                                    </template>
                                </WPopup>
                            </div>
                        </template>
                        <template v-else-if="props.key === 'timeCreate'">
                            <div @click.stop.prevent @mousedown.stop.prevent style="display:flex; align-items:center;">
                                <WTimeminute
                                    :style="`line-height:1.1rem;`"
                                    :value="cellTimeForInput(props.value)"
                                    @input="handleCellTimeInput('timeCreate', $ui.gv(props.row, 'id'), $event)"
                                    :editable="isEditable"
                                    :textEmpty="$t('selectDate')"
                                    :funRenderYear="timePickerRenders.funRenderYear"
                                    :funRenderMonth="timePickerRenders.funRenderMonth"
                                    :funRenderDayOfWeek="timePickerRenders.funRenderDayOfWeek"
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
                        <template v-else-if="props.key === 'timeEnd'">
                            <div @click.stop.prevent @mousedown.stop.prevent style="display:flex; align-items:center;">
                                <WTimeminute
                                    :style="`line-height:1.1rem;`"
                                    :value="cellTimeForInput(props.value)"
                                    @input="handleCellTimeInput('timeEnd', $ui.gv(props.row, 'id'), $event)"
                                    :editable="isEditable"
                                    :textEmpty="$t('selectDate')"
                                    :funRenderYear="timePickerRenders.funRenderYear"
                                    :funRenderMonth="timePickerRenders.funRenderMonth"
                                    :funRenderDayOfWeek="timePickerRenders.funRenderDayOfWeek"
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
                        <template v-else-if="props.key === 'timeUpdate'">
                            <div @click.stop.prevent @mousedown.stop.prevent style="display:flex; align-items:center;">
                                <WTimeminute
                                    :style="`line-height:1.1rem;`"
                                    :value="cellTimeForInput(props.value)"
                                    @input="handleCellTimeInput('timeUpdate', $ui.gv(props.row, 'id'), $event)"
                                    :editable="isEditable"
                                    :textEmpty="$t('selectDate')"
                                    :funRenderYear="timePickerRenders.funRenderYear"
                                    :funRenderMonth="timePickerRenders.funRenderMonth"
                                    :funRenderDayOfWeek="timePickerRenders.funRenderDayOfWeek"
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

        <!-- 清單載入失敗: 顯示 getDataError, 不顯示空表格(否則「No Rows To Show」被誤認為無資料; 同 LayoutContentStaInfor / LayoutContentUserInfor) -->
        <div
            style="padding:10px 15px; font-size:0.8rem;"
            v-else-if="errMsg"
        >
            {{errMsg}}
        </div>

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
import WIcon from 'w-component-vue/src/components/WIcon.vue'
import WSwitch from 'w-component-vue/src/components/WSwitch.vue'
import WButtonCircle from 'w-component-vue/src/components/WButtonCircle.vue'
import WPopup from 'w-component-vue/src/components/WPopup.vue'
import WInputCheckbox from 'w-component-vue/src/components/WInputCheckbox.vue'
import WAggridVue from 'w-aggrid-vue/src/components/WAggridVue.vue'
import WTimeminute from 'w-component-vue/src/components/WTimeminute.vue'
import { keysAppPerm, keysAppPermBase, keysAppPermHigh, getAppPerms, normAppPerms } from '../appPerms.mjs'
import AppPermsTags from './AppPermsTags.vue'


export default {
    components: {
        WIcon,
        WSwitch,
        WButtonCircle,
        WPopup,
        WInputCheckbox,
        WAggridVue,
        WTimeminute,
        AppPermsTags,
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

            firstLoading: true,
            errMsg: '', //清單載入失敗之訊息(getDataError), 有值時以訊息取代表格
            firstSetting: true,
            systemProcing: false, //程式端載入/重載清單資料期間為true, 用於排除非使用者操作之rowsChange
            showIsEditable: false,
            isEditable: false,
            isModified: false,

            tabKeys: [
                'id',
                'token',
                'userId',
                'isApp',
                'perms',
                'timeCreate',
                'timeEnd',
                'timeUpdate',
            ],
            tabKeysPick: [
                'token',
                'userId',
                'isApp',
                'perms',
                'timeCreate',
                'timeEnd',
                'timeUpdate',
            ],
            tabKeysShow: [
                'token',
                'userId',
                'isApp',
                'perms',
                'timeCreate',
                'timeEnd',
                'timeUpdate',
            ],

            tokens: [],
            items: [],
            itemsCheck: [],
            opt: null,

            //應用系統權限清單: 基本權限恆勾選不可取消, 其餘可勾選, 可取得管理者權限者加註提示 (ADR-069)
            keysAppPermBase,
            keysAppPermHigh,
            keysAppPermOpt: keysAppPerm.filter((p) => !keysAppPermBase.includes(p)),
            permsEditId: '', //清單開啟中之列id
            permsDraft: [], //清單開啟中之勾選(不含基本權限), 關閉清單時寫回該列

        }
    },
    mounted: function() {
        // console.log('mounted')

        let vo = this

        //註冊至$dg供使用
        vo.$dg.toggleItemIsAppById = vo.toggleItemIsAppById

        //firstSetting
        if (vo.firstSetting) {
            // console.log('webInfor', vo.webInfor)

            let showModeEditTokens = get(vo, 'webInfor.showModeEditTokens', '')
            vo.showIsEditable = showModeEditTokens === 'y'
            let modeEditTokens = get(vo, 'webInfor.modeEditTokens', '')
            vo.isEditable = modeEditTokens === 'y'

            //會觸發數據變更再導致opt變更導致觸發rowsChange等事件, 故得要延遲, 供組件偵測初始設定數據初始化之用
            setTimeout(() => {
                vo.firstSetting = false
                // console.log('firstSetting', vo.firstSetting)
            }, 1)

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
                vo.markDataReload() //程式端寫入資料, 其後續 rowsChange 非使用者變更
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

            //trigger: isEditable; firstLoading 亦為相依(載入請求結束時轉 false 須重算, 清單為空時 genOpt 才產得出有效 opt)
            let isEditable = vo.isEditable
            let firstLoading = vo.firstLoading

            //items
            let items = cloneDeep(vo.tokens)

            //save
            vo.items = items

            //genOpt
            vo.genOpt({ isEditable, firstLoading })

            //firstLoading 只由載入請求結束(mounted 之 getTokensList .finally)設為 false; 原於此處即設 false, 使載入中(含請求失敗之重試期間)
            //表格以空資料呈現「No Rows To Show」而被誤認為無資料, 等待訊息(waitingData)從未顯示 (2026-09-29)

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
                'token': vo.$t('token'),
                'userId': vo.$t('userId'),
                'isApp': vo.$t('isApp'),
                'perms': vo.$t('tokenPerms'),
                'timeCreate': vo.$t('tokenTimeCreate'),
                'timeEnd': vo.$t('tokenTimeEnd'),
                'timeUpdate': vo.$t('tokenTimeUpdate'),
            }

            return kp
        },

        timePickerRenders: function() {
            //依當前語系之日期選擇器渲染函數(年/月/星期); 經$ui讀取$store.state.kpText, 語系切換時自動重算
            let vo = this
            return vo.$ui.getTimePickerRenderFuns()
        },

    },
    methods: {

        //markDataReload, 標記接下來由程式端資料載入/重載所觸發之 rowsChange 非使用者變更
        //why: rowsChange 由 Vue 更新 + aggrid 渲染後才非同步觸發, 早於此之旗標(firstLoading/firstSetting)
        //於觸發當下皆已失效, 故須於寫入資料當下標記, 待渲染完成後才解除
        markDataReload: function() {
            let vo = this
            vo.systemProcing = true
            vo.$nextTick(() => {
                setTimeout(() => {
                    vo.systemProcing = false
                }, 1)
            })
        },

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

            //權限清單草稿: 重建表格即以 tokens 重置各列(未儲存之修改一併捨棄), 開啟中之清單隨儲存格銷毀而不會送出關閉事件, 故於此清除
            vo.permsEditId = ''
            vo.permsDraft = []

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
                        'perms': 260,
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
                        'perms': false, //儲存值為權限字串陣列, 顯示為各語系名稱, 文字過濾比對的是前者, 與所見不符故不提供
                    },
                    kpHeadSort: {
                        'perms': false, //陣列值無有意義之排序
                    },
                    kpHeadFocusHighlight: { //此四欄之儲存格不顯示焦點框(欄內為時間選擇器或權限清單觸發框, 焦點框會與控制項本身之框線疊加); w-aggrid-vue 2.0.87 起補 :focus-within, 子控制項取得焦點時亦確實不顯示(該版前僅 :focus, 故效果不完全)
                        'perms': false,
                        'timeCreate': false,
                        'timeEnd': false,
                        'timeUpdate': false,
                    },
                    rowsChange: (rs) => {
                        // console.log('rowsChange', rs)
                        // console.log('rowsChange cloneDeep(vo.opt.rows)', cloneDeep(vo.opt.rows))

                        //check
                        if (!vo.syncState || vo.firstLoading || vo.firstSetting || vo.systemProcing) {
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

            //markDataReload, 重建 opt 屬程式端寫入(changeParams: isEditable 切換 / items 更新皆經此), aggrid 會觸發 rowDataUpdated→rowsChange, 非使用者資料變更, 不可設 isModified (與 perm 同一咽喉點)
            vo.markDataReload()

            //save
            vo.opt = opt

        },

        refresh: function() {
            let vo = this

            //cmp
            let cmp = get(vo, '$refs.rftable')
            // console.log('cmp', cmp)

            //refresh, 因set不會觸發ag-grid重繪, 故須另外調用組件函數refresh(內為redrawRows)重繪各列, 使cell-render slot內容更新(w-aggrid-vue 2.0.56起以cell-render slot取代opt.kpCellRender)
            cmp.refresh()

        },

        toggleTabKeys: function() {
            let vo = this

            //cmp
            let cmp = get(vo, '$refs.rftable')
            // console.log('cmp', cmp)

            //markDataReload, 欄位顯隱(applyColumnState)會令aggrid觸發rowDataUpdated→rowsChange, 非使用者資料變更, 不可設isModified
            vo.markDataReload()

            //showKeys, applyOrder:false 僅切換顯示與隱藏、不依傳入陣列序重排(w-aggrid-vue 2.0.88 起); 故不再先依 tabKeysPick 重排再傳入(原 ADR-054 補丁已移除).
            //注意(ADR-066 待裁示): 勾選同時 tabKeysShow 變動會令 computed changeParams 重算(genOpt 內讀 tabKeysShow 而被追蹤為依賴) → genOpt 重建整張表,
            //欄序回到 opt.keys 原始順序; 故使用者拖曳之欄序目前仍會於顯隱切換時被重置, 勾回之欄回到原位亦是由該重建達成(非本行 applyOrder 之效果)
            cmp.showKeys(vo.tabKeysShow, { applyOrder: false })
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

        getPermsTexts: function(row) {
            //應用系統權限之顯示名稱; 清單開啟中之列顯示勾選中之草稿(清單關閉才寫回列資料, 寫回須重繪各列, 開啟中重繪會關閉清單)
            let vo = this
            let id = get(row, 'id', '')
            let perms = (isestr(id) && id === vo.permsEditId) ? getAppPerms({ perms: vo.permsDraft }) : getAppPerms(row)
            return perms.map((p) => vo.$t(`appPerm_${p}`))
        },

        findRowById: function(id) {
            let vo = this
            let rows = get(vo, 'opt.rows', [])
            let kr = null
            each(rows, (v, k) => {
                if (get(v, 'id', '') === id) {
                    kr = k
                    return false //跳出
                }
            })
            return kr
        },

        openPermsDraft: function(id) {
            let vo = this

            //kr
            let kr = vo.findRowById(id)
            if (kr === null) {
                return
            }

            //permsDraft, 不含基本權限(基本權限另列恆勾選)
            let perms = normAppPerms(get(vo, `opt.rows[${kr}].perms`))
            vo.permsDraft = perms.filter((p) => !keysAppPermBase.includes(p))
            vo.permsEditId = id

        },

        setPermsDraft: function(perms) {
            let vo = this

            //save
            vo.permsDraft = perms

            //isModified, 勾選與該列現值不同即標記已修改, 儲存鈕立即出現(按儲存時先寫回草稿, 見saveTokens)
            let kr = vo.findRowById(vo.permsEditId)
            if (kr === null) {
                return
            }
            let permsOld = normAppPerms(get(vo, `opt.rows[${kr}].perms`)).filter((p) => !keysAppPermBase.includes(p))
            if (JSON.stringify(permsOld) !== JSON.stringify(normAppPerms(perms))) {
                vo.isModified = true
            }

        },

        closePermsDraft: function() {
            let vo = this

            //commitPermsDraft
            vo.commitPermsDraft()

            //clear
            vo.permsEditId = ''
            vo.permsDraft = []

        },

        commitPermsDraft: function() {
            let vo = this

            //check, 非編輯模式或無開啟中之清單不寫回
            let id = vo.permsEditId
            if (!vo.isEditable || !isestr(id)) {
                return
            }

            //kr
            let kr = vo.findRowById(id)
            if (kr === null) {
                return
            }

            //check, 未變更不寫回
            let permsOld = normAppPerms(get(vo, `opt.rows[${kr}].perms`)).filter((p) => !keysAppPermBase.includes(p))
            let permsNew = normAppPerms(vo.permsDraft)
            if (JSON.stringify(permsOld) === JSON.stringify(permsNew)) {
                return
            }

            //set
            set(vo, `opt.rows[${kr}].perms`, permsNew)

            //refresh
            vo.refresh()

            //isModified
            vo.isModified = true

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
            vo.tokens = cloneDeep(rows) //直接更新由getTokensList取得的tokens, 連帶驅動computed重算, 故不用另外更新vo.items與vo.opt.rows
            // console.log('cloneDeep(vo.tokens)', cloneDeep(vo.tokens))

            //isModified
            vo.isModified = true

        },

        onClickSaveTokensBtn: function(msg) {
            //promiseUnlock 之鎖交由 saveTokens 之 runSubmit 於請求結束時釋放, 不於此解鎖: 請求期間儲存鈕之滑鼠與鍵盤 Enter 皆擋 (ADR-074)
            let vo = this
            vo.saveTokens({ pm: msg.pm })
        },

        saveTokens: function(opt = {}) {
            // console.log('method saveTokens')

            let vo = this

            async function core() {
                let errTemp = null

                //commitPermsDraft, 權限清單尚未關閉即按儲存時先寫回其勾選
                vo.commitPermsDraft()

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
                //     vo.$alert(`${vo.$t('tokenAddEmpty')}`, { type: 'error' })
                //     return
                // }

                //token / lang
                let token = vo.userToken
                let lang = get(vo, '$store.state.lang', 'eng')
                // console.log('token', token)

                //updateTokensList (帶 lang, 後端 reject { key, msg } 之 msg 依 lang 翻譯)
                await vo.$fapi.updateTokensList(token, lang, rows)
                    .catch((err) => {
                        errTemp = err
                    })

                //check
                if (errTemp !== null) {
                    vo.$ui.updateLoading(false)
                    //後端 reject { key, msg }: msg 已依 lang 翻譯, 直接顯示
                    let msg = isestr(errTemp) ? vo.$tErr(errTemp) : vo.$t('anUnexpectedErrorOccurred')
                    await vo.$dg.showCheckYes(`${vo.$t('tokenSaveTokensFail')}: ${msg}`)
                    return
                }

                //isModified
                vo.isModified = false

                //alert
                vo.$ui.updateLoading(false)
                await vo.$dg.showCheckYes(vo.$t('tokenSaveTokensSuccess'), { type: 'success' })

            }

            //runSubmit: 儲存流程(至結果訊息框關閉)進行中再觸發即略過; opt.pm 為儲存鈕之 promiseUnlock 鎖, 於請求結束(updateLoading(false))時釋放 (ADR-074)
            return vo.$ui.runSubmit('saveTokens', () => {
                return core()
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
            }, opt)

        },

    }
}
</script>
<style scoped>
/* 應用系統權限觸發框: 底色 / 框線 / 圓角沿用同列時間欄 WTimeminute 之設定(#f0f0f0 / hover #e5e5e5 / #767676 / 4px);
   高 22px 與時間欄同(框線 1 + 內距 2 + 標籤 16 + 內距 2 + 框線 1), 標籤四周留白皆 2px */
.perms-trigger {
    display: flex;
    align-items: center;
    padding: 2px;
    border: 1px solid #767676;
    border-radius: 4px;
    background: #f0f0f0;
    cursor: pointer;
    transition: background-color 0.2s;
}
.perms-trigger:hover {
    background: #e5e5e5;
}
</style>

