import {createHmac} from 'node:crypto';
export type IceServer={urls:string[];username:string;credential:string};
export function iceCredentials(deviceId:string, urls:string[], secret:string|undefined, now=Date.now()):IceServer[] {
  if(!/^[0-9a-f]{64}$/.test(deviceId)||urls.length>4||urls.some(u=>u.length>512||!/^turns?:[^\s]+$/.test(u)))throw Error('Invalid TURN configuration');
  if(urls.length===0)return [];
  if(!secret || Buffer.byteLength(secret)<32)throw Error('TURN shared secret requires at least 32 bytes');
  const username=`${Math.floor(now/1000)+600}:${deviceId}`;
  return [{urls,username,credential:createHmac('sha1',secret).update(username).digest('base64')}];
}
