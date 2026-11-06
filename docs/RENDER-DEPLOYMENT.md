# Render signaling deployment

Render hosts the HTTPS/WSS signaling process. File bytes continue over peer-to-peer WebRTC or an external TURN relay; Render's HTTP web service is not the TURN server.

The repository-root `render.yaml` defines a free Node web service with `apps/signaling` as root, `npm ci --include=dev && npm run build`, `npm start`, and `/health`. Render provides `PORT` and TLS termination. The CLI accepts Render's public bind only when running in that environment; local development remains loopback-only unless an operator explicitly configures a TLS proxy.

Required environment: `DROPLINK_REGISTRY_JSON` is a JSON object of trusted Ed25519 public keys and reciprocal permitted peers, exported by `droplink-agent remote-registry STATE_DIRECTORY`. An empty `{}` deploys fail-closed with no enrolled clients. The Render deployment API key is an operator credential and must never be added to this app's environment or source.

`DROPLINK_STUN_URLS=stun:stun.cloudflare.com:3478` enables public-address discovery. Optional external coturn REST credentials use `DROPLINK_TURN_URLS` (comma-separated TURN URLs) and `DROPLINK_TURN_SECRET` (at least 32 bytes, set as a protected Render environment value). The server issues authenticated devices expiring, device-scoped credentials, never the shared issuer secret. Without TURN, restrictive networks can still prevent direct transfer.

After successful deployment:

1. Verify `https://SERVICE.onrender.com/health` returns `status: ok`.
2. Set the PC's `remote-config.json` to `{"signalingUrl":"wss://SERVICE.onrender.com/v1/signaling"}`.
3. Enroll phone identities through the pinned LAN pairing channel and export the public registry.
4. Update Render's `DROPLINK_REGISTRY_JSON` with that registry, redeploy, and let clients reconnect.
5. Verify signed routing, then queue-driven file transfer, durable resume and final SHA-256. Add/test external TURN before claiming restrictive-network support.

Run one signaling instance: presence/routing live in that process; horizontal scaling needs shared routing. Native persistent replay gates remain the final replay boundary across service restarts. Registry environment values survive redeployment; uploaded/local runtime files do not. Render free instances can sleep after idle periods and take about a minute to wake, so clients must retry. An always-on paid plan is a separate choice, not selected automatically.

Source deployment should include only the signaling service, its lockfile, public test fixtures and blueprint. Never upload `.local`, `.tools`, Android signing material, Windows state, pairing invitations or private credentials.

References: [Render WebSockets](https://render.com/docs/websocket), [free-instance behavior](https://render.com/docs/free), [port/TLS handling](https://render.com/docs/web-services), [Blueprint schema](https://render.com/docs/blueprint-spec), [Cloudflare public STUN](https://developers.cloudflare.com/realtime/sfu/get-started/connection-patterns/).
