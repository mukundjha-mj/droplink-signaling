import type {IceServer} from './turn.js';

/** Long-lived issuer token stays on the backend; only 10-minute client credentials leave it. */
export async function cloudflareIce(keyId:string,token:string,request:typeof fetch=fetch):Promise<IceServer[]> {
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(keyId)||token.length<20||token.length>512)throw Error('Invalid Cloudflare TURN configuration');
  const response=await request(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,{
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({ttl:600}),signal:AbortSignal.timeout(4000),redirect:'error',
  });
  if(!response.ok || !response.body)throw Error('TURN provider unavailable');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>16384){await reader.cancel();throw Error('TURN response exceeds limit');}chunks.push(next.value);}
  const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(!Array.isArray(data.iceServers)||data.iceServers.length>4)throw Error('Invalid TURN response');
  const allowed=/^(?:stun:stun\.cloudflare\.com:3478|turn:turn\.cloudflare\.com:(?:3478|443)\?transport=udp|turn:turn\.cloudflare\.com:3478\?transport=tcp|turns:turn\.cloudflare\.com:443\?transport=tcp)$/;
  const servers:IceServer[]=data.iceServers.map((s:unknown)=>{
    const server=s as Partial<IceServer>;
    if(!Array.isArray(server.urls)||server.urls.length>12)throw Error('Invalid TURN URLs');
    const urls=server.urls.filter((u:unknown):u is string=>typeof u==='string'&&allowed.test(u)).slice(0,4);
    const username=server.username??'',credential=server.credential??'';
    if(typeof username!=='string'||typeof credential!=='string'||username.length>256||credential.length>256)throw Error('Invalid TURN credential');
    if(urls.some(u=>u.startsWith('turn'))&&(!username||!credential))throw Error('Missing TURN credential');
    return {urls,username,credential};
  }).filter((s:IceServer)=>s.urls.length>0);
  if(!servers.some(s=>s.urls.some(url=>url.startsWith('turn'))))throw Error('TURN provider supplied no supported relay');
  return servers;
}
