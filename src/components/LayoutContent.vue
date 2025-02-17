<template>
    <div
        style="height:100%; width:100%;"
        v-domresize
        @domresize="resize"
    >

        <template v-if="syncState">

            <WDrawer
                :style="`height:${panelHeight}px; width:100%;`"
                v-model="drawer"
                :drawerWidth.sync="drawerWidth"
                :drawerWidthMin="drawerWidthMin"
                :drawerWidthMax="drawerWidthMax"
                :mode="'from-left'"
                :dragDrawerWidth="true"
                :autoSwitch="true"
                :switchWidth="drawerWidth*2.3"
            >

                <template v-slot:drawer="props">
                    <div :style="`height:${props.height}px; background:#fff; position:relative;`">

                        <WListVertical
                            style="height:100%;"
                            :items="menus"
                            :itemActive="menuActive"
                            :item-text-color="'#222'"
                            :item-text-color-hover="'#444'"
                            :item-text-color-active="'#EF6C00'"
                            :item-icon-color="'#222'"
                            :item-icon-color-hover="'#444'"
                            :item-icon-color-active="'#EF6C00'"
                            :item-background-color="'#fff'"
                            :item-background-color-hover="'#f2f2f2'"
                            :item-background-color-active="'#FFF3E0'"
                            :paddingStyle="{v:15,h:15}"
                            @click="(menu)=>{menuKey=menu.key}"
                        ></WListVertical>

                        <div
                            :style="`position:absolute; top:2px; right:4px;`"
                            v-if="drawer"
                        >
                            <WButtonCircle
                                :paddingStyle="{h:2,v:2}"
                                :icon="mdiArrowLeftBoldHexagonOutline"
                                :iconSize="20"
                                :backgroundColor="'rgba(255,255,255,0.1)'"
                                :backgroundColorHover="'rgba(255,255,255,0.4)'"
                                :backgroundColorFocus="'rgba(255,255,255,0.7)'"
                                :borderColor="'transparent'"
                                :borderColorHover="'transparent'"
                                :borderColorFocus="'transparent'"
                                _tooltip="$t('menuTreeHide')"
                                :shadow="false"
                                @click="drawer=false"
                            ></WButtonCircle>
                        </div>

                    </div>
                </template>

                <template v-slot:content="props">
                    <div :style="`height:${props.height}px; width:${props.width}px; position:relative;`">

                        <template>

                            <LayoutContentInfor
                                v-if="menuKey==='mmUserInfor'"
                            ></LayoutContentInfor>

                            <LayoutContentUsers
                                v-if="menuKey==='mmUsersList'"
                            ></LayoutContentUsers>

                            <LayoutContentSettings
                                v-if="menuKey==='mmSettings'"
                            ></LayoutContentSettings>

                        </template>

                        <div
                            :style="`position:absolute; top:3px; left:5px;`"
                            v-if="!drawer"
                        >
                            <WButtonCircle
                                :paddingStyle="{h:2,v:2}"
                                :icon="mdiArrowRightBoldHexagonOutline"
                                :iconSize="20"
                                :backgroundColor="'rgba(255,255,255,0.1)'"
                                :backgroundColorHover="'rgba(255,255,255,0.4)'"
                                :backgroundColorFocus="'rgba(255,255,255,0.7)'"
                                :borderColor="'transparent'"
                                :borderColorHover="'transparent'"
                                :borderColorFocus="'transparent'"
                                _tooltip="$t('menuTreeShow')"
                                :shadow="false"
                                @click="drawer=true"
                            ></WButtonCircle>
                        </div>

                    </div>
                </template>

            </WDrawer>

        </template>

        <div
            style="padding:20px; font-size:0.9rem;"
            v-else
        >
            {{$t('waitingData')}}
        </div>

    </div>
</template>

<script>
import { mdiInformationVariantCircleOutline, mdiCogOutline, mdiCellphoneKey, mdiLockOpenRemoveOutline, mdiShieldKeyOutline, mdiArrowLeftBoldHexagonOutline, mdiArrowRightBoldHexagonOutline, mdiGamepadCircle, mdiStackOverflow, mdiAccountGroupOutline } from '@mdi/js/mdi.js'
import get from 'lodash-es/get.js'
import find from 'lodash-es/find.js'
import WDrawer from 'w-component-vue/src/components/WDrawer.vue'
import WButtonCircle from 'w-component-vue/src/components/WButtonCircle.vue'
import WListVertical from 'w-component-vue/src/components/WListVertical.vue'
import LayoutContentInfor from './LayoutContentInfor.vue'
import LayoutContentUsers from './LayoutContentUsers.vue'
import LayoutContentSettings from './LayoutContentSettings.vue'


export default {
    components: {
        WDrawer,
        WButtonCircle,
        WListVertical,
        LayoutContentInfor,
        LayoutContentUsers,
        LayoutContentSettings,
    },
    props: {
    },
    data: function() {
        return {
            mdiInformationVariantCircleOutline,
            mdiCogOutline,
            mdiCellphoneKey,
            mdiLockOpenRemoveOutline,
            mdiShieldKeyOutline,
            mdiArrowLeftBoldHexagonOutline,
            mdiArrowRightBoldHexagonOutline,

            menuKey: 'mmUserInfor',

            panelWidth: 0,
            panelHeight: 0,

            drawer: true,
            drawerWidth: 220,
            drawerWidthMin: 150,
            drawerWidthMax: 350,

        }
    },
    computed: {

        syncState: function() {
            let vo = this
            return get(vo, '$store.state.syncState')
        },

        menus: function() {
            let vo = this
            let ms = [
                {
                    key: 'mmUserInfor',
                    text: vo.$t('mmUserInfor'),
                    icon: mdiInformationVariantCircleOutline,
                },
                {
                    key: 'mmUsersList',
                    text: vo.$t('mmUsersList'),
                    icon: mdiAccountGroupOutline,
                },
                {
                    key: 'mmSettings',
                    text: vo.$t('mmSettings'),
                    icon: mdiCogOutline,
                },
                {
                    key: 'nowActiveTokensList',
                    text: vo.$t('nowActiveTokensList'),
                    icon: mdiCellphoneKey,
                },
                {
                    key: 'nowBlockList',
                    text: vo.$t('nowBlockList'),
                    icon: mdiLockOpenRemoveOutline,
                },
                {
                    key: 'systemTokenList',
                    text: vo.$t('systemTokenList'),
                    icon: mdiShieldKeyOutline,
                },
            ]
            return ms
        },

        menuActive: function() {
            let vo = this
            let r = find(vo.menus, { key: vo.menuKey })
            // console.log(r)
            return r
        },

    },
    methods: {

        resize: function(msg) {
            // console.log('methods resize', msg)

            let vo = this

            //save
            vo.panelWidth = msg.snew.clientWidth
            vo.panelHeight = msg.snew.clientHeight
            // console.log('vo.panelHeight', vo.panelHeight)

        },

    }
}
</script>

<style scoped>
</style>
