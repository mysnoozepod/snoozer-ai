# Codi Handoff Packet

## Purpose

This packet is the bridge between planning/documentation and actual implementation.

Codi should not be asked to invent the sensor system. Codi should receive approved contracts, approved rules, and clear acceptance criteria.

## Handoff Status

Current status: Not ready for implementation.

Reason:

Phase 1 documentation baseline is being created. Langston still needs to validate physical zone assumptions, and Ty still needs to approve the event contract.

## Required Before Codi Builds

Before implementation, this packet must include:

- Approved Sensor Mission
- Approved Non-Negotiables
- Approved Glossary
- Approved Zone Dictionary
- Approved Event Dictionary
- Approved ZoneEvent Schema
- Approved Device Matrix
- Approved Trigger Map
- Approved Business Metrics
- One-zone proof test plan
- Acceptance criteria
- Failure behavior
- Final Codi implementation prompt

## Architecture Direction

Future implementation path:

Sensor / edge controller  
→ AWS IoT Core MQTT over TLS  
→ IoT Rule  
→ Node.js 20 Lambda validator / normalizer  
→ DynamoDB ZoneState + ZoneEvents  
→ WebSocket push  
→ React Showroom App / Snoozer HUD / Operator View

## Implementation Guardrails

Codi must not touch:

- Shopify pricing
- Shopify availability
- Product handles
- Variant IDs
- Cart logic
- Checkout logic
- Payment flow
- Existing deterministic product retrieval
- Existing showroom assessment flow unless explicitly approved

## First Implementation Target

The first build should be a one-zone proof, not the full showroom.

Recommended first target:

- Zone: pod-1
- Device: pod-1-edge-01
- Events: occupied, vacated, heartbeat, fault
- Storage: ZoneState and ZoneEvents
- Frontend: receive WebSocket push and display operator-safe zone state
- Shopper flow: must continue if sensor data is unavailable

## Codi Readiness Checklist

| Item | Status | Notes |
|---|---|---|
| Mission approved | Not ready | Ty review needed |
| Non-negotiables approved | Not ready | Ty review needed |
| Zone dictionary approved | Not ready | Langston field input needed |
| Event dictionary approved | Not ready | Ty review needed |
| ZoneEvent schema approved | Not ready | Ty review needed |
| Device matrix approved | Not ready | Hardware research needed |
| Trigger map approved | Not ready | Ty review needed |
| One-zone proof selected | Proposed | pod-1 |
| Acceptance criteria approved | Not ready | Ty review needed |

## Final Rule

Codi builds after Ty approves the handoff packet. Until then, Codi supports documentation only.