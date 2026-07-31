# Rockfall LAN Control Protocol

This document is the normative contract for controlling the Rockfall Windows overlay from a
companion device on the same local network. The desktop application owns the protocol and remains
the authoritative state holder.

Protocol version 1 exposes only four operations:

- add one mining item to the overlay;
- remove one mining item from the overlay;
- explicitly enable or disable compact mode;
- cycle the spotlight to the next selected target.

It does not expose arbitrary settings, cloud data, game files, visibility, opacity, placement, or
game-process control.

## Transport and versioning

- Transport: HTTPS/1.1 with JSON requests and responses.
- Base path: `/api/v1`.
- Default configurable TCP port: `53987`.
- JSON responses use `application/json`.
- Error responses use `application/problem+json`.
- State events use Server-Sent Events (`text/event-stream`).
- Request bodies are limited to 16 KiB.
- Android accepts at most 1 MiB for one JSON response or one SSE event. A larger payload is a
  protocol violation: abort the connection, surface the error, and do not apply partial state.
  Desktop v1 does not truncate state.
- Unknown JSON fields are ignored. Required fields with missing, invalid, or unsupported values are
  rejected.
- A route under another `/api/vN` prefix returns `unsupported_version`.

The desktop binds IPv4 `0.0.0.0` only while LAN control is enabled. It accepts loopback, RFC1918,
and IPv4 link-local peers and rejects public source addresses. It emits no CORS headers and never
accepts credentials in a URL.

## Discovery and manual connection

An enabled listener publishes DNS-SD service `_rockfall._tcp.local` with these TXT fields:

| Field      | Value                                                        |
| ---------- | ------------------------------------------------------------ |
| `api`      | `1`                                                          |
| `serverId` | Stable desktop UUID                                          |
| `pin`      | `sha256/<base64 SHA-256 digest of DER SubjectPublicKeyInfo>` |

mDNS data locates the service but is not trusted proof during first pairing. If multicast
discovery is unavailable, Rockfall Settings lists each usable address as
`https://<private-ip>:<port>` for manual entry.
Rockfall monitors private IPv4 interfaces while enabled and refreshes both the displayed endpoints
and mDNS publication after DHCP, Wi-Fi, or adapter changes.

Android passes canonical service type `_rockfall._tcp.` to `NsdManager` and uses the resolved port.
Manual entry is private IPv4 plus an optional port; omitted port means `53987`. IPv6 and bracketed
IPv6 manual addresses are not supported in protocol v1.

## TLS trust and pairing

The desktop creates one persistent self-signed P-256 certificate and protects its private key with
Electron `safeStorage`. Its pin is:

```text
sha256/<base64(SHA-256(DER SubjectPublicKeyInfo))>
```

The human comparison code is derived from that same 32-byte digest:

1. take the first 10 digest bytes;
2. encode them as 20 uppercase hexadecimal characters;
3. display five groups of four characters separated by `-`.

Example: `1D8C-5843-D7F5-537A-1CA9`. The full enrolled pin always uses all 32 digest bytes.

On first contact, Android may inspect the untrusted certificate but must not send a pairing code
yet. It computes the full pin, displays the same grouped comparison code shown in Rockfall
Settings, and requires the user to confirm that the codes match. The confirmed full pin is then
stored and enforced for the pairing request and every later HTTPS and SSE connection.

The Android LAN client uses a dedicated trust manager that accepts only the enrolled exact SPKI.
It does not modify platform/default trust. The certificate is intentionally stable while private
IPv4 addresses can change, so normal hostname verification is replaced only inside this dedicated
client by a verifier that succeeds after the exact enrolled pin matches the leaf presented by the
resolved private IPv4 endpoint. Redirects are disabled.

Certificate, private key, and `serverId` live in Electron user data and persist across app,
address, and DHCP restarts. An install that retains user data retains this identity. Deleting user
data creates a new identity. Explicit **Reset pairing identity** rotates the key, certificate,
`serverId`, and `runId`, revokes every client token, and requires Android to forget and re-pair.
Corrupt or undecryptable identity storage fails closed until that explicit reset; it never silently
replaces the pin.

The user starts one pairing session in Settings. It:

- produces one six-digit code;
- expires after five minutes;
- is consumed by one successful device;
- rejects more than three failed attempts from one address or five attempts in total.

### `GET /api/v1/info`

This is the only generally available unauthenticated route.

```json
{
  "protocolVersion": 1,
  "supportedProtocolVersions": [1],
  "server": {
    "id": "68ea238c-78ae-4dc1-a5b6-18d35e1dc625",
    "name": "Gaming-PC",
    "appVersion": "0.2.1",
    "tlsSpkiSha256": "sha256/HYxY..."
  },
  "pairing": {
    "required": true,
    "active": true
  },
  "capabilities": [
    "overlay.item.add",
    "overlay.item.remove",
    "overlay.compact.set",
    "overlay.target.cycle"
  ]
}
```

### `POST /api/v1/pairings`

Content type must be `application/json`.

```json
{
  "code": "123456",
  "client": {
    "name": "Pixel 9",
    "platform": "android",
    "appVersion": "1.0.0"
  }
}
```

`appVersion` may be `null` or omitted. A successful request returns HTTP 201:

```json
{
  "protocolVersion": 1,
  "clientId": "2145454b-c217-43f9-9f2f-36186b73933c",
  "accessToken": "<random 256-bit base64url credential>",
  "server": {
    "id": "68ea238c-78ae-4dc1-a5b6-18d35e1dc625",
    "name": "Gaming-PC",
    "appVersion": "0.2.1",
    "tlsSpkiSha256": "sha256/HYxY..."
  },
  "state": {
    "protocolVersion": 1,
    "server": {
      "id": "68ea238c-78ae-4dc1-a5b6-18d35e1dc625",
      "runId": "90c1b655-4053-48af-9181-a35fb2766aed",
      "name": "Gaming-PC",
      "appVersion": "0.2.1"
    },
    "revision": 0,
    "catalog": {
      "state": "loading",
      "message": "Refreshing mining signatures...",
      "updatedAt": null,
      "items": []
    },
    "overlay": {
      "selectedItemIds": [],
      "maxSelectedItems": 4,
      "compact": false,
      "spotlightItemId": null
    }
  }
}
```

The token is returned once. Android stores the pin, server ID, client ID, and token in
platform-secure storage. The desktop stores only the SHA-256 token digest and device metadata.
Each device has an independent token that can be revoked in Settings.
Tokens do not expire by time in v1. They remain valid until individual revocation or a desktop
identity reset.

## Authentication

All routes except `/api/v1/info` and `/api/v1/pairings` require:

```http
Authorization: Bearer <accessToken>
```

There are no cookies, cloud sessions, Discord credentials, or query-string tokens. Pairing is
independent from Rockfall Cloud.

## Authoritative state

### `GET /api/v1/state`

```json
{
  "protocolVersion": 1,
  "server": {
    "id": "68ea238c-78ae-4dc1-a5b6-18d35e1dc625",
    "runId": "90c1b655-4053-48af-9181-a35fb2766aed",
    "name": "Gaming-PC",
    "appVersion": "0.2.1"
  },
  "revision": 17,
  "catalog": {
    "state": "game",
    "message": "Loaded installed game signatures.",
    "updatedAt": "2026-07-31T12:00:00.000Z",
    "items": [
      {
        "id": "riccite-ore",
        "commodityId": "riccite-ore",
        "name": "Riccite (Ore)",
        "displayName": "Riccite (Ore)",
        "methods": ["Ship"]
      }
    ]
  },
  "overlay": {
    "selectedItemIds": ["riccite-ore"],
    "maxSelectedItems": 4,
    "compact": false,
    "spotlightItemId": null
  }
}
```

Rules:

- `catalog.items[].id` is the only command identity.
- `commodityId` groups method variants and is not guaranteed to be selectable or unique. A method
  variant can have an ID such as `riccite-ore--fps`.
- `selectedItemIds` order is authoritative and defines target-cycle order.
- Catalog state can be `loading`, `game`, `live`, `cached`, or `fallback`. Commands that require an
  item are unavailable only while the catalog is `loading`.
- `runId` changes each desktop process start and after an explicit LAN identity reset.
- `revision` is monotonic within one `runId` and changes only when the LAN-visible catalog or
  overlay state changes.
- A changed `runId` begins a new epoch. Android discards pending commands and accepts its snapshot
  even when the numeric revision is lower than the prior epoch.
- A client replaces its local state with every full state response; it does not merge snapshots.

## State events

### `GET /api/v1/events`

This authenticated request remains open as an SSE stream. The first event is always a complete
current state:

```text
event: state
id: 90c1b655-4053-48af-9181-a35fb2766aed:17
data: {"protocolVersion":1,"server":{"id":"68ea238c-78ae-4dc1-a5b6-18d35e1dc625","runId":"90c1b655-4053-48af-9181-a35fb2766aed","name":"Gaming-PC","appVersion":"0.2.1"},"revision":17,"catalog":{"state":"game","message":"Loaded installed game signatures.","updatedAt":"2026-07-31T12:00:00.000Z","items":[]},"overlay":{"selectedItemIds":[],"maxSelectedItems":4,"compact":false,"spotlightItemId":null}}

```

The server emits another complete state after a desktop control, global shortcut, material refresh,
or command from any paired device. It emits a comment keepalive every 15 seconds. Reconnecting
always produces a fresh complete state, so version 1 has no delta replay buffer; `Last-Event-ID`
does not change that behavior.

The SSE `id` is the opaque string `<runId>:<revision>`, not a numeric counter for client
arithmetic. OkHttp may not surface comment keepalives to application code; use an unlimited
streaming read timeout, reconnect on transport failure with bounded backoff, and recover from the
new connection's immediate full state.

Android should reconnect with bounded backoff and continue pinning the desktop certificate.

## Commands

### `POST /api/v1/commands`

Every command supplies the last state tuple observed by the client:

```json
{
  "requestId": "76041b3e-33e4-4a93-9d54-a03542a38691",
  "expected": {
    "runId": "90c1b655-4053-48af-9181-a35fb2766aed",
    "revision": 17
  },
  "operation": "overlay.item.add",
  "itemId": "riccite-ore"
}
```

The desktop checks the expected tuple inside the same serialized mutation queue used by local
settings changes. A stale command receives `revision_conflict` with current state. This prevents
lost updates between multiple clients and prevents an automatically retried cycle request from
cycling twice.

`requestId` must be a UUID and is echoed for correlation. Desktop v1 retains no request-ID
deduplication entries: retention is zero. For an ambiguous timeout, Android first resynchronizes.
It may retransmit the exact unchanged request and expectation, but it never rebases or automatically
replays `overlay.target.cycle` against a newly observed revision.

### `overlay.item.add`

```json
{
  "operation": "overlay.item.add",
  "itemId": "riccite-ore"
}
```

- The ID must exist in the current desktop catalog.
- It is appended to the selected order.
- Adding an already-selected ID is a successful no-op.
- Adding a fifth different item returns `selection_limit`.

### `overlay.item.remove`

```json
{
  "operation": "overlay.item.remove",
  "itemId": "riccite-ore"
}
```

- Remaining IDs keep their order.
- Removing an available but unselected ID is a successful no-op.
- Removing the spotlighted item clears the spotlight and shows all remaining items.

### `overlay.compact.set`

```json
{
  "operation": "overlay.compact.set",
  "enabled": true
}
```

This explicitly sets compact mode. It is never interpreted as a toggle.

### `overlay.target.cycle`

```json
{
  "operation": "overlay.target.cycle"
}
```

Semantics match the existing desktop shortcut:

1. With no selected items, leave `spotlightItemId` as `null` and return a no-op.
2. From all-target mode (`spotlightItemId: null`), select the first `selectedItemIds` entry.
3. Otherwise select the next entry and wrap from the last entry to the first.
4. Cycling never returns to all-target mode. "Show all" remains a separate desktop action in v1.

### Command response

```json
{
  "protocolVersion": 1,
  "requestId": "76041b3e-33e4-4a93-9d54-a03542a38691",
  "result": "applied",
  "state": {
    "protocolVersion": 1,
    "server": {
      "id": "68ea238c-78ae-4dc1-a5b6-18d35e1dc625",
      "runId": "90c1b655-4053-48af-9181-a35fb2766aed",
      "name": "Gaming-PC",
      "appVersion": "0.2.1"
    },
    "revision": 18,
    "catalog": {
      "state": "game",
      "message": "Loaded installed game signatures.",
      "updatedAt": "2026-07-31T12:00:00.000Z",
      "items": []
    },
    "overlay": {
      "selectedItemIds": ["riccite-ore"],
      "maxSelectedItems": 4,
      "compact": false,
      "spotlightItemId": null
    }
  }
}
```

`result` is `applied` or `noop`. `state` is the complete authoritative post-command state.

Set-like no-op example:

```json
{
  "protocolVersion": 1,
  "requestId": "76041b3e-33e4-4a93-9d54-a03542a38691",
  "result": "noop",
  "state": {
    "protocolVersion": 1,
    "server": {
      "id": "68ea238c-78ae-4dc1-a5b6-18d35e1dc625",
      "runId": "90c1b655-4053-48af-9181-a35fb2766aed",
      "name": "Gaming-PC",
      "appVersion": "0.2.1"
    },
    "revision": 17,
    "catalog": {
      "state": "game",
      "message": "Loaded installed game signatures.",
      "updatedAt": "2026-07-31T12:00:00.000Z",
      "items": []
    },
    "overlay": {
      "selectedItemIds": ["riccite-ore"],
      "maxSelectedItems": 4,
      "compact": false,
      "spotlightItemId": null
    }
  }
}
```

## Errors

```json
{
  "protocolVersion": 1,
  "requestId": "76041b3e-33e4-4a93-9d54-a03542a38691",
  "error": {
    "code": "revision_conflict",
    "message": "Overlay state changed before this command was applied.",
    "retryable": true,
    "details": {}
  },
  "state": {
    "protocolVersion": 1,
    "server": {
      "id": "68ea238c-78ae-4dc1-a5b6-18d35e1dc625",
      "runId": "90c1b655-4053-48af-9181-a35fb2766aed",
      "name": "Gaming-PC",
      "appVersion": "0.2.1"
    },
    "revision": 18,
    "catalog": {
      "state": "game",
      "message": "Loaded installed game signatures.",
      "updatedAt": "2026-07-31T12:00:00.000Z",
      "items": []
    },
    "overlay": {
      "selectedItemIds": ["riccite-ore"],
      "maxSelectedItems": 4,
      "compact": false,
      "spotlightItemId": "riccite-ore"
    }
  }
}
```

`requestId` is `null` when no valid command request ID was available. Authenticated state-related
errors include current `state` when useful.

| HTTP | Codes                                                                             |
| ---- | --------------------------------------------------------------------------------- |
| 400  | `invalid_json`, `invalid_request`, `unsupported_operation`, `unsupported_version` |
| 401  | `authentication_required`, `invalid_token`                                        |
| 403  | `pairing_inactive`, `pairing_rejected`, `non_lan_peer`                            |
| 404  | `route_not_found`, `item_not_found`                                               |
| 409  | `revision_conflict`, `selection_limit`, `pairing_capacity_reached`                |
| 413  | `payload_too_large`                                                               |
| 429  | `pairing_rate_limited`                                                            |
| 503  | `catalog_unavailable`, `service_stopping`                                         |
| 500  | `internal_error`                                                                  |

Internal errors never expose stack traces, credentials, or filesystem paths.

## Limits and lifecycle

- LAN control is disabled by default and opens no socket until explicitly enabled.
- The port is configurable from 1024 through 65535 while disabled.
- Up to eight devices can be paired.
- Up to sixteen SSE connections can be open.
- Request bodies over 16 KiB are rejected with HTTP 413 `payload_too_large`.
- Android rejects one response/event over 1 MiB and never applies a partial snapshot.
- Disabling LAN control closes pairing, mDNS, SSE streams, and the HTTPS listener but preserves
  paired credentials for later re-enablement.
- Paired devices remain visible and revocable in Settings while the listener is disabled.
- Revoking a device immediately closes its active event streams.
- Resetting the LAN identity stops the service, deletes every pairing, creates a new certificate
  and pin, and restarts the listener when it was enabled.
- mDNS failure is a visible degraded state; the secure listener and manual addresses remain usable.
- Listener or protected-storage failures are visible in Settings and do not prevent normal desktop
  overlay use.
- Windows users should allow Rockfall on Private networks only when the firewall prompts.

## Android implementation checklist

The Android client must:

- discover `_rockfall._tcp`, with manual IPv4 host and port fallback;
- distrust mDNS pin data until the user compares the observed TLS certificate code;
- pin the full SPKI SHA-256 value for pairing, ordinary requests, and SSE;
- derive the displayed comparison code as the first 10 digest bytes in five uppercase hex groups;
- use a dedicated exact-pin trust manager and pin-bound LAN hostname verifier without weakening
  global trust;
- store the desktop identity and per-device token securely;
- use exact `catalog.items[].id` values, not `commodityId`;
- replace local state with each full state response/event;
- send the current `(runId, revision)` with every command;
- replace state after `revision_conflict` and avoid automatically replaying a cycle against a new
  tuple;
- treat `requestId` as correlation with zero desktop dedupe retention;
- set compact mode explicitly;
- implement target-cycle semantics exactly as documented;
- ignore unknown response fields and branch on stable error codes;
- keep LAN pairing independent from Discord and Rockfall Cloud.
