<template>
    <div
        style="height:100%;"
        v-domresize
        @domresize="resizePanel"
        :changeLang="changeLang"
    >

        <div
            style="height:100%; background:#f9fafb; overflow-y:auto;"
            v-if="!isLoading"
        >

            <div style="padding:20px 30px;">

                <!-- 頁面標題 -->
                <div class="mb-8">
                    <div style="font-size:1.5rem; font-weight:600;">{{$t('statisticsInformation')}}</div>
                    <div style="font-size:0.9rem; color:#6b7280;">{{$t('statisticsInformationDescription')}}</div>
                </div>

                <div class="space-y-8">

                    <!-- 使用者資訊區區塊 -->
                    <div>
                        <div class="pb-1 text-gray-500 flex items-center">
                            <i class="text-2xl mdi mdi-shield-account-outline mr-2"></i>
                            <span class="text-sm">{{$t('userGroupInfor')}}</span>
                        </div>
                        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">

                            <div class="bg-white p-5 rounded-lg shadow-sm border border-gray-200 flex items-center">
                                <div class="bg-blue-100 p-3 rounded-full">
                                    <i class="mdi mdi-account-group-outline mdi-24px text-blue-600"></i>
                                </div>
                                <div class="ml-4">
                                    <div class="text-gray-500 text-sm">{{$t('totalUsers')}}</div>
                                    <div class="text-2xl font-bold text-gray-900">{{ userOverview.total || 0 }}</div>
                                </div>
                            </div>

                            <div class="bg-white p-5 rounded-lg shadow-sm border border-gray-200 flex items-center">
                                <div class="bg-green-100 p-3 rounded-full">
                                    <i class="mdi mdi-account-check-outline mdi-24px text-green-600"></i>
                                </div>
                                <div class="ml-4">
                                    <div class="text-gray-500 text-sm">{{$t('activeUsers')}}</div>
                                    <div class="text-2xl font-bold text-gray-900">{{ userOverview.active || 0 }}</div>
                                </div>
                            </div>

                            <div class="bg-white p-5 rounded-lg shadow-sm border border-gray-200 flex items-center">
                                <div class="bg-red-100 p-3 rounded-full">
                                    <i class="mdi mdi-account-lock-outline mdi-24px text-red-600"></i>
                                </div>
                                <div class="ml-4">
                                    <div class="text-gray-500 text-sm">{{$t('blockedUsers')}}</div>
                                    <div class="text-2xl font-bold text-gray-900">{{ userOverview.locked || 0 }}</div>
                                </div>
                            </div>

                            <div class="bg-white p-5 rounded-lg shadow-sm border border-gray-200 flex items-center">
                                <div class="bg-yellow-100 p-3 rounded-full">
                                    <i class="mdi mdi-account-clock-outline mdi-24px text-yellow-600"></i>
                                </div>
                                <div class="ml-4">
                                    <div class="text-gray-500 text-sm">{{$t('expiredUsers')}}</div>
                                    <div class="text-2xl font-bold text-gray-900">{{ userOverview.expired || 0 }}</div>
                                </div>
                            </div>

                        </div>
                    </div>


                    <!-- 存取活動監測區塊 -->
                    <div>
                        <div class="pb-1 text-gray-500 flex items-center">
                            <i class="text-2xl mdi mdi-chart-box-outline mr-2"></i>
                            <span class="text-sm">{{$t('accessActivityMonitoring')}}</span>
                        </div>
                        <div class="grid grid-cols-1 lg:grid-cols-1 gap-6">

                            <!-- 使用者登入頻率區塊 -->
                            <div class="bg-white p-5 rounded-lg shadow-sm border border-gray-200">
                                <div class="pb-2 flex items-center font-semibold text-gray-700">
                                    <i class="text-4xl mdi mdi-login-variant mr-2 text-purple-600"></i>
                                    <span class="text-lg">{{$t('userLoginFrequency')}}</span>
                                </div>
                                <div class="flex justify-between items-center">
                                    <div class="text-xs text-gray-500 mb-4">{{$t('last7Days')}}</div>
                                    <select v-model="timeGroupLogin" @change="updateChartsDebounce" class="border rounded px-2 py-1 text-sm">
                                        <option v-for="v in timeGroupOptions" :key="v" :value="v">{{$t(`selectItem${v}`)}}</option>
                                    </select>
                                </div>

                                <WEchartsVueDyn
                                    style="width:100%; height:300px;"
                                    :options="optLogin"
                                    v-if="optLogin"
                                ></WEchartsVueDyn>

                                <div
                                    style="padding:0px; font-size:0.8rem; color:#777;"
                                    v-else
                                >
                                    {{$t('waitingData')}}
                                </div>

                            </div>

                            <!-- 金鑰使用頻率區塊 -->
                            <div class="bg-white p-5 rounded-lg shadow-sm border border-gray-200">
                                <div class="pb-2 flex items-center font-semibold text-gray-700">
                                    <i class="text-2xl mdi mdi-ticket-confirmation-outline mr-2 text-purple-600"></i>
                                    <span class="text-lg">{{$t('tokenUsageFrequency')}}</span>
                                </div>
                                <div class="flex justify-between items-center">
                                    <div class="text-xs text-gray-500 mb-4">{{$t('last7Days')}}</div>
                                    <div class="flex items-center space-x-4">
                                        <div class="flex items-center">
                                            <input id="showIndividuallyToken" type="checkbox" v-model="showIndividuallyToken" @change="updateChartsDebounce" class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500">
                                            <label for="showIndividuallyToken" class="ml-2 text-sm font-medium text-gray-900">{{$t('showIndividually')}}</label>
                                        </div>
                                        <select v-model="timeGroupToken" @change="updateChartsDebounce" class="border rounded px-2 py-1 text-sm">
                                            <option v-for="v in timeGroupOptions" :key="v" :value="v">{{$t(`selectItem${v}`)}}</option>
                                        </select>
                                    </div>
                                </div>

                                <WEchartsVueDyn
                                    style="width:100%; height:300px;"
                                    :options="optToken"
                                    v-if="optToken"
                                ></WEchartsVueDyn>

                                <div
                                    style="padding:0px; font-size:0.8rem; color:#777;"
                                    v-else
                                >
                                    {{$t('waitingData')}}
                                </div>

                                <!-- 金鑰對應使用者用量統計 -->
                                <div v-if="tokenUsageSummary.length > 0" class="mt-4">
                                    <div class="overflow-x-auto relative shadow-md">
                                        <div :style="`${showAllTokenUsers ? 'max-height:400px; overflow-y:auto;' : ''}`">
                                            <table class="w-full text-sm text-left text-gray-500 border-collapse">
                                                <thead class="text-xs text-gray-700 bg-gray-50 sticky top-0 z-10 shadow-sm">
                                                    <tr>
                                                        <th scope="col" class="py-3 px-6 border border-solid border-gray-200 w-7">{{$t('numberOrder')}}</th>
                                                        <th scope="col" class="py-3 px-6 border border-solid border-gray-200">{{$t('username')}}</th>
                                                        <th scope="col" class="py-3 px-6 border border-solid border-gray-200">{{$t('total')}}</th>
                                                        <th scope="col" class="py-3 px-6 border border-solid border-gray-200">{{$t('last1Day')}}</th>
                                                        <th scope="col" class="py-3 px-6 border border-solid border-gray-200">{{$t('last8Hour')}}</th>
                                                        <th scope="col" class="py-3 px-6 border border-solid border-gray-200">{{$t('last4Hour')}}</th>
                                                        <th scope="col" class="py-3 px-6 border border-solid border-gray-200">{{$t('last1Hour')}}</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    <tr v-for="(item, index) in displayTokenUsageSummary" :key="index" class="hover:bg-gray-50 transition-colors">
                                                        <td class="py-4 px-6 border border-solid border-gray-200 w-7">{{ item.number }}</td>
                                                        <td class="py-4 px-6 border border-solid border-gray-200">{{ item.username }}</td>
                                                        <td class="py-4 px-6 border border-solid border-gray-200">{{ formatNumber(item.total) }}</td>
                                                        <td class="py-4 px-6 border border-solid border-gray-200">{{ formatNumber(item.last1d) }}</td>
                                                        <td class="py-4 px-6 border border-solid border-gray-200">{{ formatNumber(item.last8h) }}</td>
                                                        <td class="py-4 px-6 border border-solid border-gray-200">{{ formatNumber(item.last4h) }}</td>
                                                        <td class="py-4 px-6 border border-solid border-gray-200">{{ formatNumber(item.last1h) }}</td>
                                                    </tr>
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                    <div class="text-right mt-2">
                                        <span @click="toggleShowAllTokenUsers" class="text-blue-600 hover:underline text-sm cursor-pointer">
                                            {{ showAllTokenUsers ? $t('showMax5') : $t('showAll') }}
                                        </span>
                                    </div>
                                </div>

                            </div>

                            <!-- IP連線頻率區塊 -->
                            <div class="bg-white p-5 rounded-lg shadow-sm border border-gray-200">
                                <div class="pb-2 flex items-center font-semibold text-gray-700">
                                    <i class="text-2xl mdi mdi-access-point-network mr-2 text-purple-600"></i>
                                    <span class="text-lg">{{$t('ipConnectionFrequency')}}</span>
                                </div>
                                <div class="flex justify-between items-center">
                                    <div class="text-xs text-gray-500 mb-4">{{$t('last7Days')}}</div>
                                    <div class="flex items-center space-x-4">
                                        <div class="flex items-center">
                                            <input id="showIndividuallyIp" type="checkbox" v-model="showIndividuallyIp" @change="updateChartsDebounce" class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500">
                                            <label for="showIndividuallyIp" class="ml-2 text-sm font-medium text-gray-900">{{$t('showIndividually')}}</label>
                                        </div>
                                        <select v-model="timeGroupIp" @change="updateChartsDebounce" class="border rounded px-2 py-1 text-sm">
                                            <option v-for="v in timeGroupOptions" :key="v" :value="v">{{$t(`selectItem${v}`)}}</option>
                                        </select>
                                    </div>
                                </div>

                                <WEchartsVueDyn
                                    style="width:100%; height:300px;"
                                    :options="optIp"
                                    v-if="optIp"
                                ></WEchartsVueDyn>

                                <div
                                    style="padding:0px; font-size:0.8rem; color:#777;"
                                    v-else
                                >
                                    {{$t('waitingData')}}
                                </div>

                                <!-- IP 使用量統計 -->
                                <div v-if="ipUsageSummary.length > 0" class="mt-4">
                                    <div class="overflow-x-auto relative shadow-md">
                                        <div :style="`${showAllIpUsers ? 'max-height:400px; overflow-y:auto;' : ''}`">
                                            <table class="w-full text-sm text-left text-gray-500 border-collapse">
                                                <thead class="text-xs text-gray-700 bg-gray-50 sticky top-0 z-10 shadow-sm">
                                                    <tr>
                                                        <th scope="col" class="py-3 px-6 border border-solid border-gray-200 w-7">{{$t('numberOrder')}}</th>
                                                        <th scope="col" class="py-3 px-6 border border-solid border-gray-200">{{$t('ip')}}</th>
                                                        <th scope="col" class="py-3 px-6 border border-solid border-gray-200">{{$t('total')}}</th>
                                                        <th scope="col" class="py-3 px-6 border border-solid border-gray-200">{{$t('last1Day')}}</th>
                                                        <th scope="col" class="py-3 px-6 border border-solid border-gray-200">{{$t('last8Hour')}}</th>
                                                        <th scope="col" class="py-3 px-6 border border-solid border-gray-200">{{$t('last4Hour')}}</th>
                                                        <th scope="col" class="py-3 px-6 border border-solid border-gray-200">{{$t('last1Hour')}}</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    <tr v-for="(item, index) in displayIpUsageSummary" :key="index" class="hover:bg-gray-50 transition-colors">
                                                        <td class="py-4 px-6 border border-solid border-gray-200 w-7">{{ item.number }}</td>
                                                        <td class="py-4 px-6 border border-solid border-gray-200">{{ item.ip }}</td>
                                                        <td class="py-4 px-6 border border-solid border-gray-200">{{ formatNumber(item.total) }}</td>
                                                        <td class="py-4 px-6 border border-solid border-gray-200">{{ formatNumber(item.last1d) }}</td>
                                                        <td class="py-4 px-6 border border-solid border-gray-200">{{ formatNumber(item.last8h) }}</td>
                                                        <td class="py-4 px-6 border border-solid border-gray-200">{{ formatNumber(item.last4h) }}</td>
                                                        <td class="py-4 px-6 border border-solid border-gray-200">{{ formatNumber(item.last1h) }}</td>
                                                    </tr>
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                    <div class="text-right mt-2">
                                        <span @click="toggleShowAllIpUsers" class="text-blue-600 hover:underline text-sm cursor-pointer">
                                            {{ showAllIpUsers ? $t('showMax5') : $t('showAll') }}
                                        </span>
                                    </div>
                                </div>

                            </div>

                        </div>
                    </div>


                    <!-- 管控狀態區塊 -->
                    <div>
                        <div class="pb-1 text-gray-500 flex items-center">
                            <i class="text-2xl mdi mdi-monitor-account mr-2"></i>
                            <span class="text-sm">{{$t('controlStatus')}}</span>
                        </div>
                        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">

                            <!-- 活躍 Token -->
                            <div class="bg-white p-5 rounded-lg shadow-sm border border-gray-200">
                                <div class="pb-3 flex items-center mb-2">
                                    <i class="text-2xl mdi mdi-folder-key-network-outline text-indigo-600 mr-2"></i>
                                    <div class="font-semibold text-gray-700">{{$t('tokenCharacteristic')}}</div>
                                </div>
                                <div class="space-y-2 text-sm">
                                    <div class="flex justify-between"><span>{{$t('activeTokens')}}:</span> <span class="font-bold">{{ tokenStatus.active || 0 }}</span></div>
                                    <div class="flex justify-between"><span>{{$t('createdLast24h')}}:</span> <span class="font-bold">{{ tokenStatus.created24h || 0 }}</span></div>
                                    <div class="flex justify-between"><span>{{$t('endingNext24h')}}:</span> <span class="font-bold">{{ tokenStatus.ending24h || 0 }}</span></div>
                                    <div class="flex justify-between"><span>{{$t('endedTokens')}}:</span> <span class="font-bold">{{ tokenStatus.ended || 0 }}</span></div>
                                </div>
                            </div>

                            <!-- IP 管控 -->
                            <div class="bg-white p-5 rounded-lg shadow-sm border border-gray-200">
                                <div class="pb-3 flex items-center mb-2">
                                    <i class="text-2xl mdi mdi-ip-network-outline text-teal-600 mr-2"></i>
                                    <div class="font-semibold text-gray-700">{{$t('ipCharacteristic')}}</div>
                                </div>
                                <div class="space-y-2 text-sm">
                                    <div class="flex justify-between"><span>{{$t('conn24h')}}:</span> <span class="font-bold">{{ ipCharacteristic.conn24h || 0 }}</span></div>
                                    <div class="flex justify-between"><span>{{$t('blockedIps')}}:</span> <span class="font-bold">{{ ipCharacteristic.blocked || 0 }}</span></div>
                                </div>
                            </div>

                        </div>
                    </div>

                </div>

            </div>

        </div>
        <template v-else>
            <div
                style="padding:10px 15px; font-size:0.8rem;"
                v-if="isLoading"
            >
                {{$t('waitingData')}}
            </div>
            <div
                style="padding:10px 15px; font-size:0.8rem;"
                v-if="errMsg"
            >
                {{errMsg}}
            </div>
        </template>

    </div>
</template>

<script>
import ot from 'dayjs'
import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import map from 'lodash-es/map.js'
import size from 'lodash-es/size.js'
import keys from 'lodash-es/keys.js'
import groupBy from 'lodash-es/groupBy.js'
import sumBy from 'lodash-es/sumBy.js'
// import cloneDeep from 'lodash-es/cloneDeep.js'
import omit from 'lodash-es/omit.js'
import reduce from 'lodash-es/reduce.js'
import toPairs from 'lodash-es/toPairs.js'
import sortBy from 'lodash-es/sortBy.js'
import reverse from 'lodash-es/reverse.js'
import isearr from 'wsemi/src/isearr.mjs'
import strright from 'wsemi/src/strright.mjs'
import haskey from 'wsemi/src/haskey.mjs'
import debounce from 'wsemi/src/debounce.mjs'
// import delay from 'wsemi/src/delay.mjs'
import WEchartsVueDyn from 'w-component-vue/src/components/WEchartsVueDyn.vue'


export default {
    components: {
        WEchartsVueDyn,
    },
    props: {
    },
    data: function() {
        return {

            dbc: debounce(300),

            panelWidth: 100,
            panelHeight: 100,

            isLoading: true,
            errMsg: '',

            userOverview: {},

            freqLogin: [],
            freqToken: [],
            freqIp: [],

            tokenStatus: {},
            ipCharacteristic: {},

            timeGroupLogin: '1hr',
            timeGroupToken: '1hr',
            timeGroupIp: '1hr',
            timeGroupOptions: ['1hr', '4hr', '8hr', '1day'],

            optLogin: null,
            optToken: null,
            optIp: null,

            showIndividuallyToken: false,
            showIndividuallyIp: false,

            tokenUsageSummary: [],
            showAllTokenUsers: false,

            ipUsageSummary: [],
            showAllIpUsers: false,

        }
    },
    mounted: function() {
        // console.log('mounted')

        let vo = this

        //getAndRelaData
        vo.getAndRelaData()

    },
    computed: {

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

        changeLang: function() {
            let vo = this
            let lang = vo.lang
            vo.updateChartsDebounce(lang)
            return ''
        },

        displayTokenUsageSummary: function() {
            let vo = this
            if (vo.showAllTokenUsers) {
                return vo.tokenUsageSummary
            }
            return vo.tokenUsageSummary.slice(0, 5)
        },

        displayIpUsageSummary: function() {
            let vo = this
            if (vo.showAllIpUsers) {
                return vo.ipUsageSummary
            }
            return vo.ipUsageSummary.slice(0, 5)
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

        genOpt: function(title, arr, keysPick, timeGroup = '1hr') {
            let vo = this

            //check
            if (size(arr) === 0) {
                return null
            }

            //keysPick to array
            if (!isearr(keysPick)) {
                keysPick = [keysPick]
            }

            //timeGroup
            let dataProc = arr
            if (timeGroup !== '1hr') {

                //groupHours
                let groupHours = 4
                if (timeGroup === '8hr') {
                    groupHours = 8
                }
                else if (timeGroup === '1day') {
                    groupHours = 24
                }

                //gs
                let gs = groupBy(arr, (v) => {
                    let t = ot(v.time)
                    let h = t.hour()
                    let hGroup = Math.floor(h / groupHours)
                    let tNew = t.startOf('day').add(hGroup * groupHours, 'hour')
                    return tNew.format()
                })
                // console.log('gs', gs)

                //groupBy
                dataProc = map(gs, (vs, time) => {
                    let r = {
                        time,
                        data: {},
                    }
                    each(keysPick, (k) => {
                        r.data[k] = sumBy(vs, `data.${k}`)
                    })
                    return r
                })
                // console.log('dataProc', dataProc)

            }

            //colors
            let colors = [
                '#3b82f6', // blue-500
                '#ef4444', // red-500
                '#10b981', // emerald-500
                '#f97316', // orange-500
                '#8b5cf6', // violet-500
                '#6366f1', // indigo-500
                '#eab308', // yellow-500
                '#ec4899', // pink-500
                '#14b8a6', // teal-500
                '#a855f7', // purple-500
            ]
            function getColor(k) {
                return colors[k % colors.length]
            }

            //kpKey
            let kpKey = {
                count: 'count',
                attempt: 'countAttempt',
                success: 'countSuccess',
                error: 'countError',
            }

            //getName
            let getName = (valueKey) => {
                let langKey = ''
                if (haskey(kpKey, valueKey)) {
                    langKey = kpKey[valueKey]
                }
                else {
                    langKey = valueKey
                }
                let name = vo.$t(langKey)
                // console.log(`langKey[${langKey}]`, `name[${name}]`)
                return name
            }

            //series
            let totalBarsPerGroup = size(keysPick)
            let barWidthPercent = Math.floor(100 / (totalBarsPerGroup * 1.5)) + '%' // 自動算出適合的 barWidth
            let series = map(keysPick, (valueKey, k) => {
                let name = getName(valueKey)
                // console.log('valueKey', valueKey, 'name', name)
                let color = getColor(k)
                return {
                    name,
                    type: 'bar',
                    barWidth: barWidthPercent, // 改為動態 barWidth
                    data: map(dataProc, item => get(item, `data.${valueKey}`, 0)),
                    itemStyle: {
                        color,
                    },
                    emphasis: {
                        focus: 'series'
                    },
                }
            })
            // console.log(title, 'series', series)

            //formatX
            let formatX = 'MM/DD'
            if (strright(timeGroup, 2) === 'hr') {
                formatX = 'MM/DD\nHH:mm'
            }

            //opt
            let opt = {
                title: {
                    text: title,
                    show: false, // 不顯示標題，由組件的HTML提供
                },
                tooltip: {
                    trigger: 'axis',
                    axisPointer: {
                        type: 'shadow'
                    }
                },
                grid: {
                    left: '3%',
                    right: '4%',
                    bottom: '3%',
                    containLabel: true
                },
                legend: {
                    show: true,
                },
                xAxis: [
                    {
                        type: 'category',
                        data: map(dataProc, item => ot(item.time).format(formatX)),
                        axisTick: {
                            alignWithLabel: true
                        }
                    }
                ],
                yAxis: [
                    {
                        type: 'value'
                    }
                ],
                series,
            }
            return opt
        },

        grStaUserSummary: async function() {
            let vo = this

            //token
            let token = vo.userToken

            //getStaUserSummary
            await vo.$fapi.getStaUserSummary(token)
                .then((res) => {
                    vo.userOverview = res
                })
                .catch((err) => {
                    console.log('getStaUserSummary catch', err)
                })

        },

        grStaTokenSummary: async function() {
            let vo = this

            //token
            let token = vo.userToken

            //getStaTokenSummary
            await vo.$fapi.getStaTokenSummary(token)
                .then((res) => {
                    vo.tokenStatus = res
                })
                .catch((err) => {
                    console.log('getStaTokenSummary catch', err)
                })

        },

        grStaIpSummary: async function() {
            let vo = this

            //token
            let token = vo.userToken

            //getStaIpSummary
            await vo.$fapi.getStaIpSummary(token)
                .then((res) => {
                    vo.ipCharacteristic = res
                })
                .catch((err) => {
                    console.log('getStaIpSummary catch', err)
                })

        },

        grStaUserAccountLogin: async function() {
            let vo = this

            //token
            let token = vo.userToken

            //getStaUserAccountLogin
            await vo.$fapi.getStaUserAccountLogin(token)
                .then((res) => {
                    // console.log('getStaUserAccountLogin(freqLogin)', cloneDeep(res))
                    vo.freqLogin = res
                    vo.optLogin = vo.genOpt(vo.$t('userLoginFrequency'), vo.freqLogin, ['attempt', 'success', 'error'], vo.timeGroupLogin)
                })
                .catch((err) => {
                    console.log('getStaUserAccountLogin catch', err)
                })

        },

        grStaToken: async function() {
            let vo = this

            //token
            let token = vo.userToken

            //getStaToken
            await vo.$fapi.getStaToken(token)
                .then((res) => {
                    // console.log('getStaToken(freqToken)', cloneDeep(res))
                    vo.freqToken = res
                    vo.updateCharts()
                    vo.calculateTokenUsageSummary(res)
                })
                .catch((err) => {
                    console.log('getStaToken catch', err)
                })

        },

        grStaIp: async function name(params) {
            let vo = this

            //token
            let token = vo.userToken

            //getStaIp
            await vo.$fapi.getStaIp(token)
                .then((res) => {
                    // console.log('getStaIp(freqIp)', cloneDeep(res))
                    vo.freqIp = res
                    vo.updateCharts()
                    vo.calculateIpUsageSummary(res)
                })
                .catch((err) => {
                    console.log('getStaIp catch', err)
                })

        },

        getAndRelaData: async function() {
            let vo = this

            vo.isLoading = true
            vo.errMsg = ''
            vo.grStaUserSummary() //isLoading僅針對grStaUserSummary之取得成功與否做判斷
                .catch((err) => {
                    console.log(err)
                    vo.errMsg = vo.$t('getDataError')
                })
                .finally(() => {
                    vo.isLoading = false
                })

            vo.grStaTokenSummary()
                .catch(() => { })

            vo.grStaIpSummary()
                .catch(() => { })

            vo.grStaUserAccountLogin()
                .catch(() => { })

            vo.grStaToken()
                .catch(() => { })

            vo.grStaIp()
                .catch(() => { })

        },

        updateCharts: function() {
            let vo = this

            //optLogin
            vo.optLogin = vo.genOpt(vo.$t('userLoginFrequency'), vo.freqLogin, ['attempt', 'success', 'error'], vo.timeGroupLogin)

            //optToken
            let dataToken = get(vo.freqToken, '0.data')
            let ksToken = keys(dataToken)
            if (!vo.showIndividuallyToken) {
                ksToken = ['count']
            }
            vo.optToken = vo.genOpt(vo.$t('tokenUsageFrequency'), vo.freqToken, ksToken, vo.timeGroupToken)

            //optIp
            let dataIp = get(vo.freqIp, '0.data')
            let ksIp = keys(dataIp)
            if (!vo.showIndividuallyIp) {
                ksIp = ['count']
            }
            vo.optIp = vo.genOpt(vo.$t('ipConnectionFrequency'), vo.freqIp, ksIp, vo.timeGroupIp)

        },

        updateChartsDebounce: function() {
            let vo = this
            vo.dbc(() => {
                vo.updateCharts()
            })
        },

        calculateTokenUsageSummary: function(tokenFrequency) {
            let vo = this

            // 先取得所有使用者
            let users = reduce(tokenFrequency, (acc, entry) => {
                let userData = omit(get(entry, 'data', {}), 'count')
                each(keys(userData), (username) => {
                    if (!haskey(acc, username)) {
                        acc[username] = {
                            username,
                            total: 0,
                            last1d: 0,
                            last8h: 0,
                            last4h: 0,
                            last1h: 0,
                        }
                    }
                })
                return acc
            }, {})

            // now
            let now = ot()

            // 迭代 tokenFrequency 進行計算
            each(tokenFrequency, (entry) => {
                let t = ot(entry.time)
                let diff1d = now.diff(t, 'hour') <= 24
                let diff8h = now.diff(t, 'hour') <= 8
                let diff4h = now.diff(t, 'hour') <= 4
                let diff1h = now.diff(t, 'hour') <= 1
                let userData = omit(get(entry, 'data', {}), 'count')
                each(userData, (value, username) => {
                    if (haskey(users, username)) {
                        users[username].total += value
                        if (diff1d) {
                            users[username].last1d += value
                        }
                        if (diff8h) {
                            users[username].last8h += value
                        }
                        if (diff4h) {
                            users[username].last4h += value
                        }
                        if (diff1h) {
                            users[username].last1h += value
                        }
                    }
                })
            })

            // 將物件轉換為陣列並排序
            let sortedSummary = toPairs(users)
            sortedSummary = map(sortedSummary, (v) => v[1]) //只取value
            sortedSummary = sortBy(sortedSummary, 'total')
            sortedSummary = reverse(sortedSummary)
            sortedSummary = map(sortedSummary, (v, k) => {
                v.number = k + 1
                return v
            })
            // console.log('sortedSummary', sortedSummary)

            vo.tokenUsageSummary = sortedSummary
        },

        toggleShowAllTokenUsers: function() {
            let vo = this
            vo.showAllTokenUsers = !vo.showAllTokenUsers
        },

        calculateIpUsageSummary: function(ipFrequency) {
            let vo = this

            // 先取得所有IP
            let ips = reduce(ipFrequency, (acc, entry) => {
                let ipData = omit(get(entry, 'data', {}), 'count')
                each(keys(ipData), (ip) => {
                    if (!haskey(acc, ip)) {
                        acc[ip] = {
                            ip,
                            total: 0,
                            last1d: 0,
                            last8h: 0,
                            last4h: 0,
                            last1h: 0,
                        }
                    }
                })
                return acc
            }, {})

            // now
            let now = ot()

            // 迭代 ipFrequency 進行計算
            each(ipFrequency, (entry) => {
                let t = ot(entry.time)
                let diff1d = now.diff(t, 'hour') <= 24
                let diff8h = now.diff(t, 'hour') <= 8
                let diff4h = now.diff(t, 'hour') <= 4
                let diff1h = now.diff(t, 'hour') <= 1
                let ipData = omit(get(entry, 'data', {}), 'count')
                each(ipData, (value, ip) => {
                    if (haskey(ips, ip)) {
                        ips[ip].total += value
                        if (diff1d) {
                            ips[ip].last1d += value
                        }
                        if (diff8h) {
                            ips[ip].last8h += value
                        }
                        if (diff4h) {
                            ips[ip].last4h += value
                        }
                        if (diff1h) {
                            ips[ip].last1h += value
                        }
                    }
                })
            })

            // 將物件轉換為陣列並排序
            let sortedSummary = toPairs(ips)
            sortedSummary = map(sortedSummary, (v) => v[1]) //只取value
            sortedSummary = sortBy(sortedSummary, 'total')
            sortedSummary = reverse(sortedSummary)
            sortedSummary = map(sortedSummary, (v, k) => {
                v.number = k + 1
                return v
            })
            // console.log('sortedSummary', sortedSummary)

            vo.ipUsageSummary = sortedSummary
        },

        toggleShowAllIpUsers: function() {
            let vo = this
            vo.showAllIpUsers = !vo.showAllIpUsers
        },

        formatNumber: function(num) {
            if (num === null || num === undefined) {
                return 0
            }
            return num.toLocaleString()
        },

    }
}
</script>

<style scoped>
@media (min-width: 640px) {
    .sm\:grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (min-width: 1024px) {
    .lg\:grid-cols-1 { grid-template-columns: repeat(1, minmax(0, 1fr)); }
    .lg\:grid-cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
</style>
