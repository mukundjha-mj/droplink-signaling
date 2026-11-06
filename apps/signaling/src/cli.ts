import { readFileSync } from 'node:fs';
import { createSignaling } from './server.js';
import {iceCredentials} from './turn.js';
import {listenerConfig} from './runtime-config.js';
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
const service=createSignaling(registry(),{iceServers:id=>[...(stunUrls.length?[{urls:stunUrls,username:'',credential:''}]:[]),...iceCredentials(id,urls,turnSecret)]});
const registryRefresh=path?setInterval(()=>{try{service.replaceRegistry(registry());}catch{console.error('Registry refresh failed; retaining last valid policy.');}},2000):undefined;
await service.listen(port,host);
console.log(`DropLink signaling listening on ${host}:${port}`);
const shutdown=()=>{clearInterval(registryRefresh);void service.close().then(()=>process.exit(0));};
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
