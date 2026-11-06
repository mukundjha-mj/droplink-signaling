import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,randomBytes} from 'node:crypto';
import WebSocket from 'ws';
import {createSignaling} from '../dist/server.js';
import {deviceId} from '../dist/identity.js';
import {relayJoinBytes} from '../dist/web-relay.js';
function identity(){const keys=generateKeyPairSync('ed25519');return {...keys,id:deviceId(keys.publicKey),encoded:keys.publicKey.export({type:'spki',format:'der'}).toString('base64')};}
async function fixture(t,budget){
 const a=identity(),b=identity(),c=identity();const registry={
  [a.id]:{publicKey:a.encoded,peers:[b.id]},[b.id]:{publicKey:b.encoded,peers:[a.id]},[c.id]:{publicKey:c.encoded,peers:[]}};
 const service=createSignaling(registry,{webRelay:true,relayDailyBytes:budget});const address=await service.listen();t.after(()=>service.close());
 return {a,b,c,service,registry,url:`ws://127.0.0.1:${address.port}/v1/relay`,session:randomBytes(16).toString('hex')};
}
function client(url){
 const socket=new WebSocket(url),queue=[],wait=[];
 socket.on('message',(bytes,binary)=>{const m=binary?Buffer.from(bytes):JSON.parse(bytes);const w=wait.shift();w?w(m):queue.push(m);});socket.on('error',()=>{});
 return {socket,send:m=>socket.send(JSON.stringify(m)),next:()=>queue.length?Promise.resolve(queue.shift()):new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('relay timeout')),2500);wait.push(m=>{clearTimeout(timer);resolve(m);});})};
}
async function join(c,own,peer,session,role,signer=own){
 const challenge=await c.next();assert.equal(challenge.type,'challenge');
 c.send({type:'join',deviceId:own.id,peerId:peer.id,sessionId:session,role,signature:sign(null,relayJoinBytes(challenge.nonce,own.id,peer.id,session,role),signer.privateKey).toString('base64')});return c.next();
}
test('relay forwards opaque binary bytes in both directions only after mutually signed joins',async t=>{
 const f=await fixture(t),a=client(f.url),b=client(f.url);
 assert.equal((await join(a,f.a,f.b,f.session,'send')).type,'joined');
 assert.equal((await join(b,f.b,f.a,f.session,'receive')).type,'joined');
 assert.equal((await a.next()).type,'ready');assert.equal((await b.next()).type,'ready');
 const bytes=randomBytes(8192);a.socket.send(bytes);assert.deepEqual(await b.next(),bytes);
 b.socket.send(Buffer.from('opaque TLS record'));assert.deepEqual(await a.next(),Buffer.from('opaque TLS record'));
});
test('relay rejects wrong signatures, unpaired identities and data before authentication',async t=>{
 const f=await fixture(t);
 assert.equal((await join(client(f.url),f.a,f.b,f.session,'send',f.c)).code,'unauthorized');
 assert.equal((await join(client(f.url),f.c,f.a,f.session,'send')).code,'unauthorized');
 const c=client(f.url);await c.next();c.socket.send(Buffer.from('data'));assert.equal((await c.next()).code,'authentication_required');
});
test('relay rejects same-role joins without destroying the waiting legitimate peer',async t=>{
 const f=await fixture(t),a=client(f.url),bad=client(f.url),b=client(f.url);
 await join(a,f.a,f.b,f.session,'send');assert.equal((await join(bad,f.b,f.a,f.session,'send')).code,'relay_session_conflict');
 await new Promise(r=>setTimeout(r,25));assert.equal(a.socket.readyState,WebSocket.OPEN);
 assert.equal((await join(b,f.b,f.a,f.session,'receive')).type,'joined');assert.equal((await a.next()).type,'ready');
});
test('relay enforces byte budget and current pairing revocation',async t=>{
 const f=await fixture(t,5),a=client(f.url),b=client(f.url);
 await join(a,f.a,f.b,f.session,'send');await join(b,f.b,f.a,f.session,'receive');await a.next();await b.next();
 a.socket.send(Buffer.alloc(5));assert.equal((await b.next()).length,5);
 a.socket.send(Buffer.alloc(1));assert.equal((await a.next()).code,'relay_budget_exhausted');
 const g=await fixture(t),x=client(g.url),y=client(g.url);
 await join(x,g.a,g.b,g.session,'send');await join(y,g.b,g.a,g.session,'receive');await x.next();await y.next();
 g.registry[g.a.id].peers=[];g.service.replaceRegistry(g.registry);x.socket.send(Buffer.from('x'));
 assert.equal((await x.next()).code,'invalid_relay_frame');
});
