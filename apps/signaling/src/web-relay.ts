import {WebSocket,WebSocketServer} from 'ws';
import {nonce,validSignature,type Registry} from './identity.js';
type Member={socket:WebSocket;id:string;peer:string;role:string};
type Pair={members:Member[];timer:NodeJS.Timeout};
export const relayJoinBytes=(challenge:string,id:string,peer:string,session:string,role:string)=>Buffer.from(JSON.stringify(['droplink.webrelay.join.v1',challenge,id,peer,session,role]));

/** Opaque peer-to-peer byte forwarding. Inner TLS is established by native endpoints. */
export function createWebRelay(registry:()=>Registry, dailyBytes=64*1024*1024) {
  const wss=new WebSocketServer({noServer:true,maxPayload:8192,perMessageDeflate:false});
  const pairs=new Map<string,Pair>();let used=0,day=Math.floor(Date.now()/86400000);
  const allowed=(a:string,b:string)=>registry()[a]?.peers.includes(b)&&registry()[b]?.peers.includes(a);
  wss.on('connection',socket=>{
    let member:Member|undefined,key:string|undefined,alive=true;
    const challenge=nonce();socket.send(JSON.stringify({type:'challenge',nonce:challenge}));
    const timeout=setTimeout(()=>socket.terminate(),5000);
    const heartbeat=setInterval(()=>{if(!alive){socket.terminate();return;}alive=false;socket.ping();},15000);
    socket.on('pong',()=>{alive=true;});socket.on('error',()=>{});
    socket.on('message',(raw,binary)=>{
      try {
        const data=Buffer.isBuffer(raw)?raw:Array.isArray(raw)?Buffer.concat(raw):Buffer.from(raw);
        if(!member){
          if(binary)throw Error('authentication_required');
          const m=JSON.parse(raw.toString());
          if(m.type!=='join'||typeof m.deviceId!=='string'||typeof m.peerId!=='string'||m.peerId===m.deviceId||!['send','receive'].includes(m.role)||!/^[0-9a-f]{32}$/.test(m.sessionId)||!allowed(m.deviceId,m.peerId))throw Error('unauthorized');
          const record=registry()[m.deviceId];
          if(!record||!validSignature(record.publicKey,relayJoinBytes(challenge,m.deviceId,m.peerId,m.sessionId,m.role),m.signature))throw Error('unauthorized');
          if(Math.floor(Date.now()/86400000)!==day){day=Math.floor(Date.now()/86400000);used=0;}
          if(used>=dailyBytes)throw Error('relay_budget_exhausted');
          key=m.sessionId+':'+[m.deviceId,m.peerId].sort().join(':');
          let pair=pairs.get(key);
          if(!pair){
            if(pairs.size>=16)throw Error('relay_capacity');
            const pairKey=key;
            pair={members:[],timer:setTimeout(()=>{const waiting=pairs.get(pairKey);if(waiting)for(const m of waiting.members)m.socket.close(1008,'peer timeout');},25000)};
            pairs.set(key,pair);
          }
          if(pair.members.length>=2||pair.members.some(p=>p.id===m.deviceId||p.role===m.role))throw Error('relay_session_conflict');
          member={socket,id:m.deviceId,peer:m.peerId,role:m.role};pair.members.push(member);clearTimeout(timeout);
          socket.send(JSON.stringify({type:'joined'}));
          if(pair.members.length===2){clearTimeout(pair.timer);for(const p of pair.members)p.socket.send(JSON.stringify({type:'ready'}));}
          return;
        }
        if(!binary||data.length===0||data.length>8192||!allowed(member.id,member.peer))throw Error('invalid_relay_frame');
        const target=pairs.get(key!)?.members.find(p=>p.id===member!.peer)?.socket;
        if(!target||target.readyState!==WebSocket.OPEN)throw Error('relay_peer_missing');
        if(used+data.length>dailyBytes)throw Error('relay_budget_exhausted');
        used+=data.length;
        if(target.bufferedAmount>262144)throw Error('relay_backpressure');
        socket.pause();target.send(data,{binary:true},error=>{if(error)socket.close(1011,'relay write failed');else if(socket.readyState===WebSocket.OPEN)socket.resume();});
      }catch(error){
        socket.send(JSON.stringify({type:'error',code:error instanceof Error?error.message:'relay_error'}));socket.close(1008,'relay rejected');
      }
    });
    socket.on('close',()=>{
      clearTimeout(timeout);clearInterval(heartbeat);
      if(key){const pair=pairs.get(key);if(pair?.members.some(m=>m.socket===socket)){pairs.delete(key);clearTimeout(pair.timer);for(const peer of pair.members)if(peer.socket!==socket)peer.socket.close(1000,'peer left');}}
    });
  });
  return {wss,async close(){for(const pair of pairs.values())clearTimeout(pair.timer);for(const socket of wss.clients)socket.terminate();await new Promise<void>(resolve=>wss.close(()=>resolve()));}};
}
