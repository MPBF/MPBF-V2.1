---
name: pdfkit Arabic rendering
description: Correct way to render Arabic text in pdfkit-generated PDFs in this project
---

**Rule:** With pdfkit + an embedded Arabic TTF (Amiri), pass the ORIGINAL Unicode text and add `features: ["rtla"]` to `doc.text()` options. Do NOT pre-process with `processArabicText` (arabic-reshaper + bidi reorder) — fontkit re-shapes the presentation forms and the output comes out disconnected AND reversed.

**Why:** pdfkit's fontkit already performs Arabic contextual shaping; `rtla` handles right-to-left run direction including correct line-wrap order for long paragraphs. Verified visually via pdftoppm renders (Aug 2026).

**How to apply:**
- Use `prepareArabicForPdf()` in `arabic-text-service` before `doc.text(...)`: it pre-reverses number/Latin runs (else `120` renders as `021` under rtla) and mirrors brackets (else `(طن)` renders as `)طن(`).
- Gate `features: ["rtla"]` on the text/language actually being Arabic.
- Other pdfkit generators in the project (e.g. quote PDFs) still use the old reshape+bidi approach and likely have the same corruption for multi-word/long text.
- To verify PDF output visually: `pdftoppm -png -r 80 file.pdf out` then view the PNG.
