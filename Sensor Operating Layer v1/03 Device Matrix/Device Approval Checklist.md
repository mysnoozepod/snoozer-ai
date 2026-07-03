# Device Approval Checklist

## Purpose

This checklist defines the standard a sensor device must meet before it can be considered for the MySnoozePod showroom.

The showroom must use production-grade equipment. Test hardware should be close to what we would actually deploy.

## Hard Requirements

A device should not be approved unless it can satisfy these requirements.

### Physical Reliability

- Can be securely mounted
- Can be protected from normal showroom contact
- Does not look like exposed hobby hardware
- Does not require loose jumper wires
- Does not rely on fragile temporary connections
- Can survive normal cleaning and showroom reset
- Can be labeled with device ID and zone ID

### Power

- Uses stable power
- Power cable can be secured
- No unsafe exposed wiring
- Can recover after power loss
- Does not require manual restart every day

### Network

- Supports a reliable connection path
- Can be identified by device ID
- Can send heartbeat or health status
- Can reconnect after network interruption
- Development and production devices can be separated

### Data Quality

- Can detect the intended zone activity
- Does not create constant false positives
- Does not frequently miss real activity
- Can support debounce or stability rules
- Produces data that can map to approved event types

### Maintenance

- Can be inspected easily
- Can be replaced without rebuilding the showroom
- Has clear reset/recovery steps
- Has clear failure symptoms
- Can be documented by Care and tested by Langston

## Immediate Rejection Signs

Reject or defer a device if it has:

- Exposed boards in customer areas
- Loose breadboard wiring
- Fragile jumper wires
- Unstable USB-only power in a permanent area
- No clear enclosure option
- No clear mounting method
- No reliable way to identify the device
- No realistic path to production deployment
- High false positive risk
- High maintenance burden
- Any need to modify checkout, cart, Shopify, pricing, or product logic

## Approval Table

| Device ID | Zone ID | Device Candidate | Approved? | Reason | Reviewer | Date |
|---|---|---|---|---|---|---|
| TBD | TBD | TBD | Yes / No / Deferred | TBD | TBD | TBD |

## Final Approval Rule

A device is not approved because it works once.

A device is approved only when it works reliably, can be mounted cleanly, can recover from failure, can be documented, and can support the approved event contract.