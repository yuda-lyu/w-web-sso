<template>
    <div
        style="height:100%;"
        v-domresize
        @domresize="resizePanel"
        :changeUsers="changeUsers"
    >

        <div
            style="border-bottom:1px solid #ddd; background:#fff;"
            v-domresize
            @domresize="resizeHead"
        >

            <!-- 標題區 -->
            <div style="display:inline-block; vertical-align:top; padding:10px 0px 5px 20px;">
                <div style="display:flex; align-items:center; padding:5px 15px 5px 5px; border-bottom:3px solid #FF9100;">

                    <WIcon
                        :icon="mdiAccountGroupOutline"
                        :color="'#FF9800'"
                    ></WIcon>

                    <div style="padding-left:10px; font-size:1.3rem; color:#d3912c;">
                        bbb
                    </div>

                </div>
            </div>

            <!-- 編輯設定區 -->
            <div style="display:inline-block; vertical-align:top;">

                <div style="padding:15px 20px 15px 20px; background:#fff;">

                    <div style="display:flex;">
                        <WSwitch
                            :text="$t('isEditabled')"
                            :checkedSwitchCircleColor="'#D81B60'"
                            :checkedSwitchCircleColorHover="'#f26'"
                            :checkedSwitchBarColor="'#F8BBD0'"
                            :checkedSwitchBarColorHover="'#F8BBD0'"
                            v-model="isOperatable"
                        ></WSwitch>
                    </div>

                    <div style="padding-top:5px; font-size:0.8rem; _color:#f26;" v-if="isOperatable">
                        <div style="padding:3px 0px;">
                            1. {{$t('userMsg1')}}
                        </div>
                        <div style="padding:3px 0px;">
                            2. {{$t('userMsg2')}}
                        </div>
                    </div>

                </div>

            </div>

            <!-- 儲存變更提示區 -->
            <div
                style="padding:10px 10px 12px 10px; border-top:1px solid #F48FB1; border-bottom:1px solid #F48FB1; background:#FCE4EC; display:flex; align-items:center; justify-content:flex-end;"
                v-if="isModified"
            >

                <WButtonChip
                    :paddingStyle="{v:0,h:11}"
                    :text="$t('saveChanges')"
                    :icon="mdiCloudUploadOutline"
                    :backgroundColor="'rgba(255,0,50,0.7)'"
                    :backgroundColorHover="'rgba(255,0,50,0.8)'"
                    :textColor="'#eee'"
                    :textColorHover="'#fff'"
                    :iconColor="'#eee'"
                    :iconColorHover="'#fff'"
                    @click="saveGroups"
                ></WButtonChip>

            </div>

        </div>

        <div
            :style="`padding:${spacePading}px;`"
            v-if="!firstLoading"
        >

            <div style="background:#fff; box-shadow:0 3px 1px -2px rgba(0,0,0,.2), 0 2px 2px 0 rgba(0,0,0,.14), 0 1px 5px 0 rgba(0,0,0,.12);">

                <div
                    style="padding:20px 10px 10px 20px; border-bottom:3px solid #ddd;"
                    v-domresize
                    @domresize="resizeGroupInfor"
                >

                    <div style="padding:0px 10px 10px 0px; display:inline-block; vertical-align:middle; color:#666; font-size:1.1rem;">
                        {{$t('userList')}}
                    </div>

                    <div
                        style="padding:0px 10px 10px 0px; display:inline-block; vertical-align:middle;"
                        v-if="isOperatable"
                    >

                        <WButtonChip
                            :paddingStyle="{v:0,h:11}"
                            :text="$t('addUser')"
                            :icon="mdiAccountPlusOutline"
                            :backgroundColor="'rgba(255,0,50,0.7)'"
                            :backgroundColorHover="'rgba(255,0,50,0.8)'"
                            :textColor="'#eee'"
                            :textColorHover="'#fff'"
                            :iconColor="'#eee'"
                            :iconColorHover="'#fff'"
                            @click="clickAddUser"
                        ></WButtonChip>

                    </div>

                </div>

                <WPanelScrolly
                    :style="`height:${usersGroupsHeight}px; _overflow-y:auto;`"
                >
                    <div style="padding:10px;">

                        <div
                            style="padding:10px;"
                            :key="'kus:'+kus"
                            v-for="(us,kus) in usersGroups"
                        >

                            <div style="padding-bottom:5px; display:flex; align-items:center; border-bottom:1px dashed #ddd;">
                                <div style="padding-right:5px; color:#888; font-size:0.8rem;">
                                    {{$t('from')}}:
                                </div>
                                <div style="color:#000; font-size:0.8rem;">
                                    {{getFrom(kus)}}
                                </div>
                            </div>

                            <div style="padding-top:10px;">

                                <div
                                    style="display:inline-block; margin:0px 10px 10px 0px;"
                                    :key="'ku:'+ku"
                                    v-for="(u,ku) in us"
                                >

                                    <WButtonChip
                                        :text="u.name"
                                        :paddingStyle="{
                                            v: 2,
                                            h: 12,
                                        }"
                                        :icon="getIsAdmin(u)?mdiChessRook:''"
                                        :backgroundColor="getIsNotActive(u)?'rgba(130,130,130,0.8)':getIsAdmin(u)?'rgba(216, 27, 96, 0.8)':'rgba(50,110,230,0.8)'"
                                        :backgroundColorHover="getIsNotActive(u)?'rgba(130,130,130,0.9)':getIsAdmin(u)?'rgba(216, 27, 96, 0.9)':'rgba(50,110,230,0.9)'"
                                        :textColor="'#eee'"
                                        :textColorHover="'#fff'"
                                        :iconColor="'#eee'"
                                        :iconColorHover="'#fff'"
                                        :close="isOperatable"
                                        @click="clickEditUser(u)"
                                        @click-close="clickRemoveUser(u)"
                                    ></WButtonChip>

                                </div>

                            </div>

                        </div>

                    </div>
                </WPanelScrolly>

            </div>

        </div>

        <div style="padding:10px 15px; font-size:0.8rem;" v-else>
            {{$t('waitingData')}}
        </div>

    </div>
</template>

<script>
import { mdiAccountGroupOutline, mdiAccountPlusOutline, mdiCheckboxMarkedCircle, mdiChessRook } from '@mdi/js/mdi.js'
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
import waitFun from 'wsemi/src/waitFun.mjs'
import WIcon from 'w-component-vue/src/components/WIcon.vue'
import WButtonChip from 'w-component-vue/src/components/WButtonChip.vue'
import WSwitch from 'w-component-vue/src/components/WSwitch.vue'
import WPanelScrolly from 'w-component-vue/src/components/WPanelScrolly.vue'


export default {
    components: {
        WIcon,
        WButtonChip,
        WSwitch,
        WPanelScrolly,
    },
    props: {
    },
    data: function() {
        return {
            mdiAccountGroupOutline,
            mdiAccountPlusOutline,
            mdiCheckboxMarkedCircle,
            mdiChessRook,

            panelWidth: 100,
            panelHeight: 100,
            headHeight: 100,
            groupInforHeight: 100,

            firstLoading: true,
            isOperatable: true,
            isModified: false,

            pickGroupId: '',

        }
    },
    computed: {

        users: function() {
            return get(this, `$store.state.users`)
        },

        usersGroups: function() {
            let gs = groupBy(this.users, 'from')
            let ks = keys(gs)
            ks = sortBy(ks)
            let gsTemp = {}
            each(ks, (k) => {
                gsTemp[k] = gs[k]
            })
            gs = gsTemp
            return gs
        },

        changeUsers: function() {
            // console.log('computed changeUsers')

            let vo = this

            //check
            if (size(vo.users) === 0) {
                return ''
            }

            //firstLoading
            vo.firstLoading = false

            return ''
        },

        spacePading: function() {
            let vo = this
            if (vo.panelWidth < 400) {
                return 0
            }
            else if (vo.panelWidth < 800) {
                return 10
            }
            return 20
        },

        usersGroupsHeight: function() {
            let vo = this

            //h
            let h = vo.panelHeight - vo.headHeight - 2 * vo.spacePading - vo.groupInforHeight
            h = Math.max(h, 0)

            return h
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

        resizeGroupInfor: function(msg) {
            // console.log('methods resizeGroupInfor', msg)

            let vo = this

            //groupInforHeight
            vo.groupInforHeight = msg.snew.offsetHeight

        },

        getFrom: function(kus) {
            // console.log('methods getFrom', kus)
            let vo = this
            if (!isestr(kus)) {
                kus = vo.$t('empty')
            }
            return kus
        },

        getIsAdmin: function(u) {
            return get(u, 'isAdmin') === 'y'
        },

        getIsNotActive: function(u) {
            return get(u, 'isActive') === 'n'
        },

        clickAddUser: function() {
            // console.log('methods clickAddUser')

            let vo = this

            async function core() {
                let errTemp = null

                //show loading
                vo.$ui.updateLoading(true)

                //u
                let u = {
                    id: genID(),
                    name: vo.$t('newUser'),
                    from: '',
                    isAdmin: 'n',
                    isActive: 'y',
                }

                //save
                await vo.$fapi.users.insert(u)
                    .catch((err) => {
                        errTemp = err
                    })

                //check
                if (errTemp !== null) {
                    vo.$alert(`${vo.$t('failedToAddUser')}: ${errTemp}`, { type: 'error' })
                }

                //un
                let un = null
                await waitFun(() => {
                    un = find(vo.users, { id: u.id })
                    return iseobj(un) //確認g.id已存在
                })
                // console.log('un', un)

                //showVeUser
                vo.$dg.showVeUser(un)
                    .catch(() => {})

                //alert
                vo.$alert(vo.$t('successfulToAddUser'))

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

        clickRemoveUser: function(u) {
            // console.log('methods clickRemoveUser', u)

            let vo = this

            async function core() {
                let errTemp = null

                //showCheckYesNo
                let bExit = false
                let t_confirmToDeleteUser = vo.$t('confirmToDeleteUser')
                t_confirmToDeleteUser = t_confirmToDeleteUser.replace('{name}', u.name)
                await vo.$dg.showCheckYesNo(t_confirmToDeleteUser)
                    .catch(() => {
                        bExit = true
                    })
                if (bExit) {
                    return
                }

                //show loading
                vo.$ui.updateLoading(true)

                //save
                await vo.$fapi.users.del(u)
                    .catch((err) => {
                        errTemp = err
                    })

                //check
                if (errTemp !== null) {
                    vo.$alert(`${vo.$t('failedToDeleteUser')}: ${errTemp}`, { type: 'error' })
                    return
                }

                //un
                let un = null
                await waitFun(() => {
                    un = find(vo.users, (v) => {
                        return v.id === u.id
                    })
                    return !iseobj(un) //確認g.id已不存在
                })
                // console.log('un', un)

                //alert
                vo.$alert(vo.$t('successfulToDeleteUser'))

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

        clickEditUser: function(u) {
            // console.log('clickEditGroup', u)

            let vo = this

            //check
            if (!vo.isOperatable) {
                vo.$alert(vo.$t('cannotShowUserDetailsInViewMode'), { type: 'error' })
                return
            }

            //showVeUser
            vo.$dg.showVeUser(u)
                .catch(() => {})

        },

    }
}
</script>

<style scoped>
</style>
