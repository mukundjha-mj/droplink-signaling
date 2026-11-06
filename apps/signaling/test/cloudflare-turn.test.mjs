import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudflareIce} from '../dist/cloudflare-turn.js';
test('Cloudflare adapter requests short-lived credentials and returns bounded native-compatible ICE servers',async()=>{
  const issuer='test-only-issuer-token-12345';
  const servers=await cloudflareIce('test-key',issuer,async(url,options)=>{
    assert.match(url,/^https:\/\/rtc\.live\.cloudflare\.com\/v1\/turn\/keys\/test-key\/credentials\/generate-ice-servers$/);
    assert.equal(options.headers.Authorization,`Bearer ${issuer}`);assert.deepEqual(JSON.parse(options.body),{ttl:600});
    return new Response(JSON.stringify({iceServers:[{urls:['stun:stun.cloudflare.com:3478']},{urls:['turn:turn.cloudflare.com:3478?transport=udp','turn:turn.cloudflare.com:443?transport=udp','turn:turn.cloudflare.com:3478?transport=tcp','turn:turn.cloudflare.com:80?transport=tcp','turns:turn.cloudflare.com:5349?transport=tcp','turns:turn.cloudflare.com:443?transport=tcp'],username:'issued-user',credential:'issued-password'}]}),{status:201});
  });
  assert.equal(servers[1].urls.length,4);assert.equal(servers[0].username,'');assert(!JSON.stringify(servers).includes(issuer));
});
test('Cloudflare errors and malformed/oversized provider responses fail closed',async()=>{
  const token='test-only-issuer-token-12345';
  await assert.rejects(()=>cloudflareIce('key',token,async()=>new Response('{}',{status:401})));
  await assert.rejects(()=>cloudflareIce('key',token,async()=>new Response(JSON.stringify({iceServers:[{urls:['turn:evil.invalid:3478'],username:'a',credential:'b'}]}))));
  await assert.rejects(()=>cloudflareIce('key',token,async()=>new Response('x'.repeat(16385))));
});
