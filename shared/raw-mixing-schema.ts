import { sql } from "drizzle-orm";
import { pgTable, serial, integer, varchar, text, boolean, timestamp, decimal, unique, index, check } from "drizzle-orm/pg-core";
import { items, machines, users } from "./schema";

export const factory_raw_materials = pgTable("factory_raw_materials", {
  id: serial("id").primaryKey(),
  item_id: varchar("item_id", { length: 20 }).unique().references(() => items.id),
  code: varchar("code", { length: 40 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  name_ar: varchar("name_ar", { length: 120 }).notNull(),
  quantity_kg: decimal("quantity_kg", { precision: 18, scale: 2 }).default("0").notNull(),
  is_active: boolean("is_active").default(true).notNull(),
  created_by: integer("created_by").references(() => users.id),
  created_at: timestamp("created_at", { withTimezone: true }).default(sql`clock_timestamp()`).notNull(),
});
export const factory_mixes = pgTable("factory_mixes", {
  id: serial("id").primaryKey(),
  machine_id: varchar("machine_id", { length: 20 }).notNull().references(() => machines.id),
  created_by: integer("created_by").notNull().references(() => users.id),
  created_at: timestamp("created_at", { withTimezone: true }).default(sql`clock_timestamp()`).notNull(),
  notes: text("notes"),
  total_kg: decimal("total_kg", { precision: 18, scale: 2 }).notNull(),
}, table => [
  check("factory_mixes_total_kg_check", sql`${table.total_kg}>0`),
  index("factory_mixes_actor_idx").on(table.created_by,table.id),
]);
export const factory_mix_items = pgTable("factory_mix_items", {
  id: serial("id").primaryKey(),
  mix_id: integer("mix_id").notNull().references(() => factory_mixes.id),
  material_id: integer("material_id").notNull().references(() => factory_raw_materials.id),
  quantity_kg: decimal("quantity_kg", { precision: 18, scale: 2 }).notNull(),
}, table => [
  unique().on(table.mix_id,table.material_id),
  check("factory_mix_items_quantity_kg_check", sql`${table.quantity_kg}>0`),
  index("factory_mix_items_material_idx").on(table.material_id,table.mix_id),
]);
export const factory_raw_vouchers = pgTable("factory_raw_vouchers", {
  id: serial("id").primaryKey(),
  kind: varchar("kind", { length: 20 }).notNull(),
  total_kg: decimal("total_kg", { precision: 18, scale: 2 }).notNull(),
  notes: text("notes"),
  created_by: integer("created_by").notNull().references(() => users.id),
  created_at: timestamp("created_at", { withTimezone: true }).default(sql`clock_timestamp()`).notNull(),
}, table => [
  check("factory_raw_vouchers_kind_check", sql`${table.kind} IN ('receipt','issue')`),
  check("factory_raw_vouchers_total_kg_check", sql`${table.total_kg}>0`),
]);
export const factory_raw_movements = pgTable("factory_raw_movements", {
  id: serial("id").primaryKey(),
  material_id: integer("material_id").notNull().references(() => factory_raw_materials.id),
  mix_id: integer("mix_id").references(() => factory_mixes.id),
  voucher_id: integer("voucher_id").references(() => factory_raw_vouchers.id),
  kind: varchar("kind", { length: 20 }).notNull(),
  quantity_kg: decimal("quantity_kg", { precision: 18, scale: 2 }).notNull(),
  balance_after_kg: decimal("balance_after_kg", { precision: 18, scale: 2 }).notNull(),
  created_by: integer("created_by").notNull().references(() => users.id),
  created_at: timestamp("created_at", { withTimezone: true }).default(sql`clock_timestamp()`).notNull(),
}, table => [
  unique().on(table.mix_id,table.material_id),
  unique().on(table.voucher_id,table.material_id),
  check("factory_raw_movements_kind_check", sql`${table.kind} IN ('opening','mixing','receipt','issue')`),
  check("factory_raw_movements_check", sql`(${table.kind}='mixing' AND ${table.mix_id} IS NOT NULL AND ${table.voucher_id} IS NULL AND ${table.quantity_kg}<0) OR (${table.kind}='opening' AND ${table.mix_id} IS NULL AND ${table.voucher_id} IS NULL AND ${table.quantity_kg}>=0) OR (${table.kind}='receipt' AND ${table.mix_id} IS NULL AND ${table.voucher_id} IS NOT NULL AND ${table.quantity_kg}>0) OR (${table.kind}='issue' AND ${table.mix_id} IS NULL AND ${table.voucher_id} IS NOT NULL AND ${table.quantity_kg}<0)`),
  index("factory_raw_movements_material_idx").on(table.material_id,table.id),
]);
