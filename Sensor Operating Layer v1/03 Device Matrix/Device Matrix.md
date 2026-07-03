# Device Matrix

## Purpose

The Device Matrix tracks every planned, tested, approved, or rejected sensor device in the Sensor Operating Layer.

No device should be added just because it is interesting. Every device must have a clear zone, purpose, event type, owner, and test status.

## Device Naming Rules

Device IDs should be simple, stable, and tied to the zone they support.

Examples:

- entry-edge-01
- welcome-kiosk-edge-01
- pod-1-edge-01
- pod-2-edge-01
- help-edge-01

Do not rename device IDs casually after approval.

## Phase 1 Starter Matrix

| Device ID | Zone ID | Device Type | Purpose | Event Types | Power | Network | Owner | Status |
|---|---|---|---|---|---|---|---|---|
| entry-edge-01 | entry | TBD | Detect showroom entry | entered, exited, heartbeat, fault | TBD | TBD | Langston | Planned |
| welcome-kiosk-edge-01 | welcome-kiosk | TBD | Detect kiosk-area activity | entered, exited, active, idle, heartbeat, fault | TBD | TBD | Langston | Planned |
| pod-1-edge-01 | pod-1 | TBD | Detect Pod 1 occupancy | occupied, vacated, heartbeat, fault | TBD | TBD | Langston | Planned |
| pod-2-edge-01 | pod-2 | TBD | Detect Pod 2 occupancy | occupied, vacated, heartbeat, fault | TBD | TBD | Langston | Planned |
| pod-3-edge-01 | pod-3 | TBD | Detect Pod 3 occupancy | occupied, vacated, heartbeat, fault | TBD | TBD | Langston | Planned |
| pod-4-edge-01 | pod-4 | TBD | Detect Pod 4 occupancy | occupied, vacated, heartbeat, fault | TBD | TBD | Langston | Planned |
| pod-5-edge-01 | pod-5 | TBD | Detect Pod 5 occupancy | occupied, vacated, heartbeat, fault | TBD | TBD | Langston | Planned |
| pillow-edge-01 | pillow-zone | TBD | Detect pillow-zone interaction | entered, exited, touched, heartbeat, fault | TBD | TBD | Langston | Planned |
| bedding-edge-01 | bedding-zone | TBD | Detect bedding-zone interaction | entered, exited, touched, heartbeat, fault | TBD | TBD | Langston | Planned |
| checkout-edge-01 | checkout-zone | TBD | Detect checkout/support area activity | entered, exited, active, idle, heartbeat, fault | TBD | TBD | Langston | Planned |
| help-edge-01 | help-zone | TBD | Detect explicit help request | help_requested, heartbeat, fault | TBD | TBD | Langston | Planned |

## Status Values

Use these status values:

- Planned
- Researching
- Candidate
- Testing
- Approved for Pilot
- Rejected
- Deferred
- Installed
- Needs Review

## Required Device Details

Each device must eventually include:

- Device ID
- Zone ID
- Physical location
- Device type
- Manufacturer
- Model
- Power method
- Network method
- Mounting method
- Sensor purpose
- Supported event types
- Test status
- Failure notes
- Maintenance notes
- Owner

## Device Review Notes

| Date | Device ID | Review Note | Decision | Owner |
|---|---|---|---|---|
| TBD | TBD | TBD | TBD | TBD |