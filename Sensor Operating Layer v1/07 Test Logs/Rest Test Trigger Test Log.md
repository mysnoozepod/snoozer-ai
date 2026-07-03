# Rest Test Trigger Test Log

## Purpose

This log tracks whether pod occupancy events can safely support Rest Test timing and guidance.

The Rest Test is a core showroom experience. Sensor triggers must support it without making it annoying or fragile.

## Test Goal

Confirm whether pod events can help Snoozer:

- Know when a shopper lies down
- Know when a shopper leaves
- Avoid starting too early
- Avoid repeating prompts
- Support rating prompts
- Continue gracefully if sensors fail

## Test Table

| Date | Tester | Pod | Device ID | Scenario | Expected Behavior | Actual Behavior | Pass/Fail | Notes |
|---|---|---|---|---|---|---|---|---|
| TBD | Langston | pod-1 | pod-1-edge-01 | Shopper lies down for 10 seconds | occupied accepted | TBD | TBD | TBD |
| TBD | Langston | pod-1 | pod-1-edge-01 | Shopper sits briefly then leaves | no Rest Test prompt | TBD | TBD | TBD |
| TBD | Langston | pod-1 | pod-1-edge-01 | Shopper leaves after test | rating/next-pod prompt candidate | TBD | TBD | TBD |

## Trigger Safety Questions

For each test, answer:

- Did the event fire too soon?
- Did the event fire too late?
- Did Snoozer interrupt the wrong moment?
- Did the trigger repeat?
- Did the system recover if the event was wrong?
- Could the shopper continue without the sensor?

## Starter Acceptance Standard

A Rest Test trigger is not approved unless:

- Occupancy detection is stable
- Vacated detection is stable
- False positives are low
- Missed events are low
- There is a cooldown
- There is a fallback path
- Ty approves the trigger

## Final Rule

Rest Test triggers must feel helpful, not creepy, jumpy, or salesy.