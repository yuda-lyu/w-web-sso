import users from './users.mjs'
import tokens from './tokens.mjs'
import tokensSession from './tokensSession.mjs'
import ips from './ips.mjs'


//三表之寫入契約(前後端共用); tokens 為應用系統金鑰列(嚴格), tokensSession 為 session 列(逐列寬鬆)
export { users, tokens, tokensSession, ips }
export default { users, tokens, tokensSession, ips }
