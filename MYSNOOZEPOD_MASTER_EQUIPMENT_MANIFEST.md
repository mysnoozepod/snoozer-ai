# MySnoozePod Master Equipment Manifest

Version: 1.0  
Status: Locked MVP showroom deployment packet  
Owner: MySnoozePod showroom operations  
Last updated: 2026-07-16

## Purpose

This manifest is the source document for the physical MVP showroom equipment plan. It formalizes the locked device, sensor, edge, network, and AWS assumptions for the first MySnoozePod showroom deployment.

This document does not redesign the architecture. It does not authorize firmware, React, checkout, Shopify, cart truth, device mode, sensor philosophy, or AWS resource changes.

## Locked Showroom Device Count

| Category | Item | Quantity | Purpose | MVP Status |
| --- | ---: | ---: | --- | --- |
| Customer devices | Welcome Kiosk | 1 | Welcome Wake, Snooze Code check-in, guided session start | Required |
| Customer devices | Pod iPads | 5 | Pod Home, Rest Test, Learn, Build for bound pod | Required |
| Customer devices | Ask Snoozer Kiosk | 1 | Broad showroom help and recommendation support | Required |
| Customer devices | Bedding Kiosk | 1 | Bedding and sleep essentials awareness surface | Required |
| Customer devices | Checkout Lounge | 1 | Cart review and checkout handoff authority | Required |
| Sensor layer | Presence Sensors | 9 | Wake/awareness signals by zone | Required |
| Sensor layer | Occupancy Sensors | 5 | Pod occupancy detection, one per pod | Required |
| Sensor layer | Lighting Zones | 5 | Pod-level lighting control | Required |
| Sensor layer | Ambient Audio System | 1 | Shared audio ambience and guidance cues | Required |
| Edge layer | Pod Edge Controllers | 5 | One local controller per pod zone | Required |
| Edge layer | Shared Zone Controller | 1 | Shared showroom coordination | Required |
| Edge layer | Spare Edge Controller | 1 | Hot spare for local recovery | Required |
| Network | UniFi Express | 1 | Gateway/controller layer | Required |
| Network | UniFi Lite 16 PoE | 1 | PoE switching for sensors/APs/controllers where applicable | Required |
| Network | UniFi U6+ | 2 | Showroom Wi-Fi coverage | Required |
| Network | APC UPS | 1-2 | Power protection for network/control stack | Required |
| Network | Wall Rack | 1 | Secure network/edge mounting | Required |

## Locked MVP Experiences

| Experience | Required Hardware | Required Software Boundary | Acceptance |
| --- | --- | --- | --- |
| Welcome Wake | Welcome Kiosk, presence sensor | Device mode and local reset layer | Welcome screen wakes or is ready when customer approaches |
| Pod Presence | Pod iPad, pod presence sensor, pod edge controller | Future sensor adapter, no current React redesign | Correct pod context is available for the bound pod |
| Pod Occupancy | Pod occupancy sensor, pod edge controller | Future AWS IoT event path | Occupied/unoccupied state can be emitted per pod |
| Rest Test | Pod iPad, pod occupancy sensor, optional lighting/audio | Existing Pod Experience plus future sensor state | Rest Test remains usable without sensor dependency |
| Lighting | 5 lighting zones, edge controllers | Future IoT command path | Each pod zone can be independently addressed |
| Ambient Audio | Ambient audio system, shared controller | Future command path | Shared audio can be addressed as one MVP zone |
| Ask Snoozer Awareness | Ask Snoozer Kiosk, presence sensor | Existing route/device guard plus future presence awareness | Kiosk is available and does not own checkout |
| Bedding Awareness | Bedding Kiosk, presence sensor | Approved unavailable/awareness state until route exists | Does not interfere with pod or checkout devices |
| Checkout Awareness | Checkout Lounge, presence sensor, UPS/network | Existing checkout authority device mode | Checkout Lounge remains the only checkout authority |
| Human Assistance | All customer devices | Existing Talk to Human action patterns | Human help can be requested without changing cart truth |

## Deferred Capabilities

The following are explicitly deferred and must not be implemented in this packet:

| Deferred Capability | Reason Deferred | Future Note |
| --- | --- | --- |
| Pressure Mapping | Requires different sensor class and data model | Treat as Phase 2 hardware experiment |
| Wearables | Customer privacy, pairing, and support burden | Requires opt-in identity rules |
| Entry Automation | Store operations dependency | Add only after first showroom traffic validation |
| Exit Automation | Identity/session closure implications | Requires customer journey policy |
| Environmental Controls | HVAC/building integration | Coordinate with facilities |
| Multi-Zone Audio | More complex routing and content management | Start from one ambient audio zone |
| Biometrics | High privacy and compliance burden | Do not pursue without legal review |

## Estimated Equipment Cost

Planning estimates are in USD and should be verified before purchase. Public pricing observed on 2026-07-16 includes UniFi Lite 16 PoE at about $199, UniFi U6+ at about $129 each, and UniFi Express listed on the Ubiquiti store page. APC UPS pricing varies heavily by capacity and rack/floor model.

| Area | Item | Qty | Unit Estimate | Extended Estimate | Notes |
| --- | ---: | ---: | ---: | ---: | --- |
| Customer devices | iPad or equivalent kiosk tablet | 9 | $329-$799 | $2,961-$7,191 | Final model, storage, and case choice drives range |
| Customer devices | Locking tablet stands/enclosures | 9 | $80-$250 | $720-$2,250 | Include cable routing and anti-theft mounting |
| Sensors | Presence sensors | 9 | $20-$75 | $180-$675 | Final choice depends on PIR/mmWave/privacy rules |
| Sensors | Occupancy sensors | 5 | $35-$150 | $175-$750 | Pod occupancy reliability is more important than lowest cost |
| Lighting | Lighting zone controller/driver allowance | 5 | $75-$250 | $375-$1,250 | Excludes any decorative fixture upgrades |
| Audio | Ambient audio system | 1 | $300-$1,500 | $300-$1,500 | Single-zone MVP only |
| Edge | Pod edge controllers | 5 | $25-$85 | $125-$425 | ESP32-class or equivalent later, firmware deferred |
| Edge | Shared zone controller | 1 | $25-$85 | $25-$85 | Same family as pod controllers preferred |
| Edge | Spare edge controller | 1 | $25-$85 | $25-$85 | Keep pre-labeled and pre-flashed later |
| Network | UniFi Express | 1 | $49-$149 | $49-$149 | Verify availability before purchase |
| Network | UniFi Lite 16 PoE | 1 | $199 | $199 | 45W PoE budget, verify load |
| Network | UniFi U6+ | 2 | $129 | $258 | Ceiling/wall mount as site requires |
| Network | APC UPS | 1-2 | $200-$900 | $200-$1,800 | Choose runtime based on switch/gateway/controller load |
| Network | Wall rack | 1 | $150-$500 | $150-$500 | Include shelf, cable manager, patch panel if needed |
| Cabling | Ethernet, patch, labels, cable raceway | 1 lot | $300-$1,000 | $300-$1,000 | Label both ends |
| Spares | Spare sensors/cables/mounts | 1 lot | $250-$750 | $250-$750 | See spare recommendations |

Estimated MVP equipment subtotal: $6,292-$18,867.

Recommended planning reserve: 15%-25% for shipping, mounts, tax, adapters, replacement cables, and site-specific installation.

Estimated planning total with reserve: $7,236-$23,584.

## Spare Recommendations

| Spare | Quantity | Reason |
| --- | ---: | --- |
| Edge controller | 1 | Required locked spare |
| Presence sensors | 2 | Fast recovery from false triggering or dead unit |
| Occupancy sensors | 1 | One pod can be restored quickly |
| U6+ AP | 0-1 | Optional if uptime matters during shipping delays |
| PoE injector | 1-2 | Emergency bypass for switch PoE budget/port issue |
| USB-C/Lightning charging cables | 4-6 | Kiosk tablet failures are often cable-related |
| Tablet power adapters | 2-3 | Fast field replacement |
| Ethernet patch cables | 10 | Multiple lengths, labeled |
| Label tape/asset tags | 1 kit | Commissioning and operations clarity |
| UPS battery replacement plan | 1 | Calendar reminder, not immediate purchase |

## Deployment Dependencies

| Dependency | Required Before | Owner | Notes |
| --- | --- | --- | --- |
| Final floor plan | Cable pulls and sensor placement | Showroom ops | Must identify zones and pod numbering |
| Power availability | Network rack, tablets, lights/audio | Electrician/facilities | Confirm outlets and load |
| Internet service | AWS, Shopify, Snoozer API | Network owner | Validate failover expectations |
| AWS account access | IoT registry and future events | Technical owner | No AWS resources changed by this packet |
| Shopify storefront access | Checkout/cart truth verification | Commerce owner | No checkout changes in this packet |
| Device IDs | Device registry provisioning | Technical owner | Must match device registry template |
| Physical labels | Commissioning | Installer | Label every sensor, controller, tablet, cable |

## Acceptance Criteria

1. All customer devices are labeled, mounted, powered, and assigned to a device ID.
2. Each pod iPad is bound to exactly one pod route and cannot own checkout.
3. Checkout Lounge is the only checkout authority device.
4. All sensors are labeled and mapped to a zone/pod.
5. All edge controllers are labeled and mapped to a zone/pod.
6. Network equipment is installed on UPS-backed power.
7. Wi-Fi coverage is validated at every customer device location.
8. Registry templates are filled before live commissioning.
9. Rollback plan is printed or locally available during install.
10. Deferred capabilities remain deferred.

## Source Notes For Pricing

Pricing should be treated as planning-only. Verify before purchase.

- Ubiquiti Store, UniFi Express: https://store.ui.com/us/en/products/ux
- Ubiquiti Store, Switch Lite 16 PoE: https://store.ui.com/us/en/products/usw-lite-16-poe
- Ubiquiti Store, U6+: https://store.ui.com/us/en/products/u6-plus

