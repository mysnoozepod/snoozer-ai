# MySnoozePod Content Pages Release

Release date: 2026-11-02  
Store: `mysnoozepodtest.myshopify.com`  
Published domain: `https://mysnoozepod.com`  
Status: 50 educational pages plus one guide hub published with strategic navigation and relevant editorial imagery; storefront remains protected by its pre-existing store password

## Result

Fifty manufacturer-neutral educational pages and the `/pages/sleep-guides` directory are live in Shopify. Every guide uses the default live page template and contains a concise opening answer, educational sections, a practical comparison method, a consideration checklist, MySnoozePod guidance, FAQs, and three internal related-guide links. The template adds contextual guide discovery plus Book a Snooze Session and Ask Snoozer actions immediately before the global “Stay In The Loop” newsletter.

Customer-facing comfort language is limited to **Soft**, **Medium Soft**, **Medium Firm**, and **Firm**. The content contains no BEDGEAR references and no numeric comfort scale. Product prices, warranties, fulfillment claims, and unsupported compatibility conclusions were not invented.

## Editorial image library

Every one of the 50 pages now renders a related, original editorial image above the article body. Ten manufacturer-neutral image groups cover showroom guidance, virtual Snooze Sessions, complete sleep systems, comfort comparison, dual comfort, split systems, mattress materials, cooling, adjustable bases, and bedding essentials. The assets contain no product logos, model claims, prices, or embedded text.

The handle-to-image contract is stored in `content/content-page-images.mjs`. Every image includes descriptive alternative text, explicit dimensions, responsive cropping, and a stable Shopify theme-asset reference. The same ten SHA-256-verified assets and `sections/main-page.liquid` mapping are deployed to:

- Published theme `139460542525` (`main`)
- Development theme `139216420925` (`unpublished`)

Shopify readback details, hashes, sizes, public CDN URLs, and theme roles are recorded in `CONTENT_PAGE_IMAGES_SHOPIFY_READBACK.json`.

## Navigation and conversion placement

The primary menu now uses seven focused destinations: Mattresses, Adjustable Bases, Sleep Essentials, Bedroom Furniture, Sleep Guides, Your Showroom Visit, and Our Story. Relevant educational links appear contextually under the product and visit branches, while Sleep Guides links to the full directory and its six page-group anchors. The logo remains the direct Home route, avoiding a redundant top-level Home item.

The footer now exposes Sleep Guides, booking, assessment, story, contact, delivery, trial, support, privacy, and terms. The hub lists all 50 guides exactly once across the six groups below. On guide pages, the template adds a compact related-topic discovery row and a responsive blue conversion band. Both the conversion band and any supporting page assets render inside the main page section before “Stay In The Loop.”

The durable menu/page-group contract is `content/content-navigation.mjs`; the bounded Admin API staging/readback workflow is `scripts/stage-content-navigation.mjs`; and the verified result is recorded in `CONTENT_NAVIGATION_SHOPIFY_READBACK.json`.

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
- Content-image/theme backup: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\content-page-images\2026-11-02T22-25-48-361Z`
- Final content/hub backup: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\content-pages\2026-11-02T23-05-11-071Z`
- Final page-template/image backup: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\content-page-images\2026-11-02T23-06-34-425Z`
- Navigation backup: `C:\Users\1ones\OneDrive\Documents\ChatGPT\Private Backups\Shopify\content-navigation\2026-11-02T23-07-00-347Z`

No credentials or customer information are stored in project documentation.

## Validation

- Shopify readback: 51 expected, 51 verified, 51 published (50 guides plus one hub).
- Navigation readback: 50 guide pages, one hub, two verified menus, 57 nested primary-menu items, and ten footer items.
- Idempotent content plan: zero creates, zero updates, 51 unchanged.
- Idempotent navigation plan: both managed menus unchanged after apply.
- Idempotent logo plan: zero creates, zero updates, six unchanged assets.
- Route contract: all 51 canonical URLs resolve through the existing protected storefront.
- Actual browser rendering: published-theme header/logo, seven-destination navigation, page title, hub directory, body sections, booking CTA, Ask Snoozer action, FAQs, footer, and related-guide navigation verified.
- Editorial image contract: 51/51 page handles mapped to 10/10 local PNG assets with descriptive alt text.
- Shopify theme readback: 10/10 images and the page-section mapping hash-verified on both target themes.
- Live browser validation: all ten visual groups loaded their expected 1672×941 CDN asset on representative published-theme pages.
- Desktop and 390px mobile checks found no horizontal overflow; mobile conversion buttons expand to the available width.
- `tests/runContentPageTests.mjs` and `tests/runContentNavigationTests.mjs`: pass.

## Snoozer product-information boundary

The guide library is educational content, not commerce authority. A future Snoozer retrieval task should hydrate product answers from Shopify-native product and variant fields, exact namespaced tags, collection membership, and verified metafields/metadata through the established commerce boundary. Missing or conflicting values must remain unknown; page prose or model inference must not establish price, availability, variant, compatibility, or fulfillment facts.

The Online Store password remains enabled. Pages are published and render on the live theme for authenticated preview, but public visitors continue to see Shopify's existing password page until the owner deliberately opens the storefront.
