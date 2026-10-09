import { describe, expect, it } from "@jest/globals";
import { nextOrderNumber, productionOrderNumber, productionOrderSequence, productionRollNumber, previewOrderNumber } from "../server/order-number";
import { PgDialect } from "drizzle-orm/pg-core";

describe("order number allocation", () => {
  it("previews the next available number without locks, writes or consuming it", async () => {
    const queries: string[] = [];
    const dialect = new PgDialect();
    const tx = { execute: async (query: any) => {
      const statement = dialect.sqlToQuery(query).sql;
      queries.push(statement);
      return { rows: [statement.includes("MAX(sequence)") ? { max_number: null } : { used: false }] };
    } };
    expect(await previewOrderNumber(tx)).toBe("O0001");
    expect(await previewOrderNumber(tx)).toBe("O0001");
    expect(queries.every(query => query.trim().startsWith("SELECT"))).toBe(true);
    expect(queries.some(query => /INSERT|UPDATE|DELETE|advisory/.test(query))).toBe(false);
  });
  it("starts with O and four digits", () => {
    expect(nextOrderNumber(null)).toBe("O0001");
  });

  it("continues existing numeric numbers including leading zeros", () => {
    expect(nextOrderNumber("000154")).toBe("O0155");
    expect(nextOrderNumber("9999")).toBe("O10000");
    expect(nextOrderNumber("99999")).toBe("O100000");
    expect(nextOrderNumber("999999")).toBe("O1000000");
    expect(nextOrderNumber("9007199254740993")).toBe("O9007199254740994");
  });

  it("fails explicitly before the production-order suffix could be truncated", () => {
    expect(() => nextOrderNumber("9".repeat(44))).toThrow("الحد الأقصى");
    expect(() => nextOrderNumber("abc")).toThrow("غير صالح");
  });

  it("numbers children per new-format parent, expanding without wrapping", () => {
    expect(productionOrderNumber("O0001", 1)).toBe("O0001-JO01");
    expect(productionOrderNumber("O0001", 2)).toBe("O0001-JO02");
    expect(productionOrderNumber("O0002", 1)).toBe("O0002-JO01");
    expect(productionOrderNumber("O00001", 1)).toBe("O00001-JO01");
    expect(productionOrderNumber("O00001", 2)).toBe("O00001-JO02");
    expect(productionOrderNumber("O00002", 1)).toBe("O00002-JO01");
    expect(productionOrderNumber("O00001", 100)).toBe("O00001-JO100");
    expect(productionOrderSequence("O00001", "O00001-JO100")).toBe(100);
  });

  it("numbers new rolls per production order without altering historical formats", () => {
    expect(productionRollNumber("O0001-JO01", 1, true)).toBe("O0001-JO01-R01");
    expect(productionRollNumber("O0001-JO01", 2, true)).toBe("O0001-JO01-R02");
    expect(productionRollNumber("O0001-JO02", 1, true)).toBe("O0001-JO02-R01");
    expect(productionRollNumber("O0001-JO01", 100, true)).toBe("O0001-JO01-R100");
    expect(productionRollNumber("O00001-JO01", 1, false)).toBe("O00001-JO01-R001");
    expect(productionRollNumber("000154-01", 2, false)).toBe("000154-01-R002");
    for (const sequence of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => productionRollNumber("O0001-JO01", sequence, true)).toThrow("غير صالح");
    }
  });

  it("keeps legacy parents in their existing series", () => {
    expect(productionOrderNumber("000154", 3)).toBe("000154-03");
    expect(productionOrderNumber("TEST-7", 3)).toBe("TEST-7-03");
    expect(productionOrderSequence("TEST-7", "TEST-7-03")).toBe(3);
  });

  it("ignores unrelated or invalid child suffixes", () => {
    for (const value of ["O00002-JO99", "O00001-99", "O00001-JO1.5", "O00001-JO", "O00001-JO9007199254740993"]) {
      expect(productionOrderSequence("O00001", value)).toBe(0);
    }
  });

  it("rejects invalid or overlong child identifiers without truncation", () => {
    for (const sequence of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => productionOrderNumber("O00001", sequence)).toThrow("غير صالح");
    }
    expect(() => productionOrderNumber(`O${"1".repeat(44)}`, 100)).toThrow("الحد الأقصى");
  });
});