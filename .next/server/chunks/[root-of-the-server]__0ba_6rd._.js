module.exports=[449719,(e,t,r)=>{t.exports=e.x("assert",()=>require("assert"))},500874,(e,t,r)=>{t.exports=e.x("buffer",()=>require("buffer"))},233405,(e,t,r)=>{t.exports=e.x("child_process",()=>require("child_process"))},254799,(e,t,r)=>{t.exports=e.x("crypto",()=>require("crypto"))},679594,(e,t,r)=>{t.exports=e.x("dns",()=>require("dns"))},427699,(e,t,r)=>{t.exports=e.x("events",()=>require("events"))},522734,(e,t,r)=>{t.exports=e.x("fs",()=>require("fs"))},362562,(e,t,r)=>{t.exports=e.x("module",()=>require("module"))},504446,(e,t,r)=>{t.exports=e.x("net",()=>require("net"))},270406,(e,t,r)=>{t.exports=e.x("next/dist/compiled/@opentelemetry/api",()=>require("next/dist/compiled/@opentelemetry/api"))},918622,(e,t,r)=>{t.exports=e.x("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js",()=>require("next/dist/compiled/next-server/app-page-turbo.runtime.prod.js"))},120635,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/action-async-storage.external.js",()=>require("next/dist/server/app-render/action-async-storage.external.js"))},324725,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/after-task-async-storage.external.js",()=>require("next/dist/server/app-render/after-task-async-storage.external.js"))},556704,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/work-async-storage.external.js",()=>require("next/dist/server/app-render/work-async-storage.external.js"))},832319,(e,t,r)=>{t.exports=e.x("next/dist/server/app-render/work-unit-async-storage.external.js",()=>require("next/dist/server/app-render/work-unit-async-storage.external.js"))},559043,(e,t,r)=>{t.exports=e.x("next/dist/server/runtime-reacts.external.js",()=>require("next/dist/server/runtime-reacts.external.js"))},193695,(e,t,r)=>{t.exports=e.x("next/dist/shared/lib/no-fallback-error.external.js",()=>require("next/dist/shared/lib/no-fallback-error.external.js"))},666680,(e,t,r)=>{t.exports=e.x("node:crypto",()=>require("node:crypto"))},81111,(e,t,r)=>{t.exports=e.x("node:stream",()=>require("node:stream"))},446786,(e,t,r)=>{t.exports=e.x("os",()=>require("os"))},814747,(e,t,r)=>{t.exports=e.x("path",()=>require("path"))},688947,(e,t,r)=>{t.exports=e.x("stream",()=>require("stream"))},99348,(e,t,r)=>{t.exports=e.x("string_decoder",()=>require("string_decoder"))},755004,(e,t,r)=>{t.exports=e.x("tls",()=>require("tls"))},870722,(e,t,r)=>{t.exports=e.x("tty",()=>require("tty"))},792509,(e,t,r)=>{t.exports=e.x("url",()=>require("url"))},224361,(e,t,r)=>{t.exports=e.x("util",()=>require("util"))},37702,(e,t,r)=>{t.exports=e.x("worker_threads",()=>require("worker_threads"))},478059,e=>{"use strict";async function t(e,t,r){try{if(!(await e.takeToken(`int001:preauth:${t}:${r}`,{ratePerMin:300,burst:50})).allowed||!(await e.takeToken(`int001:preauthceil:${t}`,{ratePerMin:3e3,burst:500})).allowed)return{ok:!1,status:429,error:"rate_limited"};return{ok:!0}}catch{return{ok:!1,status:503,error:"queue_unavailable"}}}async function r(e,t){try{let{allowed:r}=await e.incrWindow(`int001:rlf:${t}`,10,60);if(!r)return{ok:!1,status:429,error:"rate_limited",retryAfterSec:60,remaining:0};return{ok:!1,status:401,error:"unauthorized"}}catch{return{ok:!1,status:503,error:"queue_unavailable"}}}async function n(e){var t,n,i,a,s,o;let l,u,c,d=Math.floor(e.clock.now().getTime()/1e3),p=Number(e.t);if(!(Number.isFinite(p)&&300>=Math.abs(d-p))||!e.signatureValid)return r(e.rateLimiter,e.integration.id);if("active"!==e.integration.status)return{ok:!1,status:403,error:"integration_inactive"};if(e.inboundDisabled)return{ok:!1,status:503,error:"feature_disabled"};let m=e.limits??{ratePerMin:60,burst:20};try{l=await e.rateLimiter.takeToken((t=e.integration.id,`int001:rl:${t}`),m)}catch{return{ok:!1,status:503,error:"queue_unavailable"}}if(!l.allowed)return{ok:!1,status:429,error:"rate_limited",retryAfterSec:l.retryAfterSec,remaining:l.remaining};try{u=await e.rateLimiter.incrWindow((n=e.integration.id,i=e.nonce,`int001:replay:${n}:${i}`),1,600)}catch{return{ok:!1,status:503,error:"queue_unavailable"}}let x=!u.allowed;try{c=await e.rateLimiter.incrWindow((a=e.integration.id,s=e.nonce,o=e.digest,`int001:replaybody:${a}:${s}:${o}`),1,600)}catch{return{ok:!1,status:503,error:"queue_unavailable"}}return x&&c.allowed?r(e.rateLimiter,e.integration.id):{ok:!0,replayed:x}}e.s(["DEFAULT_PARTNER_BURST",0,20,"DEFAULT_PARTNER_RATE_PER_MIN",0,60,"chargeAuthFailureAndDecide",0,r,"checkPreAuthThrottle",0,t,"extractTrustedClientIp",0,function(e){let t=e.headers.get("x-real-ip");if(t&&t.trim())return t.trim();let r=e.headers.get("x-forwarded-for");if(r){let e=r.split(",").map(e=>e.trim()).filter(e=>e.length>0);if(e.length>0)return e[e.length-1]}return"unknown"},"guardInboundRequest",0,n])},448743,e=>{"use strict";e.i(666680),e.s(["systemClock",0,{now:()=>new Date}])},354913,e=>{"use strict";e.i(333591);var t=e.i(428998),r=e.i(842512),n=e.i(369861),i=e.i(25253),a=e.i(782425),s=e.i(448743);let o=null;function l(){return o||(o=new t.Queue("integration-inbound",{connection:(0,n.getFailFastRedisOptions)()})),o}let u={count:1e3,age:3600};async function c(e){let t=l();await t.add("member-create",e,{jobId:e.jobId,attempts:3,backoff:{type:"exponential",delay:2e3},removeOnComplete:{count:500,age:3600},removeOnFail:u})}async function d(e,t){let r=l();await r.add("welcome-send",t,{jobId:e,attempts:3,backoff:{type:"exponential",delay:5e3},removeOnComplete:{count:500,age:3600},removeOnFail:{count:1e3,age:604800}})}let p=null,m=null,x=null;e.s(["addMemberCreateJob",0,c,"addWelcomeSendJob",0,d,"getGlobalCeilingGuard",0,function(){return x||(x=new a.GlobalQueueCeilingGuard({getDepth:async()=>{let e=l(),[t,r]=await Promise.all([e.getWaitingCount(),e.getDelayedCount()]);return t+r}},s.systemClock,(0,a.globalQueueCeilingFromEnv)())),x},"getInboundRateLimiter",0,function(){return m||((p=new r.Redis((0,n.getFailFastRedisOptions)())).on("error",e=>{console.error("[IntegrationInboundQueue] rate-limiter Redis error:",e.message)}),p.connect().catch(e=>{console.error("[IntegrationInboundQueue] rate-limiter warm-up connect failed:",e.message)}),m=new i.RedisRateLimiter(p)),m}])},25253,782425,e=>{"use strict";let t=`
local key = KEYS[1]
local rate_per_min = tonumber(ARGV[1])
local burst = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])

if tokens == nil then
  tokens = burst
  ts = now
end

local elapsed_min = math.max(0, now - ts) / 60000.0
local refilled = math.min(burst, tokens + elapsed_min * rate_per_min)

local allowed = 0
local remaining = 0
local retry_after = 0

if refilled >= 1 then
  allowed = 1
  refilled = refilled - 1
  remaining = math.floor(refilled)
else
  local deficit = 1 - refilled
  retry_after = math.ceil((deficit / rate_per_min) * 60)
  if retry_after < 1 then retry_after = 1 end
end

redis.call('HMSET', key, 'tokens', tostring(refilled), 'ts', tostring(now))
redis.call('EXPIRE', key, 120)

return {allowed, remaining, retry_after}
`,r=`
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window_sec = tonumber(ARGV[2])

local count = redis.call('INCR', key)
if count == 1 then
  redis.call('EXPIRE', key, window_sec)
end

local allowed = 1
if count > limit then
  allowed = 0
end

return {allowed, count}
`;e.s(["RedisRateLimiter",0,class{redis;constructor(e){this.redis=e}async takeToken(e,r){let[n,i,a]=await this.redis.eval(t,1,e,r.ratePerMin,r.burst,Date.now());return{allowed:1===n,remaining:i,retryAfterSec:a}}async incrWindow(e,t,n){let[i,a]=await this.redis.eval(r,1,e,t,n);return{allowed:1===i,count:a}}async incr(e){return this.redis.incr(e)}async decr(e){return this.redis.decr(e)}async get(e){let t=await this.redis.get(e);return null===t?0:Number(t)}async set(e,t){await this.redis.set(e,t)}}],25253),e.s(["GlobalQueueCeilingGuard",0,class{source;clock;ceiling;cachedDepth;cachedAtMs;constructor(e,t,r){this.source=e,this.clock=t,this.ceiling=r,this.cachedDepth=null,this.cachedAtMs=-1/0}async check(){let e=this.clock.now().getTime();return(null===this.cachedDepth||e-this.cachedAtMs>=1e3)&&(this.cachedDepth=await this.source.getDepth(),this.cachedAtMs=e),{exceeded:this.cachedDepth>=this.ceiling,depth:this.cachedDepth}}},"globalQueueCeilingFromEnv",0,function(){let e=process.env.INT001_GLOBAL_QUEUE_CEILING;if(!e)return 5e3;let t=Number(e);return Number.isFinite(t)&&t>0?t:5e3}],782425)},369861,e=>{"use strict";function t(e){let t=new URL(e);return{host:t.hostname||"localhost",port:parseInt(t.port||"6379",10),...t.password?{password:decodeURIComponent(t.password)}:{},...t.username?{username:decodeURIComponent(t.username)}:{},...t.pathname&&"/"!==t.pathname?{db:parseInt(t.pathname.slice(1),10)}:{}}}function r(){return process.env.REDIS_URL??"redis://localhost:6379"}e.s(["getFailFastRedisOptions",0,function(){return{...t(r()),enableOfflineQueue:!1,maxRetriesPerRequest:1,connectTimeout:5e3,lazyConnect:!0}},"parseRedisUrl",0,t,"redisUrl",0,r])},374720,e=>{"use strict";e.i(694879);var t=e.i(224389);e.s(["createServerSupabaseClient",0,function(){return(0,t.createClient)("https://uzimqndenngebzgndlhd.supabase.co",process.env.SUPABASE_SERVICE_ROLE_KEY)}])}];

//# sourceMappingURL=%5Broot-of-the-server%5D__0ba_6rd._.js.map