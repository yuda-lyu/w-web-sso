<template>
    <div
        :style="`vertical-align:top;`"
    >

        <div style="display:table; width:100%;" v-if="inline">

            <div style="display:table-cell; vertical-align:top; white-space:nowrap; padding-right:5px;">

                <div :style="[{display:'inline-block'},useTitleHeight,useTitleWidth,titleStyle]">{{title}}</div>

            </div>

            <div style="display:table-cell; vertical-align:top; width:100%;">

                <slot></slot>

            </div>

        </div>

        <div style="" v-else>

            <div style="">

                <span style="font-size:0.9rem;">{{title}}</span>

            </div>

            <div style="">

                <slot></slot>

            </div>

        </div>

    </div>
</template>

<script>


export default {
    components: {
    },
    props: {
        title: {
            type: String,
            default: '',
        },
        titleHeight: {
            type: Number,
            default: null,
        },
        titleWidth: {
            type: Number,
            default: null,
        },
        titleStyle: {
            type: Object,
            default: () => {},
        },
        inline: {
            type: Boolean,
            default: true,
        },
    },
    data: function() {
        return {
        }
    },
    computed: {

        useTitleHeight: function() {
            //console.log('computed useTitleHeight')

            let vo = this

            if (vo.titleHeight) {
                return { height: `${vo.titleHeight}px`, lineHeight: `${vo.titleHeight}px` }
            }

            return {}
        },

        useTitleWidth: function() {
            //console.log('computed useTitleWidth')

            let vo = this

            if (vo.titleWidth) {
                return { width: `${vo.titleWidth}px` }
            }

            return {}
        },

    },
    methods: {
    }
}
</script>

<style scoped>
</style>
