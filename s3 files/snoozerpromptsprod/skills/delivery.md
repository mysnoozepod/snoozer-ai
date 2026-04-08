---

title: Delivery \& Setup

category: skills

version: 1.2

updated: 2025-10-04

tags: \["delivery", "shipping", "setup", "installation", "pickup", "timeline"]

ui\_actions:

&nbsp; - { type: "open\_tab", tab: "FAQs" }

&nbsp; - { type: "show\_faq", slug: "delivery" }

hints:

&nbsp; - "How fast can I get my mattress?"

&nbsp; - "Do you deliver and set up?"

&nbsp; - "Will you take away my old bed?"

&nbsp; - "Is delivery free?"

---



\## 🧭 Reply

Most orders arrive within 3 to 7 business days, and our team can set up your new mattress in your preferred room.  

We also offer old mattress removal and free basic delivery on qualifying purchases.



---



\## 💡 Summary

Our delivery service is designed to be simple, quick, and professional.  

We coordinate with local partners to ensure your order arrives safely, fully assembled if needed, and on your schedule.



---



\## 💬 Key Facts

\- Standard delivery time: \*\*3–7 business days\*\* after purchase.  

\- \*\*White-Glove Setup\*\*: optional full-room setup and packaging removal.  

\- \*\*Old Mattress Removal\*\* available upon request.  

\- Free delivery applies to orders \*\*$999+\*\* within our primary service area.  

\- Delivery scheduling handled via text or email confirmation after purchase.  

\- Tracking and delivery updates accessible online or through Snoozer’s live assistant.



---



\## 📎 Recommended Actions

| User Intent | Snoozer Action |

|--------------|----------------|

| "How long does delivery take?" | reply directly with 3–7 business days |

| "Do you offer setup?" | show\_faq: delivery |

| "Will you remove my old mattress?" | show\_faq: delivery |

| "Is delivery free?" | show\_faq: delivery |

| "Track my order" | open\_tab: FAQs → jump to tracking section |



---



\## 📚 Related Topics

\- `skills/returns.md`

\- `faq/delivery.md`

\- `policies/delivery.md`

\- `skills/pricing.md`



---



\## 🧠 Developer Notes

\- Fast-path for “delivery”, “setup”, “white glove”, “shipping”, “removal”.  

\- Backend extracts:

&nbsp; - `reply` block (short summary)

&nbsp; - `ui.actions` for delivery-related tab jumps

&nbsp; - `hints` for top chips

\- If user mentions “track” or “schedule,” backend should prompt `show\_faq: delivery`.



---



\## 🔍 Source

MySnoozePod — Delivery, Setup, and Removal Overview (2025).



