import { describe, expect, it } from "@jest/globals";
import type { TransferColumn, TransferFile, TransferMapping, TransferPreview, TransferPreviewRow, TransferSchema, TransferTable } from "../shared/data-transfer";
import { makePreview, project } from "../server/data-transfer/validation";
import { DataTransferService } from "../server/data-transfer/service";
import type { TransferPool } from "../server/data-transfer/schema";

const column = (name: string, extra: Partial<TransferColumn> = {}): TransferColumn => ({
  name, labelAr: name, labelEn: name, type: "text", nullable: false, default: null,
  generated: false, writable: true, maxLength: null, precision: null, scale: null, ...extra,
});
const table: TransferTable = {
  name: "examples", labelAr: "", labelEn: "", group: "discovered",
  approved: true, exportable: true, importable: true, reasonAr: "", reasonEn: "",
  columns: [column("id"), column("name"), column("amount", { type: "integer", nullable: true })],
  keys: [["id"], ["name"]], relations: [],
};
const schema: TransferSchema = {
  version: "fixture", environment: "test", tables: [table], ready: true,
  limits: { bytes: 10000, rows: 2000, retentionDays: 30 },
};
const graph = { examples: [{ id: "old", name: "Original", amount: "7" }] };
const mapping: TransferMapping = {
  table: "examples", fileTable: "file", columns: { id: "id", name: "name", amount: "amount" },
  matchKey: ["id"], nullColumns: [],
};
function preview(rows: TransferFile["tables"][number]["rows"], customGraph = graph, customSchema = schema) {
  return makePreview(customSchema, {
    source: "same-database", tables: [{ name: "file", headers: ["id", "name", "amount"], rows }],
  }, [mapping], customGraph);
}

describe("new-only table import preview", () => {
  it("omits existing records even if changed or repeated, preserving source row numbers", () => {
    const rows = preview([
      { id: "old", name: "Changed", amount: "not an integer" },
      { id: "old", name: "Changed again" },
      { id: "new", name: "New", amount: "5" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ index: 2, status: "new", old: null, errors: [] });
    expect(project(graph, rows).examples[0]).toEqual(graph.examples[0]);
  });
  it("returns an empty preview for an all-existing file", () => {
    expect(preview([{ id: "old", name: "Changed" }])).toEqual([]);
  });
  it("reports invalid new records alongside valid new records", () => {
    const rows = preview([
      { id: "old", name: "Changed" },
      { id: "new", name: "New" },
      { id: "bad", amount: "bad" },
    ]);
    expect(rows.map(row => row.status)).toEqual(["new", "invalid"]);
    expect(rows[1].index).toBe(2);
    expect(rows[1].errors.some(error => error.column === "name")).toBe(true);
    expect(rows[1].errors.some(error => error.column === "amount")).toBe(true);
  });
  it("still rejects duplicate new identities and alternate unique-key collisions", () => {
    expect(preview([{ id: "new", name: "New" }, { id: "new", name: "Other" }])
      .some(row => row.status === "conflict")).toBe(true);
    expect(preview([{ id: "new", name: "Original" }])[0].status).toBe("conflict");
  });
  it("does not project skipped updates into validation of new records", () => {
    const rows = preview([{ id: "old", name: "Stolen" }, { id: "new", name: "Stolen" }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].errors).toEqual([]);
    expect(project(graph, rows).examples.map(row => row.name)).toEqual(["Original", "Stolen"]);
  });
  it("does not suppress an untrusted numeric match key", () => {
    const numericSchema = { ...schema, tables: [{ ...table, columns: table.columns.map(c => c.name === "id" ? column("id", { type: "integer" }) : c) }] };
    const rows = makePreview(numericSchema, {
      source: "external", tables: [{ name: "file", headers: ["id", "name", "amount"], rows: [{ id: "1", name: "Changed" }] }],
    }, [mapping], { examples: [{ id: "1", name: "Original" }] });
    expect(rows[0].status).toBe("invalid");
    expect(rows[0].errors.some(error => error.message.includes("not trusted"))).toBe(true);
  });
});

describe("server-enforced new-only application", () => {
  const service = new DataTransferService({} as TransferPool);
  const select = (rows: TransferPreviewRow[], approvals: { index: number; columns: string[] }[] = [], confirmNew = true, extra: Partial<TransferPreview> = {}) =>
    (service as any).selected({ preview: { kind: "import", importMode: "new-only", rows, ...extra } }, approvals, confirmNew);
  const rows = preview([{ id: "new", name: "New" }]);
  it("selects new rows only after explicit confirmation", () => {
    expect(select(rows)).toEqual(rows);
    expect(() => select(rows, [], false)).toThrow("Explicitly confirm");
  });
  it("blocks the entire batch when any new record is invalid", () => {
    expect(() => select(preview([{ id: "new", name: "New" }, { id: "bad", amount: "bad" }]))).toThrow("Entire batch rejected");
  });
  it("rejects forged update approvals and stale old-policy previews", () => {
    expect(() => select(rows, [{ index: 0, columns: ["name"] }])).toThrow("updates are not permitted");
    expect(() => select(rows, [], true, { importMode: undefined })).toThrow("create a new preview");
    expect(() => select([{ ...rows[0], old: graph.examples[0], status: "existing" }])).toThrow("create a new preview");
    expect(() => select([])).toThrow("Select at least one change");
  });
  it("preserves explicitly approved historical restore updates", () => {
    const row: TransferPreviewRow = {
      ...rows[0], status: "existing", old: graph.examples[0],
      values: { name: "Restored" }, changes: [{ column: "name", old: "Original", new: "Restored" }],
    };
    expect(select([row], [{ index: row.index, columns: ["name"] }], false, { kind: "restore", importMode: undefined }))
      .toEqual([row]);
  });
});
