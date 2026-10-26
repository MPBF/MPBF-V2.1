---
name: Printing artwork colors
description: User-approved background removal, distinct ink colors and replacement behavior for customer product artwork.
---

# Dominant color extraction

The rule for printing artwork color extraction: return the colors covering the
largest AREA and collapse shades/gradients of one hue into a SINGLE color. Do NOT rank raw
quantized pixel buckets — that splits one gradient into many near-duplicates and lets a small
solid color outrank the true dominant one. Cluster perceptually (CIELAB, not RGB) and report
each color's area share.

**Why ignore white:** this is a plastic-bag printing tool. White is the bag substrate,
not an ink. Black stays a valid print ink; do not discard all neutral colors.

**How to apply:** merge shades and anti-aliased pale edges into the underlying ink,
not separate colors. The user's supplied green/navy factory logo must yield exactly
two ink colors, excluding white and its surrounding gray backdrop.

In the customer product form, remove the background from the image itself first,
then read colors from that processed image. Keep front and back artwork independent
and allow manual color editing.

**Why:** the user explicitly requested background removal before reading colors,
not merely omission of the background from the resulting palette.
**How to apply:** use the transparent processed image as the saved preview as well
as the extraction source. Replacing a face's image replaces that face's palette;
the user selected replacement rather than appending to the old colors. Do not
reprocess historical artwork merely by opening a saved product.
