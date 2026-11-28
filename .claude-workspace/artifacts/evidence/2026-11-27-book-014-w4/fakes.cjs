// BOOK-014 W4 walk preload: BOOK-013's fake Kapso + this walk's fake Stripe (one --require; NODE_OPTIONS
// with two --require flags reached Node as one path).
require('../2026-11-27-book-013-phone-optional/fake-kapso.cjs')
require('./fake-stripe.cjs')
