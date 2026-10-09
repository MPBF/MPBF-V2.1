import { readFileSync } from "node:fs";
import { describe, expect, it } from "@jest/globals";

const migration = readFileSync("migrations/0008_admin_identifier_sequences.sql", "utf8");

describe("administration identifier migration", () => {
  it("creates persistent sequences without modifying existing records", () => {
    expect(migration).toContain("BEGIN;");
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
    expect(migration.match(/CREATE SEQUENCE IF NOT EXISTS/g)).toHaveLength(5);
    expect(migration).not.toMatch(/\b(?:INSERT\s+INTO|UPDATE\s+(?:public\.)|DELETE\s+FROM|TRUNCATE|DROP|ALTER\s+TABLE)\b/i);
  });

  it("never rewinds an existing sequence and excludes supplier color codes", () => {
    expect(migration).toContain("observed > previous");
    expect(migration).toContain("observed = previous AND NOT previously_called");
    expect(migration).toContain("^MB[0-9]+$");
    expect(migration).toContain("^(MAC|M)[0-9]+$");
    for (let key = 2; key <= 6; key++) {
      expect(migration).toContain(`pg_advisory_xact_lock(29832, ${key})`);
    }
  });
});