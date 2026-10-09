import { readFileSync } from "node:fs";
import { describe, expect, it } from "@jest/globals";

const migration = readFileSync(
  "migrations/0007_dev_db_integrity_repair.sql",
  "utf8",
);

describe("development database integrity migration", () => {
  it("is transactional and prechecks every constraint before changing schema", () => {
    expect(migration.trimStart()).toMatch(/^--[\s\S]*?BEGIN;/);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/);
    expect(migration).toContain("Integrity migration precheck failed; no DDL applied.");
    for (const precheck of [
      "orders_created_at_null",
      "delivery_days_invalid",
      "orders_customer_orphans",
      "production_created_at_null",
      "production_status_null",
      "quantity_invalid",
      "overrun_invalid",
      "final_quantity_invalid",
      "production_order_orphans",
      "production_product_orphans",
      "customer_product_customer_orphans",
      "category_orphans",
    ]) {
      expect(migration).toContain(precheck);
    }
  });

  it("is repeatable and never edits or deletes application records", () => {
    expect(migration).toContain("IF NOT EXISTS");
    expect(migration).toContain("expected_found");
    expect(migration).not.toMatch(/\b(?:INSERT\s+INTO|UPDATE\s+(?:public\.)|DELETE\s+FROM|TRUNCATE|DROP\s+TABLE)\b/i);
    expect(migration).toContain("ALTER COLUMN final_quantity_kg DROP DEFAULT");
    expect(migration).toContain("customer_products_category_id_categories_id_fk");
    expect(migration).toContain("'r', 'RESTRICT'");
    expect(migration).toContain("'c', 'CASCADE'");
  });
});