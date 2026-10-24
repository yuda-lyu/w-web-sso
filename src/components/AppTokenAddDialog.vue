<template>
    <WConfirm
        :show.sync="bShow"
        :title="$t('tokenAddApp')"
        :hasNoBtn="true"
        :minWidth="320"
        :maxWidth="520"
        :headerBackgroundColor="'grey lighten-3'"
    >

        <template v-slot:content>
            <div
                class="app-token-add"
                style="padding:15px 20px 5px 20px;"
            >

                <!-- 名稱 -->
                <div style="margin-bottom:12px;">
                    <div style="font-size:0.8rem; color:#444; margin-bottom:2px;">{{$t('tokenAppName')}}</div>
                    <WText
                        :textColor="'#000'"
                        :bottomLineBorderColor="'#888'"
                        :bottomLineBorderColorHover="'#888'"
                        :bottomLineBorderColorFocus="'#888'"
                        v-model="name"
                    ></WText>
                </div>

                <!-- 用途 -->
                <div style="margin-bottom:12px;">
                    <div style="font-size:0.8rem; color:#444; margin-bottom:4px;">{{$t('tokenAppUsage')}}</div>
                    <WInputRadio
                        :items="keysAppUsage"
                        :value="usage"
                        :editable="true"
                        @input="setUsage"
                    >
                        <template v-slot="p">
                            <div style="padding:3px 0px 3px 3px; cursor:pointer;">
                                <div style="font-size:0.85rem; color:#222;">{{getUsageText(p.item.data)}}</div>
                                <div style="font-size:0.75rem; color:#666;">{{getUsageDesc(p.item.data)}}</div>
                            </div>
                        </template>
                    </WInputRadio>
                </div>

                <!-- 使用者用途: 所綁使用者 -->
                <div
                    style="margin-bottom:12px;"
                    v-if="usage==='user'"
                >
                    <div style="font-size:0.8rem; color:#444; margin-bottom:2px;">{{$t('tokenAppBoundUser')}}</div>
                    <WTextSelect
                        style="width:100%;"
                        :items="userIds"
                        :value="userId"
                        @input="setUserId"
                    >
                        <template v-slot:select="p">
                            {{getUserText(p.item)}}
                        </template>
                        <template v-slot:item="p">
                            {{getUserText(p.item)}}
                        </template>
                    </WTextSelect>
                    <div
                        style="padding-top:4px; font-size:0.75rem; color:#666;"
                        v-if="userIds.length===0"
                    >
                        {{$t('tokenAppBoundUserEmpty')}}
                    </div>
                </div>

                <!-- 系統服務用途: 權限 -->
                <div
                    style="margin-bottom:12px;"
                    v-if="usage==='system'"
                >
                    <div style="font-size:0.8rem; color:#444; margin-bottom:2px;">{{$t('tokenPerms')}}</div>

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
                        :value="perms"
                        @input="setPerms"
                        :editable="true"
                    >
                        <template v-slot="p">
                            <div style="padding-left:3px; display:flex; align-items:center; font-size:0.85rem; height:24px; cursor:pointer;">
                                {{$t(`appPerm_${p.item.data}`)}}
                                <span
                                    style="padding-left:6px; font-size:0.75rem; color:#D81B60;"
                                    v-if="keysAppPermHigh.includes(p.item.data)"
                                >({{$t('tokenPermsHigh')}})</span>
                            </div>
                        </template>
                    </WInputCheckbox>
                </div>

                <!-- 可預期錯誤: inline 紅字 -->
                <div
                    style="padding-bottom:8px; font-size:0.8rem; color:#c62828;"
                    v-if="errMsg"
                >
                    {{errMsg}}
                </div>

            </div>
        </template>

        <template v-slot:footer>
            <div style="display:flex; justify-content:flex-end; padding:10px 15px; background:#f5f5f5;">

                <WButtonChip
                    style="margin-left:10px;"
                    :shiftLeft="-5"
                    :icon="mdiCloseCircle"
                    :iconColor="'#444'"
                    :iconColorHover="'#444'"
                    :text="$t('cancel')"
                    :textColor="'#444'"
                    :textColorHover="'#444'"
                    :backgroundColor="'#fff'"
                    :backgroundColorHover="'#f2f2f2'"
                    @click="close"
                ></WButtonChip>

                <WButtonChip
                    style="margin-left:10px;"
                    :shiftLeft="-5"
                    :icon="mdiCheckboxMarkedCircle"
                    :iconColor="'#fff'"
                    :iconColorHover="'#fff'"
                    :text="$t('tokenAppCreate')"
                    :textColor="'#fff'"
                    :textColorHover="'#fff'"
                    :backgroundColor="'#f15'"
                    :backgroundColorHover="'#f26'"
                    :promiseUnlock="true"
                    @click="onClickCreateBtn"
                ></WButtonChip>

            </div>
        </template>

    </WConfirm>
</template>

<script>
import { mdiCloseCircle, mdiCheckboxMarkedCircle } from '@mdi/js/mdi.js'
import get from 'lodash-es/get.js'
import filter from 'lodash-es/filter.js'
import isestr from 'wsemi/src/isestr.mjs'
import WConfirm from 'w-component-vue/src/components/WConfirm.vue'
import WText from 'w-component-vue/src/components/WText.vue'
import WTextSelect from 'w-component-vue/src/components/WTextSelect.vue'
import WInputRadio from 'w-component-vue/src/components/WInputRadio.vue'
import WInputCheckbox from 'w-component-vue/src/components/WInputCheckbox.vue'
import WButtonChip from 'w-component-vue/src/components/WButtonChip.vue'
import { keysAppPerm, keysAppPermBase, keysAppPermHigh, normAppPerms } from '../appPerms.mjs'
import { keysAppUsage } from '../appUsage.mjs'


//新增應用系統金鑰對話框 (ADR-095): 名稱、用途(使用者用途 / 系統服務用途)、使用者用途之所綁使用者、系統服務用途之權限; 權杖字串由伺服端產生(createAppToken),
//成功後關閉並通知上層重新載入清單(上層需重算基準)
export default {
    components: {
        WConfirm,
        WText,
        WTextSelect,
        WInputRadio,
        WInputCheckbox,
        WButtonChip,
    },
    props: {
        show: {
            type: Boolean,
            default: false,
        },
    },
    data: function() {
        return {
            mdiCloseCircle,
            mdiCheckboxMarkedCircle,

            bShow: false,

            keysAppUsage,
            keysAppPermBase,
            keysAppPermHigh,
            keysAppPermOpt: keysAppPerm.filter((p) => !keysAppPermBase.includes(p)),

            name: '',
            usage: '', //未選擇: 須明確選擇用途(高權限能力, 不預設)
            userId: '',
            perms: [],
            users: [],
            errMsg: '',
        }
    },
    watch: {
        show: function(v) {
            let vo = this
            if (v !== vo.bShow) {
                vo.bShow = v
            }
        },
        bShow: function(v) {
            let vo = this
            if (v !== vo.show) {
                vo.$emit('update:show', v)
            }
            if (v) {
                vo.reset()
                vo.loadUsers()
            }
        },
    },
    mounted: function() {
        this.bShow = this.show
    },
    computed: {

        userToken: function() {
            let vo = this
            return get(vo, `$store.state.userToken`)
        },

        userIds: function() {
            let vo = this
            return vo.users.map((u) => u.id)
        },

    },
    methods: {

        reset: function() {
            let vo = this
            vo.name = ''
            vo.usage = ''
            vo.userId = ''
            vo.perms = []
            vo.users = []
            vo.errMsg = ''
        },

        loadUsers: function() {
            //所綁使用者之候選: 啟用中之使用者(後端亦於鑄造時驗證存在且啟用)
            let vo = this
            vo.$fapi.getUsersList(vo.userToken)
                .then((res) => {
                    vo.users = filter(res, (u) => get(u, 'isActive', '') === 'y')
                })
                .catch((err) => {
                    console.log('getUsersList catch', err)
                    vo.errMsg = vo.$t('getDataError')
                })
        },

        getUsageText: function(k) {
            return this.$t(k === 'user' ? 'tokenAppUsageUser' : 'tokenAppUsageSystem')
        },

        getUsageDesc: function(k) {
            return this.$t(k === 'user' ? 'tokenAppUsageUserDesc' : 'tokenAppUsageSystemDesc')
        },

        getUserText: function(id) {
            let vo = this
            let u = vo.users.find((x) => x.id === id)
            if (!u) {
                return ''
            }
            return `${u.account} (${u.name})`
        },

        setUsage: function(v) {
            let vo = this
            vo.usage = v
            vo.errMsg = ''
        },

        setUserId: function(v) {
            let vo = this
            vo.userId = v
            vo.errMsg = ''
        },

        setPerms: function(v) {
            this.perms = v
        },

        close: function() {
            this.bShow = false
        },

        onClickCreateBtn: function(msg) {
            //promiseUnlock 之鎖交由 submit 之 runSubmit 於請求結束時釋放, 不於此解鎖 (ADR-074)
            let vo = this
            vo.submit({ pm: msg.pm })
        },

        submit: function(opt = {}) {
            let vo = this

            async function core() {
                //1) 清空舊 inline 錯誤
                vo.errMsg = ''

                //2) 事先檢測(同步, 開 loading 之前)
                let name = isestr(vo.name) ? vo.name.trim() : ''
                if (!isestr(name)) {
                    vo.errMsg = vo.$t('tokenAppNameInvalid')
                    return
                }
                if (!keysAppUsage.includes(vo.usage)) {
                    vo.errMsg = vo.$t('tokenAppUsageInvalid')
                    return
                }
                if (vo.usage === 'user' && !isestr(vo.userId)) {
                    vo.errMsg = vo.$t('tokenAppUserInvalid')
                    return
                }

                //3) 確定打 API 才開 loading
                vo.$ui.updateLoading(true)

                //4) 執行
                let data = { name, usage: vo.usage }
                if (vo.usage === 'user') {
                    data.userId = vo.userId
                }
                else {
                    data.perms = normAppPerms(vo.perms)
                }
                let lang = get(vo, '$store.state.lang', 'eng')
                let ok = false
                await vo.$fapi.createAppToken(vo.userToken, lang, data)
                    .then(() => {
                        ok = true
                    })
                    .catch((err) => {
                        console.log('createAppToken', err)
                        vo.errMsg = isestr(err) ? vo.$tErr(err) : vo.$t('anUnexpectedErrorOccurred')
                    })
                if (!ok) {
                    return
                }

                //5) 全成功: 關 loading(同時釋放按鈕鎖)與對話框, 通知上層; 上層負責重新載入清單(新列使既有基準過時)、載入完成後再開結果訊息框 (onCreatedApp; 外審 sol#8:
                //原於此即開訊息框, 使用者關框後若重載尚未完成, 新動的草稿會被重載結果覆寫)
                vo.$ui.updateLoading(false)
                vo.bShow = false
                vo.$emit('created')
                return 'ok'
            }

            return vo.$ui.runSubmit('createAppToken', () => {
                return core()
                    .catch((err) => {
                        console.log('catch', err)
                        return vo.$dg.showCheckYes(vo.$t('anUnexpectedErrorOccurred'), { type: 'error' })
                    })
                    .finally(() => {
                        vo.$ui.updateLoading(false)
                    })
            }, opt)
        },

    },
}
</script>
