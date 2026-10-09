---
name: Dominant color extraction (image-utils.extractColors)
description: Why the "extract colors from image" tool clusters perceptually and ignores white by default.
---

# Dominant color extraction

The rule for `extractColors` (client/src/lib/image-utils.ts): return the colors covering the
largest AREA and collapse shades/gradients of one hue into a SINGLE color. Do NOT rank raw
quantized pixel buckets — that splits one gradient into many near-duplicates and lets a small
solid color outrank the true dominant one. Cluster perceptually (CIELAB, not RGB) and report
each color's area share.

**Why ignoreWhite defaults true:** this is a plastic-bag printing tool (Color Mixtures /
PrintingStep). White is the bag substrate, not an ink. Black stays (valid print ink).

**How to apply:** percentages are ABSOLUTE area share and intentionally may not sum to 100
(background dropped + a small-cluster filter). Don't "normalize to 100". Keep the
`ExtractedColor` return shape stable — both the Tools page uploader and PrintingStep rely on it.
