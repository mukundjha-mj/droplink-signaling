import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,randomBytes} from 'node:crypto';
import WebSocket from 'ws';
import {createSignaling} from '../dist/server.js';
import {authBytes,deviceId,signalBytes,validateSignal,validateRegistry} from '../dist/identity.js';

function identity() {
  const keys=generateKeyPairSync('ed25519');
  return {...keys,id:deviceId(keys.publicKey),encoded:keys.publicKey.export({type:'spki',format:'der'}).toString('base64')};
}
function registry(a,b,c) { return {
  [a.id]:{publicKey:a.encoded,peers:[b.id]},
  [b.id]:{publicKey:b.encoded,peers:[a.id]},
  [c.id]:{publicKey:c.encoded,peers:[]},
};}
function signal(a,b,changes={}) {
  const m={type:'signal',from:a.id,to:b.id,sessionId:randomBytes(16).toString('hex'),messageId:randomBytes(16).toString('hex'),expiresAt:Date.now()+30000,kind:'offer',body:JSON.stringify({sdp:'synthetic-test-sdp'}),...changes};
  m.signature=sign(null,signalBytes(m),a.privateKey).toString('base64');return m;
}
function client(url) {
  const socket=new WebSocket(url);const queue=[];const waiting=[];
  socket.on('message',data=>{const message=JSON.parse(data);const handler=waiting.shift();if(handler)handler(message);else queue.push(message);});
  socket.on('error',()=>{});
  return {socket,send:m=>socket.send(JSON.stringify(m)),next:()=>{
    if(queue.length)return Promise.resolve(queue.shift());
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('message timeout')),2000);waiting.push(m=>{clearTimeout(timer);resolve(m);});});
  },async until(type){for(let i=0;i<10;i++){const m=await this.next();if(m.type===type)return m;}throw Error('expected '+type);}};
}
async function authenticate(c,id) {
  const challenge=await c.next();assert.equal(challenge.type,'challenge');
  c.send({type:'authenticate',deviceId:id.id,signature:sign(null,authBytes(challenge.nonce),id.privateKey).toString('base64')});
  assert.equal((await c.until('authenticated')).deviceId,id.id);
}
async function fixture(t) {
  const a=identity(),b=identity(),c=identity();const trusted=registry(a,b,c);
  const service=createSignaling(trusted);const address=await service.listen();
  t.after(()=>service.close());
  return {a,b,c,trusted,service,url:`ws://127.0.0.1:${address.port}/v1/signaling`,port:address.port};
}

test('health and paired authenticated offer/answer routing',async t=>{
  const f=await fixture(t);assert.equal((await fetch(`http://127.0.0.1:${f.port}/health`)).status,200);
  const a=client(f.url),b=client(f.url);await authenticate(a,f.a);await authenticate(b,f.b);
  const offer=signal(f.a,f.b);a.send(offer);
  assert.deepEqual(await b.until('signal'),offer);
  assert.equal((await a.until('delivery')).status,'forwarded');
  const answer=signal(f.b,f.a,{kind:'answer',sessionId:offer.sessionId});b.send(answer);
  assert.deepEqual(await a.until('signal'),answer);
});
test('wrong identity signature is rejected',async t=>{
  const f=await fixture(t),a=client(f.url);const challenge=await a.next();
  a.send({type:'authenticate',deviceId:f.a.id,signature:sign(null,authBytes(challenge.nonce),f.c.privateKey).toString('base64')});
  assert.equal((await a.until('error')).code,'unauthorized');
});
test('an old connection challenge cannot authenticate a new socket',async t=>{
  const f=await fixture(t),first=client(f.url);const challenge=await first.next();
  const signature=sign(null,authBytes(challenge.nonce),f.a.privateKey).toString('base64');first.socket.terminate();
  const second=client(f.url);await second.next();second.send({type:'authenticate',deviceId:f.a.id,signature});
  assert.equal((await second.until('error')).code,'unauthorized');
});
test('unpaired devices cannot send signaling',async t=>{
  const f=await fixture(t),a=client(f.url);await authenticate(a,f.a);a.send(signal(f.a,f.c));
  assert.equal((await a.until('error')).code,'peer_not_authorized');
});
test('offline peer returns delivery state rather than claiming forwarding',async t=>{
  const f=await fixture(t),a=client(f.url);await authenticate(a,f.a);a.send(signal(f.a,f.b));
  assert.equal((await a.until('delivery')).status,'offline');
});
test('replayed messages are rejected',async t=>{
  const f=await fixture(t),a=client(f.url);await authenticate(a,f.a);const m=signal(f.a,f.b);a.send(m);await a.until('delivery');a.send(m);
  assert.equal((await a.until('error')).code,'replayed_signal');
});
test('tampering and expired messages fail end-to-end verification',()=>{
  const a=identity(),b=identity(),c=identity(),r=validateRegistry(registry(a,b,c));const m=signal(a,b);
  assert.equal(validateSignal(m,a.id,r).from,a.id);
  assert.throws(()=>validateSignal({...m,body:'tampered'},a.id,r),/invalid_signature/);
  assert.throws(()=>validateSignal(signal(a,b,{expiresAt:Date.now()-1}),a.id,r),/invalid_signal/);
  assert.throws(()=>validateSignal({...m,from:c.id},a.id,r),/invalid_signal/);
});
test('revoked peer policy takes effect for active connections',async t=>{
  const f=await fixture(t),a=client(f.url);await authenticate(a,f.a);
  const r=registry(f.a,f.b,f.c);r[f.a.id].peers=[];f.service.replaceRegistry(r);a.send(signal(f.a,f.b));
  assert.equal((await a.until('error')).code,'peer_not_authorized');
});
test('unauthenticated clients time out',async t=>{
  const service=createSignaling({}, {authTimeoutMs:30});const address=await service.listen();t.after(()=>service.close());
  const a=client(`ws://127.0.0.1:${address.port}/v1/signaling`);await a.next();
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('not disconnected')),1000);a.socket.once('close',()=>{clearTimeout(timeout);resolve();});});
});
test('binary and oversized messages are rejected',async t=>{
  const f=await fixture(t),a=client(f.url);await authenticate(a,f.a);a.socket.send(Buffer.from('binary'));
  assert.equal((await a.until('error')).code,'invalid_or_rate_limited');
  const b=client(f.url);await b.next();const closed=new Promise(resolve=>b.socket.once('close',code=>resolve(code)));
  b.socket.send('x'.repeat(17000));assert.equal(await closed,1009);
});
test('identity IDs cannot be rebound to other public keys',()=>{
  const a=identity(),b=identity();assert.throws(()=>validateRegistry({[a.id]:{publicKey:b.encoded,peers:[]}}),/Invalid registration/);
});
