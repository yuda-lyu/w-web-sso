import path from 'path'
import fs from 'fs'
import JSON5 from 'json5'


let fdSrv = path.resolve()


let fn = 'settings.json'


let fp = path.resolve(fdSrv, fn)


let setFilepath = (_fp) => {
    fp = _fp
}


let getSettings = () => {

    //readFileSync
    let j = fs.readFileSync(fp, 'utf8')

    //st
    let st = JSON5.parse(j)

    return st
}


let setSettings = (st) => {

    //stringify
    let j = JSON.stringify(st)

    //writeFileSync
    fs.writeFileSync(fp, j, 'utf8')

}


let r = {
    setFilepath,
    getSettings,
    setSettings,
}


export default r
