# Missed Event Test Log

## Purpose

This log tracks missed events.

A missed event happens when real showroom activity occurs but the sensor does not report it.

Missed events reduce trust in the Sensor Operating Layer and may prevent Snoozer from responding at the right time.

## Test Goal

Find situations where sensors fail to detect real activity.

Examples:

- Shopper lies on a pod but no occupied event is created.
- Shopper leaves a pod but no vacated event is created.
- Shopper enters a zone but no entered event is created.
- Help request is pressed but no event is created.
- Device silently fails without fault or heartbeat warning.

## Test Table

| Date | Tester | Zone ID | Device ID | Real Action | Expected Event | Actual Result | Likely Cause | Severity | Fix / Next Step |
|---|---|---|---|---|---|---|---|---|---|
| TBD | Langston | pod-1 | pod-1-edge-01 | Lie on Pod 1 | occupied | TBD | TBD | Low/Medium/High | TBD |

## Severity Guide

### Low

The miss affects reporting only.

### Medium

The miss prevents useful guidance or weakens operator awareness.

### High

The miss affects help requests, critical guidance, or reliability standards.

## Common Fixes

Possible fixes include:

- Better sensor placement
- Different sensor type
- Stronger signal processing
- Device replacement
- Stability rule adjustment
- Zone redesign
- Fallback path

## Final Rule

A sensor that frequently misses obvious activity is not production-ready.