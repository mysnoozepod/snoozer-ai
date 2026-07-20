# MySnoozePod Technical Project Status

Last updated: 2026-07-20  
Repository: `mysnoozepod/snoozer-ai`  
Current source baseline: commit `356029c` and later documentation refresh

## Executive Summary

The showroom operating system now has a protected device layer, a complete source-level IoT control loop, repaired Shopify cart integrity, and a substantially corrected Pod Experience. The work has moved from architecture into product refinement and future physical commissioning.

## Completed

### Device and showroom control

- Device registry, device modes, route ownership, pod binding, action filtering, checkout isolation, and reset policies are implemented.
- The Snoozer HUD remains mounted at layout level and uses the required structured response contract.
- Review/staging mode works without weakening fail-closed production device behavior.

### IoT software phases 1–7

- ZoneEvent, MQTT, device registry, DynamoDB, WebSocket, and trigger-map contracts are documented.
- Node.js 20 ingestion validates topic, schema, environment, store, device, and zone.
- Latest state and append-only event history are persisted with idempotency and stale-event protection.
- Malformed events quarantine to SQS and emit CloudWatch metrics.
- SAM infrastructure and rollback guidance are present.
- WebSocket subscriptions push accepted events to authorized React clients; no polling is used.
- React caches last-known state, reconnects, re-subscribes, and degrades safely when IoT is disabled.
- Presence/occupancy state is connected to showroom experience state.
- Physical command issue, MQTT publish, acknowledgement, reported state, retries/timeouts, persistence, WebSocket status, and React wiring are implemented.

### Commerce

- Shopify cart integrity was repaired so Build, header count, Cart, refresh, and Checkout Lounge share one authoritative Shopify cart.
- Failed cart mutations do not create false local item counts or false success states.
- Checkout remains protected and isolated from IoT work.

### Pod Experience

- A real-route Playwright measurement harness now tests the actual staging content viewport instead of theoretical screen dimensions.
- Locked layout coverage includes `1280×585` and a `1280×560` guard viewport.
- Pod Home and Learn clipping is corrected with strict text-boundary assertions.
- Navigation is larger and readable; the shared product strip is compact and no longer wastes space on a mattress image.
- Learn uses three supported Sleep Nutrition categories, clean pricing, and three personalized recommendation reasons.
- Build is a focused conditional flow: size → base → motion/comfort when needed → review → added.
- Pod layout validation reached `127/127` passing scenarios at the latest product checkpoint.

## Functional but not finished

### Rest Test

- Selection and active timer states exist.
- Presence/occupancy, vacancy grace, ambient audio state, logical lighting state, pause/end controls, and 7-to-15-minute switching are present.
- The experience still needs a fully approved guided protocol: timed positions, next/previous/skip behavior, adjustable-base preset sequencing, Snoozer voice transitions, and completion/rating flow.

### Snoozer

- HUD, captions, TTS hooks, deterministic scripts, Ask Snoozer, and proximity context exist.
- Answer quality still needs refinement against the Founder Answer Pack.
- Polly production rollout, hash-based audio caching, final voice scripts, failure scripts, and premium answer behavior remain incomplete.

### Showroom app

- Core journey and Pod Experience are functional.
- Sleep Essentials/Bedding needs its final recommendation/bundle experience.
- Final full-journey staging regression, unattended recovery testing, and kiosk commissioning remain.

## Blocked by deployment or physical hardware

- Live SAM/CloudFormation validation with the correct IAM permissions.
- Live environment variables and permissions for DynamoDB, IoT Data Plane publish, and WebSocket management.
- AWS IoT Things, certificates, and policies.
- Production presence and occupancy sensors.
- Pod edge controllers and shared non-pod controller.
- Lighting controllers, ambient audio hardware, wiring, mounting, and physical command adapters.
- Real threshold tuning, fault testing, and commissioning sign-off.

## Locked rules

- Checkout is sacred and remains independent from IoT instability.
- Shopify is the real-time authority for price, availability, variants, cart, and checkout.
- S3/canon/catalog provide curated deterministic product knowledge; no product truth is guessed.
- IoT uses push, not polling.
- Dev and prod topics remain isolated.
- Physical failures degrade softly; captions and manual customer flows continue.
- No Token/admin build begins until the customer-facing app and Snoozer are ready.

## Next execution order

1. Finalize the guided Rest Test protocol and voice/HUD choreography.
2. Improve Snoozer answer quality against the Founder Answer Pack.
3. Complete Sleep Essentials/Bedding.
4. Run full customer-journey and unattended-failure regression.
5. Select and procure production hardware.
6. Deploy AWS IoT/SAM resources with validated IAM and environment configuration.
7. Provision certificates, install hardware, and commission each zone.
8. Revisit Token/admin only after the showroom customer experience is stable.

## Latest source checkpoints

- `356029c` — Pod text clipping correction and actual staging-height coverage.
- `84da2d4` — Pod visual correction.
- `4aeb5d0` — Build usability and Sleep Nutrition.
- `d29c5bd` — Guided single-stage Pod builder.
- `bd85c2b` — Shopify cart integrity repair.
- `246b7fc` — IoT physical control bridge.
- `b208390` — IoT-to-showroom experience integration.
- `fa24f74` — React live zone-state integration.
- `dffe7b5` — IoT WebSocket backend.
- `d954e8f` — AWS SAM IoT infrastructure.
- `b042a04` — IoT ingestion foundation.
- `d99d818` — IoT contracts and planning baseline.
