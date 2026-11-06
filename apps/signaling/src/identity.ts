import { createHash, createPublicKey, randomBytes, verify, type KeyObject } from 'node:crypto';

export type Registration = { publicKey: string; peers: string[] };
export type Registry = Record<string, Registration>;
export type Signal = {
  type: 'signal'; from: string; to: string; sessionId: string;
  messageId: string; expiresAt: number; kind: 'offer'|'answer'|'ice'|'close'; body: string; signature: string;
};
export const nonce = () => randomBytes(32).toString('hex');
export const deviceId = (key: KeyObject) => createHash('sha256').update(key.export({format:'der',type:'spki'})).digest('hex');
export function publicKey(encoded: string): KeyObject {
  const key=createPublicKey({key:Buffer.from(encoded,'base64'),format:'der',type:'spki'});
  if(key.asymmetricKeyType!=='ed25519') throw new Error('Ed25519 public key required');
  return key;
}
export function validateRegistry(value: unknown): Registry {
  if(!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Invalid registry');
  const entries=Object.entries(value);
  if(entries.length>10000) throw new Error('Registry too large');
  const result: Registry=Object.create(null);
  for(const [id,record] of entries) {
    const r=record as Registration;
    if(!/^[0-9a-f]{64}$/.test(id) || typeof r?.publicKey!=='string' || r.publicKey.length>512 ||
      deviceId(publicKey(r.publicKey))!==id || !Array.isArray(r.peers) || r.peers.length>64 ||
      r.peers.some(p=>typeof p!=='string' || !/^[0-9a-f]{64}$/.test(p) || p===id)) throw new Error('Invalid registration');
    result[id]={publicKey:r.publicKey,peers:[...r.peers]};
  }
  return result;
}
export const authBytes = (challenge: string) => Buffer.from(JSON.stringify(['droplink.signaling.auth.v1',challenge]));
export const signalBytes = (m: Signal) => Buffer.from(JSON.stringify(['droplink.signaling.signal.v1',m.from,m.to,m.sessionId,m.messageId,m.expiresAt,m.kind,m.body]));
export function validSignature(key: string, data: Buffer, signature: unknown): boolean {
  if(typeof signature!=='string' || !/^[A-Za-z0-9+/]{86}==$/.test(signature)) return false;
  try { return verify(null,data,publicKey(key),Buffer.from(signature,'base64')); } catch { return false; }
}
export function validateSignal(value: unknown, sender: string, registry: Registry, now=Date.now()): Signal {
  const m=value as Signal;
  if(!m || typeof m!=='object' || Array.isArray(m) || Object.keys(m).sort().join(',')!=='body,expiresAt,from,kind,messageId,sessionId,signature,to,type' || m.type!=='signal' || m.from!==sender || !/^[0-9a-f]{64}$/.test(m.to) ||
    !/^[0-9a-f]{32}$/.test(m.sessionId) || !/^[0-9a-f]{32}$/.test(m.messageId) ||
    !Number.isSafeInteger(m.expiresAt) || m.expiresAt<=now || m.expiresAt>now+60000 ||
    !['offer','answer','ice','close'].includes(m.kind) || typeof m.body!=='string' || Buffer.byteLength(m.body)>12000) throw new Error('invalid_signal');
  const source=registry[sender], target=registry[m.to];
  if(!source || !target || !source.peers.includes(m.to) || !target.peers.includes(sender)) throw new Error('peer_not_authorized');
  if(!validSignature(source.publicKey,signalBytes(m),m.signature)) throw new Error('invalid_signature');
  return m;
}
