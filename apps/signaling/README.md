# Development signaling service

Render deployment is supported by the repository's `render.yaml`; see [deployment setup](../../docs/RENDER-DEPLOYMENT.md). `RENDER=true` selects `0.0.0.0:$PORT` behind Render's TLS edge. Supply `DROPLINK_REGISTRY_JSON` for persisted environment-based public-key policy. External TURN remains a separate service.

Remote-connectivity foundation using Node 22 + TypeScript + ws. The service routes connection metadata; the native development harness below negotiates real loopback WebRTC and transfers generated test files directly between peers. Android and Internet delivery remain pending.

```powershell
cd apps/signaling
npm ci
npm test
npm run demo
```

The demo starts a loopback service, creates two ephemeral simulated-device identities, authenticates both, routes a signed offer and verifies it at the destination, then stops everything. No phone or cloud account is required.

## Trust and wire contract

This prototype takes a trusted registry of public identities and reciprocal permitted peers. It has no unauthenticated device-registration endpoint. Existing LAN capability tokens are never reused as cloud credentials. Native key creation, protected storage, QR/TLS enrollment and public registry export now exist; see [secure pairing](../../docs/SECURE-REMOTE-PAIRING.md). Native WebSocket clients, queue integration and provisioning into the deployed service remain pending.

Identity: Ed25519 public key encoded as base64 DER SPKI. Device ID: lowercase SHA-256 hex of DER SPKI. Registry: `{ "DEVICE_ID": { "publicKey": "BASE64_SPKI", "peers": ["OTHER_DEVICE_ID"] } }`. Both sides must permit each other. Only public metadata belongs in this file.

Connect to `/v1/signaling` without query parameters, credentials or browser Origin. Server sends `{type:"challenge",protocolVersion:1,nonce:"64-hex"}`. Reply `{type:"authenticate",deviceId,signature}`. Signature bytes are UTF-8 `JSON.stringify(["droplink.signaling.auth.v1", nonce])`, signed using Ed25519; signature encoding is standard base64. The nonce is fresh for every socket and must be answered within five seconds. Keys come only from the trusted registry.

After authentication, the service reports authorized peer presence. Connection loss is detected by ping/pong. Presence is advisory and may be stale until the heartbeat timeout; it does not prove file-transfer reachability.

Signals contain exactly `type`, `from`, `to`, `sessionId`, `messageId`, `expiresAt`, `kind`, `body`, `signature`. Type is `signal`; session/message IDs are 32 lowercase hex characters. `expiresAt` is Unix milliseconds, future but at most 60 seconds away. Kind is offer/answer/ice/close. Body is an opaque UTF-8 string, at most 12,000 bytes, reserved for connection negotiation. Sign the UTF-8 JSON array:

```text
["droplink.signaling.signal.v1",from,to,sessionId,messageId,expiresAt,kind,body]
```

The destination must independently verify using its pinned peer public key, validate expiry/session state and maintain its own replay cache. Server verification alone is insufficient against a compromised signaling server. `validateSignal` verifies the envelope/signature; the native client's accepted-session state machine and destination replay handling are future integration work.

The server forwards the original signed signal only between reciprocal peers. Delivery status says forwarded or offline. Forwarded means handed to the target WebSocket, not accepted by the target and never file delivery. No file-upload/download endpoint or offline message/file storage is implemented. Filenames, source URIs and file bytes do not belong in signaling payloads.

Limits: 16 KiB frames, 120 messages/minute/socket, 20 upgrades/minute/IP, 256 simultaneous clients, bounded replay/IP maps, 256 KiB outbound buffer threshold. Binary frames are rejected. Changing policy through `replaceRegistry` takes effect on subsequent signals; removing a device disconnects it. CLI registry changes require restarting the process. Session/presence/replay state is ephemeral, so endpoints must enforce their own replay/session protection across a server restart.

## Manual local service

```powershell
$env:DROPLINK_REGISTRY = 'E:\path\to\trusted-public-registry.json'
npm start
```

Default endpoint is `ws://127.0.0.1:8787/v1/signaling`. CLI intentionally binds only loopback and prints no credentials or messages. Health endpoint: `GET /health`.

Public deployment remains a separate gate: HTTPS/WSS termination, trusted proxy/IP rate handling, controlled identity enrollment, durable metadata, monitoring, TURN credentials and capacity, security review and real network tests. Plain WS is only for local development. No infrastructure has been provisioned.

Documentation used through Context7: https://github.com/websockets/ws and Node 22 crypto documentation at https://nodejs.org/docs/latest-v22.x/api/crypto.html.
## Native transfer demonstration

After building the Rust `droplink-remote-probe` from the repository root, run `npm.cmd run demo:webrtc` here. It routes real SDP through signed signaling and carries a generated file over native loopback WebRTC, then checks interruption/resume, SHA-256 and duplicate receipt handling. The harness uses ephemeral simulated identities; Android, public WSS and TURN remain pending. Full evidence and commands: [native transport test](../../docs/WEBRTC-TEST-2026-11-06.md).

