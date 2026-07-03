# False Positive Test Log

## Purpose

This log tracks false positives.

A false positive happens when a sensor reports activity that did not really happen.

False positives are dangerous because they can cause Snoozer to speak at the wrong time or create bad business data.

## Test Goal

Find situations where sensors incorrectly report activity.

Examples:

- Someone walks near a pod but does not lie down.
- A blanket, pillow, or object triggers a pod.
- Cleaning or resetting the showroom triggers events.
- A nearby zone causes overlap.
- A device reports occupied when the pod is empty.

## Test Table

| Date | Tester | Zone ID | Device ID | False Positive Scenario | Incorrect Event | Likely Cause | Severity | Fix / Next Step |
|---|---|---|---|---|---|---|---|---|
| TBD | Langston | pod-1 | pod-1-edge-01 | Walked beside pod | occupied | TBD | Low/Medium/High | TBD |

## Severity Guide

### Low

The false positive creates bad data but does not affect the shopper.

### Medium

The false positive may cause incorrect Snoozer timing or confusing operator status.

### High

The false positive could interrupt the customer, damage trust, or block a key flow.

## Common Fixes

Possible fixes include:

- Better sensor placement
- Different sensor type
- Debounce rule
- Longer stability window
- Zone boundary change
- Ignore rule
- Device rejection

## Final Rule

A sensor that constantly creates false positives is not production-ready.