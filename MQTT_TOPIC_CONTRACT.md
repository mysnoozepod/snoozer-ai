# MQTT Topic Contract

<!-- LIVING_STATUS_START -->
## Current Implementation Status — 2026-07-20

- The zone event topic contract is implemented in the ingestion validator and IoT Rule design.
- The physical control bridge adds isolated per-device `commands`, `ack`, and `reported-state` topics.
- Topic/environment/store/device mismatches fail closed and are covered by tests.
- Dev and prod isolation remains mandatory; no production device may subscribe to dev commands or publish into the prod namespace without explicit provisioning.
- Live certificates, IoT policies, and edge firmware conformance remain pending commissioning.
<!-- LIVING_STATUS_END -->


Status: Phase 1 architecture contract  
Scope: AWS IoT Core MQTT topics for MySnoozePod showroom sensors  
Runtime code: not implemented in this pass

## Purpose

This document defines the MQTT topic contract for the MySnoozePod sensor and IoT layer.

AWS IoT Core is the central IoT hub. Do not introduce SmartThings, Hubitat, Home Assistant, or another consumer hub into the primary event path.

Required ingestion path:

```text
Sensor -> production edge controller -> AWS IoT Core using MQTT over TLS -> IoT Rule -> Lambda Node.js 20
```

## Base Topics

```text
mysnoozepod/{env}/stores/{storeId}/zones/{zoneId}/events
mysnoozepod/{env}/stores/{storeId}/devices/{deviceId}/heartbeat
mysnoozepod/{env}/stores/{storeId}/devices/{deviceId}/fault
mysnoozepod/{env}/stores/{storeId}/devices/{deviceId}/status
```

Where:

- `{env}` is `dev` or `prod`.
- `{storeId}` is `severn-pilot` for the MVP pilot unless explicitly changed by approved deployment config.
- `{zoneId}` is one of the locked zone IDs.
- `{deviceId}` is a registered enabled IoT device.

## Locked Zone IDs

- `entry`
- `welcome-kiosk`
- `pod-1`
- `pod-2`
- `pod-3`
- `pod-4`
- `pod-5`
- `ask-snoozer`
- `sleep-essentials-zone`
- `checkout-zone`
- `help`

## Topic Types

| Topic | Required for Phase 1 | Purpose |
| --- | --- | --- |
| `zones/{zoneId}/events` | Yes | Normalized zone events. |
| `devices/{deviceId}/heartbeat` | Yes | Device liveness. |
| `devices/{deviceId}/fault` | Yes | Device fault reporting. |
| `devices/{deviceId}/status` | Yes | Device status/config version reporting. |

## Future Command Topics

Command topics are not required for Phase 1 ingestion. If added later, use a separate command namespace:

```text
mysnoozepod/{env}/stores/{storeId}/devices/{deviceId}/commands/lighting
mysnoozepod/{env}/stores/{storeId}/devices/{deviceId}/commands/config
mysnoozepod/{env}/stores/{storeId}/devices/{deviceId}/commands/manual-override
mysnoozepod/{env}/stores/{storeId}/devices/{deviceId}/commands/diagnostics
```

Rules:

- Commands must be authorization-gated.
- Commands must never be accepted from untrusted frontend clients directly.
- Commands must be idempotent where possible.
- Command acknowledgements should publish to `devices/{deviceId}/status`.
- MVP ingestion must not depend on command topics.

## Dev Topics

Examples:

```text
mysnoozepod/dev/stores/severn-pilot/zones/pod-3/events
mysnoozepod/dev/stores/severn-pilot/devices/pod-3-edge-01/heartbeat
mysnoozepod/dev/stores/severn-pilot/devices/showroom-zone-edge-01/fault
```

Dev topics must use dev certificates, dev IoT policies, dev IoT rules, dev Lambdas, and dev DynamoDB tables.

## Prod Topics

Examples:

```text
mysnoozepod/prod/stores/severn-pilot/zones/pod-3/events
mysnoozepod/prod/stores/severn-pilot/devices/pod-3-edge-01/heartbeat
mysnoozepod/prod/stores/severn-pilot/devices/showroom-zone-edge-01/fault
```

Prod topics must use prod certificates, prod IoT policies, prod IoT rules, prod Lambdas, and prod DynamoDB tables.

## Topic Authorization

Each certificate must be scoped to only its allowed topics.

Example policy pattern for `pod-3-edge-01` in prod:

```text
Allow publish:
mysnoozepod/prod/stores/severn-pilot/zones/pod-3/events
mysnoozepod/prod/stores/severn-pilot/devices/pod-3-edge-01/heartbeat
mysnoozepod/prod/stores/severn-pilot/devices/pod-3-edge-01/fault
mysnoozepod/prod/stores/severn-pilot/devices/pod-3-edge-01/status
```

Do not allow:

- Cross-store publish.
- Cross-environment publish.
- Other device heartbeat/fault/status topics.
- Direct frontend publish.
- Wildcard publish beyond the device's assigned store/zone.

## Retained Message Policy

- Zone events: retained messages disabled.
- Heartbeat: retained messages disabled.
- Fault: retained messages disabled in Phase 1; latest fault state belongs in DynamoDB latest-state table.
- Status: retained messages disabled unless explicitly approved for device bootstrap.

AWS IoT retained messages should not be used as the customer-facing state source of truth.

## QoS Recommendation

- Publish QoS 1 for events, heartbeat, fault, and status.
- Lambda/idempotency must tolerate duplicate QoS 1 delivery.
- QoS 0 may be acceptable only for high-frequency diagnostics that are not customer-facing.

## Payload Size Expectations

- Normal event payload target: under 4 KB.
- Fault payload target: under 8 KB.
- Hard cap recommendation: under 32 KB.
- Large logs, raw traces, or firmware dumps must not be sent through ZoneEvent payloads.

## Event Ordering Limitations

MQTT ordering is not a full system ordering guarantee.

The ingestion Lambda must rely on:

- `eventId` for idempotency.
- `deviceId` and `sequence` for per-device ordering.
- `timestamp` and `receivedAt` for stale checks.

Older events must not overwrite newer latest state.

## Heartbeat Frequency

Recommended:

- Pod edge controllers: every 30 seconds.
- Shared zone controller: every 30 seconds.
- Spare edge controller when active: every 30 seconds.
- During fault or reconnect: heartbeat immediately after reconnect.

Missing heartbeat thresholds:

- Warning after 90 seconds.
- Fault after 180 seconds.
- Operator alert after 300 seconds.

These are Phase 1 recommendations and may be tuned after commissioning.

## Reconnect Behavior

On reconnect, a controller should:

1. Reconnect using MQTT over TLS.
2. Publish a `device_heartbeat` event.
3. Publish status including firmware version and config version.
4. Resume sequence with same `bootId` if state persisted.
5. Start new `bootId` if rebooted.

## Last Will Strategy

If supported, configure MQTT Last Will and Testament:

Topic:

```text
mysnoozepod/{env}/stores/{storeId}/devices/{deviceId}/fault
```

Payload:

```json
{
  "schemaVersion": "1.0",
  "eventType": "device_fault",
  "state": "error",
  "source": "edge-controller",
  "metadata": {
    "faultCode": "MQTT_DISCONNECT_UNEXPECTED"
  }
}
```

The Lambda must enrich/validate this payload before writing canonical state.

## Certificate-to-Topic Restrictions

- One certificate should belong to one physical edge controller.
- Certificate principal must be mapped to `deviceId`.
- A certificate for `pod-3-edge-01` must not publish for `pod-4-edge-01`.
- A dev certificate must not publish to prod topics.
- A prod certificate must not publish to dev topics.

## Cross-Environment Rejection

Cross-environment mismatch is rejected at two levels:

1. IoT policy should deny incorrect topic paths.
2. Lambda should reject when topic env and payload `env` differ.

## Device Replacement Behavior

Replacement workflow:

1. Disable old device or certificate.
2. Register new certificate.
3. Assign same logical `deviceId` only if the replacement is a direct swap.
4. Increment registry `configVersion`.
5. Publish status after activation.
6. Confirm latest-state table receives heartbeat.

## Example Topics

### Pod 3 Occupancy Event

```text
mysnoozepod/prod/stores/severn-pilot/zones/pod-3/events
```

### Pod 3 Heartbeat

```text
mysnoozepod/prod/stores/severn-pilot/devices/pod-3-edge-01/heartbeat
```

### Welcome Presence Event

```text
mysnoozepod/prod/stores/severn-pilot/zones/welcome-kiosk/events
```

### Checkout Presence Event

```text
mysnoozepod/prod/stores/severn-pilot/zones/checkout-zone/events
```

### Shared Zone Controller Fault

```text
mysnoozepod/prod/stores/severn-pilot/devices/showroom-zone-edge-01/fault
```
