# Zone Awareness Test Log

## Purpose

This test log captures whether the system can correctly detect activity in each showroom zone.

Zone awareness is the first Sensor Operating Layer milestone.

## Test Goal

Confirm whether a zone can reliably detect:

- Entry into the zone
- Exit from the zone
- Occupancy, if applicable
- Idle or active status, if applicable
- Device heartbeat
- Device fault

## Test Instructions

For each test:

1. Identify the zone.
2. Identify the device.
3. Perform the physical action.
4. Record what should have happened.
5. Record what actually happened.
6. Mark pass or fail.
7. Add notes for false positives, missed events, delay, or confusion.

## Test Table

| Date | Tester | Zone ID | Device ID | Action Tested | Expected Event | Actual Event | Pass/Fail | Notes |
|---|---|---|---|---|---|---|---|---|
| TBD | Langston | entry | entry-edge-01 | Walk into entry zone | entered | TBD | TBD | TBD |
| TBD | Langston | welcome-kiosk | welcome-kiosk-edge-01 | Stand at kiosk | entered/active | TBD | TBD | TBD |
| TBD | Langston | pod-1 | pod-1-edge-01 | Lie on Pod 1 | occupied | TBD | TBD | TBD |
| TBD | Langston | pod-1 | pod-1-edge-01 | Leave Pod 1 | vacated | TBD | TBD | TBD |

## Pass Standard

A zone passes only if detection is reliable enough to support the approved event contract.

One successful attempt is not enough.

## Notes for Care

Care should summarize repeated problems and update:

- Zone Dictionary
- Device Matrix
- Event Dictionary
- Trigger Map
- Weekly Summary