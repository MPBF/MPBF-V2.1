import { describe, expect, it } from "@jest/globals";
import type { TransferColumn, TransferTable } from "../shared/data-transfer";
import { clearableMappingColumns, exactMappingSuggestions, mappedNullColumns, writableMappingColumns } from "../client/src/lib/data-transfer-mapping";

const column = (name: string, overrides: Partial<TransferColumn> = {}): TransferColumn => ({
  name, labelAr: name, labelEn: name, type: "text", nullable: true,
  default: null, generated: false, writable: true, maxLength: null,
  precision: null, scale: null, ...overrides,
});

describe("import bindings follow the server writable-column policy", () => {
  it("never auto-maps derived or protected fields, including matching labels", () => {
    const target = { ...table, columns: [
      column("name", { labelAr: "الاسم" }),
      column("universal_thickness", { writable: false }),
      column("computed", { writable: false, generated: true, labelEn: "Total" }),
      column("id", { generated: true, default: "nextval('example_id_seq')" }),
    ] };
    expect(exactMappingSuggestions([" الاسم ", "universal_thickness", "Total", "id", "missing"], target))
      .toEqual({ " الاسم ": "name", id: "id" });
  });
  it("drops stale sources and skips protected/retired targets from saved bindings", () => {
    expect(writableMappingColumns(["Name", "Derived", "Retired", "Skip"], table, {
      Name: "name", Derived: "protected", Retired: "missing", Skip: "", OldHeader: "notes",
    })).toEqual({ Name: "name", Derived: "", Retired: "", Skip: "" });
  });
  it("does not guess between ambiguous allowed labels", () => {
    expect(exactMappingSuggestions(["label"], { ...table, columns: [
      column("one", { labelEn: "label" }), column("two", { labelEn: "label" }),
    ] })).toEqual({});
  });
});
const table: TransferTable = {
  name: "example", labelAr: "", labelEn: "", group: "discovered",
  approved: true, exportable: true, importable: true, reasonAr: "", reasonEn: "",
  columns: [
    column("name"), column("notes"), column("unmapped"),
    column("required", { nullable: false }),
    column("protected", { writable: false }), column("computed", { generated: true }),
  ],
  keys: [], relations: [],
};

describe("explicit blank clearing stays within the current mapping", () => {
  it("offers only mapped nullable writable non-generated fields", () => {
    expect(clearableMappingColumns(table, {
      Name: "name", Required: "required", Protected: "protected",
      Computed: "computed", Unknown: "missing", Skipped: "",
    }).map(c => c.name)).toEqual(["name"]);
  });
  it("removes stale and invalid selections restored from templates", () => {
    expect(mappedNullColumns(table, { Name: "name" }, [
      "name", "notes", "unmapped", "required", "protected", "computed", "missing", "name",
    ])).toEqual(["name"]);
  });
  it("unmapping discards permission to clear and remapping does not restore it", () => {
    const selected = mappedNullColumns(table, { Name: "" }, ["name"]);
    expect(selected).toEqual([]);
    expect(mappedNullColumns(table, { Name: "name" }, selected)).toEqual([]);
  });
  it("changing a destination never transfers its clearing choice", () => {
    expect(mappedNullColumns(table, { Name: "notes" }, ["name"])).toEqual([]);
  });
  it("never opts into clearing just because a nullable field is mapped", () => {
    expect(mappedNullColumns(table, { Name: "name" }, [])).toEqual([]);
    expect(clearableMappingColumns(null, { Name: "name" })).toEqual([]);
    expect(mappedNullColumns(null, { Name: "name" }, ["name"])).toEqual([]);
  });
});
