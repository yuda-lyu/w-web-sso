import get from 'lodash-es/get.js'
import isestr from 'wsemi/src/isestr.mjs'
import ispint from 'wsemi/src/ispint.mjs'
import isearr from 'wsemi/src/isearr.mjs'
import WEmail from 'w-email'


let init = (st) => {

    let srcEmail = get(st, 'emSrcEmail', '')
    if (!isestr(srcEmail)) {
        throw new Error(`invalid srcEmail[${srcEmail}]`)
    }

    let srcPW = get(st, 'emSrcPW', '')
    if (!isestr(srcEmail)) {
        throw new Error(`invalid srcPW[${srcPW}]`)
    }

    let srcHost = get(st, 'emSrcHost', '')
    if (!isestr(srcHost)) {
        throw new Error(`invalid srcHost[${srcHost}]`)
    }

    let srcPort = get(st, 'emSrcPort', '')
    if (!ispint(srcPort)) {
        throw new Error(`invalid srcPort[${srcPort}]`)
    }

    let send = async(srcName, emTitle, emContent, toEmails) => {

        if (!isestr(srcName)) {
            throw new Error(`invalid srcName[${srcName}]`)
        }

        if (!isestr(emTitle)) {
            throw new Error(`invalid emTitle[${emTitle}]`)
        }

        if (!isestr(emContent)) {
            throw new Error(`invalid emContent[${emContent}]`)
        }

        if (isestr(toEmails)) {
            toEmails = [toEmails]
        }
        if (!isearr(toEmails)) {
            throw new Error(`invalid toEmails[${toEmails}]`)
        }

        //opt
        let opt = {
            srcName, //例如: SSO之寄信系統
            srcEmail,
            srcPW,
            srcHost,
            srcPort,
            emTitle, //例如: 使用者登入通知
            emContent, //例如: 使用者已於時間ooo裝置xxx登入
            toEmails, //例如: 'firsemisphere@gmail.com' 或 ['firsemisphere1@gmail.com','firsemisphere2@gmail.com' ]
            //toEmailsCC: 'firsemisphere@gmail.com',
            //toEmailsBCC: 'firsemisphere@gmail.com',
            // emAttachments: {
            //     filename: 'att.txt',
            //     path: path.resolve('../', './_data', 'att.txt')
            // }
        }

        //WEmail
        let r = await new WEmail(opt)
        // console.log('已成功寄送信件', r)

        return r
    }

    //r
    let r = {
        send,
    }

    return r
}


export default init
