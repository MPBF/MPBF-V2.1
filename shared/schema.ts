import { relations, sql } from "drizzle-orm";
export * from "./production-schema";
import {
  boolean,
  check,
  date,
  decimal,
  index,
  integer,
  json,
  jsonb,
  pgSequence,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const adminSectionIdSequence = pgSequence("admin_section_id_seq");
export const adminCategoryIdSequence = pgSequence("admin_category_id_seq");
export const adminItemIdSequence = pgSequence("admin_item_id_seq");
export const adminMasterBatchColorIdSequence = pgSequence("admin_master_batch_color_id_seq");
export const adminMachineIdSequence = pgSequence("admin_machine_id_seq");

export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 50 }).notNull(),
  name_ar: varchar("name_ar", { length: 100 }),
  permissions: json("permissions").$type<string[]>(),
});

export const sections = pgTable("sections", {
  id: varchar("id", { length: 20 }).primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  name_ar: varchar("name_ar", { length: 100 }),
  description: text("description"),
});

export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    username: varchar("username", { length: 50 }).unique(),
    password: varchar("password", { length: 100 }),
    display_name: varchar("display_name", { length: 100 }),
    display_name_ar: varchar("display_name_ar", { length: 100 }),
    full_name: varchar("full_name", { length: 200 }),
    phone: varchar("phone", { length: 20 }),
    email: varchar("email", { length: 100 }),
    role_id: integer("role_id").references(() => roles.id),
    // Section IDs are varchar codes (for example, SEC01).
    section_id: varchar("section_id", { length: 20 }),
    status: varchar("status", { length: 20 }).default("active"),
    must_change_password: boolean("must_change_password").default(false),
    is_system_user: boolean("is_system_user").notNull().default(false),
    include_in_attendance: boolean("include_in_attendance").notNull().default(true),
    created_at: timestamp("created_at").defaultNow(),
    national_id: varchar("national_id", { length: 20 }),
    nationality: varchar("nationality", { length: 30 }),
    birth_date: date("birth_date"),
    service_start_date: date("service_start_date"),
    profession: varchar("profession", { length: 100 }),
    replit_user_id: varchar("replit_user_id", { length: 255 }).unique(),
    preferred_language: varchar("preferred_language", { length: 10 }),
    first_name: varchar("first_name", { length: 100 }),
    last_name: varchar("last_name", { length: 100 }),
    profile_image_url: varchar("profile_image_url", { length: 500 }),
    updated_at: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_users_role_id").on(table.role_id),
    index("idx_users_status").on(table.status),
  ],
);

export const shift_definitions = pgTable(
  "shift_definitions",
  {
    id: varchar("id", { length: 80 }).primaryKey(),
    name_ar: varchar("name_ar", { length: 120 }).notNull(),
    name_en: varchar("name_en", { length: 120 }),
    start_time: varchar("start_time", { length: 5 }).notNull(),
    end_time: varchar("end_time", { length: 5 }).notNull(),
    next_day_checkin_time: varchar("next_day_checkin_time", { length: 5 }).notNull().default("06:00"),
    early_checkin_minutes: integer("early_checkin_minutes").notNull().default(15),
    late_checkout_minutes: integer("late_checkout_minutes").notNull().default(15),
    break_minutes: integer("break_minutes").notNull().default(30),
    geofence_enabled: boolean("geofence_enabled").notNull().default(true),
    geofence_center_lat: decimal("geofence_center_lat", { precision: 9, scale: 6 }),
    geofence_center_lng: decimal("geofence_center_lng", { precision: 9, scale: 6 }),
    geofence_radius_meters: integer("geofence_radius_meters").notNull().default(200),
    is_active: boolean("is_active").notNull().default(true),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_shift_definitions_active").on(table.is_active)],
);

export const user_shift_assignments = pgTable(
  "user_shift_assignments",
  {
    id: serial("id").primaryKey(),
    user_id: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    shift_id: varchar("shift_id", { length: 80 }).notNull().references(() => shift_definitions.id, { onDelete: "restrict" }),
    assigned_at: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    unassigned_at: timestamp("unassigned_at", { withTimezone: true }),
    assigned_by: integer("assigned_by").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => [
    index("idx_user_shift_assignments_user_history").on(table.user_id, table.assigned_at),
    index("idx_user_shift_assignments_shift_active").on(table.shift_id, table.unassigned_at),
    uniqueIndex("uniq_user_active_shift").on(table.user_id).where(sql`${table.unassigned_at} IS NULL`),
  ],
);

export const attendance_sessions = pgTable(
  "attendance_sessions",
  {
    id: serial("id").primaryKey(),
    user_id: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    shift_assignment_id: integer("shift_assignment_id").references(() => user_shift_assignments.id, { onDelete: "set null" }),
    shift_id: varchar("shift_id", { length: 80 }).notNull(),
    shift_date: date("shift_date").notNull(),
    shift_start_at: timestamp("shift_start_at", { withTimezone: true }).notNull(),
    shift_end_at: timestamp("shift_end_at", { withTimezone: true }).notNull(),
    window_start_at: timestamp("window_start_at", { withTimezone: true }).notNull(),
    window_end_at: timestamp("window_end_at", { withTimezone: true }).notNull(),
    expected_minutes: integer("expected_minutes").notNull(),
    check_in_at: timestamp("check_in_at", { withTimezone: true }).notNull(),
    check_out_at: timestamp("check_out_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("uniq_attendance_session_occurrence").on(table.user_id, table.shift_start_at),
    index("idx_attendance_sessions_user_date").on(table.user_id, table.shift_date),
    check("attendance_session_time_check", sql`${table.shift_start_at} < ${table.shift_end_at} AND ${table.window_start_at} <= ${table.shift_start_at} AND ${table.window_end_at} >= ${table.shift_end_at}`),
    check("attendance_session_checkout_check", sql`${table.check_out_at} IS NULL OR ${table.check_out_at} >= ${table.check_in_at}`),
  ],
);

export const attendance_events = pgTable(
  "attendance_events",
  {
    id: serial("id").primaryKey(),
    user_id: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    shift_assignment_id: integer("shift_assignment_id").references(() => user_shift_assignments.id, { onDelete: "set null" }),
    session_id: integer("session_id").references(() => attendance_sessions.id, { onDelete: "set null" }),
    action: varchar("action", { length: 20 }).notNull(),
    occurred_at: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    latitude: decimal("latitude", { precision: 9, scale: 6 }).notNull(),
    longitude: decimal("longitude", { precision: 9, scale: 6 }).notNull(),
    accuracy: decimal("accuracy", { precision: 10, scale: 2 }).notNull(),
    source: varchar("source", { length: 20 }).notNull().default("employee"),
    created_by: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    updated_by: integer("updated_by").references(() => users.id, { onDelete: "set null" }),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_attendance_events_user_time").on(table.user_id, table.occurred_at),
    index("idx_attendance_events_session").on(table.session_id, table.id),
    check("attendance_events_action_check", sql`${table.action} IN ('check_in', 'break_start', 'break_end', 'check_out')`),
    check("attendance_events_latitude_check", sql`${table.latitude} BETWEEN -90 AND 90`),
    check("attendance_events_longitude_check", sql`${table.longitude} BETWEEN -180 AND 180`),
    check("attendance_events_accuracy_check", sql`${table.accuracy} BETWEEN 0 AND 10000`),
    check("attendance_events_source_check", sql`${table.source} IN ('employee', 'manual')`),
  ],
);

export const internal_messages = pgTable(
  "internal_messages",
  {
    id: serial("id").primaryKey(),
    sender_id: integer("sender_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    recipient_id: integer("recipient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    reply_to_id: integer("reply_to_id").references((): any => internal_messages.id, { onDelete: "set null" }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    read_at: timestamp("read_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_internal_messages_sender_created").on(table.sender_id, table.created_at),
    index("idx_internal_messages_recipient_created").on(table.recipient_id, table.created_at),
    check("internal_messages_check", sql`${table.sender_id} <> ${table.recipient_id}`),
  ],
);

export const administrative_requests = pgTable(
  "administrative_requests",
  {
    id: serial("id").primaryKey(),
    user_id: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 20 }).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    details: text("details").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    response: text("response"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    responded_at: timestamp("responded_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_administrative_requests_user_created").on(table.user_id, table.created_at),
    index("idx_administrative_requests_status_created").on(table.status, table.created_at),
    check("administrative_requests_type_check", sql`${table.type} IN ('leave', 'permission', 'other')`),
    check("administrative_requests_status_check", sql`${table.status} IN ('pending', 'approved', 'rejected')`),
  ],
);

export const user_violations = pgTable(
  "user_violations",
  {
    id: serial("id").primaryKey(),
    user_id: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 200 }).notNull(),
    details: text("details").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    acknowledged_at: timestamp("acknowledged_at", { withTimezone: true }),
  },
  (table) => [index("idx_user_violations_user_created").on(table.user_id, table.created_at)],
);

export const customers = pgTable(
  "customers",
  {
    id: varchar("id", { length: 20 }).primaryKey(),
    name: varchar("name", { length: 200 }).notNull(),
    name_ar: varchar("name_ar", { length: 200 }),
    code: varchar("code", { length: 20 }),
    user_id: varchar("user_id", { length: 10 }),
    plate_drawer_code: varchar("plate_drawer_code", { length: 20 }),
    city: varchar("city", { length: 50 }),
    address: text("address"),
    tax_number: varchar("tax_number", { length: 20 }),
    commercial_name: varchar("commercial_name", { length: 200 }),
    unified_number: varchar("unified_number", { length: 10 }),
    unique_customer_number: varchar("unique_customer_number", { length: 20 }),
    is_active: boolean("is_active").default(true),
    phone: varchar("phone", { length: 20 }),
    sales_rep_id: integer("sales_rep_id").references(() => users.id),
    created_at: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    unifiedNumberFormat: check(
      "unified_number_format",
      sql`${table.unified_number} IS NULL OR ${table.unified_number} ~ '^7[0-9]{9}$'`,
    ),
    taxNumberLength: check(
      "tax_number_length",
      sql`${table.tax_number} IS NULL OR (${table.tax_number} ~ '^[0-9]+$' AND LENGTH(${table.tax_number}) BETWEEN 10 AND 20)`,
    ),
    idx_customers_created_at: index("idx_customers_created_at").on(table.created_at),
  }),
);

export const categories = pgTable("categories", {
  id: varchar("id", { length: 20 }).primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  name_ar: varchar("name_ar", { length: 100 }),
  code: varchar("code", { length: 20 }),
  parent_id: varchar("parent_id", { length: 20 }),
  overrun_percentage: integer("overrun_percentage").notNull().default(0),
}, (table) => [
  check("categories_overrun_percentage_allowed", sql`${table.overrun_percentage} IN (0, 5, 10, 20)`),
]);

export const items = pgTable("items", {
  id: varchar("id", { length: 20 }).primaryKey(),
  category_id: varchar("category_id", { length: 20 }),
  name: varchar("name", { length: 100 }),
  name_ar: varchar("name_ar", { length: 100 }),
  code: varchar("code", { length: 50 }),
  status: varchar("status", { length: 20 }).default("active"),
});

export const master_batch_colors = pgTable("master_batch_colors", {
  id: varchar("id", { length: 20 }).primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  name_ar: varchar("name_ar", { length: 100 }).notNull(),
  color_hex: varchar("color_hex", { length: 20 }).notNull().default("#FFFFFF"),
  text_color: varchar("text_color", { length: 20 }).notNull().default("#000000"),
  brand: varchar("brand", { length: 100 }),
  aliases: text("aliases"),
  is_active: boolean("is_active").default(true).notNull(),
  sort_order: integer("sort_order").default(0),
  created_at: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updated_at: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const customer_products = pgTable(
  "customer_products",
  {
    id: serial("id").primaryKey(),
    customer_id: varchar("customer_id", { length: 20 }).references(() => customers.id, { onDelete: "restrict" }),
    category_id: varchar("category_id", { length: 20 }).references(() => categories.id),
    item_id: varchar("item_id", { length: 20 }).references(() => items.id),
    size_caption: varchar("size_caption", { length: 50 }),
    // Unscaled numeric plus CHECK constraints reject fractional SQL writes.
    // PostgreSQL integer and numeric(p, 0) would silently round them instead.
    width: decimal("width"),
    left_facing: decimal("left_facing"),
    right_facing: decimal("right_facing"),
    thickness: decimal("thickness"),
    universal_thickness: decimal("universal_thickness").generatedAlwaysAs(
      sql`CEIL(CASE WHEN (COALESCE(left_facing, 0) = 0 AND COALESCE(right_facing, 0) = 0) THEN thickness / 2 * 10 WHEN (left_facing > 0 AND right_facing > 0) THEN thickness / 4 * 10 ELSE thickness / 2 * 10 END)`,
    ),
    density: decimal("density", { precision: 6, scale: 3 }).default("0.95"),
    bag_weight_grams: decimal("bag_weight_grams", { precision: 12, scale: 4 }),
    bags_per_kilo: decimal("bags_per_kilo"),
    printing_cylinder: varchar("printing_cylinder", { length: 10 }),
    cutting_length_cm: integer("cutting_length_cm"),
    raw_material: varchar("raw_material", { length: 20 }),
    master_batch_id: varchar("master_batch_id", { length: 20 }),
    is_printed: boolean("is_printed").default(false),
    cutting_unit: varchar("cutting_unit", { length: 20 }),
    punching: varchar("punching", { length: 20 }),
    unit_weight_kg: decimal("unit_weight_kg", { precision: 8, scale: 3 }),
    unit_quantity: integer("unit_quantity"),
    package_weight_kg: decimal("package_weight_kg", { precision: 8, scale: 2 }),
    cliche_front_design: text("cliche_front_design"),
    cliche_back_design: text("cliche_back_design"),
    front_print_colors: text("front_print_colors").array(),
    back_print_colors: text("back_print_colors").array(),
    notes: text("notes"),
    status: varchar("status", { length: 20 }).default("active"),
    created_at: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_customer_products_customer_id").on(table.customer_id),
    index("idx_customer_products_status").on(table.status),
    index("idx_customer_products_created_at").on(table.created_at),
    check("customer_products_width_whole", sql`${table.width} IS NULL OR ${table.width} = trunc(${table.width})`),
    check("customer_products_left_facing_whole", sql`${table.left_facing} IS NULL OR ${table.left_facing} = trunc(${table.left_facing})`),
    check("customer_products_right_facing_whole", sql`${table.right_facing} IS NULL OR ${table.right_facing} = trunc(${table.right_facing})`),
    check("customer_products_thickness_whole", sql`${table.thickness} IS NULL OR ${table.thickness} = trunc(${table.thickness})`),
    check("customer_products_universal_thickness_whole", sql`${table.universal_thickness} IS NULL OR ${table.universal_thickness} = trunc(${table.universal_thickness})`),
    check("customer_products_bags_per_kilo_whole", sql`${table.bags_per_kilo} IS NULL OR ${table.bags_per_kilo} = trunc(${table.bags_per_kilo})`),
  ],
);

export const machines = pgTable(
  "machines",
  {
    id: varchar("id", { length: 20 }).primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    name_ar: varchar("name_ar", { length: 100 }),
    type: varchar("type", { length: 50 }),
    section_id: varchar("section_id", { length: 20 }).references(() => sections.id, { onDelete: "restrict" }),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    capacity_small_kg_per_hour: decimal("capacity_small_kg_per_hour", { precision: 8, scale: 2 }),
    capacity_medium_kg_per_hour: decimal("capacity_medium_kg_per_hour", { precision: 8, scale: 2 }),
    capacity_large_kg_per_hour: decimal("capacity_large_kg_per_hour", { precision: 8, scale: 2 }),
    screw_type: varchar("screw_type", { length: 10 }).default("A"),
    raw_material_type: varchar("raw_material_type", { length: 20 }),
    min_thickness: decimal("min_thickness", { precision: 8, scale: 3 }),
    max_thickness: decimal("max_thickness", { precision: 8, scale: 3 }),
    inline_printer_id: varchar("inline_printer_id", { length: 20 }).references((): any => machines.id, { onDelete: "set null" }),
    min_width_cm: decimal("min_width_cm", { precision: 8, scale: 2 }),
    max_width_cm: decimal("max_width_cm", { precision: 8, scale: 2 }),
    max_print_colors: integer("max_print_colors"),
    min_cylinder_inch: decimal("min_cylinder_inch", { precision: 8, scale: 2 }),
    max_cylinder_inch: decimal("max_cylinder_inch", { precision: 8, scale: 2 }),
    min_length_cm: decimal("min_length_cm", { precision: 8, scale: 2 }),
    max_length_cm: decimal("max_length_cm", { precision: 8, scale: 2 }),
    width_cm: decimal("width_cm", { precision: 10, scale: 2 }),
    length_cm: decimal("length_cm", { precision: 10, scale: 2 }),
    height_cm: decimal("height_cm", { precision: 10, scale: 2 }),
    weight_kg: decimal("weight_kg", { precision: 10, scale: 2 }),
    manufacturer: varchar("manufacturer", { length: 100 }),
    metal_plate: text("metal_plate"),
    manufacture_date: date("manufacture_date"),
    serial_number: varchar("serial_number", { length: 100 }),
  },
  (table) => ({
    machineIdFormat: check("machine_id_format", sql`${table.id} ~ '^(M[0-9]{3}|MAC[0-9]{2,3})$'`),
    // Keep existing imported labels valid in the schema model. API writes
    // normalize these aliases only when a machine type is actually changed.
    typeValid: check("type_valid", sql`${table.type} IN ('extruder', 'printer', 'cutter', 'quality_check', 'printing', 'cutting', 'Printer', 'Cutter')`),
    statusValid: check("status_valid", sql`${table.status} IN ('active', 'maintenance', 'down')`),
    nameNotEmpty: check("name_not_empty", sql`LENGTH(TRIM(${table.name})) > 0`),
    screwTypeValid: check("screw_type_valid", sql`${table.screw_type} IS NULL OR ${table.screw_type} IN ('A', 'ABA')`),
  }),
);

export const orders = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    order_number: varchar("order_number", { length: 50 }).notNull().unique(),
    customer_id: varchar("customer_id", { length: 20 }).notNull().references(() => customers.id, { onDelete: "restrict" }),
    delivery_days: integer("delivery_days"),
    status: varchar("status", { length: 30 }).default("pending"),
    previous_status: varchar("previous_status", { length: 30 }),
    notes: text("notes"),
    share_token: varchar("share_token", { length: 64 }).unique(),
    created_by: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    created_at: timestamp("created_at").notNull().defaultNow(),
    delivery_date: date("delivery_date"),
  },
  (table) => ({
    deliveryDaysPositive: check("delivery_days_positive", sql`${table.delivery_days} IS NULL OR ${table.delivery_days} > 0`),
    statusValid: check("status_valid", sql`${table.status} IN ('waiting', 'on_hold', 'in_production', 'for_production', 'paused', 'cancelled', 'completed', 'delivered', 'archived')`),
    idx_orders_customer_id: index("idx_orders_customer_id").on(table.customer_id),
    idx_orders_created_at: index("idx_orders_created_at").on(table.created_at),
  }),
);

// Kept after order deletion to prevent number reuse and identify the new format.
export const order_number_allocations = pgTable("order_number_allocations", {
  sequence: decimal("sequence", { precision: 44, scale: 0 }).primaryKey(),
  order_number: varchar("order_number", { length: 45 }).notNull().unique(),
}, table => ({
  sequencePositive: check("order_number_allocation_positive", sql`${table.sequence} > 0`),
}));

export const order_display_folder_assignments = pgTable("order_display_folder_assignments", {
  order_id: integer("order_id").primaryKey().references(() => orders.id, { onDelete: "cascade" }),
  folder: varchar("folder", { length: 20 }).notNull(),
  updated_by: integer("updated_by").references(() => users.id, { onDelete: "set null" }),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
}, table => ({
  folderValid: check("order_display_folder_valid", sql`${table.folder} IN ('new','production','urgent','archive')`),
  folderOrderIndex: index("idx_order_display_folder_order").on(table.folder, table.order_id),
}));

export const production_orders = pgTable(
  "production_orders",
  {
    id: serial("id").primaryKey(),
    production_order_number: varchar("production_order_number", { length: 50 }).notNull().unique(),
    order_id: integer("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    customer_product_id: integer("customer_product_id").references(() => customer_products.id, { onDelete: "restrict" }),
    quantity_kg: decimal("quantity_kg", { precision: 10, scale: 2 }).notNull(),
    overrun_percentage: decimal("overrun_percentage", { precision: 5, scale: 2 }).notNull().default("5.00"),
    final_quantity_kg: decimal("final_quantity_kg", { precision: 10, scale: 2 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("pending"),
    previous_status: varchar("previous_status", { length: 30 }),
    batch_number: varchar("batch_number", { length: 50 }).unique(),
    created_at: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    quantityPositive: check("quantity_kg_positive", sql`${table.quantity_kg} > 0`),
    overrunPercentageValid: check("overrun_percentage_valid", sql`${table.overrun_percentage} >= 0 AND ${table.overrun_percentage} <= 50`),
    finalQuantityPositive: check("final_quantity_kg_positive", sql`${table.final_quantity_kg} > 0`),
    statusValid: check("production_status_valid", sql`${table.status} IN ('pending', 'active', 'completed', 'cancelled', 'archived')`),
    idx_production_orders_order_id: index("idx_production_orders_order_id").on(table.order_id),
    idx_production_orders_status: index("idx_production_orders_status").on(table.status),
    idx_production_orders_created_at: index("idx_production_orders_created_at").on(table.created_at),
  }),
);

export const maintenance_component_catalog = pgTable(
  "maintenance_component_catalog",
  {
    id: serial("id").primaryKey(),
    machine_type: varchar("machine_type", { length: 30 }).notNull(),
    name_ar: varchar("name_ar", { length: 200 }).notNull(),
    name_en: varchar("name_en", { length: 200 }).notNull(),
    sort_order: integer("sort_order").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
    created_at: timestamp("created_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("uniq_component_catalog_type_name").on(table.machine_type, table.name_en),
    index("idx_component_catalog_type").on(table.machine_type),
  ],
);

export const company_profile = pgTable("company_profile", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  name_ar: varchar("name_ar", { length: 100 }),
  address: text("address"),
  tax_number: varchar("tax_number", { length: 20 }),
  phone: varchar("phone", { length: 20 }),
  email: varchar("email", { length: 100 }),
  logo_url: varchar("logo_url", { length: 255 }),
  working_hours_per_day: integer("working_hours_per_day").default(8),
  default_language: varchar("default_language", { length: 10 }).default("ar"),
  letter_header_image_url: varchar("letter_header_image_url", { length: 255 }),
  letter_footer_image_url: varchar("letter_footer_image_url", { length: 255 }),
  letter_footer_text: text("letter_footer_text"),
  letter_default_signatures: jsonb("letter_default_signatures"),
});

export const system_settings = pgTable("system_settings", {
  id: serial("id").primaryKey(),
  setting_key: varchar("setting_key", { length: 100 }).notNull().unique(),
  setting_value: text("setting_value"),
  setting_type: varchar("setting_type", { length: 20 }).default("string"),
  description: text("description"),
  is_editable: boolean("is_editable").default(true),
  updated_at: timestamp("updated_at").defaultNow(),
  updated_by: integer("updated_by").references(() => users.id),
});

export const rolesRelations = relations(roles, ({ many }) => ({ users: many(users) }));
export const sectionsRelations = relations(sections, ({ many }) => ({ users: many(users), machines: many(machines) }));
export const usersRelations = relations(users, ({ one, many }) => ({
  role: one(roles, { fields: [users.role_id], references: [roles.id] }),
  salesCustomers: many(customers),
  createdOrders: many(orders),
  shiftAssignments: many(user_shift_assignments, { relationName: "shift_assignee" }),
}));
export const shiftDefinitionsRelations = relations(shift_definitions, ({ many }) => ({
  assignments: many(user_shift_assignments),
}));
export const userShiftAssignmentsRelations = relations(user_shift_assignments, ({ one, many }) => ({
  user: one(users, { fields: [user_shift_assignments.user_id], references: [users.id], relationName: "shift_assignee" }),
  assignedBy: one(users, { fields: [user_shift_assignments.assigned_by], references: [users.id], relationName: "shift_assigner" }),
  shift: one(shift_definitions, { fields: [user_shift_assignments.shift_id], references: [shift_definitions.id] }),
  attendanceEvents: many(attendance_events),
}));
export const customersRelations = relations(customers, ({ one, many }) => ({
  salesRep: one(users, { fields: [customers.sales_rep_id], references: [users.id] }),
  orders: many(orders),
  products: many(customer_products),
}));
export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, { fields: [categories.parent_id], references: [categories.id], relationName: "parent_category" }),
  children: many(categories, { relationName: "parent_category" }),
  products: many(customer_products),
}));
export const itemsRelations = relations(items, ({ many }) => ({ products: many(customer_products) }));
export const customerProductsRelations = relations(customer_products, ({ one, many }) => ({
  customer: one(customers, { fields: [customer_products.customer_id], references: [customers.id] }),
  category: one(categories, { fields: [customer_products.category_id], references: [categories.id] }),
  item: one(items, { fields: [customer_products.item_id], references: [items.id] }),
  productionOrders: many(production_orders),
}));
export const machinesRelations = relations(machines, ({ one, many }) => ({
  section: one(sections, { fields: [machines.section_id], references: [sections.id] }),
}));
export const ordersRelations = relations(orders, ({ one, many }) => ({
  customer: one(customers, { fields: [orders.customer_id], references: [customers.id] }),
  productionOrders: many(production_orders),
}));
export const productionOrdersRelations = relations(production_orders, ({ one }) => ({
  order: one(orders, { fields: [production_orders.order_id], references: [orders.id] }),
  customerProduct: one(customer_products, { fields: [production_orders.customer_product_id], references: [customer_products.id] }),
}));

const omitGenerated = { id: true, created_at: true, updated_at: true } as const;
export const insertRoleSchema = createInsertSchema(roles).omit({ id: true });
export const insertSectionSchema = createInsertSchema(sections).omit({ id: true });
export const insertUserSchema = createInsertSchema(users).omit({ id: true, created_at: true, updated_at: true });
export const insertShiftDefinitionSchema = createInsertSchema(shift_definitions).omit({ created_at: true, updated_at: true });
export const insertCustomerSchema = createInsertSchema(customers).omit({ created_at: true });
export const insertCategorySchema = createInsertSchema(categories).omit({ id: true }).extend({
  overrun_percentage: z.union([z.literal(0), z.literal(5), z.literal(10), z.literal(20)]).optional(),
});
export const insertItemSchema = createInsertSchema(items).omit({ id: true });
export const insertMasterBatchColorSchema = createInsertSchema(master_batch_colors).omit(omitGenerated);
const wholeProductNumber = z.string().regex(/^-?\d+$/, "يجب إدخال عدد صحيح دون كسور").nullish();
export const insertCustomerProductSchema = createInsertSchema(customer_products, {
  width: wholeProductNumber,
  left_facing: wholeProductNumber,
  right_facing: wholeProductNumber,
  thickness: wholeProductNumber,
  bags_per_kilo: wholeProductNumber,
}).omit({
  id: true,
  created_at: true,
  size_caption: true,
  bag_weight_grams: true,
  bags_per_kilo: true,
  package_weight_kg: true,
  is_printed: true,
});
export const insertMachineSchema = createInsertSchema(machines).omit({ id: true });
export const insertNewOrderSchema = createInsertSchema(orders).omit({ id: true, created_at: true });
export const insertProductionOrderSchema = createInsertSchema(production_orders).omit({ id: true, created_at: true });
export const insertMaintenanceComponentCatalogSchema = createInsertSchema(maintenance_component_catalog).omit({ id: true, created_at: true });
export const insertCompanyProfileSchema = createInsertSchema(company_profile).omit({ id: true });
export const insertSystemSettingSchema = createInsertSchema(system_settings).omit({ id: true, updated_at: true });
export const updateUserSchema = insertUserSchema.partial();
export const updateCustomerSchema = insertCustomerSchema.partial();
export const updateMachineSchema = insertMachineSchema.partial();
export const updateOrderSchema = insertNewOrderSchema.partial();
export const updateProductionOrderSchema = insertProductionOrderSchema.partial();
export const updateSystemSettingSchema = insertSystemSettingSchema.partial();

export type Role = typeof roles.$inferSelect;
export type Section = typeof sections.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type User = typeof users.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Item = typeof items.$inferSelect;
export type MasterBatchColor = typeof master_batch_colors.$inferSelect;
export type CustomerProduct = typeof customer_products.$inferSelect;
export type Machine = typeof machines.$inferSelect;
export type NewOrder = typeof orders.$inferSelect;
export type ProductionOrder = typeof production_orders.$inferSelect;
export type MaintenanceComponentCatalog = typeof maintenance_component_catalog.$inferSelect;
export type CompanyProfile = typeof company_profile.$inferSelect;
export type SystemSetting = typeof system_settings.$inferSelect;
export type InsertRole = z.infer<typeof insertRoleSchema>;
export type InsertSection = z.infer<typeof insertSectionSchema>;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type InsertCategory = z.infer<typeof insertCategorySchema>;
export type InsertItem = z.infer<typeof insertItemSchema>;
export type InsertMasterBatchColor = z.infer<typeof insertMasterBatchColorSchema>;
export type InsertCustomerProduct = z.infer<typeof insertCustomerProductSchema>;
export type InsertMachine = z.infer<typeof insertMachineSchema>;
export type InsertNewOrder = z.infer<typeof insertNewOrderSchema>;
export type InsertProductionOrder = z.infer<typeof insertProductionOrderSchema>;
export type InsertMaintenanceComponentCatalog = z.infer<typeof insertMaintenanceComponentCatalogSchema>;
export type InsertCompanyProfile = z.infer<typeof insertCompanyProfileSchema>;
export type InsertSystemSetting = z.infer<typeof insertSystemSettingSchema>;
