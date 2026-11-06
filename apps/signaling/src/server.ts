import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { authBytes, nonce, validateRegistry, validateSignal, validSignature, type Registry } from './identity.js';
import type {IceServer} from './turn.js';
import {createWebRelay} from './web-relay.js';

export function createSignaling(registrations: unknown, options: { heartbeatMs?: number; authTimeoutMs?: number; iceServers?:(id:string)=>IceServer[]|Promise<IceServer[]>; webRelay?:boolean; relayDailyBytes?:number }={}) {
  let registry=validateRegistry(registrations);
  const online=new Map<string,WebSocket>();
  const replay=new Map<string,number>();
  const upgrades=new Map<string,{count:number;until:number}>();
  const http=createServer((request,response)=> {
    response.setHeader('Cache-Control','no-store');
    response.setHeader('Content-Type','application/json');
    response.writeHead(request.method==='GET' && request.url==='/health'?200:404);
    response.end(JSON.stringify(request.url==='/health'?{status:'ok',protocolVersion:1}:{error:'not_found'}));
  });
  http.requestTimeout=5000; http.headersTimeout=5000;
  const wss=new WebSocketServer({noServer:true,maxPayload:16384,perMessageDeflate:false});
  const relay=options.webRelay?createWebRelay(()=>registry,options.relayDailyBytes):undefined;
  const send=(socket:WebSocket,data:unknown)=> {
    if(socket.readyState!==WebSocket.OPEN) return;
    if(socket.bufferedAmount>262144) { socket.terminate(); return; }
    socket.send(JSON.stringify(data));
  };
  const allowed=(a:string,b:string)=>registry[a]?.peers.includes(b) && registry[b]?.peers.includes(a);
  const presence=(id:string,connected:boolean)=> {
    for(const [peer,socket] of online) if(allowed(id,peer)) send(socket,{type:'presence',deviceId:id,online:connected});
  };
  http.on('upgrade',(request,socket,head)=> {
    socket.on('error',()=>{});
    const ip=request.socket.remoteAddress ?? 'unknown', now=Date.now();
    for(const [key,entry] of upgrades) if(entry.until<=now) upgrades.delete(key);
    if(!upgrades.has(ip) && upgrades.size>=4096) {socket.destroy();return;}
    const bucket=upgrades.get(ip) ?? {count:0,until:now+60000}; bucket.count++; upgrades.set(ip,bucket);
    // Native clients only. No credentials in URL, query string or browser origin.
    if((request.url!=='/v1/signaling' && !(relay && request.url==='/v1/relay')) || request.headers.origin || bucket.count>20 || wss.clients.size>=256 || (relay?.wss.clients.size??0)>=32 || upgrades.size>4096) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    const target=request.url==='/v1/relay'?relay!.wss:wss;
    target.handleUpgrade(request,socket,head,ws=>target.emit('connection',ws));
  });
  wss.on('connection',socket=> {
    let identity:string|undefined, authenticating=false, alive=true, count=0, window=Date.now();
    const challenge=nonce();
    const timeout=setTimeout(()=>socket.terminate(),options.authTimeoutMs ?? 5000);
    send(socket,{type:'challenge',protocolVersion:1,nonce:challenge});
    const ping=setInterval(()=> {
      if(!alive) {socket.terminate();return;}
      alive=false;socket.ping();
    },options.heartbeatMs ?? 30000);
    socket.on('pong',()=>{alive=true;});
    socket.on('error',()=>{});
    socket.on('message',async(data,binary)=> {
      try {
        if(Date.now()-window>=60000) {window=Date.now();count=0;}
        if(++count>120 || binary) throw new Error('invalid_or_rate_limited');
        const message=JSON.parse(data.toString());
        if(!identity) {
          if(authenticating)throw new Error('authentication_in_progress');
          const record=registry[message.deviceId];
          if(message.type!=='authenticate' || typeof message.deviceId!=='string' || !record || !validSignature(record.publicKey,authBytes(challenge),message.signature)) throw new Error('unauthorized');
          if(online.has(message.deviceId)) throw new Error('device_already_connected');
          authenticating=true;
          const iceServers=await options.iceServers?.(message.deviceId)??[];
          if(socket.readyState!==WebSocket.OPEN)return;
          // Recheck policy and duplicate login after the asynchronous provider lookup.
          if(!registry[message.deviceId]||registry[message.deviceId]!.publicKey!==record.publicKey||online.has(message.deviceId))throw new Error('unauthorized');
          identity=message.deviceId; online.set(identity!,socket); clearTimeout(timeout);
          send(socket,{type:'authenticated',deviceId:identity,iceServers,webRelay:Boolean(relay)});
          for(const peer of record.peers) if(allowed(identity!,peer)) send(socket,{type:'presence',deviceId:peer,online:online.has(peer)});
          presence(identity!,true); return;
        }
        const signal=validateSignal(message,identity,registry);
        for(const [id,expiry] of replay) if(expiry<=Date.now()) replay.delete(id);
        const replayId=identity+':'+signal.messageId;
        if(replay.has(replayId)) throw new Error('replayed_signal');
        if(replay.size>=32768) throw new Error('capacity_exceeded');
        replay.set(replayId,signal.expiresAt);
        const target=online.get(signal.to);
        if(!target) {send(socket,{type:'delivery',messageId:signal.messageId,status:'offline'});return;}
        send(target,signal);send(socket,{type:'delivery',messageId:signal.messageId,status:'forwarded'});
      } catch(error) {
        send(socket,{type:'error',code:error instanceof Error && /^[a-z_]+$/.test(error.message)?error.message:'invalid_message'});
        socket.close(1008,'protocol violation');
      }
    });
    socket.on('close',()=> {
      clearTimeout(timeout);clearInterval(ping);
      if(identity && online.get(identity)===socket) {online.delete(identity);presence(identity,false);}
    });
  });
  return {
    isOnline(id:string) { return online.has(id); },
    async listen(port=0,host='127.0.0.1') {
      await new Promise<void>((resolve,reject)=>{http.once('error',reject);http.listen(port,host,()=>{http.removeListener('error',reject);resolve();});});
      return http.address() as AddressInfo;
    },
    replaceRegistry(value: unknown) {
      const next=validateRegistry(value), old=registry;registry=next;
      for(const [id,socket] of online) if(!next[id] || next[id]!.publicKey!==old[id]?.publicKey) socket.terminate();
    },
    async close() {
      await relay?.close();
      for(const socket of wss.clients) socket.terminate();
      await new Promise<void>(resolve=>wss.close(()=>resolve()));
      await new Promise<void>(resolve=>http.close(()=>resolve()));
    },
  };
}
