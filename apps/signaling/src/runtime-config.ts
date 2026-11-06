export function listenerConfig(env:NodeJS.ProcessEnv) {
  const render=env.RENDER==='true';
  const host=env.DROPLINK_HOST??(render?'0.0.0.0':'127.0.0.1');
  if(!['127.0.0.1','::1'].includes(host) && !render && env.DROPLINK_TLS_PROXY!=='1')throw Error('Public binding requires Render TLS termination or an explicitly configured TLS proxy.');
  const port=Number(env.PORT??env.DROPLINK_PORT??8787);
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid port');
  if(!env.DROPLINK_REGISTRY && !env.DROPLINK_REGISTRY_JSON)throw Error('Configure a trusted public-key registry; open registration is disabled.');
  if(env.DROPLINK_REGISTRY && env.DROPLINK_REGISTRY_JSON)throw Error('Choose one registry source.');
  return {host,port};
}
