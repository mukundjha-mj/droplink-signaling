import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verify} from 'node:crypto';
import {publicKey,authBytes,validateSignal,validateRegistry} from '../dist/identity.js';
const f=JSON.parse(readFileSync(new URL('../../../protocol/remote-fixtures/identity.json',import.meta.url)));
test('shared native identity fixtures match Node auth, binding and Unicode signal signatures',()=>{
  const a=f.a,b=f.b;
  assert(verify(null,authBytes(f.nonce),publicKey(a.publicKey),Buffer.from(f.auth,'base64')));
  const bind=Buffer.from(JSON.stringify(['droplink.remote.bind.v1',f.lan,b.deviceId,a.deviceId,f.nonce]));
  assert(verify(null,bind,publicKey(a.publicKey),Buffer.from(f.binding,'base64')));
  const registry=validateRegistry({[a.deviceId]:{publicKey:a.publicKey,peers:[b.deviceId]},[b.deviceId]:{publicKey:b.publicKey,peers:[a.deviceId]}});
  assert.equal(validateSignal(f.signal,a.deviceId,registry,2000000000000).to,b.deviceId);
  assert.throws(()=>validateSignal({...f.signal,body:'modified'},a.deviceId,registry,2000000000000));
});
