# IoT Device Registry Contract

<!-- LIVING_STATUS_START -->
## Current Implementation Status — 2026-07-20

- Canonical store ID: `severn-pilot`.
- Canonical customer zones: `welcome-kiosk`, `pod-1` through `pod-5`, `ask-snoozer`, `sleep-essentials-zone`, `checkout-zone`, and `help`.
- Source registries now support event validation, WebSocket authorization, zone subscriptions, and physical command target resolution.
- Five pod edge controllers, one shared non-pod controller, and one spare remain the planned controller count.
- Physical asset tags, serial numbers, AWS IoT Things/certificates, and commissioned status remain pending and must not be guessed.
<!-- LIVING_STATUS_END -->


Status: Phase 1 architecture contract  
Scope: Production and dev IoT device registry for the MySnoozePod showroom  
Runtime code: not implemented in this pass

## Purpose

The IoT device registry defines physical edge controllers, attached sensors, outputs, MQTT topics, and certificate ownership.

Device identity is separate from:

- Shopper identity.
- Snooze Code.
- Session identity.
- Customer Profile OS.

## Canonical Device Record

```json
{
  "deviceId": "pod-3-edge-01",
  "deviceType": "pod-edge-controller",
  "env": "prod",
  "storeId": "severn-pilot",
  "zoneId": "pod-3",
  "podId": "pod-3",
  "thingName": "msp-prod-severn-pilot-pod-3-edge-01",
  "certificateId": "string",
  "firmwareVersion": "1.0.0",
  "networkType": "ethernet-poe",
  "enabled": true,
  "sensors": [
    {
      "sensorId": "pod-3-presence-01",
      "sensorType": "mmwave-presence",
      "inputChannel": "uart-1",
      "enabled": true
    },
    {
      "sensorId": "pod-3-occupancy-01",
      "sensorType": "bed-occupancy",
      "inputChannel": "digital-1",
      "enabled": true
    }
  ],
  "outputs": [
    {
      "outputId": "pod-3-lighting-01",
      "outputType": "lighting-zone",
      "outputChannel": "relay-1",
      "enabled": true
    }
  ],
  "mqtt": {
    "eventTopic": "mysnoozepod/prod/stores/severn-pilot/zones/pod-3/events",
    "heartbeatTopic": "mysnoozepod/prod/stores/severn-pilot/devices/pod-3-edge-01/heartbeat",
    "faultTopic": "mysnoozepod/prod/stores/severn-pilot/devices/pod-3-edge-01/fault",
    "statusTopic": "mysnoozepod/prod/stores/severn-pilot/devices/pod-3-edge-01/status"
  },
  "configVersion": 1
}
```

## Required Fields

| Field | Required | Rule |
| --- | --- | --- |
| `deviceId` | Yes | Unique logical controller ID. |
| `deviceType` | Yes | Approved device type. |
| `env` | Yes | `dev` or `prod`. |
| `storeId` | Yes | `severn-pilot` for MVP. |
| `zoneId` | Yes | Locked zone ID. |
| `podId` | Required for pod controllers | `pod-1` through `pod-5`, otherwise null. |
| `thingName` | Yes | AWS IoT Thing name. |
| `certificateId` | Yes in deployed env | Certificate identifier or placeholder before provisioning. |
| `firmwareVersion` | Yes | Semantic version when known. |
| `networkType` | Yes | Example: `ethernet-poe`. |
| `enabled` | Yes | Boolean. |
| `sensors` | Yes | Array; may be empty only for spare. |
| `outputs` | Yes | Array; may be empty. |
| `mqtt` | Yes | Topic set for the device. |
| `configVersion` | Yes | Integer, starts at 1. |

## Optional Fields

- `label`
- `serialNumber`
- `assetTag`
- `installedAt`
- `lastCommissionedAt`
- `notes`
- `replacementFor`
- `hardwareRevision`
- `owner`

## Naming Rules

### Device IDs

Format:

```text
{zone-or-role}-edge-01
```

Examples:

- `pod-1-edge-01`
- `showroom-zone-edge-01`
- `spare-edge-01`

### Thing Names

Format:

```text
msp-{env}-{storeId}-{deviceId}
```

Example:

```text
msp-prod-severn-pilot-pod-3-edge-01
```

### Sensor IDs

Format:

```text
{zoneId}-{sensor-purpose}-01
```

Examples:

- `pod-3-presence-01`
- `pod-3-occupancy-01`
- `checkout-zone-presence-01`

### Output IDs

Format:

```text
{zoneId}-{output-purpose}-01
```

Example:

```text
pod-3-lighting-01
```

## Device Types

- `pod-edge-controller`
- `shared-zone-controller`
- `spare-edge-controller`

## Sensor Types

- `mmwave-presence`
- `bed-occupancy`
- `device-heartbeat`
- `device-fault`

## Output Types

- `lighting-zone`
- `ambient-audio`
- `status-indicator`

## Pod Bindings

Pod controllers must bind exactly one pod:

| Device | Zone | Pod |
| --- | --- | --- |
| `pod-1-edge-01` | `pod-1` | `pod-1` |
| `pod-2-edge-01` | `pod-2` | `pod-2` |
| `pod-3-edge-01` | `pod-3` | `pod-3` |
| `pod-4-edge-01` | `pod-4` | `pod-4` |
| `pod-5-edge-01` | `pod-5` | `pod-5` |

## Shared-Zone Controller Bindings

`showroom-zone-edge-01` owns non-pod presence zones:

- `entry`
- `welcome-kiosk`
- `ask-snoozer`
- `sleep-essentials-zone`
- `checkout-zone`
- `help`

It may also own the showroom ambient audio output.

## Enabled and Disabled Behavior

Disabled devices:

- Must not update latest zone state.
- Must not trigger WebSocket broadcasts.
- Must not trigger customer-facing HUD or React behavior.
- May write a rejected/quarantine record for diagnostics.
- Must emit CloudWatch metric `ZoneEventDisabledDeviceRejected`.

## Certificate Ownership

- One certificate should map to one physical controller.
- Certificate ownership must not imply shopper identity.
- Certificate subject/principal should be mapped to `thingName` and `deviceId`.
- Certs are environment-specific.

## Certificate Rotation

Rotation process:

1. Provision new certificate.
2. Attach least-privilege IoT policy.
3. Update registry certificate ID.
4. Deploy new cert to controller.
5. Confirm heartbeat.
6. Disable old certificate.
7. Retain old cert ID in audit notes.

## Replacement Device Workflow

1. Mark old device disabled or under maintenance.
2. Provision replacement hardware.
3. Assign certificate.
4. Preserve logical `deviceId` only for direct hardware replacement.
5. Increment `configVersion`.
6. Confirm status topic includes new firmware/hardware details.
7. Verify WebSocket latest-state updates.

## Firmware Version Handling

- Firmware must report semantic version in status and events where possible.
- Ingestion should accept known minimum versions only after Phase 2 policy is defined.
- Unknown firmware should be accepted only in dev or commissioning mode.
- Firmware version must never alter cart, checkout, pricing, or product truth.

## Config Versioning and Stale Config

- `configVersion` increments on registry changes.
- Device status must include its active config version.
- If controller reports stale config, ingestion may accept events but should emit operator warning.
- Critical stale config may disable derived events while preserving raw diagnostics.

## Missing Device Behavior

Unknown `deviceId`:

- Reject event.
- Quarantine payload.
- Emit metric.
- Do not update latest state.
- Do not broadcast.

## Registry Ownership

The registry should be owned by engineering/operations, not firmware alone.

Registry changes should require:

- Review.
- Versioning.
- Environment separation.
- Rollback path.

## Planned Devices

### pod-1-edge-01

```json
{
  "deviceId": "pod-1-edge-01",
  "deviceType": "pod-edge-controller",
  "env": "prod",
  "storeId": "severn-pilot",
  "zoneId": "pod-1",
  "podId": "pod-1",
  "thingName": "msp-prod-severn-pilot-pod-1-edge-01",
  "certificateId": "TBD",
  "firmwareVersion": "1.0.0",
  "networkType": "ethernet-poe",
  "enabled": true,
  "sensors": [
    { "sensorId": "pod-1-presence-01", "sensorType": "mmwave-presence", "inputChannel": "uart-1", "enabled": true },
    { "sensorId": "pod-1-occupancy-01", "sensorType": "bed-occupancy", "inputChannel": "digital-1", "enabled": true }
  ],
  "outputs": [
    { "outputId": "pod-1-lighting-01", "outputType": "lighting-zone", "outputChannel": "relay-1", "enabled": true }
  ],
  "mqtt": {
    "eventTopic": "mysnoozepod/prod/stores/severn-pilot/zones/pod-1/events",
    "heartbeatTopic": "mysnoozepod/prod/stores/severn-pilot/devices/pod-1-edge-01/heartbeat",
    "faultTopic": "mysnoozepod/prod/stores/severn-pilot/devices/pod-1-edge-01/fault",
    "statusTopic": "mysnoozepod/prod/stores/severn-pilot/devices/pod-1-edge-01/status"
  },
  "configVersion": 1
}
```

### pod-2-edge-01

```json
{
  "deviceId": "pod-2-edge-01",
  "deviceType": "pod-edge-controller",
  "env": "prod",
  "storeId": "severn-pilot",
  "zoneId": "pod-2",
  "podId": "pod-2",
  "thingName": "msp-prod-severn-pilot-pod-2-edge-01",
  "certificateId": "TBD",
  "firmwareVersion": "1.0.0",
  "networkType": "ethernet-poe",
  "enabled": true,
  "sensors": [
    { "sensorId": "pod-2-presence-01", "sensorType": "mmwave-presence", "inputChannel": "uart-1", "enabled": true },
    { "sensorId": "pod-2-occupancy-01", "sensorType": "bed-occupancy", "inputChannel": "digital-1", "enabled": true }
  ],
  "outputs": [
    { "outputId": "pod-2-lighting-01", "outputType": "lighting-zone", "outputChannel": "relay-1", "enabled": true }
  ],
  "mqtt": {
    "eventTopic": "mysnoozepod/prod/stores/severn-pilot/zones/pod-2/events",
    "heartbeatTopic": "mysnoozepod/prod/stores/severn-pilot/devices/pod-2-edge-01/heartbeat",
    "faultTopic": "mysnoozepod/prod/stores/severn-pilot/devices/pod-2-edge-01/fault",
    "statusTopic": "mysnoozepod/prod/stores/severn-pilot/devices/pod-2-edge-01/status"
  },
  "configVersion": 1
}
```

### pod-3-edge-01

Use the canonical example above.

### pod-4-edge-01

```json
{
  "deviceId": "pod-4-edge-01",
  "deviceType": "pod-edge-controller",
  "env": "prod",
  "storeId": "severn-pilot",
  "zoneId": "pod-4",
  "podId": "pod-4",
  "thingName": "msp-prod-severn-pilot-pod-4-edge-01",
  "certificateId": "TBD",
  "firmwareVersion": "1.0.0",
  "networkType": "ethernet-poe",
  "enabled": true,
  "sensors": [
    { "sensorId": "pod-4-presence-01", "sensorType": "mmwave-presence", "inputChannel": "uart-1", "enabled": true },
    { "sensorId": "pod-4-occupancy-01", "sensorType": "bed-occupancy", "inputChannel": "digital-1", "enabled": true }
  ],
  "outputs": [
    { "outputId": "pod-4-lighting-01", "outputType": "lighting-zone", "outputChannel": "relay-1", "enabled": true }
  ],
  "mqtt": {
    "eventTopic": "mysnoozepod/prod/stores/severn-pilot/zones/pod-4/events",
    "heartbeatTopic": "mysnoozepod/prod/stores/severn-pilot/devices/pod-4-edge-01/heartbeat",
    "faultTopic": "mysnoozepod/prod/stores/severn-pilot/devices/pod-4-edge-01/fault",
    "statusTopic": "mysnoozepod/prod/stores/severn-pilot/devices/pod-4-edge-01/status"
  },
  "configVersion": 1
}
```

### pod-5-edge-01

```json
{
  "deviceId": "pod-5-edge-01",
  "deviceType": "pod-edge-controller",
  "env": "prod",
  "storeId": "severn-pilot",
  "zoneId": "pod-5",
  "podId": "pod-5",
  "thingName": "msp-prod-severn-pilot-pod-5-edge-01",
  "certificateId": "TBD",
  "firmwareVersion": "1.0.0",
  "networkType": "ethernet-poe",
  "enabled": true,
  "sensors": [
    { "sensorId": "pod-5-presence-01", "sensorType": "mmwave-presence", "inputChannel": "uart-1", "enabled": true },
    { "sensorId": "pod-5-occupancy-01", "sensorType": "bed-occupancy", "inputChannel": "digital-1", "enabled": true }
  ],
  "outputs": [
    { "outputId": "pod-5-lighting-01", "outputType": "lighting-zone", "outputChannel": "relay-1", "enabled": true }
  ],
  "mqtt": {
    "eventTopic": "mysnoozepod/prod/stores/severn-pilot/zones/pod-5/events",
    "heartbeatTopic": "mysnoozepod/prod/stores/severn-pilot/devices/pod-5-edge-01/heartbeat",
    "faultTopic": "mysnoozepod/prod/stores/severn-pilot/devices/pod-5-edge-01/fault",
    "statusTopic": "mysnoozepod/prod/stores/severn-pilot/devices/pod-5-edge-01/status"
  },
  "configVersion": 1
}
```

### showroom-zone-edge-01

```json
{
  "deviceId": "showroom-zone-edge-01",
  "deviceType": "shared-zone-controller",
  "env": "prod",
  "storeId": "severn-pilot",
  "zoneId": "help",
  "podId": null,
  "thingName": "msp-prod-severn-pilot-showroom-zone-edge-01",
  "certificateId": "TBD",
  "firmwareVersion": "1.0.0",
  "networkType": "ethernet-poe",
  "enabled": true,
  "sensors": [
    { "sensorId": "entry-presence-01", "sensorType": "mmwave-presence", "inputChannel": "uart-1", "enabled": true },
    { "sensorId": "welcome-kiosk-presence-01", "sensorType": "mmwave-presence", "inputChannel": "uart-2", "enabled": true },
    { "sensorId": "ask-snoozer-presence-01", "sensorType": "mmwave-presence", "inputChannel": "uart-3", "enabled": true },
    { "sensorId": "sleep-essentials-zone-presence-01", "sensorType": "mmwave-presence", "inputChannel": "uart-4", "enabled": true },
    { "sensorId": "checkout-zone-presence-01", "sensorType": "mmwave-presence", "inputChannel": "uart-5", "enabled": true },
    { "sensorId": "help-presence-01", "sensorType": "mmwave-presence", "inputChannel": "uart-6", "enabled": true }
  ],
  "outputs": [
    { "outputId": "showroom-ambient-audio-01", "outputType": "ambient-audio", "outputChannel": "audio-1", "enabled": true }
  ],
  "mqtt": {
    "eventTopic": "mysnoozepod/prod/stores/severn-pilot/zones/{zoneId}/events",
    "heartbeatTopic": "mysnoozepod/prod/stores/severn-pilot/devices/showroom-zone-edge-01/heartbeat",
    "faultTopic": "mysnoozepod/prod/stores/severn-pilot/devices/showroom-zone-edge-01/fault",
    "statusTopic": "mysnoozepod/prod/stores/severn-pilot/devices/showroom-zone-edge-01/status"
  },
  "configVersion": 1
}
```

### spare-edge-01

```json
{
  "deviceId": "spare-edge-01",
  "deviceType": "spare-edge-controller",
  "env": "prod",
  "storeId": "severn-pilot",
  "zoneId": "help",
  "podId": null,
  "thingName": "msp-prod-severn-pilot-spare-edge-01",
  "certificateId": "TBD",
  "firmwareVersion": "1.0.0",
  "networkType": "ethernet-poe",
  "enabled": false,
  "sensors": [],
  "outputs": [],
  "mqtt": {
    "eventTopic": "mysnoozepod/prod/stores/severn-pilot/zones/{zoneId}/events",
    "heartbeatTopic": "mysnoozepod/prod/stores/severn-pilot/devices/spare-edge-01/heartbeat",
    "faultTopic": "mysnoozepod/prod/stores/severn-pilot/devices/spare-edge-01/fault",
    "statusTopic": "mysnoozepod/prod/stores/severn-pilot/devices/spare-edge-01/status"
  },
  "configVersion": 1
}
```

## Environment Isolation

- Dev and prod registries must be separate.
- Dev devices use dev certs and dev topics.
- Prod devices use prod certs and prod topics.
- Registry tooling must fail closed on environment mismatch.
