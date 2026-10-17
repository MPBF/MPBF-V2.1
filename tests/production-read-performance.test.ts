import { describe, it, expect } from "@jest/globals";
import { ProductionReadPerformance, readPerformanceConfig } from "../server/production/read-performance";
import { historyReadDimensions } from "../server/production/history";
import { ProductionReadService } from "../server/production/read";
import type { Connection } from "../server/production/core";

function setup(options = {}) {
  let clock = 0, serialized = 0;
  const events: { event: any; warning: boolean }[] = [];
  const metrics = new ProductionReadPerformance({ ...readPerformanceConfig({}), sampleRate: 1, ...options },
    (event, warning) => events.push({ event, warning }), () => clock, () => 0);
  const payload = { toJSON() { serialized++; return { customer_name: "PRIVATE", notes: "SECRET", value: "ع".repeat(20) }; } };
  return { metrics, events, payload, tick: (ms: number) => { clock += ms; }, serialized: () => serialized };
}
const state = { operation: "state", view: "management" } as const;
describe("bounded, private production read performance", () => {
  it("validates configuration and supports a complete opt-out", async () => {
    expect(readPerformanceConfig({ PRODUCTION_READ_METRICS_SAMPLE_RATE: "NaN",
      PRODUCTION_READ_METRICS_SLOW_MS: "-1", PRODUCTION_READ_METRICS_INTERVAL_MS: "0" }))
      .toMatchObject({ sampleRate: 0.01, slowMs: 1000, intervalMs: 60000 });
    const s = setup({ enabled: false });
    expect(await s.metrics.measure(state, async () => s.payload)).toBe(s.payload);
    expect(s.events).toEqual([]); expect(s.serialized()).toBe(0);
  });
  it("records UTF-8 bytes and safe shape only, never filters or returned records", async () => {
    const s = setup();
    const dimensions = historyReadDimensions("orders", { search: "PRIVATE", order_id: 987, from: "2026-01-01", before: 44 });
    await s.metrics.measure(dimensions, async () => { s.tick(12); return s.payload; });
    expect(s.events[0].event).toMatchObject({ search: true, filtered: true, paged: true, duration_ms: 12,
      bytes: Buffer.byteLength(JSON.stringify(s.payload)), outcome: "ok" });
    expect(JSON.stringify(s.events)).not.toMatch(/PRIVATE|SECRET|987|2026-01-01|customer_name/);
  });
  it("does not serialize unsampled fast reads; still warns for slow reads", async () => {
    const s = setup({ sampleRate: 0, slowMs: 100 });
    await s.metrics.measure(state, async () => s.payload);
    expect(s.serialized()).toBe(0);
    await s.metrics.measure(state, async () => { s.tick(101); return s.payload; });
    expect(s.events[0]).toMatchObject({ warning: true, event: { slow: true, sampled: false } });
  });
  it("caps serialization and logs even when every response exceeds the byte threshold", async () => {
    const s = setup({ largeBytes: 1 });
    for (let i = 0; i < 100; i++) await s.metrics.measure(state, async () => s.payload);
    expect(s.events).toHaveLength(1); expect(s.serialized()).toBe(1);
    s.tick(60000);
    await s.metrics.measure(state, async () => s.payload);
    expect(s.events).toHaveLength(2);
  });
  it("rate limits slow warnings independently and reports suppression", async () => {
    const s = setup({ sampleRate: 0, slowMs: 10 });
    for (let i = 0; i < 3; i++) await s.metrics.measure(state, async () => { s.tick(11); return s.payload; });
    expect(s.events).toHaveLength(1); expect(s.serialized()).toBe(1);
    s.tick(60000);
    await s.metrics.measure(state, async () => { s.tick(11); return s.payload; });
    expect(s.events[1].event.suppressed).toBe(2);
  });
  it("preserves original errors and never records their messages", async () => {
    const s = setup(), error = new Error("PRIVATE SQL secret");
    await expect(s.metrics.measure(state, async () => { throw error; })).rejects.toBe(error);
    expect(s.events[0].event).toMatchObject({ outcome: "error", bytes: null });
    expect(JSON.stringify(s.events)).not.toMatch(/PRIVATE|SQL|secret/);
  });
  it("cannot change responses when the logging sink fails", async () => {
    const metrics = new ProductionReadPerformance({ ...readPerformanceConfig({}), sampleRate: 1 },
      () => { throw new Error("sink unavailable"); });
    expect(await metrics.measure(state, async () => 42)).toBe(42);
  });
  it("instruments real service transactions including pool waits, without weakening permissions", async () => {
    const s = setup();
    const commands: string[] = [];
    let released = false;
    const tx: Connection = { release() { released = true; }, async query(text) {
      commands.push(text); s.tick(2); return { rows: [] };
    } };
    const read = new ProductionReadService({ async connect() { s.tick(7); return tx; } }, s.metrics);
    await expect(read.history({ id: 1, permissions: [] }, "orders", {})).rejects.toMatchObject({ status: 403 });
    expect(commands).toEqual([]); expect(s.events).toEqual([]);
    expect(await read.history({ id: 1, permissions: ["admin"] }, "orders", { search: "PRIVATE" }))
      .toEqual({ records: [], next: null });
    expect(commands[0]).toBe("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(commands.at(-1)).toBe("COMMIT"); expect(released).toBe(true);
    expect(s.events[0].event).toMatchObject({ pool_ms: 7, query_ms: 6, query_count: 3, search: true });
    expect(JSON.stringify(s.events)).not.toContain("PRIVATE");
  });
  it("preserves read rollback/release and a failed connection without logging error details", async () => {
    const s = setup(), error = new Error("PRIVATE query parameters");
    const commands: string[] = [];
    let released = false;
    const read = new ProductionReadService({ async connect() { return {
      release() { released = true; },
      async query(text) {
        commands.push(text);
        if (text.startsWith("WITH")) throw error;
        return { rows: [] };
      },
    }; } }, s.metrics);
    await expect(read.history({ id: 1, permissions: ["admin"] }, "receipts", {})).rejects.toBe(error);
    expect(commands.at(-1)).toBe("ROLLBACK"); expect(released).toBe(true);
    expect(s.events[0].event).toMatchObject({ outcome: "error", bytes: null, query_count: 3 });
    const failedPool = new ProductionReadService({ async connect() { s.tick(80); throw error; } }, s.metrics);
    await expect(failedPool.state({ id: 1, permissions: ["admin"] }, "hall")).rejects.toBe(error);
    expect(s.events[1].event).toMatchObject({ outcome: "error", pool_ms: 80, query_count: 0 });
    expect(JSON.stringify(s.events)).not.toMatch(/PRIVATE|parameters/);
  });
});
