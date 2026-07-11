# Snoozer Source Truth Gaps

This audit separates observed source truth from answer-copy behavior. Product data remains owned by Shopify/canonical catalog sources; this file is a gap tracker only.

## Product Claims

| Claim area | Observed source | Status | Snoozer behavior |
| --- | --- | --- | --- |
| 14-inch Hybrid supportive coil design | `s3 files/snoozerknowledgeprod/products/mattress/hybrid-14.md` | Supported as coil/support language | Use "supportive coils" or "lifted support"; avoid more specific coil engineering unless source is expanded. |
| 14-inch Hybrid pocketed coils | No explicit local source found | Gap | Do not say "pocketed coils" until source truth is added. |
| 14-inch Hybrid gel-infused foam | No explicit local source found | Gap | Do not mention gel-infused foam. |
| 14-inch Hybrid airflow/cooling | `hybrid-14.md` and manifest cooling tags | Supported, but general | Use cautious airflow/breathability language, not "solves sleeping hot." |
| 12-inch All Foam pressure relief | `s3 files/snoozerknowledgeprod/products/mattress/all-foam-12.md` | Supported | Use shoulder/hip pressure relief language for side sleepers. |
| 12-inch All Foam cooling | `all-foam-12.md` and manifest tags | Supported, but general | Use "cooling cues" or "temperature balance"; avoid claiming foam solves heat. |
| 12-inch Dual Comfort different firmness | `s3 files/snoozerknowledgeprod/products/mattress/dual-comfort-12.md` | Supported | Use for partner firmness/comfort differences. |
| 12-inch Dual Comfort motion isolation | `dual-comfort-12.md` | Supported | Use for partner movement, but distinguish movement from firmness difference. |

## Policy Claims

| Claim area | Observed source | Status | Snoozer behavior |
| --- | --- | --- | --- |
| Mattress sleep trial | `s3 files/snoozerknowledgeprod/policies/returns.md` | Supported as 100-night mattress trial | Lead return answers with mattress return/exchange window. |
| Bases/accessories final sale | `returns.md` | Supported for motion bases, adjustable frames, bedding, pillows, accessories | Use those terms; avoid unsourced broad "furniture" language unless source is updated. |
| Delivery timing | `s3 files/snoozerknowledgeprod/policies/delivery.md` | Supported as standard 3-7 business days | Use 3-7 business days when sourced; do not invent 7-10 days. |
| Delivery carrier | `delivery.md` says trusted local carriers | Supported generally | Do not name UPS/FedEx unless source is added. |
| White-glove setup and old mattress removal | `delivery.md` | Supported | Safe to mention as available add-ons when delivery source is loaded. |
| Financing monthly/pay-over-time options | `s3 files/snoozerpromptsprod/skills/financing.md` | Supported for qualified customers/eligible purchases | Safe for generic financing questions. |
| 0% APR | `financing.md` | Supported for qualified customers up to 24 months | Mention only for APR/provider/payment-plan questions, not as the generic financing opener. |
| Financing approval/payment amount | No exact customer-specific calculator source | Gap | Do not guess approval, exact payment, or no-money-down promises. |

## Copy Risks To Keep Watching

- Product docs include some informal/internal copy that should not be lifted verbatim into customer-facing answers.
- Canonical recommendation context may include internal labels like `No Base` and `No Motion`; answer copy should filter those out while preserving the structured context.
- Side-sleeper and general pressure-relief questions can look similar to back-pain questions; side-sleeper language should win when side-sleeping phrasing is present.
