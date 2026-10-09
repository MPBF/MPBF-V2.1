import { describe, expect, it } from "@jest/globals";
import { canStartFilmProductionOrder } from "../shared/production";

const ready = { status: "pending", order_status: "for_production", batch_number: null,
  final_quantity_kg: "330.00", previous_status: null, started_at: null,
  film_closed_at: null, completed_at: null };

describe("film ready plans", () => {
  it.each(["for_production", "in_production"])("shows pending work of %s parents", order_status => {
    expect(canStartFilmProductionOrder({ ...ready, order_status })).toBe(true);
  });
  it.each([null, "", "pending"])("accepts untouched previous status %s", previous_status => {
    expect(canStartFilmProductionOrder({ ...ready, previous_status })).toBe(true);
  });
  it.each(["waiting", "on_hold", "paused", "cancelled", "completed", "delivered", "archived"])(
    "excludes %s parents", order_status => expect(canStartFilmProductionOrder({ ...ready, order_status })).toBe(false),
  );
  it.each(["active", "paused", "completed", "cancelled", "archived"])(
    "excludes %s children", status => expect(canStartFilmProductionOrder({ ...ready, status })).toBe(false),
  );
  it.each([
    { previous_status: "active" }, { batch_number: "HISTORICAL" },
    { started_at: "2026-10-05" }, { film_closed_at: "2026-10-05" }, { completed_at: "2026-10-05" },
  ])("excludes historical/executed work %p", change => {
    expect(canStartFilmProductionOrder({ ...ready, ...change })).toBe(false);
  });
  it.each(["0", "-1", "", "NaN", "Infinity", "1e3", "1,000", "0.001", "1000000000000"])(
    "excludes invalid targets %s", final_quantity_kg => expect(canStartFilmProductionOrder({ ...ready, final_quantity_kg })).toBe(false),
  );
  it("does not mutate the plan", () => {
    const frozen = Object.freeze({ ...ready });
    expect(canStartFilmProductionOrder(frozen)).toBe(true);
    expect(frozen.started_at).toBeNull();
    expect(frozen.order_status).toBe("for_production");
  });
});
