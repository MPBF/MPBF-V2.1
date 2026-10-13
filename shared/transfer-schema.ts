import { pgTable, uuid, integer, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./schema";

export const data_transfer_previews = pgTable("data_transfer_previews", {
  id: uuid("id").primaryKey(), actor_id: integer("actor_id").notNull().references(() => users.id),
  document: jsonb("document").notNull(), created_at: timestamp("created_at", {withTimezone:true}).notNull().defaultNow(),
  expires_at: timestamp("expires_at", {withTimezone:true}).notNull(),
}, t => [index("data_transfer_previews_expiry").on(t.expires_at)]);
export const data_transfer_operations = pgTable("data_transfer_operations", {
  id: uuid("id").primaryKey(), actor_id: integer("actor_id").notNull().references(() => users.id),
  kind: text("kind").notNull(), status: text("status").notNull(), counts: jsonb("counts").notNull().default({}),
  approval_hash: text("approval_hash"), result: jsonb("result"),
  created_at: timestamp("created_at", {withTimezone:true}).notNull().defaultNow(),
}, t => [index("data_transfer_operations_actor_time").on(t.actor_id,t.created_at)]);
export const data_transfer_backups = pgTable("data_transfer_backups", {
  id: uuid("id").primaryKey(), actor_id: integer("actor_id").notNull().references(() => users.id),
  document: jsonb("document").notNull(), checksum: text("checksum").notNull(),
  created_at: timestamp("created_at", {withTimezone:true}).notNull().defaultNow(),
  expires_at: timestamp("expires_at", {withTimezone:true}).notNull(),
}, t => [index("data_transfer_backups_expiry").on(t.expires_at)]);
export const data_transfer_templates = pgTable("data_transfer_templates", {
  id: uuid("id").primaryKey(), actor_id: integer("actor_id").notNull().references(() => users.id),
  name: text("name").notNull(), schema_version: text("schema_version").notNull(), mappings: jsonb("mappings").notNull(),
  created_at: timestamp("created_at", {withTimezone:true}).notNull().defaultNow(),
});
