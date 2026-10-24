import { performance } from "node:perf_hooks";
import type { Connection } from "./core";
import type { ProductionHistoryKind, ProductionStateScope } from "../../shared/production";

// Deliberately closed dimensions: never accept URLs, SQL, IDs, filters or errors.
export type ReadDimensions =
  | { operation: "state"; view: ProductionStateScope }
  | { operation: "history"; view: ProductionHistoryKind; search: boolean; filtered: boolean; paged: boolean };
type Config = { enabled: boolean; sampleRate: number; slowMs: number; largeBytes: number; intervalMs: number };
type Event = ReadDimensions & {
  event: "production_read"; outcome: "ok" | "error"; duration_ms: number;
  pool_ms: number; query_ms: number; query_count: number; bytes: number | null;
  slow: boolean; large: boolean; sampled: boolean; suppressed: number;
};
const numeric = (env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number) => {
  const value = env[key]?.trim();
  const number = value ? Number(value) : NaN;
  return Number.isFinite(number) && number >= min && number <= max ? number : fallback;
};
export function readPerformanceConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    enabled: env.PRODUCTION_READ_METRICS_ENABLED !== "false",
    sampleRate: numeric(env, "PRODUCTION_READ_METRICS_SAMPLE_RATE", 0.01, 0, 1),
    slowMs: numeric(env, "PRODUCTION_READ_METRICS_SLOW_MS", 1000, 1, 3600000),
    largeBytes: numeric(env, "PRODUCTION_READ_METRICS_LARGE_BYTES", 262144, 1, 1073741824),
    intervalMs: numeric(env, "PRODUCTION_READ_METRICS_INTERVAL_MS", 60000, 1000, 3600000),
  };
}

export class ProductionReadPerformance {
  // Fixed cardinality (7 state views + 5 history kinds, sample/warning channels).
  private readonly buckets = new Map<string, { last: number; suppressed: number }>();
  constructor(
    private readonly config = readPerformanceConfig(),
    private readonly emit: (event: Event, warning: boolean) => void = (event, warning) =>
      (warning ? console.warn : console.info)(JSON.stringify(event)),
    private readonly now = () => performance.now(),
    private readonly random = () => Math.random(),
  ) {}

  async measure<T>(dimensions: ReadDimensions, action: (timing: {
    connected(): void; connection(tx: Connection): Connection;
  }) => Promise<T>): Promise<T> {
    if (!this.config.enabled) return action({ connected() {}, connection: tx => tx });
    const start = this.now();
    const key = `${dimensions.operation}:${dimensions.view}`;
    const sampled = this.random() < this.config.sampleRate && this.available(`${key}:sample`, start);
    if (sampled) this.buckets.set(`${key}:sample`, { last: start, suppressed: 0 });
    let poolMs = 0, queryMs = 0, queryCount = 0, connected = false;
    const timing = {
      connected: () => { connected = true; poolMs = this.now() - start; },
      connection: (tx: Connection): Connection => ({
        release: () => tx.release(),
        query: async (text, values) => {
          const queryStart = this.now();
          try { return await tx.query(text, values); }
          finally { queryMs += this.now() - queryStart; queryCount++; }
        },
      }),
    };
    let outcome: "ok" | "error" = "error", result: T | undefined;
    try {
      result = await action(timing);
      outcome = "ok";
      return result;
    } finally {
      // Monitoring must never change a successful response or hide its error.
      try {
        let duration = this.now() - start;
        const slow = duration >= this.config.slowMs;
        const warningAvailable = this.available(`${key}:warning`, this.now());
        if (sampled || ((slow || outcome === "error") && warningAvailable)) {
          const bytes = outcome === "ok" ? Buffer.byteLength(JSON.stringify(result) ?? "null", "utf8") : null;
          duration = this.now() - start; // Includes the sampled serialization cost.
          const large = bytes !== null && bytes >= this.config.largeBytes;
          const warning = slow || duration >= this.config.slowMs || large || outcome === "error";
          const channel = `${key}:${warning ? "warning" : "sample"}`;
          if (!warning || this.available(channel, this.now())) {
            const suppressed = this.buckets.get(channel)?.suppressed ?? 0;
            this.buckets.set(channel, { last: this.now(), suppressed: 0 });
            this.emit({ ...dimensions, event: "production_read", outcome,
              duration_ms: Math.round(duration), pool_ms: Math.round(connected ? poolMs : duration),
              query_ms: Math.round(queryMs), query_count: queryCount, bytes,
              slow: slow || duration >= this.config.slowMs, large, sampled, suppressed }, warning);
          } else this.suppress(channel);
        } else if (slow || outcome === "error") this.suppress(`${key}:warning`);
      } catch { /* No payloads or error messages may be logged here. */ }
    }
  }
  private available(key: string, now: number) {
    const bucket = this.buckets.get(key);
    return !bucket || now - bucket.last >= this.config.intervalMs;
  }
  private suppress(key: string) {
    const bucket = this.buckets.get(key);
    if (bucket) bucket.suppressed++;
  }
}

export const productionReadPerformance = new ProductionReadPerformance();
