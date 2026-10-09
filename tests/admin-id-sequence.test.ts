import { describe, expect, it, jest } from "@jest/globals";
import { nextAdminIdNumber } from "../server/admin-id-sequence";

describe("database-backed admin identifiers", () => {
  it("advances a persistent sequence past observed legacy rows while locked by the caller", async () => {
    const results: any[] = [
      { rows: [{ value: "4" }] },
      { rows: [{ value: "21" }] },
      { rows: [{ value: "22" }] },
    ];
    const execute = jest.fn(async () => results.shift());
    const number = await nextAdminIdNumber({ execute }, "categories", "20");
    expect(number).toBe("22");
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("uses the next sequence value directly when it is beyond the active maximum", async () => {
    const execute = jest.fn(async () => ({ rows: [{ value: "9" }] }));
    expect(await nextAdminIdNumber({ execute }, "sections", "8")).toBe("9");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});