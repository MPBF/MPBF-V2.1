import { sql } from "drizzle-orm";
import { pgTable, serial, integer, varchar, text, boolean, timestamp, decimal, jsonb, unique, index, check, foreignKey, uuid } from "drizzle-orm/pg-core";
import { customer_products, production_orders, items, machines, users } from "./schema";
import type { ProductSnapshot, PackagingInput } from "./production";

export const factory_execution = pgTable("factory_execution", {
  production_order_id: integer("production_order_id").primaryKey().references(() => production_orders.id, { onDelete: "restrict" }),
  customer_product_id: integer("customer_product_id").notNull().references(() => customer_products.id, { onDelete: "restrict" }),
  item_id: varchar("item_id", { length: 20 }).notNull().references(() => items.id, { onDelete: "restrict" }),
  product: jsonb("product").$type<ProductSnapshot>().notNull(),
  is_printed: boolean("is_printed").notNull(), is_roll_product: boolean("is_roll_product").notNull(),
  started_by: integer("started_by").references(() => users.id, { onDelete: "set null" }),
  started_at: timestamp("started_at", { withTimezone: true }).default(sql`clock_timestamp()`).notNull(),
  film_closed_at: timestamp("film_closed_at", { withTimezone: true }),
  film_closed_by: integer("film_closed_by").references(() => users.id, { onDelete: "set null" }),
  completed_at: timestamp("completed_at", { withTimezone: true }),
  batch_number: varchar("batch_number", { length: 50 }).unique(),
  stage: varchar("stage", { length: 20 }).default("film").notNull(),
}, t => [
  unique().on(t.production_order_id, t.customer_product_id, t.item_id),
  check("factory_execution_stage_check", sql`${t.stage} IN ('film','printing','cutting','completed')`),
  check("factory_execution_completion_check", sql`${t.completed_at} IS NULL OR ${t.film_closed_at} IS NOT NULL`),
]);
export const factory_rolls = pgTable("factory_rolls", {
  id: serial("id").primaryKey(),
  production_order_id: integer("production_order_id").notNull().references(() => factory_execution.production_order_id, { onDelete: "restrict" }),
  sequence: integer("sequence").notNull(), roll_number: varchar("roll_number", { length: 100 }).unique().notNull(),
  weight_kg: decimal("weight_kg", { precision: 14, scale: 2 }).notNull(), stage: varchar("stage", { length: 20 }).notNull(),
  film_machine_id: varchar("film_machine_id", { length: 20 }).notNull().references(() => machines.id, { onDelete: "restrict" }),
  created_by: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  created_at: timestamp("created_at", { withTimezone: true }).default(sql`clock_timestamp()`).notNull(),
  production_minutes: integer("production_minutes"), is_last_roll: boolean("is_last_roll").default(false).notNull(),
  printing_machine_id: varchar("printing_machine_id", { length: 20 }).references(() => machines.id, { onDelete: "restrict" }),
  printed_by: integer("printed_by").references(() => users.id, { onDelete: "set null" }),
  printed_at: timestamp("printed_at", { withTimezone: true }),
  cutting_machine_id: varchar("cutting_machine_id", { length: 20 }).references(() => machines.id, { onDelete: "restrict" }),
  cut_by: integer("cut_by").references(() => users.id, { onDelete: "set null" }),
  cut_completed_at: timestamp("cut_completed_at", { withTimezone: true }),
  net_weight_kg: decimal("net_weight_kg", { precision: 14, scale: 2 }),
  waste_kg: decimal("waste_kg", { precision: 14, scale: 2 }).default("0").notNull(),
}, t => [
  unique().on(t.production_order_id, t.sequence), index("factory_rolls_order_stage").on(t.production_order_id, t.stage),
  check("factory_rolls_sequence_check", sql`${t.sequence} > 0`),
  check("factory_rolls_weight_kg_check", sql`${t.weight_kg} > 0`),
  check("factory_rolls_stage_check", sql`${t.stage} IN ('film','printing','done')`),
  check("factory_rolls_net_check", sql`${t.net_weight_kg} IS NULL OR ${t.net_weight_kg} > 0 AND ${t.net_weight_kg} <= ${t.weight_kg}`),
  check("factory_rolls_waste_check", sql`${t.waste_kg} >= 0 AND ${t.waste_kg} <= ${t.weight_kg}`),
  check("factory_rolls_balance_check", sql`${t.net_weight_kg} IS NULL AND ${t.waste_kg} = 0 OR ${t.net_weight_kg} + ${t.waste_kg} = ${t.weight_kg}`),
]);
export const factory_queues = pgTable("factory_queues", {
  id: serial("id").primaryKey(),
  production_order_id: integer("production_order_id").notNull().references(() => production_orders.id, { onDelete: "cascade" }),
  stage: varchar("stage", { length: 20 }).notNull(),
  machine_id: varchar("machine_id", { length: 20 }).notNull().references(() => machines.id, { onDelete: "restrict" }),
  position: integer("position").notNull(),
  updated_by: integer("updated_by").references(() => users.id, { onDelete: "set null" }),
  updated_at: timestamp("updated_at", { withTimezone: true }).default(sql`clock_timestamp()`).notNull(),
}, t => [
  unique().on(t.production_order_id, t.stage), index("factory_queues_machine_position").on(t.stage, t.machine_id, t.position, t.id),
  check("factory_queues_stage_check", sql`${t.stage} IN ('film','printing','cutting')`),
  check("factory_queues_position_check", sql`${t.position} > 0`),
]);
export const factory_locations = pgTable("factory_locations", {
  id: serial("id").primaryKey(), name: varchar("name", { length: 100 }).notNull().unique(),
  name_ar: varchar("name_ar", { length: 100 }).notNull().unique(), is_active: boolean("is_active").default(true).notNull(),
});
export const factory_receipts = pgTable("factory_receipts", {
  id: serial("id").primaryKey(), voucher_number: varchar("voucher_number", { length: 50 }).notNull().unique(),
  created_at: timestamp("created_at", { withTimezone: true }).default(sql`clock_timestamp()`).notNull(),
  created_by: integer("created_by").references(() => users.id, { onDelete: "set null" }), notes: text("notes"),
});
export const factory_receipt_items = pgTable("factory_receipt_items", {
  id: serial("id").primaryKey(),
  receipt_id: integer("receipt_id").notNull().references(() => factory_receipts.id, { onDelete: "restrict" }),
  production_order_id: integer("production_order_id").notNull(), customer_product_id: integer("customer_product_id").notNull(),
  item_id: varchar("item_id", { length: 20 }).notNull(),
  location_id: integer("location_id").notNull().references(() => factory_locations.id, { onDelete: "restrict" }),
  quantity_kg: decimal("quantity_kg", { precision: 14, scale: 2 }).notNull(), packaging: jsonb("packaging").$type<PackagingInput>(),
}, t => [
  foreignKey({ columns: [t.production_order_id, t.customer_product_id, t.item_id], foreignColumns: [factory_execution.production_order_id, factory_execution.customer_product_id, factory_execution.item_id] }).onDelete("restrict"),
  unique().on(t.receipt_id, t.production_order_id, t.location_id), unique().on(t.id, t.receipt_id),
  index("factory_receipt_items_order").on(t.production_order_id),
  check("factory_receipt_items_quantity_kg_check", sql`${t.quantity_kg} > 0`),
]);
export const factory_inventory = pgTable("factory_inventory", {
  id: serial("id").primaryKey(), production_order_id: integer("production_order_id").notNull(),
  customer_product_id: integer("customer_product_id").notNull(), item_id: varchar("item_id", { length: 20 }).notNull(),
  location_id: integer("location_id").notNull().references(() => factory_locations.id, { onDelete: "restrict" }),
  quantity_kg: decimal("quantity_kg", { precision: 14, scale: 2 }).notNull(),
}, t => [
  foreignKey({ columns: [t.production_order_id, t.customer_product_id, t.item_id], foreignColumns: [factory_execution.production_order_id, factory_execution.customer_product_id, factory_execution.item_id] }).onDelete("restrict"),
  unique().on(t.customer_product_id, t.production_order_id, t.location_id),
  check("factory_inventory_quantity_kg_check", sql`${t.quantity_kg} >= 0`),
]);
export const factory_movements = pgTable("factory_movements", {
  id: serial("id").primaryKey(), receipt_id: integer("receipt_id").notNull(),
  receipt_item_id: integer("receipt_item_id").notNull().unique(),
  quantity_kg: decimal("quantity_kg", { precision: 14, scale: 2 }).notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).default(sql`clock_timestamp()`).notNull(),
}, t => [
  foreignKey({ columns: [t.receipt_item_id, t.receipt_id], foreignColumns: [factory_receipt_items.id, factory_receipt_items.receipt_id] }).onDelete("restrict"),
  check("factory_movements_quantity_kg_check", sql`${t.quantity_kg} > 0`),
]);
export const factory_operations = pgTable("factory_operations", {
  id: serial("id").primaryKey(), actor_id: integer("actor_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  request_id: uuid("request_id").notNull(), operation: text("operation").notNull(),
  fingerprint: text("fingerprint").notNull(), result: jsonb("result").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).default(sql`clock_timestamp()`).notNull(),
}, t => [unique().on(t.actor_id, t.request_id)]);