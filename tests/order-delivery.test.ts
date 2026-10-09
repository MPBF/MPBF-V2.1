import { describe, expect, it } from "@jest/globals";
import { deliveryDateFromDays, orderDateInRiyadh } from "../server/order-delivery";

describe("order delivery calendar dates", () => {
  it("uses the Riyadh order date, including at the UTC day boundary", () => {
    expect(orderDateInRiyadh(new Date("2026-09-30T21:30:00Z"))).toBe("2026-10-01");
    expect(deliveryDateFromDays("2026-10-01", 20)).toBe("2026-10-21");
  });

  it("handles the next day, month boundaries, and leap years", () => {
    expect(deliveryDateFromDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(deliveryDateFromDays("2028-02-28", 2)).toBe("2028-03-01");
  });

  it("rejects invalid periods and dates", () => {
    expect(() => deliveryDateFromDays("2026-02-30", 20)).toThrow();
    expect(() => deliveryDateFromDays("2026-10-01", 0)).toThrow();
    expect(() => deliveryDateFromDays("2026-10-01", 3651)).toThrow();
  });
});