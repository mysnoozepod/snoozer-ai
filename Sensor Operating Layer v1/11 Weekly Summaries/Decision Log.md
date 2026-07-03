# Decision Log

## Purpose

This file records important Sensor Operating Layer decisions so the team does not lose track of why choices were made.

Decisions should be short, clear, dated, and tied to an owner.

## Decision Rules

Log a decision when the team approves, rejects, defers, or changes something important.

Examples:

- Approved zone names
- Approved event types
- Rejected device candidate
- Approved one-zone proof
- Changed trigger rule
- Deferred pressure mapping
- Changed hardware direction
- Approved Codi handoff

## Decision Table

| Date | Decision | Reason | Owner | Status |
|---|---|---|---|---|
| 2026-07-03 | Use production-grade equipment only | Test equipment should match deployable showroom standards | Ty | Approved |
| 2026-07-03 | Start with zone awareness | Stable foundation before triggers, BI, or pressure mapping | Ty | Approved |
| 2026-07-03 | Pressure mapping only on two non-adjustable-base pods | Adjustable bases create fit and reliability issues | Ty | Approved |
| 2026-07-03 | No polling-based UI | Live zone state should use WebSocket push | Ty | Approved |
| 2026-07-03 | Codi builds only after handoff approval | Prevents Codi from guessing strategy or architecture | Ty | Approved |

## Status Values

Use these values:

- Proposed
- Approved
- Rejected
- Deferred
- Reopened
- Superseded

## Open Decisions

| Decision Needed | Why It Matters | Owner | Due |
|---|---|---|---|
| Confirm exact non-adjustable pod numbers | Needed for pressure mapping scope | Ty / Langston | TBD |
| Confirm first one-zone proof target | Needed before Codi implementation | Ty | TBD |
| Confirm help trigger hardware direction | Needed for support workflow | Ty / Langston | TBD |
| Confirm whether accessory zones are Phase 1 or Phase 2 | Needed to control scope | Ty | TBD |

## Final Rule

If a decision affects Codi, Langston, Care, hardware, AWS, triggers, or customer experience, log it here.