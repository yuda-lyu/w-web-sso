<template>
    <div
        ref="box"
        style="position:relative; display:flex; align-items:center; overflow:hidden; white-space:nowrap;"
        v-domresize
        @domresize="updateShow"
    >

        <!-- 量測層: 各標籤與「+N」之自然寬, 不顯示亦不接收事件 -->
        <div
            ref="measure"
            style="position:absolute; left:0px; top:0px; display:flex; visibility:hidden; pointer-events:none;"
        >
            <span
                :style="styleTag"
                :key="`m-${k}`"
                v-for="(t,k) in texts"
            >{{t}}</span>
            <span :style="styleMore">+{{texts.length}}</span>
        </div>

        <span
            :style="`${styleTag} ${k>0?`margin-left:${gap}px;`:''}`"
            :key="`s-${k}`"
            v-for="(t,k) in textsShow"
        >{{t}}</span>

        <span
            :style="`${styleMore} ${nShow>0?`margin-left:${gap}px;`:''}`"
            v-if="nShow < texts.length"
        >+{{texts.length-nShow}}</span>

    </div>
</template>

<script>
import size from 'lodash-es/size.js'


//AppPermsTags: 以標籤顯示應用系統金鑰之權限, 依容器實寬決定顯示幾個, 其餘收為「+N」(ADR-069)
//容器寬度變動(如拖曳欄寬)時經 v-domresize 重算; 全部清單由外層彈窗提供
export default {
    props: {
        texts: { //已翻譯之權限名稱陣列, 依顯示序
            type: Array,
            default: () => [],
        },
    },
    data: function() {
        return {
            gap: 3,
            nShow: 0,
            styleTag: 'display:inline-flex; align-items:center; flex:0 0 auto; height:16px; padding:0px 6px; box-sizing:border-box; border:1px solid #c8c8c8; border-radius:3px; background:#fff; color:#222; font-size:0.75rem;',
            styleMore: 'display:inline-flex; align-items:center; flex:0 0 auto; height:16px; padding:0px 5px; box-sizing:border-box; border:1px solid #c8c8c8; border-radius:3px; background:#fff; color:#666; font-size:0.75rem;',
        }
    },
    mounted: function() {
        let vo = this
        vo.nShow = size(vo.texts)
        vo.$nextTick(() => {
            vo.updateShow()
        })
    },
    watch: {
        texts: function() {
            let vo = this
            vo.nShow = size(vo.texts)
            vo.$nextTick(() => {
                vo.updateShow()
            })
        },
    },
    computed: {
        textsShow: function() {
            let vo = this
            return vo.texts.slice(0, vo.nShow)
        },
    },
    methods: {

        updateShow: function() {
            let vo = this

            //box, measure
            let box = vo.$refs.box
            let measure = vo.$refs.measure
            if (!box || !measure) {
                return
            }

            //ws, 各標籤自然寬; wMore, 「+N」取最寬情形(N=全部數量)
            let n = size(vo.texts)
            let cs = measure.children
            let ws = []
            for (let i = 0; i < n; i++) {
                ws.push(cs[i].offsetWidth)
            }
            let wMore = cs[n] ? cs[n].offsetWidth : 0

            //wBox
            let wBox = box.clientWidth

            //全部放得下
            let sum = 0
            for (let i = 0; i < n; i++) {
                sum += ws[i] + (i > 0 ? vo.gap : 0)
            }
            if (sum <= wBox) {
                vo.nShow = n
                return
            }

            //放不下: 取最多k個使 k個標籤 + 「+N」可容納
            let k = 0
            let acc = 0
            for (let i = 0; i < n; i++) {
                let w = acc + ws[i] + (i > 0 ? vo.gap : 0)
                if (w + vo.gap + wMore > wBox) {
                    break
                }
                acc = w
                k = i + 1
            }
            vo.nShow = k

        },

    },
}
</script>

<style scoped>
</style>
