# Render signaling deployment

Live deployment: [HTTPS health](https://droplink-signaling-62ww.onrender.com/health), WSS endpoint `wss://droplink-signaling-62ww.onrender.com/v1/signaling`. Service ID: `srv-dbn1gj8n74is73dgil6g`, free plan, Singapore region. Source: [isolated signaling repository](https://github.com/mukundjha-mj/droplink-signaling), made public with the user's explicit approval. Automatic deployment is disabled; updates are deployed deliberately after checks.

Verified: HTTPS health, authorized WSS routing, recipient-side signature/session verification and incorrect-signature rejection. Temporary cloud test identities were removed. The existing phone and PC's two public keys are provisioned in the live registry. An actual 8,388,731-byte cellular-phone → Render web relay → home-PC transfer passed pinned TLS, native completion and independent SHA-256, with one exact output. See [test evidence](REMOTE-QUEUE-TEST-2026-11-07.md). This proves the explicitly selected web relay; direct/TURN stabilization and broader background/large-file gates remain open.

Render hosts HTTPS/WSS signaling and can forward opaque inner-TLS records through the optional `/v1/relay` fallback. It cannot host a standard public UDP TURN listener on this HTTP service. Direct WebRTC remains preferred; external TURN is optional. The user declined Cloudflare billing, so no Cloudflare TURN subscription or issuer key was created.

The repository-root `render.yaml` defines a free Node web service with `apps/signaling` as root, `npm ci --include=dev && npm run build`, `npm start`, and `/health`. Render provides `PORT` and TLS termination. The CLI accepts Render's public bind only when running in that environment; local development remains loopback-only unless an operator explicitly configures a TLS proxy.

Required environment: `DROPLINK_REGISTRY_JSON` is a JSON object of trusted Ed25519 public keys and reciprocal permitted peers, exported by `droplink-agent remote-registry STATE_DIRECTORY`. An empty `{}` deploys fail-closed with no enrolled clients. The Render deployment API key is an operator credential and must never be added to this app's environment or source.

`DROPLINK_STUN_URLS=stun:stun.cloudflare.com:3478` enables public-address discovery. Optional external coturn REST credentials use `DROPLINK_TURN_URLS` (comma-separated TURN URLs) and `DROPLINK_TURN_SECRET` (at least 32 bytes, set as a protected Render environment value). The server issues authenticated devices expiring, device-scoped credentials, never the shared issuer secret. If direct/TURN fails, `DROPLINK_WEB_RELAY=1` enables the authenticated web relay. The endpoints establish pinned TLS inside WSS, keeping file contents and LAN credentials private from the broker.

`DROPLINK_RELAY_DAILY_BYTES=67108864` permits 64 MiB of forwarded TLS traffic per UTC day per process, including both directions. The allowance is held in memory and resets on process restart; it cannot guarantee a provider billing cap. Render bandwidth/build quotas and existing account billing policy still apply. This is a small demo allowance, not unlimited free file sharing. No paid instance or Cloudflare billing activation is required by this fallback.

After successful deployment:

1. Verify `https://SERVICE.onrender.com/health` returns `status: ok`.
2. Set the PC's `remote-config.json` to `{"signalingUrl":"wss://SERVICE.onrender.com/v1/signaling"}`.
3. Enroll phone identities through the pinned LAN pairing channel and export the public registry.
4. Update Render's `DROPLINK_REGISTRY_JSON` with that registry, redeploy, and let clients reconnect.
5. Verify signed routing and final SHA-256 through the selected transport. Test default-route fallback, durable resume, background delivery and target network restrictions before release.

Run one signaling instance: presence/routing live in that process; horizontal scaling needs shared routing. Native persistent replay gates remain the final replay boundary across service restarts. Registry environment values survive redeployment; uploaded/local runtime files do not. Render free instances can sleep after idle periods and take about a minute to wake, so clients must retry. An always-on paid plan is a separate choice, not selected automatically.

Source deployment should include only the signaling service, its lockfile, public test fixtures and blueprint. Never upload `.local`, `.tools`, Android signing material, Windows state, pairing invitations or private credentials.

References: [Render WebSockets](https://render.com/docs/websocket), [free-instance behavior](https://render.com/docs/free), [port/TLS handling](https://render.com/docs/web-services), [Blueprint schema](https://render.com/docs/blueprint-spec), [Cloudflare public STUN](https://developers.cloudflare.com/realtime/sfu/get-started/connection-patterns/).
