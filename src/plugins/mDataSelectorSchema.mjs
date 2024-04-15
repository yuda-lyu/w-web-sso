import get from 'lodash-es/get.js'
import find from 'lodash-es/find.js'
import isestr from 'wsemi/src/isestr.mjs'


function mDataSelectorSchema(ds, opt = {}) {

    function getTableInforBy(keyFind, valueFind, keyPick) {
        let r = find(ds, { [keyFind]: valueFind })
        if (!r) {
            r = ''
        }
        if (isestr(keyPick)) {
            r = get(r, keyPick, '')
        }
        return r
    }

    function getTableChtByKey(valueFind) {
        return getTableInforBy('keyTable', valueFind, 'tableNameCht')
    }

    return {
        getTableInforBy,
        getTableChtByKey,
    }
}


export default mDataSelectorSchema
