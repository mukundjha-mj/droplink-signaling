# Development signaling service

Render deployment is supported by the repository's `render.yaml`; see [deployment setup](../../docs/RENDER-DEPLOYMENT.md). `RENDER=true` selects `0.0.0.0:$PORT` behind Render's TLS edge. Supply `DROPLINK_REGISTRY_JSON` for persisted environment-based public-key policy. External TURN remains a separate service.

Remote connectivity using Node 22 + TypeScript + ws. Native Android and Windows clients verify signed negotiation independently and connect the persistent queue through direct WebRTC, TURN, or an optional opaque web relay.

```powershell
cd apps/signaling
npm ci
npm test
npm run demo
```

The demo starts a loopback service, creates two ephemeral simulated-device identities, authenticates both, routes a signed offer and verifies it at the destination, then stops everything. No phone or cloud account is required.

## Trust and wire contract

The service takes a trusted registry of public identities and reciprocal permitted peers. It has no unauthenticated device-registration endpoint. Existing LAN capability tokens are never reused as cloud credentials. Native key creation, protected storage, QR/TLS enrollment, public registry export, WebSocket clients and queue integration exist; see [secure pairing](../../docs/SECURE-REMOTE-PAIRING.md). Real-device cloud policy must be provisioned explicitly.

Identity: Ed25519 public key encoded as base64 DER SPKI. Device ID: lowercase SHA-256 hex of DER SPKI. Registry: `{ "DEVICE_ID": { "publicKey": "BASE64_SPKI", "peers": ["OTHER_DEVICE_ID"] } }`. Both sides must permit each other. Only public metadata belongs in this file.

Connect to `/v1/signaling` without query parameters, credentials or browser Origin. Server sends `{type:"challenge",protocolVersion:1,nonce:"64-hex"}`. Reply `{type:"authenticate",deviceId,signature}`. Signature bytes are UTF-8 `JSON.stringify(["droplink.signaling.auth.v1", nonce])`, signed using Ed25519; signature encoding is standard base64. The nonce is fresh for every socket and must be answered within five seconds. Keys come only from the trusted registry.

After authentication, the service reports authorized peer presence. Connection loss is detected by ping/pong. Presence is advisory and may be stale until the heartbeat timeout; it does not prove file-transfer reachability.

Signals contain exactly `type`, `from`, `to`, `sessionId`, `messageId`, `expiresAt`, `kind`, `body`, `signature`. Type is `signal`; session/message IDs are 32 lowercase hex characters. `expiresAt` is Unix milliseconds, future but at most 60 seconds away. Kind is offer/answer/ice/close. Body is an opaque UTF-8 string, at most 12,000 bytes, reserved for connection negotiation. Sign the UTF-8 JSON array:

```text
["droplink.signaling.signal.v1",from,to,sessionId,messageId,expiresAt,kind,body]
```

The destination independently verifies using its pinned peer public key, validates expiry/session state and maintains a persistent replay ledger. Server verification alone is insufficient against a compromised signaling server. Native senders use 30-second expiry to leave clock-skew headroom under the strict 60-second validation bound.

The server forwards the original signed signal only between reciprocal peers. Delivery status says forwarded or offline. Forwarded means handed to the target WebSocket, not accepted by the target and never file delivery. No file-upload/download endpoint or offline message/file storage is implemented. Filenames, source URIs and file bytes do not belong in signaling payloads.

Signaling limits: 16 KiB frames, 120 messages/minute/socket, 20 upgrades/minute/IP, 256 simultaneous clients, bounded replay/IP maps, 256 KiB outbound buffer threshold. Binary signaling frames are rejected. Changed policy applies on subsequent signals; removing a device disconnects it. CLI registry files refresh every two seconds; environment-based policy changes require redeployment. Session/presence/replay state is ephemeral, so native endpoints enforce persistent replay/session protection across restarts.

## Manual local service

```powershell
$env:DROPLINK_REGISTRY = 'E:\path\to\trusted-public-registry.json'
npm start
```

Default endpoint is `ws://127.0.0.1:8787/v1/signaling`. CLI intentionally binds only loopback and prints no credentials or messages. Health endpoint: `GET /health`.

The free Render WSS deployment is live; see the deployment guide for its verified scope and remaining hardware checks. Plain WS is allowed only for debug loopback development. Cloudflare TURN remains optional and unconfigured: the user declined billing activation.

## Optional encrypted web relay

`DROPLINK_WEB_RELAY=1` enables `/v1/relay`. Authenticated signaling advertises `webRelay: true`. A signed offer/answer chooses `transport: web-relay`; endpoints still validate the pinned peer key and persistent session state. Each relay socket receives a fresh nonce and joins using an Ed25519 signature over UTF-8 JSON `["droplink.webrelay.join.v1",nonce,deviceId,peerId,sessionId,role]`. Roles are `send` and `receive`; both peers must be reciprocally permitted and join the same session with opposite roles.

The broker forwards opaque binary records only after both joins. Native endpoints establish a second TLS session through that pipe using the paired PC certificate pin, then authenticate the LAN capability inside TLS. The broker sees addresses, identities, timing and byte counts, but no file plaintext or LAN credential. It stores no files.

Relay limits: 8 KiB frames, 16 pairs/32 clients, 256 KiB socket buffer threshold, 25-second waiting-peer deadline, heartbeat, and live policy checks on every forwarded frame. `DROPLINK_RELAY_DAILY_BYTES` defaults to 67,108,864 total forwarded bytes per UTC day per process (both directions including TLS overhead); setting 0 disables forwarding. This in-memory allowance resets on a process restart. It is a demo traffic guard, not an account-level spending limit. Render outbound bandwidth/build quotas still apply; no new paid service or Cloudflare subscription is selected.

Documentation used through Context7: https://github.com/websockets/ws and Node 22 crypto documentation at https://nodejs.org/docs/latest-v22.x/api/crypto.html.
## Native transfer demonstration

After building Rust `droplink-remote-probe`, run `npm.cmd run demo:webrtc` here for the simulated-peer native harness. It routes signed SDP and checks loopback transfer/resume, SHA-256 and duplicate receipts. Separate native Android queue and physical cellular web-relay evidence, including open acceptance gates, is recorded in [current test results](../../docs/REMOTE-QUEUE-TEST-2026-11-07.md).

