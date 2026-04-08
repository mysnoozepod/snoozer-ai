---

title: Pricing \& Value

category: skills

version: 1.2

updated: 2025-10-04

tags: \["pricing", "discounts", "loyalty", "rewards", "value", "promotions"]

ui\_actions:

&nbsp; - { type: "open\_tab", tab: "Explore" }

&nbsp; - { type: "show\_products" }

hints:

&nbsp; - "How much do your mattresses cost?"

&nbsp; - "Do you offer discounts?"

&nbsp; - "Can I earn rewards in the showroom?"

&nbsp; - "Is your pricing negotiable?"

---



\## 🧭 Reply

Our pricing is transparent and consistent across all channels.  

You’ll always see the best available price, with bonus rewards and exclusive discounts offered during your showroom experience.



---



\## 💡 Summary

We believe great sleep should be a clear and fair investment—no haggling, no hidden markups.  

Our loyalty program lets shoppers earn rewards on purchases and unlock seasonal perks while testing products in the showroom.



---



\## 💬 Key Facts

\- Pricing is \*\*set for fairness\*\* and doesn’t fluctuate by location or time of day.  

\- Members of our \*\*Loyalty \& Rewards Program\*\* earn points for every purchase, referral, or in-store activity.  

\- In-showroom guests can receive \*\*limited-time discounts\*\* or bonus points during special events.  

\- All prices are shown \*\*before tax and delivery\*\* so you know exactly what you’re paying.  

\- Snoozer can surface current featured items or limited promotions when available.  



---



\## 📎 Recommended Actions

| User Intent | Snoozer Action |

|--------------|----------------|

| "How much are your mattresses?" | show\_products filtered by budget |

| "Do you have discounts?" | open\_tab: Explore → display current promos |

| "Tell me about rewards" | open\_tab: Explore + badge rewards chip |

| "Are prices the same in store?" | reply: yes, pricing is consistent online and in-showroom |



---



\## 📚 Related Topics

\- `skills/financing.md`

\- `skills/help\_me\_choose.md`

\- `faq/general.md`

\- `guides/buying\_guide.md`



---



\## 🧠 Developer Notes

\- Designed for \*\*fast-path replies (<2.5s)\*\*.  

\- When `intent=pricing`, backend should retrieve this file first.  

\- Backend extracts:

&nbsp; - `reply` block → short message for chat  

&nbsp; - `ui.actions` for `open\_tab` or `show\_products`  

&nbsp; - `hints` for starter chips  



---



\## 🔍 Source

MySnoozePod — Transparent pricing philosophy, Loyalty Rewards Program, 2025.



