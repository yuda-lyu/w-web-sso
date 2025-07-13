import w from 'wsemi'

let t = ''

t = w.nowms2str()
console.log('nowms2str', t, w.istimemsTZ(t))

t = `3000-01-01T00:00:00.000+08:00`
console.log('nowms2str', t, w.istimemsTZ(t))

//node g.mjs
