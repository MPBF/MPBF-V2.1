import { describe, expect, it, jest } from "@jest/globals";
import { ProductionExecutionService } from "../server/production/execution";
import { ProductionError, type Connection } from "../server/production/core";
import type { ProductionStage } from "../shared/production";

const at = new Date("2026-10-06T08:00:00Z");
type Roll = { stage: string; printed_at: Date | null; cut_completed_at: Date | null };
const unprinted: Roll = { stage: "film", printed_at: null, cut_completed_at: null };
const printed: Roll = { stage: "printing", printed_at: at, cut_completed_at: null };
const done: Roll = { stage: "done", printed_at: at, cut_completed_at: at };

function fixture(options: {
  started?: boolean; closed?: boolean; completed?: boolean; printed?: boolean; rollProduct?: boolean;
  rolls?: Roll[]; status?: string; orderStatus?: string;
} = {}) {
  const product = { id: 1, item_id: "ITM1", name: options.rollProduct ? "Plastic Roll" : "Bag",
    name_ar: null, width: "20", universal_thickness: "40", cutting_length_cm: 30, printing_cylinder: "12" };
  const queries: string[] = [];
  const query = jest.fn<Connection["query"]>(async (sql, values = []) => {
    queries.push(sql);
    if (sql.startsWith("SELECT id,order_id FROM production_orders"))
      return { rows: [{ id: 1, order_id: 2 }] };
    if (sql.includes("FROM production_orders p"))
      return { rows: [{ id: 1, order_id: 2, customer_product_id: 1, customer_id: "C1",
        status: options.status ?? "active", order_status: options.orderStatus ?? "in_production" }] };
    if (sql.startsWith("SELECT * FROM factory_execution"))
      return { rows: options.started === false ? [] : [{ product, is_printed: options.printed ?? true,
        is_roll_product: options.rollProduct ?? false, film_closed_at: options.closed === false ? null : at,
        completed_at: options.completed ? at : null }] };
    if (sql.includes("FROM customer_products cp"))
      return { rows: [{ product, is_printed: options.printed ?? true, status: "active" }] };
    if (sql.includes("FROM factory_rolls"))
      return { rows: options.rolls ?? [printed] };
    if (sql.startsWith("SELECT * FROM machines"))
      return { rows: [{ id: values[0], type: values[0] === "film" ? "extruder" : values[0], status: "active" }] };
    if (sql.startsWith("INSERT INTO factory_queues") || sql.startsWith("SELECT * FROM factory_queues"))
      return { rows: [{ id: 9, production_order_id: 1, stage: values[1], position: 1 }] };
    return { rows: [] };
  });
  const release = jest.fn();
  const service = new ProductionExecutionService({ connect: async () => ({ query, release }) });
  const queue = (stage: ProductionStage) => service.queue({ id: 1, permissions: ["manage_production"] },
    { request_id: "queue-request", production_order_id: 1, stage, machine_id: stage, position: 1 });
  return { queue, queries, release };
}

async function rejected(stage: ProductionStage, options: Parameters<typeof fixture>[0]) {
  const test = fixture(options);
  await expect(test.queue(stage)).rejects.toBeInstanceOf(ProductionError);
  expect(test.queries).toContain("ROLLBACK");
  expect(test.queries.some(sql => /^(INSERT|UPDATE|DELETE)\b/.test(sql))).toBe(false);
  expect(test.queries.some(sql => sql.includes("FROM machines"))).toBe(false);
  expect(test.release).toHaveBeenCalledTimes(1);
}

async function accepted(stage: ProductionStage, options: Parameters<typeof fixture>[0]) {
  const test = fixture(options);
  await expect(test.queue(stage)).resolves.toMatchObject({ id: 9 });
  expect(test.queries.filter(sql => sql.startsWith("INSERT INTO factory_queues"))).toHaveLength(1);
  expect(test.queries.some(sql => sql.startsWith("UPDATE factory_queues"))).toBe(true);
  expect(test.queries.some(sql => sql.startsWith("INSERT INTO factory_operations"))).toBe(true);
  expect(test.queries).toContain("COMMIT");
  expect(test.queries).not.toContain("ROLLBACK");
  expect(test.release).toHaveBeenCalledTimes(1);
}

describe("production queue stage eligibility before writes", () => {
  it("rejects completed printing for closed-film bags waiting for cutting", async () => {
    await rejected("printing", { rolls: [printed, done] });
    await accepted("cutting", { rolls: [printed, done] });
  });
  it("rejects requeueing inline-printed rolls after film closes", async () => {
    await rejected("printing", { rolls: [printed] });
  });
  it("accepts printing when at least one real roll still needs it", async () => {
    await accepted("printing", { rolls: [done, printed, unprinted] });
  });
  it("does not consider an unprinted done roll eligible for printing", async () => {
    await rejected("printing", { rolls: [{ ...done, printed_at: null }] });
  });
  it.each(["printing", "cutting"] as const)("rejects %s with no rolls after closure", async stage => {
    await rejected(stage, { rolls: [] });
  });
  it("rejects cutting without eligible printed rolls after closure", async () => {
    await rejected("cutting", { rolls: [unprinted, done] });
  });
  it("accepts cutting plain bags and rejects already-cut rolls", async () => {
    await accepted("cutting", { printed: false, rolls: [unprinted] });
    await rejected("cutting", { rolls: [done, { ...printed, cut_completed_at: at }] });
  });
  it.each(["film", "printing", "cutting"] as const)("preserves pre-start %s planning", async stage => {
    await accepted(stage, { started: false, rolls: [] });
  });
  it.each(["film", "printing", "cutting"] as const)("preserves %s planning during open film", async stage => {
    await accepted(stage, { closed: false, rolls: [done] });
    await accepted(stage, { closed: false, rolls: [] });
  });
  it("rejects closed film and stages not required by the product", async () => {
    await rejected("film", {});
    await rejected("printing", { closed: false, printed: false });
    await rejected("cutting", { closed: false, rollProduct: true });
  });
  it("accepts unfinished printing for plastic rolls but never cutting", async () => {
    await accepted("printing", { rollProduct: true, rolls: [unprinted] });
    await rejected("cutting", { rollProduct: true, rolls: [unprinted] });
    await rejected("printing", { rollProduct: true, rolls: [done] });
  });
  it.each(["film", "printing", "cutting"] as const)("rejects %s on completed execution", async stage => {
    await rejected(stage, { closed: false, completed: true, rolls: [unprinted] });
  });
  it.each(["completed", "cancelled", "archived"])("preserves the %s order guard", async status => {
    await rejected("printing", { status, rolls: [unprinted] });
  });
  it("preserves the paused parent-order guard", async () => {
    await rejected("printing", { orderStatus: "on_hold", rolls: [unprinted] });
  });
});
