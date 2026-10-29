import get from 'lodash-es/get.js'
import isestr from 'wsemi/src/isestr.mjs'
import ispint from 'wsemi/src/ispint.mjs'
import isearr from 'wsemi/src/isearr.mjs'
import getDiag from 'wsemi/src/getDiag.mjs'
import WEmail from 'w-email'


//init(st, diag): diag 為診斷遮罩實例(wsemi getDiag, 由 WWebSso 宣告寄信帳密後傳入, R-DIAG-01; 未傳者為無登錄秘密之預設實例), send 內 w-email(SMTP)之 reject 為外來值, 出口前經 diag.err
let init = (st, diag = getDiag()) => {

    let srcEmail = get(st, 'emSrcEmail', '')
    if (!isestr(srcEmail)) {
        throw new Error(`invalid srcEmail[${srcEmail}]`)
    }

    let srcPW = get(st, 'emSrcPW', '')
    if (!isestr(srcPW)) {
        throw new Error('invalid srcPW') //寄信密碼為憑證, 訊息不回顯其值(型別無效時值可為任意設定內容)
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
            return Promise.reject(`invalid srcName[${srcName}]`)
        }

        if (!isestr(emTitle)) {
            return Promise.reject(`invalid emTitle[${emTitle}]`)
        }

        if (!isestr(emContent)) {
            return Promise.reject(`invalid emContent[${emContent}]`)
        }

        if (isestr(toEmails)) {
            toEmails = [toEmails]
        }
        if (!isearr(toEmails)) {
            return Promise.reject(`invalid toEmails[${toEmails}]`)
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

        //WEmail, SMTP 之 reject 為外來值(主機/帳號/回應文字, 可夾帶寄信帳密), 進入本套件前遮罩憑證; 上方 invalid 系列為本函數以固定詞彙組成之 reject, 不經遮罩
        let r = null
        try {
            r = await new WEmail(opt)
        }
        catch (err) {
            return Promise.reject(diag.err(err))
        }
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
