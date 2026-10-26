import { describe, expect, it } from "@jest/globals";
import { extractPrintColors, removePrintBackground } from "../client/src/lib/print-color-extraction";

function artwork(draw: (x: number, y: number) => number[], width = 100, height = 100) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(draw(x, y), (y * width + x) * 4);
  return extractPrintColors(data, width, height);
}
const white = [255, 255, 255, 255];
describe("spot printing color extraction", () => {
  it("collapses a green gradient while keeping navy as a distinct ink", () => {
    const result = artwork((x, y) => x < 5 || y < 5 || x > 94 || y > 94 ? white :
      x < 65 ? [10, 90 + y, 40 + y / 3, 255] : [32, 32, 112, 255]);
    expect(result).toHaveLength(2);
    expect(result).toContain("#202070");
  });
  it("removes connected gray background and white substrate, not internal black ink", () => {
    const result = artwork((x, y) => x < 15 || y < 15 || x > 84 || y > 84 ? [72, 72, 72, 255] :
      x < 40 ? [0, 0, 0, 255] : x < 65 ? white : [16, 152, 72, 255]);
    expect(result).toEqual(expect.arrayContaining(["#000000", "#109848"]));
    expect(result).toHaveLength(2);
  });
  it("ignores transparent pixels and returns no inks for a white image", () => {
    expect(artwork(() => white)).toEqual([]);
    expect(artwork((x) => x < 50 ? [255, 0, 0, 0] : [0, 0, 0, 255])).toEqual(["#000000"]);
  });
  it("keeps separate chromatic inks and drops isolated noise", () => {
    const result = artwork((x, y) => x === 50 && y === 50 ? [0, 255, 0, 255] :
      y < 10 || y > 90 || x < 10 || x > 90 ? white :
      x < 35 ? [224, 32, 32, 255] : x < 65 ? [32, 32, 176, 255] : [240, 208, 16, 255]);
    expect(result).toHaveLength(3);
  });
  it("merges pale anti-aliasing tints with their underlying inks", () => {
    const shades = [[24, 160, 80, 255], [48, 48, 136, 255], [216, 216, 232, 255], [192, 232, 208, 255]];
    const result = artwork((x, y) => x < 5 || y < 5 || x > 94 || y > 94 ? white : shades[Math.min(3, Math.floor((x - 5) / 23))]);
    expect(result).toHaveLength(2);
  });
  it("rejects malformed pixel buffers", () => {
    expect(() => extractPrintColors(new Uint8ClampedArray(0), 2, 2)).toThrow();
  });
  it("makes backgrounds transparent before extraction without recoloring interior ink", () => {
    const pixels = new Uint8ClampedArray(20 * 20 * 4);
    for (let i = 0; i < 400; i++) pixels.set([72, 72, 72, 255], i * 4);
    pixels.set([255, 255, 255, 255], (10 * 20 + 10) * 4);
    pixels.set([20, 160, 70, 255], (10 * 20 + 11) * 4);
    const cleaned = removePrintBackground(pixels, 20, 20);
    expect(cleaned[3]).toBe(0);
    expect(cleaned[(10 * 20 + 10) * 4 + 3]).toBe(0);
    expect([...cleaned.slice((10 * 20 + 11) * 4, (10 * 20 + 11) * 4 + 4)]).toEqual([20, 160, 70, 255]);
    expect(pixels[3]).toBe(255);
  });
});
