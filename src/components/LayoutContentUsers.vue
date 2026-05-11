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
                        :icon="mdiAccountGroupOutline"
                        :color="'#000'"
                        :size="32"
                    ></WIcon>

                    <div style="padding-left:12px;">

                        <div style="font-size:1.4rem; color:#000;">
                            {{$t('mmUsersList')}}
                        </div>

                        <div style="padding-top:2px; font-size:0.8rem; color:#666;">
                            {{$t('mmUsersListMsg')}}
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

                <template v-if="isEditable">

                    <WButtonCircle
                        :paddingStyle="{v:6,h:6}"
                        :tooltip="$t('userAdd')"
                        :icon="mdiPlus"
                        :backgroundColor="'#fff'"
                        :backgroundColorHover="'#f2f2f2'"
                        :iconColor="'#444'"
                        :iconColorHover="'#222'"
                        :iconColorFocus="'#222'"
                        :shadow="false"
                        @click="addItem"
                    ></WButtonCircle>

                    <div style="padding-left:4px;"></div>

                </template>

                <template v-if="isEditable && hasItemCheckOne">

                    <WButtonCircle
                        :paddingStyle="{v:6,h:6}"
                        :tooltip="$t('userCopy')"
                        :icon="mdiContentCopy"
                        :backgroundColor="'#fff'"
                        :backgroundColorHover="'#f2f2f2'"
                        :iconColor="'#444'"
                        :iconColorHover="'#222'"
                        :iconColorFocus="'#222'"
                        :shadow="false"
                        @click="copyItem"
                    ></WButtonCircle>

                    <div style="padding-left:4px;"></div>

                </template>

                <template v-if="isEditable && hasItemsCheck">

                    <WButtonCircle
                        :paddingStyle="{v:6,h:6}"
                        :tooltip="$t('userDeleteCheckUsers')"
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
                        :backgroundColor="'rgba(255,0,50,0.7)'"
                        :backgroundColorHover="'rgba(255,0,50,0.8)'"
                        :iconColor="'#eee'"
                        :iconColorHover="'#fff'"
                        :iconColorFocus="'#fff'"
                        :shadow="false"
                        @click="saveUsers"
                    ></WButtonCircle>

                    <div style="padding-left:4px;"></div>

                </template>

            </div>

        </div>

        <template
            v-if="!isLoading"
        >

            <template v-if="items">
                <WAggridVue
                    ref="rftable"
                    :style="`width:100%;`"
                    :height="contentHeight"
                    :opt="opt"
                >
                    <template v-slot:cell-render="props">
                        <!-- account -->
                        <template v-if="props.key === 'account'">
                            <span v-if="cellFieldErr('account', props.value)" :title="cellFieldErr('account', props.value)">
                                <span style="color:#F57C00;">{{ $ui.cstr(props.value) }}</span>
                                <img style="vertical-align:sub; width:16px; height:16px;" :src="$ui.getIcon('warning')" />
                            </span>
                            <template v-else>{{ props.value }}</template>
                        </template>
                        <!-- password -->
                        <template v-else-if="props.key === 'password'">
                            <div @click.stop.prevent @mousedown.stop.prevent style="height:100%; display:flex; align-items:center;">
                                <template v-if="props.row._isNew">
                                    <!-- 新增列: 就地輸入密碼 (顯/隱 toggle), 警告 icon 顯示驗證錯誤 -->
                                    <span v-if="cellPasswordErr($ui.gv(props.row, 'id'))" :title="cellPasswordErr($ui.gv(props.row, 'id'))" style="padding-right:4px;">
                                        <img style="vertical-align:sub; width:16px; height:16px;" :src="$ui.getIcon('warning')" />
                                    </span>
                                    <WText
                                        :style="`flex:1;`"
                                        :textFontSize="'0.8rem'"
                                        :paddingStyle="{v:1,h:8}"
                                        :backgroundColor="'#f0f0f0'"
                                        :backgroundColorHover="'#e5e5e5'"
                                        :backgroundColorFocus="'#e5e5e5'"
                                        :borderColor="'#767676'"
                                        :borderColorHover="'#767676'"
                                        :borderColorFocus="'#767676'"
                                        :borderRadius="4"
                                        :shadow="false"
                                        :password="!passwordVisible[$ui.gv(props.row, 'id')]"
                                        :rightIcon="passwordVisible[$ui.gv(props.row, 'id')] ? 'mdi-eye' : 'mdi-eye-off'"
                                        :value="props.row.password || ''"
                                        :editable="isEditable"
                                        @input="onPasswordInput($ui.gv(props.row, 'id'), $event)"
                                        @click-right="togglePasswordVisible($ui.gv(props.row, 'id'))"
                                    ></WText>
                                </template>
                                <template v-else>
                                    <!-- 既有列: 重設密碼按鈕 (走另一條 API, 不在本頁批次儲存範圍) -->
                                    <WButtonChip
                                        :style="`line-height:1.1rem; flex:1;`"
                                        :text="$t('userResetPassword')"
                                        :displayType="'line'"
                                        :textFontSize="'0.8rem'"
                                        :paddingStyle="{v:1,h:8}"
                                        :backgroundColor="'#f0f0f0'"
                                        :backgroundColorHover="'#e5e5e5'"
                                        :backgroundColorFocus="'#e5e5e5'"
                                        :borderColor="'#767676'"
                                        :borderColorHover="'#767676'"
                                        :borderColorFocus="'#767676'"
                                        :borderRadius="4"
                                        :shadow="false"
                                        :editable="isEditable"
                                        @click="$dg.modifyItemPasswordById($ui.gv(props.row, 'id'))"
                                    ></WButtonChip>
                                </template>
                            </div>
                        </template>
                        <!-- email -->
                        <template v-else-if="props.key === 'email'">
                            <span v-if="cellFieldErr('email', props.value)" :title="cellFieldErr('email', props.value)">
                                <span style="color:#F57C00;">{{ $ui.cstr(props.value) }}</span>
                                <img style="vertical-align:sub; width:16px; height:16px;" :src="$ui.getIcon('warning')" />
                            </span>
                            <template v-else>{{ props.value }}</template>
                        </template>
                        <!-- redir -->
                        <template v-else-if="props.key === 'redir'">
                            <span v-if="cellFieldErr('redir', props.value)" :title="cellFieldErr('redir', props.value)">
                                <span style="color:#F57C00;">{{ $ui.cstr(props.value) }}</span>
                                <img style="vertical-align:sub; width:16px; height:16px;" :src="$ui.getIcon('warning')" />
                            </span>
                            <template v-else>{{ props.value }}</template>
                        </template>
                        <!-- isAdmin -->
                        <template v-else-if="props.key === 'isAdmin'">
                            <input type="checkbox" :checked="props.value === 'y'" @click="$dg.toggleItemIsAdminById($ui.gv(props.row, 'id'))" :disabled="!isEditable" />
                        </template>
                        <!-- isActive -->
                        <template v-else-if="props.key === 'isActive'">
                            <input type="checkbox" :checked="props.value === 'y'" @click="$dg.toggleItemIsActiveById($ui.gv(props.row, 'id'))" :disabled="!isEditable" />
                        </template>
                        <!-- timeVerified -->
                        <template v-else-if="props.key === 'timeVerified'">
                            <div @click.stop.prevent @mousedown.stop.prevent style="display:flex; align-items:center;">
                                <div style="width:90px; display:inline-flex; align-items:center; vertical-align:middle;" :style="{ color: $s.getIsVerified(props.row) ? 'green' : 'red' }">
                                    <i class="mdi" :class="$s.getIsVerified(props.row) ? 'mdi-check-bold' : 'mdi-close-thick'"></i>
                                    <span style="padding-left:2px;">{{ $s.getIsVerified(props.row) ? $t('isVerifiedY') : $t('isVerifiedN') }}</span>
                                </div>
                                <WTimeminute
                                    :style="`line-height:1.1rem;`"
                                    :value="cellTimeForInput(props.value)"
                                    @input="handleCellTimeInput('timeVerified', $ui.gv(props.row, 'id'), $event)"
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
                        <!-- timeExpired -->
                        <template v-else-if="props.key === 'timeExpired'">
                            <div @click.stop.prevent @mousedown.stop.prevent style="display:flex; align-items:center;">
                                <div style="width:90px; display:inline-flex; align-items:center; vertical-align:middle;" :style="{ color: !$s.getIsExpired(props.row) ? 'green' : 'red' }">
                                    <i class="mdi" :class="!$s.getIsExpired(props.row) ? 'mdi-check-bold' : 'mdi-close-thick'"></i>
                                    <span style="padding-left:2px;">{{ $s.getIsExpired(props.row) ? $t('isExpiredY') : $t('isExpiredN') }}</span>
                                </div>
                                <WTimeminute
                                    :style="`line-height:1.1rem;`"
                                    :value="cellTimeForInput(props.value)"
                                    @input="handleCellTimeInput('timeExpired', $ui.gv(props.row, 'id'), $event)"
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
                        <!-- timeBlocked -->
                        <template v-else-if="props.key === 'timeBlocked'">
                            <div @click.stop.prevent @mousedown.stop.prevent style="display:flex; align-items:center;">
                                <div style="width:90px; display:inline-flex; align-items:center; vertical-align:middle;" :style="{ color: !$s.getIsBlocked(props.row) ? 'green' : 'red' }">
                                    <i class="mdi" :class="!$s.getIsBlocked(props.row) ? 'mdi-check-bold' : 'mdi-close-thick'"></i>
                                    <span style="padding-left:2px;">{{ $s.getIsBlocked(props.row) ? $t('isBlockedY') : $t('isBlockedN') }}</span>
                                </div>
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
                        <!-- default -->
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
import { mdiAccountGroupOutline, mdiCloudUploadOutline, mdiTrashCanOutline, mdiTableHeadersEye, mdiPlus, mdiContentCopy } from '@mdi/js/mdi.js'
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
import istimemsTZ from 'wsemi/src/istimemsTZ.mjs'
import isEmail from 'wsemi/src/isEmail.mjs'
import arrPull from 'wsemi/src/arrPull.mjs'
import WIcon from 'w-component-vue/src/components/WIcon.vue'
import WSwitch from 'w-component-vue/src/components/WSwitch.vue'
import WButtonCircle from 'w-component-vue/src/components/WButtonCircle.vue'
import WPopup from 'w-component-vue/src/components/WPopup.vue'
import WInputCheckbox from 'w-component-vue/src/components/WInputCheckbox.vue'
import WAggridVue from 'w-aggrid-vue/src/components/WAggridVue.vue'
import WTimeminute from 'w-component-vue/src/components/WTimeminute.vue'
import WButtonChip from 'w-component-vue/src/components/WButtonChip.vue'
import WText from 'w-component-vue/src/components/WText.vue'


export default {
    components: {
        WIcon,
        WSwitch,
        WButtonCircle,
        WPopup,
        WInputCheckbox,
        WAggridVue,
        WTimeminute,
        WButtonChip,
        WText,
    },
    props: {
        drawer: {
            type: Boolean,
            default: false,
        },
    },
    data: function() {
        return {
            mdiAccountGroupOutline,
            mdiCloudUploadOutline,
            mdiTrashCanOutline,
            mdiTableHeadersEye,
            mdiPlus,
            mdiContentCopy,

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
                'order',
                'account',
                'password', //後端api不提供, 前端自動渲染提供變更密碼用
                'name',
                'email',
                'description',
                'from',
                'redir',
                'isAdmin',
                'timeVerified',
                'timeExpired',
                'timeBlocked',
                'userId',
                'timeCreate',
                'userIdUpdate',
                'timeUpdate',
                'isActive',
            ],
            tabKeysPick: [
                'account',
                'password', //後端api不提供, 前端自動渲染提供變更密碼用
                'name',
                'email',
                'description',
                'from',
                'redir',
                'isAdmin',
                'timeVerified',
                'timeExpired',
                'timeBlocked',
                'userId',
                'timeCreate',
                'userIdUpdate',
                'timeUpdate',
                'isActive',
            ],
            tabKeysShow: [
                'account',
                'password', //後端api不提供, 前端自動渲染提供變更密碼用
                'name',
                'email',
                'description',
                'from',
                'redir',
                'isAdmin',
                'timeVerified',
                'timeExpired',
                'timeBlocked',
                'userId',
                'timeCreate',
                'userIdUpdate',
                'timeUpdate',
                'isActive',
            ],

            widthUsersName: null,
            widthUsersEmail: null,
            widthUsersDescription: null,

            users: [],
            items: [],
            itemsCheck: [],
            opt: null,

            //新增列密碼欄位的「顯/隱」狀態, 鍵為 row id, 值為 boolean (true=顯示明文)
            passwordVisible: {},

        }
    },
    mounted: function() {
        // console.log('mounted')

        let vo = this

        //註冊至$dg供使用
        vo.$dg.toggleItemIsAdminById = vo.toggleItemIsAdminById
        // vo.$dg.toggleItemIsVerifiedById = vo.toggleItemIsVerifiedById
        vo.$dg.toggleItemIsActiveById = vo.toggleItemIsActiveById
        vo.$dg.modifyItemPasswordById = vo.modifyItemPasswordById

        //firstSetting
        if (vo.firstSetting) {
            // console.log('webInfor', vo.webInfor)

            let showModeEditUsers = get(vo, 'webInfor.showModeEditUsers', '')
            vo.showIsEditable = showModeEditUsers === 'y'
            let modeEditUsers = get(vo, 'webInfor.modeEditUsers', '')
            vo.isEditable = modeEditUsers === 'y'

            vo.widthUsersName = get(vo, 'webInfor.widthUsersName', '')
            vo.widthUsersEmail = get(vo, 'webInfor.widthUsersEmail', '')
            vo.widthUsersDescription = get(vo, 'webInfor.widthUsersDescription', '')

            //會觸發數據變更再導致opt變更導致觸發rowsChange等事件, 故得要延遲, 供組件偵測初始設定數據初始化之用
            setTimeout(() => {
                vo.firstSetting = false
                // console.log('firstSetting', vo.firstSetting)
            }, 1)

        }

        //token
        let token = vo.userToken
        // console.log('token', token)

        //getUsersList
        vo.$fapi.getUsersList(token)
            .then((res) => {
                // console.log(res)
                res = sortBy(res, 'order')
                vo.users = res
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
            let items = cloneDeep(vo.users)

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

        errItemsByAccount: function() {
            let vo = this

            //rows
            let rows = get(vo, 'opt.rows', [])

            //kpErr
            let kpErr = {}
            let kpAccount = {}
            each(rows, (v, k) => {

                //account
                let account = get(v, 'account', '')

                //check
                if (!isestr(account)) {

                    //kpErr
                    kpErr[account] = vo.$t(`userAccountEmpty`)

                    return true //跳出換下一個
                }

                //check
                if (haskey(kpAccount, account)) {

                    //kpErr
                    kpErr[account] = vo.$t(`userAccountDuplicate`)

                    return true //跳出換下一個
                }

                //kpAccount
                kpAccount[account] = true

            })

            return kpErr
        },

        errItemsByEmail: function() {
            let vo = this

            //rows
            let rows = get(vo, 'opt.rows', [])

            //kpErr
            let kpErr = {}
            let kpEmail = {}
            each(rows, (v, k) => {

                //email
                let email = get(v, 'email', '')

                //check
                if (!isestr(email)) {

                    //kpErr
                    kpErr[email] = vo.$t(`userEmailEmpty`)

                    return true //跳出換下一個
                }

                //check
                if (!isEmail(email)) {

                    //kpErr
                    kpErr[email] = vo.$t(`userEmailError`)

                    return true //跳出換下一個
                }

                //check
                if (haskey(kpEmail, email)) {

                    //kpErr
                    kpErr[email] = vo.$t(`userEmailDuplicate`)

                    return true //跳出換下一個
                }

                //kpEmail
                kpEmail[email] = true

            })

            return kpErr
        },

        errItemsByRedir: function() {
            let vo = this

            //rows
            let rows = get(vo, 'opt.rows', [])

            //kpErr
            let kpErr = {}
            each(rows, (v, k) => {

                //redir
                let redir = get(v, 'redir', '')

                //check
                if (!isestr(redir)) {

                    //kpErr
                    kpErr[redir] = vo.$t(`userRedirEmpty`)

                    return true //跳出換下一個
                }

            })

            return kpErr
        },

        //新增列密碼空值檢查 (其他 policy 違反交給後端 reject, 訊息再 alert 上來)
        //鍵以 row.id 而非 password value, 因 password 不適合做 key
        errItemsByPassword: function() {
            let vo = this

            let rows = get(vo, 'opt.rows', [])

            let kpErr = {}
            each(rows, (v) => {

                //只檢查新增列, 既有列 password 顯示為「重設密碼」按鈕, 不在本流程驗證範圍
                if (!get(v, '_isNew')) {
                    return true
                }

                let id = get(v, 'id', '')
                let pw = get(v, 'password', '')

                if (!isestr(pw)) {
                    kpErr[id] = vo.$t('userPasswordEmpty')
                    return true
                }

            })

            return kpErr
        },

        isError: function() {
            let vo = this

            //回傳第一條具體錯誤訊息 (按 account → password → email → redir 優先序),
            //而非 category title (errInAccounts 等)。讓 CheckYes modal 顯示具體錯誤
            //(如「使用者帳號出現重複」而非「帳號出現錯誤待修復」), admin 可立即知道哪一步出問題。
            let firstOf = (kpErr) => {
                if (!iseobj(kpErr)) return ''
                for (let k in kpErr) {
                    let v = kpErr[k]
                    if (isestr(v)) return v
                }
                return ''
            }

            let m = ''
            m = firstOf(vo.errItemsByAccount); if (m) return m
            m = firstOf(vo.errItemsByPassword); if (m) return m
            m = firstOf(vo.errItemsByEmail); if (m) return m
            m = firstOf(vo.errItemsByRedir); if (m) return m

            return ''
        },

        kpHead: function() {
            let vo = this

            let kp = {
                'id': vo.$t('id'),
                'order': vo.$t('order'),
                'account': vo.$t('account'),
                'password': vo.$t('password'),
                'name': vo.$t('name'),
                'email': vo.$t('email'),
                'description': vo.$t('description'),
                'from': vo.$t('from'),
                'redir': vo.$t('redir'),
                'isAdmin': vo.$t('isAdmin'),
                'timeVerified': vo.$t('userTimeVerified'),
                'timeExpired': vo.$t('userTimeExpired'),
                'timeBlocked': vo.$t('userTimeBlocked'),
                'userId': vo.$t('userId'),
                'timeCreate': vo.$t('timeCreate'),
                'userIdUpdate': vo.$t('userIdUpdate'),
                'timeUpdate': vo.$t('timeUpdate'),
                'isActive': vo.$t('isActive'),
            }

            return kp
        },

    },
    methods: {

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

        cellFieldErr: function(field, v) {
            let vo = this
            let errMaps = {
                'account': vo.errItemsByAccount,
                'email': vo.errItemsByEmail,
                'redir': vo.errItemsByRedir,
            }
            let err = get(errMaps[field], v, '')
            return isestr(err) ? err : ''
        },

        //新增列密碼欄位錯誤查詢, 鍵為 row.id (其他欄位以 value 當鍵, 但 password 不適合做鍵)
        cellPasswordErr: function(id) {
            let vo = this
            let err = get(vo.errItemsByPassword, id, '')
            return isestr(err) ? err : ''
        },

        //新增列密碼輸入: 將輸入值寫回對應 row.password
        onPasswordInput: function(id, value) {
            let vo = this

            if (!isestr(id)) {
                return
            }

            let rows = get(vo, 'opt.rows', [])
            let kr = null
            each(rows, (v, k) => {
                if (get(v, 'id', '') === id) {
                    kr = k
                    return false
                }
            })
            if (kr === null) {
                return
            }

            set(vo, `opt.rows[${kr}].password`, value || '')
            vo.refresh()
            vo.isModified = true
        },

        //新增列密碼欄位顯/隱 toggle
        togglePasswordVisible: function(id) {
            let vo = this

            if (!isestr(id)) {
                return
            }

            let cur = get(vo.passwordVisible, id, false)
            //Vue 2 響應式: 對物件 dynamic key 須用 $set
            vo.$set(vo.passwordVisible, id, !cur)
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
                        'account': true,
                        'name': true,
                        'email': true,
                        'description': true,
                        'from': true,
                        'redir': true,
                    }
                    kpRowDrag = {
                        'account': true,
                    }
                    kpHeadCheckBox = {
                        'account': true,
                    }
                }

                //kpHeadHide
                let kpHeadHide = {
                    'id': true,
                    'order': true,
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
                        'account': true,
                    },
                    defHeadMinWidth: 150,
                    kpHeadWidth: {
                        'timeVerified': 250,
                        'timeExpired': 250,
                        'timeBlocked': 250,
                    },
                    kpHeadFilterType: {
                        'id': 'text',
                        'order': 'text',
                        'account': 'text',
                        'password': 'text',
                        'name': 'text',
                        'email': 'text',
                        'description': 'text',
                        'from': 'text',
                        'redir': 'text',
                        'isAdmin': 'text',
                        'timeVerified': 'text',
                        'timeExpired': 'text',
                        'timeBlocked': 'text',
                        'userId': 'text',
                        'timeCreate': 'text',
                        'userIdUpdate': 'text',
                        'timeUpdate': 'text',
                        'isActive': 'text',
                    },
                    kpCellEditable,
                    kpRowDrag,
                    kpHeadCheckBox,
                    kpHeadFilter: {
                        'password': false,
                    },
                    kpHeadSort: {
                        'password': false,
                    },
                    kpHeadFocusHighlight: { //雖然效果不完全, 但因按鈕與cell有padding可被點擊, 故還是需要開啟
                        'password': false,
                        'timeVerified': false,
                        'timeExpired': false,
                        'timeBlocked': false,
                    },
                    rowsChange: (rs) => {
                        // console.log('rowsChange', rs)
                        // console.log('rowsChange cloneDeep(vo.opt.rows)', cloneDeep(vo.opt.rows))

                        //check
                        if (!vo.syncState || vo.firstLoading || vo.firstSetting) {
                            return
                        }

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

        modifyItemPasswordById: function(id) {
            let vo = this

            //check id
            if (!isestr(id)) {
                vo.$alert(`${vo.$t('userEditNoUserId')}`, { type: 'error' })
                return
            }

            //find target row (取 account 給二次確認文字使用)
            let rows = get(vo, 'opt.rows', [])
            let r = null
            each(rows, (v) => {
                if (get(v, 'id', '') === id) {
                    r = v
                    return false //跳出
                }
            })
            if (!iseobj(r)) {
                vo.$alert(`${vo.$t('userEditNoUserData')}`, { type: 'error' })
                return
            }

            let account = get(r, 'account', '')
            let email = get(r, 'email', '')

            //二次確認 (showCheckYesNo 回傳 true=yes / false=no)
            let confirmText = vo.$t('adminResetPasswordConfirm').replace('{account}', account)
            vo.$dg.showCheckYesNo(confirmText)
                .then((agree) => {
                    if (!agree) {
                        return
                    }

                    let token = vo.userToken
                    let lang = get(vo, '$store.state.lang', 'eng')

                    vo.$ui.updateLoading(true)
                    vo.$fapi.adminResetUserPassword(token, lang, id)
                        .then(() => {
                            let msg = vo.$t('adminResetPasswordSuccess').replace('{email}', email)
                            vo.$alert(msg)
                        })
                        .catch((err) => {
                            let errMsg = (err && typeof err === 'string') ? err : ''
                            if (errMsg === 'cannot reset self') {
                                vo.$alert(vo.$t('adminResetPasswordCannotResetSelf'), { type: 'error' })
                            }
                            else if (errMsg === 'forbidden') {
                                vo.$alert(vo.$t('adminResetPasswordForbidden'), { type: 'error' })
                            }
                            else if (errMsg === 'user not found') {
                                vo.$alert(vo.$t('adminResetPasswordUserNotFound'), { type: 'error' })
                            }
                            else {
                                console.log('adminResetUserPassword unknown error', err)
                                vo.$alert(vo.$t('adminResetPasswordFailed'), { type: 'error' })
                            }
                        })
                        .finally(() => {
                            vo.$ui.updateLoading(false)
                        })
                })

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

        toggleItemIsAdminById: function(id) {
            // console.log('toggleItemIsAdminById', id)

            let vo = this

            //toggleItemByKeyAndId
            vo.toggleItemByKeyAndId('isAdmin', id)

        },

        toggleItemIsActiveById: function(id) {
            // console.log('toggleItemIsActiveById', id)

            let vo = this

            //toggleItemByKeyAndId
            vo.toggleItemByKeyAndId('isActive', id)

        },

        addItem: function() {
            // console.log('method addItem')

            let vo = this

            //cloneDeep
            let rows = get(vo, 'opt.rows', [])

            //cloneDeep
            rows = cloneDeep(rows)

            //r
            let r = vo.$ds.users.funNew()
            r.name = vo.$s.getNameNew(rows, 'name', '', vo.$t('userAddNameNew'))
            r.userId = `{${vo.$t('userAddIdNew')}}`
            r.timeCreate = `{${vo.$t('userAddIdNew')}}`
            r.userIdUpdate = `{${vo.$t('userAddIdNew')}}`
            r.timeUpdate = `{${vo.$t('userAddIdNew')}}`
            //transient flag, 用來區分「未儲存的新列」: password cell 顯示為輸入框, 並啟用密碼策略檢查
            //(送後端前由 saveUsers 剝除)
            r._isNew = true
            // console.log('r', r)

            //添加至最首
            rows = [
                r,
                ...rows,
            ]

            //save
            vo.users = cloneDeep(rows) //直接更新由getUsersList取得的users, 連帶驅動computed重算, 故不用另外更新vo.items與vo.opt.rows
            // console.log('cloneDeep(vo.users)', cloneDeep(vo.users))

            //isModified
            vo.isModified = true

        },

        copyItem: function() {
            // console.log('method copyItem')

            let vo = this

            //check
            if (size(vo.itemsCheck) !== 1) {
                console.log(`size(vo.itemsCheck) !== 1`, vo.itemsCheck)
                vo.$alert(`${vo.$t('anUnexpectedErrorOccurred')}`, { type: 'error' })
                return
            }

            //cloneDeep
            let rows = get(vo, 'opt.rows', [])

            //cloneDeep
            rows = cloneDeep(rows)

            //find
            let tar = vo.itemsCheck[0]
            let tarId = get(tar, 'data.id', '')
            let row = null
            each(rows, (v) => {
                let id = get(v, 'id', '')
                if (id === tarId) {
                    row = v
                    return false //跳出
                }
            })
            // console.log('tar', tar)
            // console.log('row', row)

            //check
            if (!iseobj(row)) {
                console.log(`!iseobj(row)`, row)
                vo.$alert(`${vo.$t('anUnexpectedErrorOccurred')}`, { type: 'error' })
                return
            }

            //r
            let r = cloneDeep(row)
            // let nameOld = r.name
            let _r = vo.$ds.users.funNew()
            r.id = _r.id //使用新建方式預先產生id避免重複
            // r.name = vo.$s.getNameNew(rows, 'name', nameOld, vo.$t('userCopyNameNew'))
            r.userId = `{${vo.$t('userAddIdNew')}}`
            r.timeCreate = `{${vo.$t('userAddIdNew')}}`
            r.userIdUpdate = `{${vo.$t('userAddIdNew')}}`
            r.timeUpdate = `{${vo.$t('userAddIdNew')}}`
            //transient flag: copyItem 出來的列也是「新列」, 須由 admin 重新輸入密碼
            r.password = ''
            r._isNew = true
            // console.log('r', r)

            //添加至最首
            rows = [
                r,
                ...rows,
            ]

            //save
            vo.users = cloneDeep(rows) //直接更新由getUsersList取得的users, 連帶驅動computed重算, 故不用另外更新vo.items與vo.opt.rows
            // console.log('cloneDeep(vo.users)', cloneDeep(vo.users))

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
            vo.users = cloneDeep(rows) //直接更新由getUsersList取得的users, 連帶驅動computed重算, 故不用另外更新vo.items與vo.opt.rows
            // console.log('cloneDeep(vo.users)', cloneDeep(vo.users))

            //isModified
            vo.isModified = true

        },

        saveUsers: function() {
            // console.log('method saveUsers')

            let vo = this

            async function core() {
                let errTemp = null

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

                //check
                if (size(rows) === 0) {
                    vo.$ui.updateLoading(false)
                    await vo.$dg.showCheckYes(`${vo.$t('userAddEmpty')}`)
                    return
                }

                //自我鎖死保護 (前端先擋, 後端也會 reject 作為第二道防線)
                let userSelf = get(vo, '$store.state.userSelf', {})
                let myId = get(userSelf, 'id', '')
                let mySelfRow = null
                each(rows, (rr) => {
                    if (get(rr, 'id', '') === myId) {
                        mySelfRow = rr
                        return false
                    }
                })
                //自我刪除保護: 自己列已從 rows 移除 (admin 把自己勾選刪除), 直接擋下
                if (isestr(myId) && !iseobj(mySelfRow)) {
                    vo.$ui.updateLoading(false)
                    await vo.$dg.showCheckYes(vo.$t('cannotDeleteSelf'))
                    return
                }
                if (iseobj(mySelfRow)) {
                    if (get(mySelfRow, 'isAdmin', '') !== 'y') {
                        vo.$ui.updateLoading(false)
                        await vo.$dg.showCheckYes(vo.$t('cannotDemoteSelf'))
                        return
                    }
                    if (get(mySelfRow, 'isActive', '') !== 'y') {
                        vo.$ui.updateLoading(false)
                        await vo.$dg.showCheckYes(vo.$t('cannotDisableSelf'))
                        return
                    }
                }

                //剝除 transient 欄位 _isNew (前端用來區分新列/既有列, 不送後端)
                rows = rows.map((r) => {
                    let copy = { ...r }
                    delete copy._isNew
                    return copy
                })

                //token / lang
                let token = vo.userToken
                let lang = get(vo, '$store.state.lang', 'eng')

                //updateUsersList
                await vo.$fapi.updateUsersList(token, lang, rows)
                    .catch((err) => {
                        errTemp = err
                    })

                //check
                //後端 reject (token 過期 / ckKey 衝突 / 密碼策略違反 / 自我鎖死等)
                //改用 showCheckYes 強制 admin 點擊確認讀過訊息, 避免 transient toast 漏看
                if (errTemp !== null) {
                    //hide loading 因 showCheckYes 是 modal, 等待期間 loading 會疊著
                    vo.$ui.updateLoading(false)
                    await vo.$dg.showCheckYes(`${vo.$t('userSaveUsersFail')}: ${errTemp}`)
                    return
                }

                //儲存成功 → 重拉 getUsersList 同步 server-side data (新增使用者的 timeVerified
                //在後端被填 now, 既有使用者的 audit fields 也在後端被覆寫, 須刷新前端表格)
                await vo.$fapi.getUsersList(token)
                    .then((res) => {
                        res = sortBy(res, 'order')
                        vo.users = res
                    })
                    .catch((err) => {
                        console.log('refresh getUsersList catch', err)
                    })

                //isModified
                vo.isModified = false

                //成功訊息: 改用 CheckYes modal 與其他訊息一致, admin 須點擊確認讀過
                vo.$ui.updateLoading(false)
                await vo.$dg.showCheckYes(vo.$t('userSaveUsersSuccess'))

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
