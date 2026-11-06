import test from 'node:test';
import assert from 'node:assert/strict';
import {listenerConfig} from '../dist/runtime-config.js';
import {iceCredentials} from '../dist/turn.js';
import {createHmac} from 'node:crypto';
test('Render listener uses assigned PORT and all-interface binding behind TLS edge',()=>{
  assert.deepEqual(listenerConfig({RENDER:'true',PORT:'10000',DROPLINK_REGISTRY_JSON:'{}'}),{host:'0.0.0.0',port:10000});
  assert.throws(()=>listenerConfig({DROPLINK_HOST:'0.0.0.0',DROPLINK_REGISTRY_JSON:'{}'}));
  assert.throws(()=>listenerConfig({RENDER:'true',PORT:'invalid',DROPLINK_REGISTRY_JSON:'{}'}));
  assert.throws(()=>listenerConfig({RENDER:'true'}));
  assert.throws(()=>listenerConfig({DROPLINK_REGISTRY:'a',DROPLINK_REGISTRY_JSON:'{}'}));
});
test('TURN credentials are device scoped, expiring HMAC credentials without exposing issuer secret',()=>{
  const secret='test-only-secret-'.repeat(4),id='a'.repeat(64);
  const [server]=iceCredentials(id,['turn:127.0.0.1:3478'],secret,2000000000000);
  assert.equal(server.username,`2000000600:${id}`);
  assert.equal(server.credential,createHmac('sha1',secret).update(server.username).digest('base64'));
  assert(!JSON.stringify(server).includes(secret));
  assert.throws(()=>iceCredentials(id,['turn:127.0.0.1'],'short'));
  assert.deepEqual(iceCredentials(id,[],undefined),[]);
});
