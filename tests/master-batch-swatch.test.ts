import { describe, expect, jest, test } from "@jest/globals";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
jest.mock("../client/src/components/MasterBatchSwatch.css", () => ({}));
jest.mock("../client/src/i18n", () => ({
  translate: (text: string) => text,
  localizedName: (ar: string, en: string, fallback: string) => ar || en || fallback,
}));
import MasterBatchSwatch from "../client/src/components/MasterBatchSwatch";

describe("shared master-batch SVG swatch", () => {
  test("transparent is a white circle with black SVG stripes, not a background-only effect", () => {
    const markup = renderToStaticMarkup(createElement(MasterBatchSwatch, {
      color: { name_ar: "شفاف", color_hex: "#ffffff" }, size: 34,
    }));
    expect(markup).toContain('data-transparent="true"');
    expect(markup).toContain('fill="#ffffff"');
    expect(markup).toContain('stroke="#000000"');
    expect(markup).toContain('patternTransform="rotate(45)"');
    expect(markup).toContain('aria-label="شفاف"');
    expect(markup).toContain('fill="url(#master-batch-');
  });
  test("ordinary white is solid white with no stripes", () => {
    const markup = renderToStaticMarkup(createElement(MasterBatchSwatch, {
      color: { name_ar: "أبيض", name: "White", color_hex: "#ffffff" },
    }));
    expect(markup).toContain('data-transparent="false"');
    expect(markup).not.toContain("<pattern");
    expect(markup).toContain('fill="#ffffff"');
  });
  test("multiple swatches have unique pattern IDs", () => {
    const markup = renderToStaticMarkup(createElement(Fragment, null,
      createElement(MasterBatchSwatch, { color: { color_hex: "transparent" } }),
      createElement(MasterBatchSwatch, { color: { color_hex: "transparent" } }),
    ));
    const ids = [...markup.matchAll(/<pattern id="([^"]+)"/g)].map(match => match[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});