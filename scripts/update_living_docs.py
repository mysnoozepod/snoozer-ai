#!/usr/bin/env python3
"""Refresh MySnoozePod living source documents with the current project state.

This script is intentionally idempotent. It replaces the marked living-status
block in each document, or inserts one directly after the first H1 when the
block does not yet exist.
"""

from __future__ import annotations

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
UPDATED = "2026-07-20"
START = "<!-- LIVING_STATUS_START -->"
END = "<!-- LIVING_STATUS_END -->"

TARGETS = {
    "AWS_DEPLOYMENT_GUIDE.md": """
## Current Implementation Status — 2026-07-20

- IoT Phases 1–7 are implemented in source: contracts, validated ingestion, DynamoDB persistence, quarantine, SAM infrastructure, WebSocket push, React zone state, experience integration, and the physical control bridge.
- The software control loop now covers command issue → MQTT publish → controller acknowledgement/reported state → DynamoDB/WebSocket → React status.
- Live AWS deployment validation remains pending because SAM CLI validation was unavailable locally and CloudFormation validation was blocked by IAM permissions.
- Deployment still requires live values and permissions for `IOT_PHYSICAL_CONTROL_TABLE`, `IOT_DATA_ENDPOINT`, DynamoDB access, IoT publish, and WebSocket `ManageConnections`.
- No physical sensor/controller fleet is commissioned yet. Cart, checkout, Shopify truth, and manual showroom flows must continue operating when IoT is disabled or unavailable.
""",
    "AWS_IOT_RESOURCE_PLAN.md": """
## Current Implementation Status — 2026-07-20

- The planned AWS IoT resources are represented in `template.yaml` and supporting Node.js 20 handlers.
- Zone event ingestion, quarantine, latest state, append-only history, WebSocket subscriptions, and physical command acknowledgement/reported-state paths are implemented in source.
- Canonical store ID remains `severn-pilot`; dev and prod topic isolation remains mandatory.
- AWS IoT Things, certificates, policies, physical controller provisioning, and showroom commissioning are not complete.
- This document remains the resource authority for deployment planning; Shopify cart and checkout remain outside IoT ownership.
""",
    "AWS_RESOURCE_INVENTORY.md": """
## Current Implementation Status — 2026-07-20

- The repository now defines the Phase 1–7 IoT resource set, including ingestion, quarantine, state/history tables, WebSocket connections, and physical-control command/state resources.
- Source-defined does not mean live-deployed. Confirm every resource in the target AWS account before marking it active.
- Physical command topics are `commands`, `ack`, and `reported-state` under the isolated environment/store/device hierarchy.
- Live hardware identities, certificates, serial numbers, and commissioned status remain pending.
- Checkout authority remains restricted to the Checkout Lounge and is not controlled by this inventory.
""",
    "AWS_ROLLBACK_GUIDE.md": """
## Current Implementation Status — 2026-07-20

- Rollback coverage now includes zone ingestion, WebSocket delivery, React live-state consumption, and the physical control bridge.
- The physical command layer must be independently disableable while sensor ingestion and all manual customer flows continue.
- No live production rollback rehearsal has been completed because the stack and physical controller fleet are not yet commissioned.
- When deployment begins, validate rollback in dev before enabling prod IoT rules or device certificates.
""",
    "DYNAMODB_ZONE_TABLE_DESIGN.md": """
## Current Implementation Status — 2026-07-20

- The latest-state and append-only event-history patterns are implemented in the IoT ingestion services and SAM template.
- Idempotent history writes, stale-event protection, command status, and latest physical reported state are covered in source and tests.
- The optional `eventType + receivedAt` GSI remains deferred.
- Live tables, capacity behavior, alarms, TTL operation, and production retention still require deployed-environment validation.
""",
    "IOT_DEVICE_REGISTRY.md": """
## Current Implementation Status — 2026-07-20

- Canonical store ID: `severn-pilot`.
- Canonical customer zones: `welcome-kiosk`, `pod-1` through `pod-5`, `ask-snoozer`, `sleep-essentials-zone`, `checkout-zone`, and `help`.
- Source registries now support event validation, WebSocket authorization, zone subscriptions, and physical command target resolution.
- Five pod edge controllers, one shared non-pod controller, and one spare remain the planned controller count.
- Physical asset tags, serial numbers, AWS IoT Things/certificates, and commissioned status remain pending and must not be guessed.
""",
    "IOT_PHASE_2_IMPLEMENTATION_SEQUENCE.md": """
## Current Implementation Status — 2026-07-20

> The original sequence below is retained as planning history. Runtime implementation has progressed beyond the document's original “not implemented” status.

Completed in source:

1. ZoneEvent schema validation and registry guardrails.
2. Node.js 20 IoT ingestion Lambda services.
3. DynamoDB latest state and append-only event history.
4. Malformed-event SQS quarantine and CloudWatch metrics.
5. SAM infrastructure and rollback documentation.
6. WebSocket connect/disconnect/subscribe/unsubscribe and zone authorization.
7. React live zone-state subscriber with cache/reconnect/stale handling.
8. Showroom experience integration for presence, occupancy, Rest Test, lighting state, and ambient audio state.
9. Physical command bridge with desired/reported state, acknowledgement, retry/timeout, persistence, and React status wiring.

Remaining work is deployment/commissioning, hardware selection and installation, live IAM/environment validation, and physical adapter integration—not another abstract IoT architecture phase.
""",
    "MQTT_TOPIC_CONTRACT.md": """
## Current Implementation Status — 2026-07-20

- The zone event topic contract is implemented in the ingestion validator and IoT Rule design.
- The physical control bridge adds isolated per-device `commands`, `ack`, and `reported-state` topics.
- Topic/environment/store/device mismatches fail closed and are covered by tests.
- Dev and prod isolation remains mandatory; no production device may subscribe to dev commands or publish into the prod namespace without explicit provisioning.
- Live certificates, IoT policies, and edge firmware conformance remain pending commissioning.
""",
    "POD_LAYOUT_MEASUREMENT_REPORT.md": """
## Current Product Status — 2026-07-20

- Pod Home, Learn, and Build now pass strict layout and text-containment validation at the actual staging content viewport `1280×585` and the shorter guard viewport `1280×560`.
- Latest validation: `127/127` Pod layout tests passed, alongside device-mode, cart-integrity, canonical Pod Builder, and production build checks.
- Navigation is readable, the product strip is compact, product imagery was removed from the shared strip, and diagnostics no longer cover customer controls.
- Learn now uses three grounded Sleep Nutrition rows, pricing without the retailer disclaimer, and three personalized “Snoozer Recommends This Mattress Because” bullets.
- Build uses a focused conditional sequence—size → base → motion/comfort when applicable → review → added—while preserving Shopify as commerce truth.
- The next product-design priority is the guided Rest Test protocol and its voice/HUD transitions. Do not reopen broad Pod sizing work without a visible regression at the locked staging viewport.
""",
    "SENSOR_TO_EXPERIENCE_TRIGGER_MAP.md": """
## Current Implementation Status — 2026-07-20

- The React experience adapter is implemented for Welcome presence refresh, Pod presence/occupancy, Rest Test eligibility/vacancy grace, Ask Snoozer proximity context, and passive awareness in Sleep Essentials/Checkout.
- Rest Test start/complete states now map to logical lighting and ambient-audio states.
- The physical control bridge can issue logical lighting/audio commands and consume acknowledgements/reported state.
- No customer-facing entry or exit automation was added.
- Real sensor thresholds, controller adapters, lighting/audio hardware, and commissioning behavior remain pending physical installation.
""",
    "WEBSOCKET_ZONE_PUSH_PLAN.md": """
## Current Implementation Status — 2026-07-20

- WebSocket connect, disconnect, subscribe, and unsubscribe handlers are implemented with showroom-device registry authorization.
- Accepted zone events broadcast only after DynamoDB persistence succeeds.
- React subscribes by authorized zone, reconnects with backoff, re-subscribes, caches last-known state, and marks stale state safely.
- Physical-control status updates can broadcast through the same zone-aware channel.
- Polling is not an approved fallback for live showroom zone state. Live endpoint deployment and `ManageConnections` permissions remain pending.
""",
    "ZONE_EVENT_SCHEMA.md": """
## Current Implementation Status — 2026-07-20

- The canonical ZoneEvent validator, topic-to-payload checks, registry checks, idempotency behavior, stale-event protection, quarantine path, and metrics are implemented and tested.
- Malformed or unauthorized events fail closed and cannot update latest state or trigger showroom behavior.
- The schema remains the contract for physical edge events; hardware vendors and firmware must conform during commissioning.
- No checkout, cart, customer identity, or Shopify truth may be placed under ZoneEvent authority.
""",
}

MASTER = f"""# MySnoozePod Technical Project Status

Last updated: {UPDATED}  
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
"""


def status_block(body: str) -> str:
    return f"{START}\n{body.strip()}\n{END}"


def inject_status(text: str, body: str) -> str:
    block = status_block(body)
    pattern = re.compile(
        rf"{re.escape(START)}.*?{re.escape(END)}",
        flags=re.DOTALL,
    )
    if pattern.search(text):
        return pattern.sub(block, text, count=1)

    lines = text.splitlines()
    insert_at = 0
    for index, line in enumerate(lines):
        if line.startswith("# "):
            insert_at = index + 1
            break
    lines[insert_at:insert_at] = ["", block, ""]
    return "\n".join(lines).rstrip() + "\n"


def main() -> None:
    missing: list[str] = []
    changed: list[str] = []

    for relative, body in TARGETS.items():
        path = ROOT / relative
        if not path.exists():
            missing.append(relative)
            continue
        original = path.read_text(encoding="utf-8")
        updated = inject_status(original, body)
        if updated != original:
            path.write_text(updated, encoding="utf-8")
            changed.append(relative)

    master_path = ROOT / "PROJECT_STATUS.md"
    existing_master = master_path.read_text(encoding="utf-8") if master_path.exists() else ""
    if existing_master != MASTER:
        master_path.write_text(MASTER, encoding="utf-8")
        changed.append("PROJECT_STATUS.md")

    if missing:
        raise SystemExit("Missing living documents: " + ", ".join(missing))

    print("Updated living documents:")
    for relative in changed:
        print(f"- {relative}")
    if not changed:
        print("- none; already current")


if __name__ == "__main__":
    main()
