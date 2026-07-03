# Equipment Research Notes

## Purpose

This file captures sensor and edge hardware research before any device is approved.

Research should be practical. The goal is production-grade equipment that can realistically operate in an unattended showroom.

## Research Rules

Do not research devices randomly.

Each candidate should answer:

- What zone would this support?
- What event would it detect?
- How would it be mounted?
- How would it be powered?
- How would it communicate?
- How would it recover from failure?
- What could go wrong?
- Is this close to deployable equipment?

## Candidate Device Notes

| Date | Researcher | Device / Category | Zone Use | Event Use | Pros | Risks | Status |
|---|---|---|---|---|---|---|---|
| TBD | Langston/Care | TBD | TBD | TBD | TBD | TBD | Researching |

## Categories to Research

### Pod Occupancy Detection

Possible purpose:

- Detect when a shopper lies on a mattress
- Support Rest Test timing
- Track pod dwell time

Research concerns:

- Mattress movement
- Adjustable base movement
- False positives from sitting or objects
- Wiring and mounting
- Comfort
- Reset and maintenance

### Entry / Presence Detection

Possible purpose:

- Detect showroom entry
- Track traffic
- Prepare welcome flow

Research concerns:

- People passing by
- Zone overlap
- Privacy
- Mounting height
- False positives

### Accessory Interaction

Possible purpose:

- Detect pillow or bedding engagement
- Track add-on interest

Research concerns:

- Too much noise
- Low business value
- Over-triggering Snoozer
- Maintenance

### Help Request Hardware

Possible purpose:

- Give shoppers an obvious way to request help
- Create high-priority support event

Research concerns:

- Must be simple
- Must be reliable
- Must not depend on complex interpretation
- Must recover from failure

### Edge Controller / Gateway

Possible purpose:

- Connect sensors to AWS IoT Core
- Normalize device communication
- Provide device ID and heartbeat

Research concerns:

- Secure MQTT/TLS support
- Stable power
- Enclosure
- Device identity
- Firmware management
- Reboot recovery

## Rejection Notes

| Date | Device / Category | Rejected Because | Reviewer |
|---|---|---|---|
| TBD | TBD | TBD | TBD |

## Final Rule

If the equipment looks like a prototype that would embarrass us in the showroom, it is not ready for production testing.