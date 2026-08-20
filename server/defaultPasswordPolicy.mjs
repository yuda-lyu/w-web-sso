//defaultPasswordPolicy: settings 未提供 passwordPolicy 時之程式內建預設密碼政策
//與套件自帶 settings.json 之 passwordPolicy 同組, 對齊 WWebSso 其他設定[未給即回退預設值]之慣例,
//引用方未給時直接採用(啟動不失敗); 有給時才由 WWebSso 逐欄嚴格驗證(給了就必須給對)
let defaultPasswordPolicy = {
    minLength: 8,
    maxLength: 16,
    requireLetter: true,
    requireUppercase: false,
    requireLowercase: false,
    requireDigit: true,
    requireSpecial: true,
    noSpace: true,
    onlyAscii: true,
    forbiddenChars: ['\\'],
    noConsecutiveCharsFromAccount: true,
    consecutiveCharsMinMatch: 2,
    commonPasswordBlacklist: [
        '1234', '12345', '123456', '1234567', '12345678',
        '123456789', '1234567890', '12345678910',
        '111111', '000000', '666666', '888888', '7777777', '11111111',
        '123123', '123321', '654321', '987654321',
        'qwerty', 'qwerty123', 'qwerty1', 'qwertyuiop', 'qazwsx',
        '1q2w3e4r', '1q2w3e4r5t', '1q2w3e', '1qaz2wsx', 'zxcvbnm',
        'password', 'password1', 'passw0rd', 'admin', 'admin123',
        'welcome', 'letmein', 'login', 'master', 'monkey', 'dragon',
        'shadow', 'sunshine', 'superman', 'batman', 'football',
        'baseball', 'soccer', 'hockey', 'michael', 'jordan', 'jennifer',
        'hunter', 'ranger', 'harley', 'thomas', 'charlie', 'andrew',
        'daniel', 'ashley', 'bailey', 'mustang', 'access', 'secret',
        'ninja', 'jesus', 'hello', 'freedom', 'trustno1',
        '1qaz@WSX', 'P@ssw0rd', 'Pass@123', 'Aa123456', 'Aa@123456',
        'Admin@123', 'abc@123',
        'abc123', 'abcdef', 'abcd1234', 'abc',
        'iloveyou', 'fuckyou', 'f*ckyou', 'whatever', 'nothing',
        'google', 'computer', 'internet', 'samsung', 'apple', 'killer',
        'princess', 'lovely', 'tigger', 'starwars', 'pokemon',
        'minecraft', '123qwe', 'zaq1zaq1', 'photoshop', 'adobe123',
        '18atcskd2w', 'mynoob',
    ],
}


export { defaultPasswordPolicy }
export default defaultPasswordPolicy
