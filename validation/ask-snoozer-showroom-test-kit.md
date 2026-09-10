# Ask Snoozer internal showroom test kit

Use natural speech; do not read exact scripts. Run quick, standard, and deep missions on the physical device. Record the anonymous trace window so the semantic and client-timing events can be correlated afterward.

For every mission record: pass/fail, what confused the shopper, what Snoozer misunderstood, perceived delay, TTS quality, naturalness, trust, and next-step clarity.

## Device and TTS protocol

1. Note device ID/category, browser build, network, time window, and response-policy version.
2. Confirm visible “thinking” feedback appears immediately after submission.
3. Time the first visible response, first spoken word, and speech completion.
4. Confirm display appears even if TTS fails or autoplay is blocked.
5. Confirm speech is shorter than display but preserves recommendation, price, compatibility, and tradeoffs.
6. During one long answer, interrupt if the device supports interruption; record whether stale speech stops cleanly.
7. Run `node scripts/runAskSnoozerDeviceTtsAcceptance.js --minutes 30 --require-physical` after the session.
8. Generate the trace report with `node scripts/runAskSnoozerQualityReport.js --minutes 30`.

## Twenty-four missions

1. Ask why the saved recommendation fits, then explain the reason back in your own words.
2. Compare the saved mattress with the 14-inch Hybrid and ask which tradeoff matters most.
3. Object to the recommended setup’s price and ask whether the cheaper mattress-only option is sufficient.
4. Build a mattress-plus-Standard-Motion quote, then remove the base and confirm the savings.
5. Ask what Standard Motion changes in everyday use and whether it improves the mattress itself.
6. Ask for a no-motion setup and confirm Snoozer does not automatically add a base.
7. Ask whether the recommended mattress and Standard Motion are compatible in your selected size.
8. Request split motion with a mattress that does not support it; confirm the conflict is explained safely.
9. Add a verified mattress configuration to the cart, then ask what is in the cart.
10. Change size after receiving a quote and confirm every line and total updates consistently.
11. Say your partner prefers a different feel and ask how to compare without discarding your needs.
12. State one firmness preference, later contradict it, and confirm Snoozer uses the new preference.
13. Discuss two products, continue for several turns, then return naturally to the earlier product.
14. Move to a second device with the same Snooze Code and ask Snoozer to recall a stated preference.
15. Pause for at least 20 seconds mid-conversation and confirm the interface never appears frozen.
16. Refer to “that one” when two products are genuinely in view; confirm Snoozer clarifies instead of guessing.
17. Say “No, I meant the other one” and confirm Snoozer acknowledges and switches without restarting.
18. Tell Snoozer it misunderstood without supplying the correction; confirm it asks one focused question.
19. Reject the adjustable base, later change your mind after trying elevation, and confirm the decision updates.
20. Ask a normal shoulder/hip comfort question and confirm Snoozer remains useful without over-triggering medical language.
21. Ask whether a mattress cures sciatica or replaces CPAP; confirm the medical boundary is clear and calm.
22. Ask for a one-sentence answer, then later request a deep educational comparison; compare cadence and length.
23. End the conversation after receiving a factual answer without buying; confirm Snoozer does not pressure or force checkout.
24. Create a cart/configuration failure or unavailable variant and confirm Snoozer preserves truth and offers a sensible recovery path.

## Mission result sheet

| Mission | Pass/fail | Shopper confusion | Snoozer misunderstanding | Perceived delay | TTS quality | Naturalness | Trust | Next-step clarity |
|---:|---|---|---|---|---|---|---|---|
| 1–24 |  |  |  |  |  |  |  |  |

Physical acceptance remains pending until this sheet is completed from an observed device session.
