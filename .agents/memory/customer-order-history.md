---
name: Customer history actual output
description: User-approved meaning of actual production in a customer's order history.
---

Customer history uses output from the final manufacturing stage only, not the
most recently executed intermediate stage. Show zero if no final-stage output
exists. Count partially completed final output without waiting for the whole
production order to finish.

**Why:** the user explicitly approved «نعم، ومن لم يصل للمرحلة النهائية يظهر
إنتاجه صفرًا» when choosing between final-stage output and the latest performed
stage.

**How to apply:** use net cutting output for cut products, and finished roll
weights for roll products that skip cutting (after printing when required).
Never sum stage inputs and outputs, use planned overrun as requested quantity,
cap actual output at the target, or subtract warehouse receipts/deliveries.
