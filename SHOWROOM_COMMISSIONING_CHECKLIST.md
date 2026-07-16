# MySnoozePod Showroom Commissioning Checklist

Version: 1.0  
Status: Field commissioning checklist  
Last updated: 2026-07-16

## Purpose

Use this checklist during install, pre-open testing, and first-day validation. It is intentionally operational and should be checked off by the person physically commissioning the showroom.

## Pre-Commissioning

| Check | Pass/Fail | Notes |
| --- | --- | --- |
| Final floor plan is available |  |  |
| Pod numbering is confirmed |  |  |
| Device labels are printed |  |  |
| Sensor labels are printed |  |  |
| Controller labels are printed |  |  |
| Network labels are printed |  |  |
| Deployment packet is locally available |  |  |
| Rollback procedure is locally available |  |  |
| Spare edge controller is on site |  |  |

## Network Commissioning

| Check | Pass/Fail | Notes |
| --- | --- | --- |
| Wall rack installed securely |  |  |
| UPS installed and powered |  |  |
| UniFi Express powered and adopted |  |  |
| UniFi Lite 16 PoE powered and adopted |  |  |
| U6+ AP 1 powered and adopted |  |  |
| U6+ AP 2 powered and adopted |  |  |
| WAN connectivity confirmed |  |  |
| Wi-Fi SSID available |  |  |
| Wi-Fi signal confirmed at Welcome Kiosk |  |  |
| Wi-Fi signal confirmed at Pod 1 |  |  |
| Wi-Fi signal confirmed at Pod 2 |  |  |
| Wi-Fi signal confirmed at Pod 3 |  |  |
| Wi-Fi signal confirmed at Pod 4 |  |  |
| Wi-Fi signal confirmed at Pod 5 |  |  |
| Wi-Fi signal confirmed at Ask Snoozer |  |  |
| Wi-Fi signal confirmed at Bedding Kiosk |  |  |
| Wi-Fi signal confirmed at Checkout Lounge |  |  |

## Customer Device Commissioning

| Device | Expected ID | Expected Mode | Default Route | Pass/Fail | Notes |
| --- | --- | --- | --- | --- | --- |
| Welcome Kiosk | `welcome-01` | `welcome-kiosk` | `/welcome` |  |  |
| Pod iPad 1 | `pod-1-ipad-01` | `pod-ipad` | `/pod/pod-1` |  |  |
| Pod iPad 2 | `pod-2-ipad-01` | `pod-ipad` | `/pod/pod-2` |  |  |
| Pod iPad 3 | `pod-3-ipad-01` | `pod-ipad` | `/pod/pod-3` |  |  |
| Pod iPad 4 | `pod-4-ipad-01` | `pod-ipad` | `/pod/pod-4` |  |  |
| Pod iPad 5 | `pod-5-ipad-01` | `pod-ipad` | `/pod/pod-5` |  |  |
| Ask Snoozer Kiosk | `ask-snoozer-01` | `ask-snoozer-kiosk` | `/ask-snoozer` |  |  |
| Bedding Kiosk | `bedding-01` | `sleep-essentials-kiosk` | `/sleep-essentials` |  |  |
| Checkout Lounge | `checkout-01` | `checkout-kiosk` | `/cart` |  |  |

## Sensor and Edge Commissioning

| Item | Quantity | Pass/Fail | Notes |
| --- | ---: | --- | --- |
| Presence sensors installed | 9 |  |  |
| Presence sensors labeled | 9 |  |  |
| Occupancy sensors installed | 5 |  |  |
| Occupancy sensors labeled | 5 |  |  |
| Lighting zones installed/labeled | 5 |  |  |
| Ambient audio system installed | 1 |  |  |
| Pod edge controllers installed/labeled | 5 |  |  |
| Shared zone controller installed/labeled | 1 |  |  |
| Spare edge controller labeled/stored | 1 |  |  |

## Route and Authority Checks

| Check | Expected Result | Pass/Fail | Notes |
| --- | --- | --- | --- |
| Welcome Kiosk can open `/welcome` | Allowed |  |  |
| Welcome Kiosk can open `/assessment` | Allowed |  |  |
| Welcome Kiosk can open `/results` | Allowed |  |  |
| Welcome Kiosk can open `/checkout/guest` | Blocked/redirected |  |  |
| Pod 1 iPad can open `/pod/pod-1` | Allowed |  |  |
| Pod 1 iPad opening `/pod/pod-2` | Redirects to `/pod/pod-1` |  |  |
| Any pod iPad opening checkout | Redirects/handoff, no checkout authority |  |  |
| Ask Snoozer Kiosk can open `/ask-snoozer` | Allowed |  |  |
| Ask Snoozer Kiosk opening `/cart` | Blocked/redirected |  |  |
| Checkout Lounge can open `/cart` | Allowed |  |  |
| Checkout Lounge can open checkout route | Allowed |  |  |
| Checkout Lounge can open pod route | Blocked/redirected |  |  |

## MVP Experience Checks

| Experience | Procedure | Acceptance | Pass/Fail |
| --- | --- | --- | --- |
| Welcome Wake | Approach/use Welcome Kiosk | Welcome path is ready |  |
| Assessment | Complete a test assessment | Results route loads |  |
| Results | Open recommended pods | Pod links are correct |  |
| Pod Presence | Open each bound pod iPad | Correct pod number/title appears |  |
| Rest Test | Start and pause/complete one test | Rest Test remains usable |  |
| Learn | Open Learn on one pod | Product info displays |  |
| Build | Open Build on one pod | Options display without checkout authority |  |
| Ask Snoozer | Ask a policy/product question | Answer appears in chat |  |
| Bedding Awareness | Open Bedding Kiosk | Approved unavailable/awareness state if route deferred |  |
| Checkout Awareness | Review cart in Checkout Lounge | Checkout handoff available only there |  |
| Human Assistance | Tap Talk to Human | Human help path starts |  |

## Inactivity and Reset Checks

| Device | Expected Behavior | Pass/Fail | Notes |
| --- | --- | --- | --- |
| Welcome Kiosk | Resets transient assessment UI after 5 minutes |  |  |
| Pod iPad | Resets pod/rest temp state after 15 minutes idle |  |  |
| Ask Snoozer Kiosk | Resets conversation after 5 minutes idle |  |  |
| Bedding Kiosk | Uses 8-minute reset policy and approved unavailable state |  |  |
| Checkout Lounge | Shows saved-selection warning at 15 minutes |  |  |
| Checkout Lounge | Returns to `/cart` at 30 minutes |  |  |
| All devices | Do not clear cart ID, checkout URL, Snooze Code, or shopper identity |  |  |

## Rollback Procedures

### Single Customer Device Failure

1. Remove failed device from customer access.
2. Use spare tablet if available.
3. Assign the same device ID only after confirming the old device is offline.
4. Re-run route and authority checks for that device.

### Network Failure

1. Confirm UPS state.
2. Confirm UniFi Express and switch power.
3. Confirm WAN handoff.
4. If internet is down, keep showroom in guided/manual mode.
5. Do not change Shopify checkout or cart behavior as a workaround.

### Sensor False Triggering

1. Disable or unplug only the affected sensor.
2. Mark sensor as unavailable in field notes.
3. Keep customer devices operational manually.
4. Do not alter device mode or checkout authority.

### Edge Controller Failure

1. Swap in spare edge controller only after labeling it with temporary assignment.
2. Record original failed controller ID.
3. Do not flash or modify firmware from this packet.
4. Re-run zone checks.

### Checkout Issue

1. Confirm the customer is on Checkout Lounge.
2. Confirm cart still exists.
3. Confirm checkout URL is preserved.
4. If Shopify is unavailable, pause checkout attempts and use manual staff support.
5. Do not enable checkout on pod iPads or other kiosks.

## Final Sign-Off

| Role | Name | Date | Signature |
| --- | --- | --- | --- |
| Showroom owner |  |  |  |
| Technical lead |  |  |  |
| Installer |  |  |  |
| Store operations |  |  |  |

