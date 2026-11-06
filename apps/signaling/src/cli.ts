import { readFileSync } from 'node:fs';
import { createSignaling } from './server.js';
import {iceCredentials} from './turn.js';
import {listenerConfig} from './runtime-config.js';
import {cloudflareIce} from './cloudflare-turn.js';
const {host,port}=listenerConfig(process.env);
const path=process.env.DROPLINK_REGISTRY;
const registry=()=>{
  const text=path?readFileSync(path,'utf8'):process.env.DROPLINK_REGISTRY_JSON!;
  if(Buffer.byteLength(text)>1048576)throw Error('Registry too large');
  return JSON.parse(text);
};
const urls=(process.env.DROPLINK_TURN_URLS??'').split(',').filter(Boolean);
const secretPath=process.env.DROPLINK_TURN_SECRET_FILE;
const turnSecret=secretPath?readFileSync(secretPath,'utf8').trim():process.env.DROPLINK_TURN_SECRET;
const stunUrls=(process.env.DROPLINK_STUN_URLS??'').split(',').filter(Boolean);
if(stunUrls.length>4||stunUrls.some(url=>url.length>512||!/^stuns?:[^\s]+$/.test(url)))throw Error('Invalid STUN configuration');
iceCredentials('0'.repeat(64),urls,turnSecret); // Validate before listening.
const cloudflareKey=process.env.DROPLINK_CF_TURN_KEY_ID,cloudflareToken=process.env.DROPLINK_CF_TURN_TOKEN;
if(Boolean(cloudflareKey)!==Boolean(cloudflareToken))throw Error('Configure both Cloudflare TURN key ID and issuer token');
if(cloudflareKey && urls.length)throw Error('Choose Cloudflare or coturn credentials, not both');
const relayDailyBytes=Number(process.env.DROPLINK_RELAY_DAILY_BYTES??67108864);
if(!Number.isSafeInteger(relayDailyBytes)||relayDailyBytes<0||relayDailyBytes>1073741824)throw Error('Invalid web relay traffic allowance');
const service=createSignaling(registry(),{webRelay:process.env.DROPLINK_WEB_RELAY==='1',relayDailyBytes,iceServers:async id=>cloudflareKey?cloudflareIce(cloudflareKey,cloudflareToken!):[...(stunUrls.length?[{urls:stunUrls,username:'',credential:''}]:[]),...iceCredentials(id,urls,turnSecret)]});
const registryRefresh=path?setInterval(()=>{try{service.replaceRegistry(registry());}catch{console.error('Registry refresh failed; retaining last valid policy.');}},2000):undefined;
await service.listen(port,host);
console.log(`DropLink signaling listening on ${host}:${port}`);
const shutdown=()=>{clearInterval(registryRefresh);void service.close().then(()=>process.exit(0));};
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
