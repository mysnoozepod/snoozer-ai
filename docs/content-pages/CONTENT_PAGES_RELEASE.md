# MySnoozePod Content Pages Release

Release date: 2026-11-02  
Store: `mysnoozepodtest.myshopify.com`  
Published domain: `https://mysnoozepod.com`  
Status: 50 Shopify pages published; storefront remains protected by its pre-existing store password

## Result

Fifty manufacturer-neutral educational pages are live in Shopify. Every page uses the default live page template, contains a concise opening answer, educational sections, a practical comparison method, a consideration checklist, MySnoozePod guidance, Book a Snooze Session and Ask Snoozer actions, FAQs, and three internal related-guide links.

Customer-facing comfort language is limited to **Soft**, **Medium Soft**, **Medium Firm**, and **Firm**. The content contains no BEDGEAR references and no numeric comfort scale. Product prices, warranties, fulfillment claims, and unsupported compatibility conclusions were not invented.

## Published page groups

### The SnoozePod Experience

1. Building Your SnoozePod
2. What Is a SnoozePod?
3. How the MySnoozePod Showroom Works
4. What Is a Snooze Session?
5. What to Expect During Your Snooze Session
6. How to Prepare for Your Showroom Visit
7. How a Virtual Snooze Session Works
8. What Happens After Your Snooze Session?
9. Comparing Sleep Systems Without Sales Pressure
10. From Showroom Recommendation to Home Delivery

### Building a Sleep System

11. What Makes a Complete Sleep System?
12. How Your Sleep System Components Work Together
13. How to Choose the Right Mattress
14. How to Choose the Right Mattress Size
15. Understanding Mattress Comfort: Soft to Firm
16. Mattress Support vs. Mattress Firmness
17. Memory Foam vs. Hybrid Mattresses
18. Understanding Modular Mattresses
19. Showroom Comfort vs. Your Ordered Configuration
20. Questions to Ask Before Buying a Mattress

### Dual Comfort and Couples

21. The Benefits of Dual Comfort Mattresses
22. How Independent Left and Right Comfort Works
23. Choosing Between Soft, Medium Soft, Medium Firm, and Firm
24. Choosing Different Comfort Levels as a Couple
25. What Happens When Partners Have Different Sleep Preferences?
26. Choosing Comfort for Each Side of the Bed
27. Who Is a Dual Comfort Mattress For?
28. Standard, Split-Head, Half-Split, and Full-Split Explained
29. Is a Split-Head Mattress Right for You?
30. Choosing a Mattress for Couples With Different Sleep Styles

### Mattress Education

31. Choosing a Foam Mattress
32. Choosing a Hybrid Mattress
33. Comparing Mattress Types
34. How Mattress Materials Affect Comfort
35. Cooling Mattresses: What Actually Matters?
36. Understanding Pressure Relief and Body Alignment
37. Choosing a Mattress for Side, Back, or Combination Sleep
38. When Is It Time to Replace Your Mattress?

### Adjustable Bases and Compatibility

39. The Benefits of an Adjustable Base
40. Adjustable Base Features Explained
41. How to Choose an Adjustable Base
42. Understanding Zero-Gravity and Preset Positions
43. How to Match a Mattress With an Adjustable Base
44. Understanding Split-Head Adjustable Sleep Systems
45. Adjustable Bases vs. Platform Bases

### Pillows, Protection, and Bedding

46. How to Find the Right Pillow
47. How Mattress Protectors Help Protect Your Bed
48. Choosing Sheets for Standard and Split-Head Mattresses
49. Choosing the Right Comforter Weight
50. Creating a Cooler, More Comfortable Sleep Environment

The canonical handles, Shopify page IDs, body hashes, publication status, and URLs are recorded in `CONTENT_PAGES_SHOPIFY_READBACK.json`.

## Sharp logo release

The approved sharp source `omnia-journey/src/assets/mysnoozepod-logo-welcome.png` is deployed as theme asset `assets/mysnoozepod-logo-sharp.png`. The active header, password header, and organization structured-data logo reference the sharp asset on:

- Published theme `139460542525` (`main`)
- Development theme `139216420925` (`unpublished`)

The surrounding header layout, menus, Ask Snoozer entry point, Snooze Code controls, account, and cart presentation were preserved.

## Recovery

- Content page backup: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\content-pages\2026-11-02T21-26-28-679Z`
- Logo/theme backup: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\sharp-logo\2026-11-02T21-24-53-134Z`

No credentials or customer information are stored in project documentation.

## Validation

- Shopify readback: 50 expected, 50 verified, 50 published.
- Idempotent content plan: zero creates, zero updates, 50 unchanged.
- Idempotent logo plan: zero creates, zero updates, six unchanged assets.
- Route contract: all 50 canonical URLs resolve through the existing protected storefront.
- Actual browser rendering: published-theme header/logo, page title, body sections, booking CTA, Ask Snoozer action, FAQs, footer, and related-guide navigation verified.
- `tests/runContentPageTests.mjs`: pass.

The Online Store password remains enabled. Pages are published and render on the live theme for authenticated preview, but public visitors continue to see Shopify's existing password page until the owner deliberately opens the storefront.
