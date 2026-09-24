<template>
    <div style="height:100svh; background:#f5f5f5;">

        <!-- menu top, 內容驅動之RWD(ADR-067): 系統名稱/說明/語系選單/使用者全部攤開所需之自然寬未超過標題列寬時為寬版(與原版面相同),
             超過則右側收合為漢堡按鈕(WPopup內含當前登入者資訊/語系切換/登出); 名稱與說明各自以剩餘寬為上限, 超出顯示省略符號並以WTooltip提供全文.
             overflow:hidden為保險, 正常情況下任何寬度皆不溢出(原overflow-y:hidden會使水平方向自動出現捲軸) -->
        <div
            ref="rfHeader"
            :style="`height:${heightToolbar}px; box-sizing:border-box; overflow:hidden; padding:0px 10px; background:#fff; border-bottom:1px solid #ccc; display:flex; align-items:center;`"
            v-domresize
            @domresize="resizeHeader"
        >

            <!-- 識別區, flex:1與min-width:0使寬度隨版寬伸縮, 不再以nowrap撐開整列 -->
            <div style="padding-left:5px; display:flex; align-items:center; flex:1 1 auto; min-width:0;">

                <div
                    style="padding-right:10px; display:flex; align-items:center; flex:0 0 auto;"
                    v-if="webLogo"
                >
                    <!-- 因chrome渲染機制變更須添加min-width避免被壓縮至無寬度 -->
                    <img style="width:36px; min-width:36px; height:36px;" :src="webLogo" />
                </div>

                <div style="flex:1 1 auto; min-width:0;">

                    <!-- 系統名稱, 超出剩餘寬時省略; 僅於確實被截斷時啟用tooltip, 顯示中則維持啟用直到移出, 避免截斷狀態於顯示中翻轉致提示無法關閉(editable為false時mouseleave不處理) -->
                    <WTooltip
                        :displayType="'line'"
                        :isolated="true"
                        :placement="'bottom-start'"
                        :maxWidth="tooltipMaxWidth"
                        :editable="webNameTruncated || tipNameShown"
                        @show="tipNameShown=true"
                        @hide="tipNameShown=false"
                    >
                        <template v-slot:trigger>
                            <div
                                ref="rfWebName"
                                style="font-size:1.2rem; color:#000; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"
                            >{{webName}}</div>
                        </template>
                        <template v-slot:content>
                            <div style="white-space:normal; word-break:break-word;">{{webName}}</div>
                        </template>
                    </WTooltip>

                    <!-- 系統說明, 同上 -->
                    <WTooltip
                        :displayType="'line'"
                        :isolated="true"
                        :placement="'bottom-start'"
                        :maxWidth="tooltipMaxWidth"
                        :editable="webDescTruncated || tipDescShown"
                        @show="tipDescShown=true"
                        @hide="tipDescShown=false"
                    >
                        <template v-slot:trigger>
                            <div
                                ref="rfWebDesc"
                                style="font-size:0.8rem; color:#666; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"
                            >{{webDesc}}</div>
                        </template>
                        <template v-slot:content>
                            <div style="white-space:normal; word-break:break-word;">{{webDesc}}</div>
                        </template>
                    </WTooltip>

                </div>

            </div>

            <div
                style="padding-right:10px; white-space:nowrap; flex:0 0 auto;"
                v-if="showLangSelect && !isNarrow"
            >
                <WTextSelect
                    style="width:100px;"
                    :items="keysLang"
                    :value="lang"
                    @input="toggleLang"
                >
                    <template v-slot:select="props">
                        {{getLangText(props.item)}}
                    </template>
                    <template v-slot:item="props">
                        {{getLangText(props.item)}}
                    </template>
                </WTextSelect>
            </div>

            <div
                style="padding-right:10px; display:flex; align-items:center;"
                v-if="!isNarrow"
            >

                <WPopup
                    :isolated="true"
                    _show=""
                    _hide=""
                >
                    <template v-slot:trigger>

                        <div style="display:flex; align-items:center; white-space:nowrap; user-select:none; cursor:pointer;">
                            <div style="padding-top:2px;">
                                <WIcon
                                    :icon="mdiAccountCircleOutline"
                                    :size="20"
                                ></WIcon>
                            </div>
                            <div style="padding-left:5px; font-size:0.85rem;">
                                {{userName}}
                            </div>
                        </div>

                    </template>
                    <template v-slot:content>
                        <div style="padding:10px;">

                            <div
                                style="display:flex; align-items:center; white-space:nowrap; user-select:none; cursor:pointer;"
                                @click="logout"
                            >
                                <div style="padding-top:2px;">
                                    <WIcon
                                        :icon="mdiLogoutVariant"
                                        :size="18"
                                    ></WIcon>
                                </div>
                                <div style="padding-left:5px; font-size:0.8rem;">
                                    {{$t('logout')}}
                                </div>
                            </div>

                        </div>
                    </template>
                </WPopup>

            </div>

            <!-- 窄版: 右側收合為漢堡按鈕, 彈窗內依序為當前登入者資訊/語系切換/登出;
                 用v-show而非v-if: 非isolated之WPopup於開啟中被銷毀時不會自行隱藏(不釋放popper與開啟層級清單), 故切回寬版時改以menuOpen=false正常關閉;
                 v-show之元素其靜態style不可含display: Vue 2.7.16之updateStyle每次重繪皆重設靜態style全部屬性, 會蓋掉v-show之display:none, 故flex置於內層 -->
            <div
                style="padding-left:10px; padding-right:5px; flex:0 0 auto;"
                v-show="isNarrow"
                @keydown.esc="closeMenu"
            >
                <div style="display:flex; align-items:center;">

                    <WPopup
                        :placement="'bottom-end'"
                        :value="menuOpen"
                        @input="setMenuOpen"
                    >
                        <template v-slot:trigger>
                            <!-- 開關一律由toggleMenu經menuOpen控制(再次點擊即關閉, 開啟中以active維持底色); 攔下click不讓WPopup觸發區自行開啟:
                                 使用者真實點擊時各監聽器之間會先執行microtask, 按鈕之toggleMenu關閉後觸發區仍收到同一click而重新開啟. 外部點擊關閉走window之mouseup, 不受影響 -->
                            <div @click.stop>
                                <WButtonCircle
                                    ref="rfMenuBtn"
                                    :paddingStyle="{v:6,h:6}"
                                    :icon="mdiMenu"
                                    :backgroundColor="'#fff'"
                                    :backgroundColorHover="'#f2f2f2'"
                                    :iconColor="'#444'"
                                    :iconColorHover="'#222'"
                                    :iconColorFocus="'#222'"
                                    :iconColorActive="'#222'"
                                    :shadow="false"
                                    :active="menuOpen"
                                    :aria-label="$t('menuUser')"
                                    :aria-expanded="menuOpen?'true':'false'"
                                    @click="toggleMenu"
                                ></WButtonCircle>
                            </div>
                        </template>
                        <template v-slot:content>
                            <div
                                :style="`min-width:220px; max-width:${menuMaxWidth}px; padding:4px 0px; font-size:0.85rem; color:#222;`"
                                @keydown.esc="closeMenu"
                            >

                                <!-- 當前登入者資訊, 層級同使用者資訊頁: 姓名為主, 帳號為輔 -->
                                <div style="padding:8px 12px; display:flex; align-items:center;">
                                    <div style="flex:0 0 36px; display:flex; justify-content:center;">
                                        <WIcon
                                            :icon="mdiAccountCircleOutline"
                                            :color="'grey darken-1'"
                                            :colorHover="'grey darken-1'"
                                            :size="36"
                                        ></WIcon>
                                    </div>
                                    <div style="padding-left:10px; min-width:0;">
                                        <div style="font-size:0.9rem; color:#222; word-break:break-word;">
                                            {{userName || userAccount}}
                                        </div>
                                        <div
                                            style="font-size:0.75rem; color:#666; word-break:break-all;"
                                            v-if="userName && userAccount"
                                        >
                                            {{userAccount}}
                                        </div>
                                    </div>
                                </div>

                                <!-- 語系切換, 下拉選單同寬版 -->
                                <div
                                    style="border-top:1px solid #ddd; padding:8px 12px; display:flex; align-items:center;"
                                    v-if="showLangSelect"
                                >
                                    <div style="flex:0 0 36px; display:flex; justify-content:center;">
                                        <WIcon
                                            :icon="mdiTranslate"
                                            :color="'grey darken-1'"
                                            :colorHover="'grey darken-1'"
                                            :size="20"
                                        ></WIcon>
                                    </div>
                                    <div style="padding-left:10px; flex:1 1 auto; white-space:nowrap;">
                                        {{$t('language')}}
                                    </div>
                                    <div style="padding-left:10px; flex:0 0 auto;">
                                        <WTextSelect
                                            style="width:100px;"
                                            :items="keysLang"
                                            :value="lang"
                                            @input="toggleLang"
                                        >
                                            <template v-slot:select="props">
                                                {{getLangText(props.item)}}
                                            </template>
                                            <template v-slot:item="props">
                                                {{getLangText(props.item)}}
                                            </template>
                                        </WTextSelect>
                                    </div>
                                </div>

                                <!-- 登出 -->
                                <div
                                    class="menu-row-click"
                                    style="border-top:1px solid #ddd; padding:10px 12px; display:flex; align-items:center; white-space:nowrap; user-select:none; cursor:pointer; outline:none;"
                                    role="button"
                                    tabindex="0"
                                    @click="logout"
                                    @keyup.enter="logout"
                                >
                                    <div style="flex:0 0 36px; display:flex; justify-content:center;">
                                        <WIcon
                                            :icon="mdiLogoutVariant"
                                            :color="'grey darken-1'"
                                            :colorHover="'grey darken-1'"
                                            :size="20"
                                        ></WIcon>
                                    </div>
                                    <div style="padding-left:10px;">
                                        {{$t('logout')}}
                                    </div>
                                </div>

                            </div>
                        </template>
                    </WPopup>

                </div>

            </div>

        </div>

        <div :style="`height:calc( 100% - ${heightToolbar}px );`">
            <LayoutContent
            ></LayoutContent>
        </div>

    </div>
</template>

<script>
import { mdiAccountCircleOutline, mdiLogoutVariant, mdiMenu, mdiTranslate } from '@mdi/js/mdi.js'
import get from 'lodash-es/get.js'
import isestr from 'wsemi/src/isestr.mjs'
import WIcon from 'w-component-vue/src/components/WIcon.vue'
import WPopup from 'w-component-vue/src/components/WPopup.vue'
import WTooltip from 'w-component-vue/src/components/WTooltip.vue'
import WTextSelect from 'w-component-vue/src/components/WTextSelect.vue'
import WButtonCircle from 'w-component-vue/src/components/WButtonCircle.vue'
import LayoutContent from './LayoutContent.vue'


//寬窄版判斷用之固定寬(px), 須與template之寬版結構一致
const hdPadH = 20 //標題列左右padding各10
const hdLeftPad = 5 //識別區padding-left
const hdLogoW = 36 + 10 //logo寬+其padding-right
const hdLangW = 100 + 10 //語系選單寬+其容器padding-right
const hdUserFixW = 10 + 20 + 5 //使用者容器padding-right+icon寬+文字padding-left
const hdGap = 10 //寬版時名稱說明與右側群組間至少保留之間距


//量測文字自然寬(px), 以canvas量測, 不受DOM截斷(省略符號)影響, 亦可量測未渲染之文字(窄版時不渲染使用者名稱)
let ctxMeasure = null
function measureTextWidth(text, font) {
    if (!isestr(text)) {
        return 0
    }
    if (ctxMeasure === null) {
        ctxMeasure = document.createElement('canvas').getContext('2d')
    }
    ctxMeasure.font = font
    return ctxMeasure.measureText(text).width
}


export default {
    components: {
        WIcon,
        WPopup,
        WTooltip,
        WTextSelect,
        WButtonCircle,
        LayoutContent,
    },
    props: {
    },
    data: function() {
        return {
            mdiAccountCircleOutline,
            mdiLogoutVariant,
            mdiMenu,
            mdiTranslate,

            t: null,

            loggingOut: false, //登出 in-flight 重入鎖: 登出觸發點為原生 popup 選單 div (非 WButton, 無 promiseUnlock),
            //且 mUI.logout 無 updateLoading 全頁 overlay, 故以此旗標擋雙擊重入 (避免重複 logoutByToken / 清 LS / 切 viewState)

            firstSetting: true,

            showLangSelect: false,

            keysLang: [
                'eng',
                'cht',
            ],
            kpLangSelect: {
                'eng': 'English',
                'cht': '中文',
            },

            drawer: true, //null,

            hdW: 0, //標題列寬(clientWidth), 0代表尚未量測
            hdFontFamily: '', //標題列字型, 供canvas量測文字自然寬
            hdFontWeight: '400',
            rootFontSize: 16, //rem基準(px)
            fontsTick: 0, //字型載入完成後遞增, 觸發文字自然寬重算

            menuOpen: false, //窄版漢堡選單是否開啟

            webNameTruncated: false, //系統名稱是否被截斷(顯示省略符號)
            webDescTruncated: false, //系統說明是否被截斷
            tipNameShown: false, //系統名稱tooltip是否顯示中
            tipDescShown: false, //系統說明tooltip是否顯示中

        }
    },
    mounted: function() {
        // console.log('mounted')

        let vo = this

        //字型與標題列寬, 於mounted同步設定, 寬窄版於首次繪製前即確定(資料變更之重繪在microtask內完成)
        let elHeader = vo.$refs.rfHeader
        if (elHeader) {
            let cs = window.getComputedStyle(elHeader)
            vo.hdFontFamily = cs.fontFamily
            vo.hdFontWeight = cs.fontWeight
            vo.hdW = elHeader.clientWidth
        }
        let rfs = parseFloat(window.getComputedStyle(document.documentElement).fontSize)
        if (rfs > 0) {
            vo.rootFontSize = rfs
        }
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(() => {
                vo.fontsTick++
            })
        }

        //firstSetting
        if (vo.firstSetting) {
            // console.log('webInfor', vo.webInfor)
            let showLanguage = get(vo, 'webInfor.showLanguage', '')
            // console.log('showLanguage', showLanguage)
            vo.showLangSelect = showLanguage === 'y'
            //setLang(null) 走 getLang 的優先序（URL > store > window），不會被 webInfor 預設覆蓋
            //store 在 App.vue beforeMount 已依 URL/window 設好；使用者後續切語系也存於 store
            vo.$ui.setLang(null, 'layout mounted')

            //會觸發數據變更再導致opt變更導致觸發rowsChange等事件, 故得要延遲, 供組件偵測初始設定數據初始化之用
            setTimeout(() => {
                vo.firstSetting = false
                // console.log('firstSetting', vo.firstSetting)
            }, 1)

        }

        //setInterval
        vo.t = setInterval(() => {
            if (isestr(vo.userToken)) {

                // console.log('refreshToken...', vo.userToken)
                // vo.$fapi.refreshToken(vo.userToken)
                //     .then((timeEnd) => {
                //         console.log('refreshToken then', timeEnd)
                //     })
                //     .catch((err) => {
                //         console.log('refreshToken catch', err)

                //         //logout, 登出與轉跳登入頁
                //         vo.logout()

                //     })

                // console.log('checkToken...', vo.userToken)
                vo.$fapi.checkToken(vo.userToken) //斷線有重試機制, resolve回傳true代表有效, false代表已過期, reject代表無效token或檢測token發生錯誤
                    .then((b) => {
                        if (b !== true) {
                            // console.log('checkToken expired')
                            vo.logout() //登出與轉跳登入頁
                        }
                    })
                    .catch((err) => {
                        console.log('checkToken catch', err)
                        vo.logout() //登出與轉跳登入頁
                    })

            }
        }, 60 * 1000) //每1min更新

    },
    beforeDestroy: function() {
        // console.log('beforeDestroy')

        let vo = this

        //clearInterval
        clearInterval(vo.t)

    },
    computed: {

        viewState: function() {
            let vo = this
            return get(vo, '$store.state.viewState', '')
        },

        heightToolbar: function() {
            let vo = this
            return get(vo, `$store.state.heightToolbar`, 0)
        },

        userToken: function() {
            let vo = this
            return get(vo, `$store.state.userToken`)
        },

        lang: function() {
            let vo = this
            return get(vo, `$store.state.lang`, '')
        },

        webInfor: function() {
            let wi = get(this, `$store.state.webInfor`)
            return wi
        },

        webName: {
            get() {
                let vo = this
                let c = vo.$t('webName', '')
                // console.log('get webName1', c)
                if (!isestr(c)) {
                    c = vo.$t('waitingData', '')
                }
                // console.log('get webName2', c)
                document.title = c //更換網頁title
                return c
            },
            // set(value) {
            //     return value
            // },
        },

        webDesc: function() {
            let vo = this
            return vo.$t('webDescription')
        },

        webLogo: function() {
            let vo = this
            return get(vo, `$store.state.webInfor.webLogo`, '')
        },

        userSelf: function() {
            let vo = this
            return get(vo, `$store.state.userSelf`, '')
        },

        userName: function() {
            let vo = this
            return get(vo, `userSelf.name`, '')
        },

        userAccount: function() {
            let vo = this
            return get(vo, `userSelf.account`, '')
        },

        natLeftWidth: function() {
            //識別區自然寬: padding + logo + 名稱與說明之較寬者
            let vo = this
            let wName = vo.getTextWidth(vo.webName, 1.2)
            let wDesc = vo.getTextWidth(vo.webDesc, 0.8)
            return hdLeftPad + (vo.webLogo ? hdLogoW : 0) + Math.max(wName, wDesc)
        },

        natRightWidth: function() {
            //寬版右側群組自然寬: 語系選單 + 使用者(icon與名稱)
            let vo = this
            let wUser = vo.getTextWidth(vo.userName, 0.85)
            return (vo.showLangSelect ? hdLangW : 0) + hdUserFixW + wUser
        },

        isNarrow: function() {
            //全部攤開所需寬度超過標題列寬即為窄版, 未量測前(hdW為0)視為寬版
            let vo = this
            if (vo.hdW <= 0) {
                return false
            }
            return hdPadH + vo.natLeftWidth + vo.natRightWidth + hdGap > vo.hdW
        },

        tooltipMaxWidth: function() {
            //名稱與說明tooltip最大寬(不含其左右padding共20), 不超出版寬
            let vo = this
            return Math.max(100, Math.min(400, vo.hdW - 40))
        },

        menuMaxWidth: function() {
            //漢堡選單最大寬, 不超出版寬
            let vo = this
            return Math.max(220, Math.min(320, vo.hdW - 20))
        },

        layoutSig: function() {
            //影響名稱與說明是否被截斷之因子, 變更時重新偵測截斷狀態
            let vo = this
            return `${vo.hdW}|${vo.isNarrow}|${!!vo.webLogo}|${vo.webName}|${vo.webDesc}|${vo.fontsTick}`
        },

    },
    watch: {

        isNarrow: function(v) {
            //切回寬版時關閉漢堡選單(漢堡按鈕隨之隱藏)
            let vo = this
            if (!v) {
                vo.menuOpen = false
            }
        },

        layoutSig: function() {
            let vo = this
            vo.$nextTick(() => {
                vo.checkTruncated()
            })
        },

    },
    methods: {

        getTextWidth: function(text, rem) {
            //以標題列字型量測文字自然寬, rem為字級倍率; fontsTick僅作為相依觸發重算
            let vo = this
            if (vo.fontsTick < 0 || !isestr(vo.hdFontFamily)) {
                return 0
            }
            return measureTextWidth(text, `${vo.hdFontWeight} ${vo.rootFontSize * rem}px ${vo.hdFontFamily}`)
        },

        resizeHeader: function(msg) {
            // console.log('methods resizeHeader', msg)

            let vo = this

            //hdW, 直接讀元素當下寬度, 不用msg.snew(視窗resize事件所帶者為前次輪詢之舊值)
            let el = vo.$refs.rfHeader
            if (el) {
                vo.hdW = el.clientWidth
            }

        },

        checkTruncated: function() {
            //偵測名稱與說明是否被截斷: scrollWidth為整數, 溢出不足1px時可能偵測不到, 故再以自然寬比對元素實寬
            let vo = this
            let isTruncated = (el, text, rem) => {
                if (!el) {
                    return false
                }
                if (el.scrollWidth > el.clientWidth) {
                    return true
                }
                return vo.getTextWidth(text, rem) > el.getBoundingClientRect().width + 0.05
            }
            vo.webNameTruncated = isTruncated(vo.$refs.rfWebName, vo.webName, 1.2)
            vo.webDescTruncated = isTruncated(vo.$refs.rfWebDesc, vo.webDesc, 0.8)
        },

        toggleMenu: function() {
            // console.log('methods toggleMenu')

            let vo = this

            vo.menuOpen = !vo.menuOpen

        },

        setMenuOpen: function(b) {
            // console.log('methods setMenuOpen', b)

            let vo = this

            vo.menuOpen = b

        },

        closeMenu: function() {
            // console.log('methods closeMenu')

            let vo = this

            //check
            if (!vo.menuOpen) {
                return
            }

            vo.menuOpen = false

            //焦點回到漢堡按鈕(焦點原位於選單內時, 選單內容銷毀後焦點會遺失); WButtonCircle內有兩個tabindex=0之元素,
            //外層為其tooltip觸發區, 內層為按鈕本體(具Enter處理), 故取最後一個
            let el = get(vo, '$refs.rfMenuBtn.$el', null)
            let els = el ? el.querySelectorAll('[tabindex="0"]') : []
            let elFocus = els.length > 0 ? els[els.length - 1] : null
            if (elFocus) {
                elFocus.focus()
            }

        },

        getLangText: function(lang) {
            // console.log('methods getLangText', lang)

            let vo = this

            let t = get(vo, `kpLangSelect.${lang}`, '')

            return t
        },

        toggleLang: function(lang) {
            // console.log('methods toggleLang', lang)

            let vo = this

            //setLang
            vo.$ui.setLang(lang, 'toggle')

        },

        logout: function() {
            // console.log('methods logout')

            let vo = this

            //關閉漢堡選單, 使其於轉跳登入頁(本組件銷毀)前正常隱藏
            vo.menuOpen = false

            //雙擊重入防護: 登出觸發點為原生 popup 選單 div (無 promiseUnlock), 且 mUI.logout 無全頁 loading,
            //in-flight 期間擋住第二次點擊, 避免重複 logoutByToken / 清 LS / 切 viewState. 成功會轉跳登入頁
            //(updateViewState('login')) 自然重置; 失敗 (如 webKey 缺失 reject) 於 catch 解鎖供使用者重試.
            if (vo.loggingOut) {
                return
            }
            vo.loggingOut = true

            //logout
            vo.$ui.logout()
                .then(() => {

                    //登出時提交變更viewState返回登入頁
                    vo.$ui.updateViewState('login')
                    console.log(`logout, goto view['login'] page`)

                })
                .catch((err) => {
                    console.log(`logout err[${err}]`)
                })
                .finally(() => {
                    vo.loggingOut = false
                })

        },

    }
}
</script>

<style scoped>
.menu-row-click {
    transition: background 0.2s;
}
.menu-row-click:hover,
.menu-row-click:focus {
    background: #f2f2f2;
}
</style>
