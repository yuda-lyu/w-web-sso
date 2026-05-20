<template>
    <WConfirm
        :show.sync="bShow"
        :title="$t('systemMessage')"
        :content="content"
        :_contentColor="'white'"
        :_contentIconColor="'white'"
        :_contentBackgroundColor="'orange lighten-5'"
        :_titleColor="'white'"
        :headerBackgroundColor="'grey lighten-3'"
        :noBtnText="$t('no')"
        :yesBtnText="$t('yes')"
        @click-no="clickBtn(false)"
        @click-yes="clickBtn(true)"
    ></WConfirm>
</template>

<script>
import Vue from 'vue'
import genPm from 'wsemi/src/genPm.mjs'
import WConfirm from 'w-component-vue/src/components/WConfirm.vue'

export default {
    components: {
        WConfirm,
    },
    props: {
    },
    data: function() {
        return {

            bShow: false,
            pm: null,

            content: '',

        }
    },
    mounted: function() {
        //console.log('mounted')

        let vo = this

        //set
        Vue.prototype.$dg.showCheckYesNo = vo.show

    },
    computed: {
    },
    methods: {

        /**
         * 顯示 Yes/No 確認對話框並回傳 Promise。
         *
         * **Contract** (caller 須遵守):
         *   - 使用者點 **Yes** → Promise `resolve()` (無值, 進 `.then()`)
         *   - 使用者點 **No** → Promise `reject('close')` (進 `.catch(err => err === 'close')`)
         *
         * 正確 caller pattern:
         *
         *     vo.$dg.showCheckYesNo('確定要 X？')
         *         .then(() => {
         *             //使用者點 Yes
         *             doX()
         *         })
         *         .catch((err) => {
         *             //使用者點 No (err === 'close') 為正常路徑, 靜默處理
         *             if (err === 'close') return
         *             //非預期錯誤 (CheckYesNo 本身故障等)
         *             console.log('showCheckYesNo unexpected error', err)
         *         })
         *
         * **錯誤 pattern (歷史踩過坑, 不要再寫)**:
         *
         *     // ❌ 永遠錯: 假設 resolve(true/false) 來判斷 Yes/No
         *     vo.$dg.showCheckYesNo(text).then(agree => {
         *         if (agree) { doX() }  //agree 永遠 undefined (resolve 無值) → 永不執行 doX
         *     })
         *     //雙重 bug: Yes silent fail (本段) + No unhandled rejection (沒 .catch)
         *
         * @param {string} content - 顯示在 modal 中的訊息文字
         * @returns {Promise<void>} Yes → resolve(); No → reject('close')
         */
        show: function (content) {
            //console.log('methods show', content)

            let vo = this

            //pm
            vo.pm = genPm()

            //save
            vo.content = content

            //show
            vo.bShow = true

            return vo.pm
        },

        clickBtn: function(mode) {
            //console.log('methods clickBtn', mode)

            let vo = this

            if (mode) {
                vo.pm.resolve()
            }
            else {
                vo.pm.reject('close')
            }

            //hide
            vo.bShow = false

        },

    }
}
</script>

<style scoped>
</style>
