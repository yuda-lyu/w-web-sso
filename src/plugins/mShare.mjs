//前後端共用函數區
import JSON5 from 'json5'
import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import map from 'lodash-es/map.js'
import find from 'lodash-es/find.js'
import join from 'lodash-es/join.js'
import cloneDeep from 'lodash-es/cloneDeep.js'
import takeRight from 'lodash-es/takeRight.js'
import dropRight from 'lodash-es/dropRight.js'
import sortBy from 'lodash-es/sortBy.js'
import sep from 'wsemi/src/sep.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import haskey from 'wsemi/src/haskey.mjs'
import composeToTree from 'wsemi/src/composeToTree.mjs'


//dlm
let dlm = '/'


function getAllBlocks(targets) {

    //rs
    let rs = map(targets, (v) => {

        //text, parentId
        let s = sep(v.id, dlm) //[tag:dlm]
        let text = get(takeRight(s), 0) //取最後節點
        s = dropRight(s, 1)
        let parentId = join(s, dlm) //[tag:dlm] 取父節點

        return {
            ...v,
            idTemp: v.id,
            parentId,
            text,
        }
    })
    // console.log('rs', rs)

    //sortBy
    rs = sortBy(rs, 'order')
    // console.log('rs sortBy', rs)

    return rs
}


function getTreeBlocks(targets) {

    //getAllBlocks
    let blocks = getAllBlocks(targets)
    // console.log('blocks', blocks)

    //opt
    let opt = {
        bindKey: 'id',
        bindParent: 'parentId',
        bindChildren: 'children',
        saveExtProps: true,
    }

    //composeToTree
    let r
    try {
        r = composeToTree(blocks, opt)
    }
    catch (err) {
        console.log(err)
    }
    // console.log('treeBlocks', cloneDeep(r))

    return r
}


function getUserGroups(user, ruleGroups) {

    //userGroups
    let ruleGroupsIds = get(user, 'ruleGroupsIds', '')

    //sep
    let s = sep(ruleGroupsIds, ';')

    //gs
    let gs = []
    each(s, (id) => {
        let g = find(ruleGroups, { id })
        if (iseobj(g)) {
            gs.push(g)
        }
    })

    //add rules
    gs = map(gs, (g) => {
        let rules = JSON5.parse(g.crules)
        g.rules = rules
        return g
    })

    return gs
}


function getTargetsByGroup(targets, group) {

    //cloneDeep
    targets = cloneDeep(targets)

    //sortBy
    targets = sortBy(targets, 'order')

    //cloneDeep
    group = cloneDeep(group)

    //rules
    let rules = JSON5.parse(group.crules)

    //rulesDisplay
    let rulesDisplay = {}
    let ks = ['show', 'active']
    each(ks, (k) => {

        //___all___
        let def = get(rules, `___all___.${k}`)
        def = (def === 'y') ? 'y' : 'n'

        //other props
        each(targets, (v) => {

            //krule
            let krule = v.id

            //check
            if (!rulesDisplay[krule]) {
                rulesDisplay[krule] = {}
            }

            //rule
            let rule = rules[krule]

            //r
            let r = null

            //b
            let b = get(rule, `${k}`)
            if (b === 'y' || b === 'n') {
                r = b
            }
            else {
                r = def
            }

            //save
            rulesDisplay[krule][k] = r //因krule內含有「.」故不能用set

        })

    })
    // console.log('rulesDisplay', rulesDisplay)

    return rulesDisplay
}


function getUserRules(user, ruleGroups, targets) {
    //依照使用者所允許之ruleGroups轉出對全部targets權限

    //ruleGroupsIds
    let ruleGroupsIds = get(user, 'ruleGroupsIds', '')

    //getUserGroups
    let gs = getUserGroups(user, ruleGroups)
    // console.log('gs', gs)

    //ruleGroupsNames
    let ruleGroupsNames = map(gs, 'name')
    ruleGroupsNames = join(ruleGroupsNames, ';')

    //getTargetsByGroup
    let rulesDisplay = {}
    each(gs, (g) => {
        let r = getTargetsByGroup(targets, g)
        each(r, (v, k) => {

            //check
            if (!haskey(rulesDisplay, k)) {
                rulesDisplay[k] = {}
            }

            //merge
            let ks = ['show', 'active']
            each(ks, (kk) => {
                let bOld = rulesDisplay[k][kk]
                let bNew = r[k][kk]
                if (bOld === 'y') {
                    //不用覆寫
                }
                else {
                    //需覆寫
                    if (bNew === 'y') {
                        rulesDisplay[k][kk] = 'y'
                    }
                    else {
                        rulesDisplay[k][kk] = 'n'
                    }
                }
            })

        })
    })
    // console.log('rulesDisplay', rulesDisplay)

    return {
        ruleGroupsIds,
        ruleGroupsNames,
        rules: rulesDisplay,
    }
}


export {
    getAllBlocks,
    getTreeBlocks,
    // getUserGroups,
    // getTargetsByGroup,
    getUserRules
}
