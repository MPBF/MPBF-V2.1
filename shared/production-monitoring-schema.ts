import { sql } from "drizzle-orm";
import { pgTable, integer, varchar, timestamp, decimal, bigserial, primaryKey, unique, index, check, customType } from "drizzle-orm/pg-core";
import { machines, users } from "./schema";
import { factory_rolls } from "./production-schema";
import { factory_mixes } from "./raw-mixing-schema";

const xid8 = customType<{data:string}>({dataType:()=>"xid8"});
export const factory_mix_activation = pgTable("factory_mix_activation",{
  id:integer("id").primaryKey(), activated_at:timestamp("activated_at",{withTimezone:true}).default(sql`clock_timestamp()`).notNull(),
  last_roll_id:integer("last_roll_id").notNull(),last_mix_id:integer("last_mix_id").notNull(),
},t=>[check("factory_mix_activation_id_check",sql`${t.id}=1`),
  check("factory_mix_activation_last_roll_id_check",sql`${t.last_roll_id}>=0`),
  check("factory_mix_activation_last_mix_id_check",sql`${t.last_mix_id}>=0`)]);
export const factory_roll_mix_tracking = pgTable("factory_roll_mix_tracking",{
  roll_id:integer("roll_id").primaryKey().references(()=>factory_rolls.id),
  machine_id:varchar("machine_id",{length:20}).notNull().references(()=>machines.id),
  weight_kg:decimal("weight_kg",{precision:14,scale:2}).notNull(),
  uncovered_kg:decimal("uncovered_kg",{precision:14,scale:2}).notNull(),
},t=>[check("factory_roll_mix_tracking_weight_kg_check",sql`${t.weight_kg}>0`),
  check("factory_roll_mix_tracking_uncovered_kg_check",sql`${t.uncovered_kg}>=0 AND ${t.uncovered_kg}<=${t.weight_kg}`),
  index("factory_roll_mix_tracking_machine").on(t.machine_id,t.roll_id)]);
export const factory_mix_allocations = pgTable("factory_mix_allocations",{
  mix_id:integer("mix_id").notNull().references(()=>factory_mixes.id),
  roll_id:integer("roll_id").notNull().references(()=>factory_roll_mix_tracking.roll_id),
  allocated_kg:decimal("allocated_kg",{precision:14,scale:2}).notNull(),
},t=>[primaryKey({columns:[t.mix_id,t.roll_id]}),
  check("factory_mix_allocations_allocated_kg_check",sql`${t.allocated_kg}>0`),
  index("factory_mix_allocations_roll").on(t.roll_id,t.mix_id)]);
export const factory_production_events = pgTable("factory_production_events",{
  id:bigserial("id",{mode:"bigint"}).primaryKey(),roll_id:integer("roll_id").notNull().references(()=>factory_rolls.id),
  stage:varchar("stage",{length:20}).notNull(),registered_at:timestamp("registered_at",{withTimezone:true}).notNull(),
  machine_id:varchar("machine_id",{length:20}).notNull().references(()=>machines.id),
  actor_id:integer("actor_id").references(()=>users.id,{onDelete:"set null"}),
  weight_kg:decimal("weight_kg",{precision:14,scale:2}).notNull(),
  net_weight_kg:decimal("net_weight_kg",{precision:14,scale:2}),
  waste_kg:decimal("waste_kg",{precision:14,scale:2}),
  transaction_id:xid8("transaction_id").default(sql`pg_current_xact_id()`).notNull(),
},t=>[unique().on(t.roll_id,t.stage),
  check("factory_production_events_stage_check",sql`${t.stage} IN ('film','printing','cutting')`),
  check("factory_production_events_weight_kg_check",sql`${t.weight_kg}>0`),
  index("factory_production_events_time").on(t.registered_at.desc(),t.id.desc()),
  index("factory_production_events_stage_time").on(t.stage,t.registered_at.desc(),t.id.desc()),
  index("factory_production_events_machine_time").on(t.machine_id,t.registered_at.desc(),t.id.desc())]);
