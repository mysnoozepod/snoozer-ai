# MySnoozePod Showroom Deployment Sequence

Version: 1.0  
Status: Living deployment sequence  
Last updated: 2026-07-16

## Purpose

This document defines the recommended deployment order for the locked MySnoozePod MVP showroom. It coordinates physical installation, device registry preparation, network readiness, local reset/device behavior, and future IoT readiness without changing checkout, Shopify, cart truth, React architecture, or AWS architecture.

## Deployment Principles

1. Physical labels come before software configuration.
2. Network stability comes before customer device commissioning.
3. Device registry truth comes before route testing.
4. Checkout authority remains isolated to the Checkout Lounge.
5. Sensors are installed and labeled now, but firmware and IoT work remain deferred.
6. Every step must have a rollback path.

## Phase 0 - Pre-Deployment Readiness

| Step | Action | Exit Criteria |
| ---: | --- | --- |
| 0.1 | Confirm final showroom floor plan and pod numbering | Pod 1-5 locations are locked |
| 0.2 | Confirm customer device locations | Welcome, five pod iPads, Ask Snoozer, Bedding, Checkout are placed |
| 0.3 | Confirm network rack location and power | Rack has power, ventilation, and cable access |
| 0.4 | Confirm internet handoff | WAN handoff location and credentials are known |
| 0.5 | Print or export registry templates | Device, zone, and IoT templates are available for field completion |
| 0.6 | Prepare label set | Device, zone, sensor, controller, cable labels are ready |

Rollback: Stop before hardware install. No customer-impacting state exists.

## Phase 1 - Network Foundation

| Step | Action | Exit Criteria |
| ---: | --- | --- |
| 1.1 | Install wall rack | Rack secure and accessible |
| 1.2 | Install UPS | UPS powered and labeled |
| 1.3 | Install UniFi Express | Gateway/controller powered |
| 1.4 | Install UniFi Lite 16 PoE | Switch powered and uplinked |
| 1.5 | Install two UniFi U6+ access points | APs adopted and online |
| 1.6 | Label all patch cables | Both cable ends identify source and destination |
| 1.7 | Validate Wi-Fi at all customer device locations | Stable connection at every kiosk/pod location |

Rollback: Return to previous network or cellular hotspot for app testing. Do not change Shopify or checkout.

## Phase 2 - Physical Device Placement

| Step | Action | Exit Criteria |
| ---: | --- | --- |
| 2.1 | Mount Welcome Kiosk | Device powered and labeled `welcome-01` |
| 2.2 | Mount Pod iPads | Devices powered and labeled `pod-1-ipad-01` through `pod-5-ipad-01` |
| 2.3 | Mount Ask Snoozer Kiosk | Device powered and labeled `ask-snoozer-01` |
| 2.4 | Mount Bedding Kiosk | Device powered and labeled `bedding-01` or approved equivalent |
| 2.5 | Mount Checkout Lounge device | Device powered and labeled `checkout-01` |
| 2.6 | Confirm cable strain relief | No exposed or stressed power/data cables |

Rollback: Remove a failed device from customer access and use a spare tablet if available.

## Phase 3 - Sensor and Edge Placement

| Step | Action | Exit Criteria |
| ---: | --- | --- |
| 3.1 | Install nine presence sensors | Each sensor physically labeled and mapped to zone |
| 3.2 | Install five occupancy sensors | One per pod, mapped to pod zone |
| 3.3 | Install five lighting zones | Each zone labeled and manually controllable if hardware supports it |
| 3.4 | Install ambient audio system | Shared audio path powered and tested locally |
| 3.5 | Install five pod edge controllers | One controller per pod, labeled |
| 3.6 | Install shared zone controller | Labeled and powered |
| 3.7 | Store spare edge controller | Labeled `spare-edge-01`, accessible to ops |

Rollback: Disable or unplug a noisy sensor/controller. The showroom app must still operate manually.

## Phase 4 - Registry Preparation

| Step | Action | Exit Criteria |
| ---: | --- | --- |
| 4.1 | Complete `DEVICE_REGISTRY_TEMPLATE.json` | Every customer device has ID, mode, zone, route, and authority |
| 4.2 | Complete `ZONE_REGISTRY_TEMPLATE.json` | Every physical area has zone ID, device list, sensors, controller |
| 4.3 | Complete `IOT_REGISTRY_TEMPLATE.json` | Future IoT thing names, topics, and shadows are planned |
| 4.4 | Validate checkout authority | Only `checkout-01` has checkout authority |
| 4.5 | Validate pod bindings | Pod iPads point only to their bound pod |
| 4.6 | Validate deferred routes | Bedding/Sleep Essentials can remain unavailable if route is not live |

Rollback: Use current hardcoded/dev registry until field registry is corrected.

## Phase 5 - Customer Device Software Verification

| Step | Device | Required Check |
| ---: | --- | --- |
| 5.1 | Welcome Kiosk | `/welcome`, `/what-to-expect`, `/assessment`, `/results` allowed |
| 5.2 | Pod iPad 1 | Bound to `/pod/pod-1`, no checkout route |
| 5.3 | Pod iPad 2 | Bound to `/pod/pod-2`, no checkout route |
| 5.4 | Pod iPad 3 | Bound to `/pod/pod-3`, no checkout route |
| 5.5 | Pod iPad 4 | Bound to `/pod/pod-4`, no checkout route |
| 5.6 | Pod iPad 5 | Bound to `/pod/pod-5`, no checkout route |
| 5.7 | Ask Snoozer Kiosk | `/ask-snoozer` allowed, cart/checkout blocked |
| 5.8 | Bedding Kiosk | Approved unavailable/awareness state if route not live |
| 5.9 | Checkout Lounge | `/cart`, `/checkout/guest`, `/checkout/:id`, `/financing` allowed |

Rollback: Revert device ID, use admin-dev only for internal debug, never for customer checkout.

## Phase 6 - MVP Experience Walkthrough

| Experience | Walkthrough |
| --- | --- |
| Welcome Wake | Approach Welcome Kiosk, confirm ready/wake behavior |
| Pod Presence | Approach each pod, confirm pod context and bound route |
| Pod Occupancy | Simulate occupancy, confirm sensor label and future event mapping |
| Rest Test | Start a 7-minute and 15-minute test on at least one pod |
| Lighting | Manually verify each lighting zone responds or is electrically ready |
| Ambient Audio | Verify shared audio can play at safe volume |
| Ask Snoozer Awareness | Ask a question from Ask Snoozer Kiosk |
| Bedding Awareness | Confirm Bedding Kiosk is present and not checkout-authorized |
| Checkout Awareness | Confirm cart review and checkout handoff only in Checkout Lounge |
| Human Assistance | Trigger Talk to Human from representative surfaces |

Rollback: Disable only the failing experience; preserve core Welcome, Pod, and Checkout flows.

## Phase 7 - Operational Handoff

| Step | Action | Exit Criteria |
| ---: | --- | --- |
| 7.1 | Export final registries | Copies stored with deployment docs |
| 7.2 | Photograph installed labels | Photo record exists for each device/sensor/controller |
| 7.3 | Record network admin access location | Credentials stored securely, not in repo |
| 7.4 | Confirm support escalation path | Staff know who to call for app, network, Shopify, and hardware |
| 7.5 | Confirm daily open/close routine | Staff checklist exists |

## Deployment Acceptance Criteria

1. Every required customer device is installed and labeled.
2. Every pod iPad is route-bound to the correct pod.
3. Checkout Lounge is the only checkout-authorized station.
4. Network and Wi-Fi are stable across the showroom.
5. Sensor and edge hardware are installed/labeled without requiring firmware.
6. Registry templates are filled and match physical labels.
7. MVP experiences are manually validated.
8. Rollback paths are known and documented.

## Future Expansion Notes

- IoT Phase 1 should start from the completed `IOT_REGISTRY_TEMPLATE.json`.
- Sensor firmware should emit state only. It should not own checkout, cart, recommendation, or identity truth.
- Pressure mapping, wearables, environmental controls, biometrics, and multi-zone audio require separate architecture reviews.

