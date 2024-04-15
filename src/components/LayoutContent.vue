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
                            :style="`position:absolute; top:1px; right:4px;`"
                            v-if="drawer"
                        >
                            <WButtonCircle
                                :paddingStyle="{v:3,h:3}"
                                :icon="'mdi-arrow-left'"
                                :iconSize="16"
                                :backgroundColor="'#fff'"
                                :backgroundColorHover="'#eee'"
                                :backgroundColorFocus="'#fff'"
                                :borderColor="'transparent'"
                                :borderColorHover="'#eee'"
                                :borderColorFocus="'#eee'"
                                :tooltip="$t('menuTreeHide')"
                                :shadow="true"
                                @click="drawer=false"
                            ></WButtonCircle>
                        </div>

                    </div>
                </template>

                <template v-slot:content="props">
                    <div :style="`height:${props.height}px; width:${props.width}px; position:relative;`">

                        <template>

                            <LayoutContentUsers
                                v-if="menuKey==='users'"
                            ></LayoutContentUsers>

                        </template>

                        <div
                            :style="`position:absolute; top:1px; left:4px;`"
                            v-if="!drawer"
                        >
                            <WButtonCircle
                                :paddingStyle="{v:3,h:3}"
                                :icon="'mdi-arrow-right'"
                                :iconSize="16"
                                :backgroundColor="'#fff'"
                                :backgroundColorHover="'#eee'"
                                :backgroundColorFocus="'#fff'"
                                :borderColor="'transparent'"
                                :borderColorHover="'#eee'"
                                :borderColorFocus="'#eee'"
                                :tooltip="$t('menuTreeShow')"
                                :shadow="true"
                                @click="drawer=true"
                            ></WButtonCircle>
                        </div>

                    </div>
                </template>

            </WDrawer>

        </template>

        <template v-else>
            <div
                style="padding:20px; font-size:0.9rem;"
            >
                {{$t('waitingData')}}
            </div>
        </template>

    </div>
</template>

<script>
import { mdiGamepadCircle, mdiStackOverflow, mdiAccountGroupOutline } from '@mdi/js/mdi.js'
import get from 'lodash-es/get.js'
import find from 'lodash-es/find.js'
import WDrawer from 'w-component-vue/src/components/WDrawer.vue'
import WButtonCircle from 'w-component-vue/src/components/WButtonCircle.vue'
import WListVertical from 'w-component-vue/src/components/WListVertical.vue'
import LayoutContentUsers from './LayoutContentUsers.vue'


export default {
    components: {
        WDrawer,
        WButtonCircle,
        WListVertical,
        LayoutContentUsers,
    },
    props: {
    },
    data: function() {
        return {

            menuKey: 'targets',

            panelWidth: 0,
            panelHeight: 0,

            drawer: true,
            drawerWidth: 180,
            drawerWidthMin: 150,
            drawerWidthMax: 300,

        }
    },
    computed: {

        syncState: function() {
            return get(this, '$store.state.syncState')
        },

        menus: function() {
            let vo = this
            let ms = [
                {
                    key: 'users',
                    text: 'bbb',
                    icon: mdiAccountGroupOutline,
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
