import { describe, expect, test } from "@jest/globals";
import { isTransparentMasterBatch } from "../client/src/lib/master-batch-color";

describe("transparent master-batch display", () => {
  test.each([
    { color_hex: "transparent" }, { color_hex: " Transparent " }, { color_hex: "شفاف" },
    { color_hex: "#0000" }, { color_hex: "#fff0" }, { color_hex: "#ffffff00" },
    { color_hex: "rgba(255, 255, 255, 0)" }, { name_ar: "شفاف" },
    { name_ar: "الماستر باتش الشفاف", color_hex: "#ffffff" }, { name: "Transparent", color_hex: "#ffffff" },
    { name: "Transparent natural" }, { id: "transparent" },
  ])("recognizes genuinely transparent values or labels: %j", color => {
    expect(isTransparentMasterBatch(color)).toBe(true);
  });
  test.each([
    undefined, null, {}, { color_hex: "#ffffff" }, { name_ar: "أبيض", color_hex: "#ffffff" },
    { name: "White", color_hex: "#fff" }, { color_hex: "#ffff" }, { color_hex: "#ffffffff" },
    { name_ar: "غير شفاف", color_hex: "#ffffff" }, { name: "Non-transparent white" },
    { name: "Opaque" }, { color_hex: "#000000" }, { color_hex: "rgba(255,255,255,0.5)" },
    { name: 42, color_hex: 42 },
  ])("keeps white, opaque, missing or malformed colors unstriped: %j", color => {
    expect(isTransparentMasterBatch(color)).toBe(false);
  });
});