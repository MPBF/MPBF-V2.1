/**
 * Spot-ink estimation, not a photographic palette: ignore the substrate and
 * connected outer background, cluster perceptually, then merge same-hue shades.
 * This is deliberately local; artwork is never sent to an external service.
 */
type Color = { rgb: number[]; lab: number[]; hue: number; saturation: number; count: number };
const distance = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]));
const hueDistance = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
function color(rgb: number[], count = 1): Color {
  const [r, g, b] = rgb.map((v) => v / 255);
  const linear = [r, g, b].map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [lr, lg, lb] = linear;
  const f = (v: number) => v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116;
  const x = f((lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375) / 0.95047);
  const y = f(lr * 0.2126729 + lg * 0.7151522 + lb * 0.072175);
  const z = f((lr * 0.0193339 + lg * 0.119192 + lb * 0.9503041) / 1.08883);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const rawHue = !delta ? 0 : max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { rgb, lab: [116 * y - 16, 500 * (x - y), 200 * (y - z)], hue: (rawHue * 60 + 360) % 360, saturation: max ? delta / max : 0, count };
}
const white = (c: Color) => c.lab[0] > 91 && Math.hypot(c.lab[1], c.lab[2]) < 12;
const hex = (rgb: number[]) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/** Remove a coherent frame-connected background and white bag substrate.
 * Preserve original RGB and dimensions; only change alpha, never recolor ink.
 */
export function removePrintBackground(data: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  if (width < 1 || height < 1 || data.length !== width * height * 4) throw new Error("Invalid image pixels");
  const result = new Uint8ClampedArray(data);
  const border: number[] = [];
  for (let x = 0; x < width; x++) { border.push(x); if (height > 1) border.push((height - 1) * width + x); }
  for (let y = 1; y < height - 1; y++) { border.push(y * width); if (width > 1) border.push(y * width + width - 1); }
  const buckets = new Map<string, { rgb: number[]; count: number }>();
  for (const i of border) {
    if (data[i * 4 + 3] < 128) continue;
    const rgb = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
    const key = rgb.map((v) => Math.round(v / 16)).join(",");
    const entry = buckets.get(key);
    if (entry) entry.count++; else buckets.set(key, { rgb, count: 1 });
  }
  const background = [...buckets.values()].sort((a, b) => b.count - a.count)[0]?.rgb;
  if (background) {
    const matches = (i: number) => data[i * 4 + 3] >= 128 &&
      (data[i * 4] - background[0]) ** 2 + (data[i * 4 + 1] - background[1]) ** 2 + (data[i * 4 + 2] - background[2]) ** 2 < 50 ** 2;
    const seeds = border.filter(matches);
    if (seeds.length > border.length * 0.6) {
      const seen = new Uint8Array(width * height);
      const queue = new Int32Array(width * height);
      let tail = 0;
      for (const i of seeds) if (!seen[i]) { seen[i] = 1; queue[tail++] = i; }
      for (let head = 0; head < tail; head++) {
        const i = queue[head], x = i % width;
        result[i * 4 + 3] = 0;
        const visit = (next: number) => {
          if (next >= 0 && next < seen.length && !seen[next] && matches(next)) {
            seen[next] = 1; queue[tail++] = next;
          }
        };
        visit(i - width); visit(i + width);
        if (x > 0) visit(i - 1);
        if (x < width - 1) visit(i + 1);
      }
    }
  }
  for (let i = 0; i < width * height; i++) {
    const offset = i * 4;
    const min = Math.min(data[offset], data[offset + 1], data[offset + 2]);
    const max = Math.max(data[offset], data[offset + 1], data[offset + 2]);
    if (min > 232 && max - min < 18) result[offset + 3] = 0;
  }
  return result;
}

export function extractPrintColors(data: Uint8ClampedArray, width: number, height: number): string[] {
  if (width < 1 || height < 1 || data.length !== width * height * 4) throw new Error("Invalid image pixels");
  data = removePrintBackground(data, width, height);
  const pixels: (Color | null)[] = new Array(width * height);
  const cache = new Map<number, Color>();
  for (let i = 0; i < pixels.length; i++) {
    const offset = i * 4, alpha = data[offset + 3] / 255;
    if (alpha < 0.5) { pixels[i] = null; continue; }
    // Composite partially transparent edge pixels onto the white substrate.
    const rgb = [0, 1, 2].map((j) => Math.min(255, Math.round((data[offset + j] * alpha + 255 * (1 - alpha)) / 8) * 8));
    const key = rgb[0] * 65536 + rgb[1] * 256 + rgb[2];
    if (!cache.has(key)) cache.set(key, color(rgb));
    pixels[i] = cache.get(key)!;
  }
  const counts = new Map<Color, number>();
  pixels.forEach((c) => { if (c && !white(c)) counts.set(c, (counts.get(c) || 0) + 1); });
  const samples = [...counts].map(([c, count]) => ({ ...c, count })).sort((a, b) => b.count - a.count);
  if (!samples.length) return [];
  // Weighted farthest-point seeds avoid letting a broad gradient occupy every
  // palette slot while a smaller, distinct printing ink disappears.
  let centers = [samples[0].lab];
  while (centers.length < 16) {
    const candidate = samples.reduce((best, c) => {
      const score = Math.min(...centers.map((v) => distance(c.lab, v)));
      return score > best.score && c.count >= 2 ? { c, score } : best;
    }, { c: samples[0], score: 18 });
    if (candidate.score <= 18) break;
    centers.push(candidate.c.lab);
  }
  let groups: Color[][] = [];
  for (let pass = 0; pass < 8; pass++) {
    groups = centers.map(() => []);
    for (const sample of samples) {
      let index = 0, nearest = Infinity;
      centers.forEach((c, i) => { const d = distance(sample.lab, c); if (d < nearest) { nearest = d; index = i; } });
      groups[index].push(sample);
    }
    centers = groups.map((group, i) => {
      const count = group.reduce((sum, c) => sum + c.count, 0);
      return count ? [0, 1, 2].map((j) => group.reduce((sum, c) => sum + c.lab[j] * c.count, 0) / count) : centers[i];
    });
  }
  const representative = (group: Color[]) => {
    const count = group.reduce((sum, c) => sum + c.count, 0);
    return color([0, 1, 2].map((j) => group.reduce((sum, c) => sum + c.rgb[j] * c.count, 0) / count), count);
  };
  groups = groups.filter((g) => g.length).sort((a, b) => representative(b).count - representative(a).count);
  const merged: Color[][] = [];
  for (const group of groups) {
    const c = representative(group);
    const match = merged.find((g) => {
      const other = representative(g);
      // Anti-aliased ink on white can have very low saturation but still has
      // the same hue. Keep those pale edge tints with their parent ink.
      const chromatic = c.saturation > 0.06 && other.saturation > 0.06 &&
        Math.hypot(c.lab[1], c.lab[2]) > 6 && Math.hypot(other.lab[1], other.lab[2]) > 6;
      return distance(c.lab, other.lab) < 18 || (chromatic && hueDistance(c.hue, other.hue) < 24);
    });
    if (match) match.push(...group); else merged.push([...group]);
  }
  const total = samples.reduce((sum, c) => sum + c.count, 0);
  return merged.filter((g) => representative(g).count >= Math.max(3, total * 0.012))
    .sort((a, b) => representative(b).count - representative(a).count)
    .map((g) => {
      // A real, prevalent shade rather than an invented average of edge tints.
      const prevalent = [...g].sort((a, b) => b.count - a.count)[0];
      return hex(prevalent.rgb);
    });
}

export async function preparePrintArtwork(source: string): Promise<{ image: string; colors: string[] }> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Image decoding failed"));
    image.src = source;
  });
  // Bound decoded allocations explicitly; do not silently reduce print resolution.
  if (image.naturalWidth * image.naturalHeight > 16_000_000) throw new Error("Image dimensions too large");
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas unavailable");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  pixels.data.set(removePrintBackground(pixels.data, canvas.width, canvas.height));
  context.putImageData(pixels, 0, 0);
  const processed = canvas.toDataURL("image/png");
  const scale = Math.min(1, 256 / Math.max(canvas.width, canvas.height));
  const sample = document.createElement("canvas");
  sample.width = Math.max(1, Math.round(canvas.width * scale));
  sample.height = Math.max(1, Math.round(canvas.height * scale));
  const sampleContext = sample.getContext("2d", { willReadFrequently: true });
  if (!sampleContext) throw new Error("Canvas unavailable");
  sampleContext.drawImage(canvas, 0, 0, sample.width, sample.height);
  const colors = extractPrintColors(sampleContext.getImageData(0, 0, sample.width, sample.height).data, sample.width, sample.height);
  return { image: processed, colors };
}
