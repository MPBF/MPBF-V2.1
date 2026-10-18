import { productionRoleBindingSchema } from "../shared/production-role";
import { ensureProductionRoleBinding, resolveProductionRoleBinding, saveProductionRoleBinding, productionRoleSettingPrefix } from "./production-role";
import { Router, type Request, type Response } from "express";
import { releaseOrderToProduction } from "./order-production-release";
import { deleteOrderProduction, lockOrderProductionDeletion } from "./order-production-delete";
import { deleteOrdersAtomically } from "./order-bulk-delete";
import { ORDER_PRODUCTION_RELEASE_STATUSES } from "../shared/order-production-release";
import { ORDER_ACTIVE_STATUSES, ORDER_DISPLAY_FILTERS, ORDER_DISPLAY_FOLDERS, ORDER_WORKSPACE_ACTIONS, ORDER_WORKSPACE_STATUSES } from "../shared/order-workspace";
import { applyOrderActions, moveOrderFolders, orderFolderCounts } from "./order-workspace";
import { order_display_folder_assignments } from "../shared/schema";
import { and, asc, count, desc, eq, getTableColumns, ilike, inArray, isNull, or, aliasedTable, sql } from "drizzle-orm";
import bcrypt from "bcrypt";
import { z } from "zod";
import {
  categories,
  company_profile,
  customer_products,
  customers,
  insertCategorySchema,
  insertCompanyProfileSchema,
  insertCustomerProductSchema,
  insertCustomerSchema,
  insertItemSchema,
  insertMachineSchema,
  insertMaintenanceComponentCatalogSchema,
  insertMasterBatchColorSchema,
  insertNewOrderSchema,
  insertProductionOrderSchema,
  insertRoleSchema,
  insertSectionSchema,
  insertSystemSettingSchema,
  insertUserSchema,
  items,
  machines,
  maintenance_component_catalog,
  master_batch_colors,
  orders,
  production_orders,
  roles,
  sections,
  system_settings,
  users,
} from "@shared/schema";
import { db, pool } from "./db";
import { nextCategoryId } from "./category-id";
import { nextItemId } from "./item-id";
import { nextSectionId } from "./section-id";
import { nextMachineId } from "./machine-id";
import { nextMasterBatchColorId } from "./master-batch-id";
import { nextAdminIdNumber } from "./admin-id-sequence";
import { customerFormSchema, nextCustomerId, salesRepresentativeRoleCondition, validateCustomerSalesRepresentative } from "./customer-form";
import { allocateOrderNumber, previewOrderNumber, productionOrderNumber, productionOrderSequence } from "./order-number";
import { deliveryDateFromDays, orderDateInRiyadh } from "./order-delivery";
import { getOrderDetails } from "./order-details";
import { customerOrderHistory } from "./customer-order-history";
import { createPublicOrderPrintRouter, publicOrderPrintPath } from "./public-order-print";
import { customerProductFacingNotice, deriveCustomerProductFields, PRINTING_CYLINDERS } from "@shared/customer-product-fields";
import { authenticate, hashPassword, requireAnyPermission, requireAuth, requirePermission } from "./auth";
import rolePreviewRouter from "./role-preview";
import { canGrantPermissions, isProtectedProductionOrder, plannedFinalQuantity } from "./audit-rules";
import { categoryProductionPlan } from "./category-production-plan";
import hr from "./hr";
import selfService from "./self-service";
import factoryProduction from "./production/routes";
import dataTransfer from "./data-transfer/routes";
import databaseBackups from "./database-backups/routes";

const router = Router();
router.use(createPublicOrderPrintRouter(getOrderDetails));
const admin = requirePermission("admin");
const usersRead = requireAnyPermission("manage_users", "admin");
const rolesRead = requireAnyPermission("manage_users", "manage_roles", "admin");
const rolesWrite = requireAnyPermission("manage_roles", "admin");
const sectionsRead = requireAnyPermission("manage_users", "manage_sections", "manage_machines", "manage_maintenance", "admin");
const sectionsWrite = requireAnyPermission("manage_sections", "admin");
const settingsRead = requireAnyPermission("manage_settings", "admin");
const businessRead = requireAnyPermission("manage_customers", "manage_orders", "view_orders", "admin");
const customerProductsRead = requireAnyPermission("manage_customers", "manage_orders", "view_orders", "manage_production", "admin");
const ordersRead = requireAnyPermission("view_orders", "manage_orders", "manage_production", "admin");
const productionRead = requireAnyPermission("view_production", "manage_production", "admin");
const machinesRead = requireAnyPermission("view_production", "manage_machines", "view_maintenance", "manage_maintenance", "admin");
const maintenanceRead = requireAnyPermission("view_maintenance", "manage_maintenance", "admin");
const businessWrite = requireAnyPermission("manage_customers", "manage_orders", "admin");
const ordersWrite = requireAnyPermission("manage_orders", "admin");
const productionWrite = requireAnyPermission("manage_production", "admin");
const machinesWrite = requireAnyPermission("manage_machines", "manage_maintenance", "admin");
const maintenanceWrite = requireAnyPermission("manage_maintenance", "admin");
const categoriesRead = requireAnyPermission("manage_categories", "manage_definitions", "manage_customers", "manage_orders", "view_orders", "admin");
const itemsRead = requireAnyPermission("manage_items", "manage_definitions", "manage_customers", "manage_orders", "view_orders", "admin");
const masterBatchRead = requireAnyPermission("manage_master_batch", "manage_definitions", "manage_customers", "manage_orders", "view_orders", "admin");
const categoriesWrite = requireAnyPermission("manage_categories", "manage_definitions", "manage_customers", "manage_orders", "admin");
const itemsWrite = requireAnyPermission("manage_items", "manage_definitions", "manage_customers", "manage_orders", "admin");
const masterBatchWrite = requireAnyPermission("manage_master_batch", "manage_definitions", "manage_customers", "manage_orders", "admin");

const positiveWhole = z.string().regex(/^\d+$/, "يجب إدخال عدد صحيح دون كسور")
  .refine((value) => Number(value) > 0, "يجب أن تكون القيمة أكبر من صفر").nullish();
const nonnegativeWhole = z.string().regex(/^\d+$/, "يجب إدخال عدد صحيح دون كسور").nullish();
const positiveDecimalString = (maxIntegerDigits: number, maxDecimalDigits: number) => z.string()
  .regex(new RegExp(`^\\d{1,${maxIntegerDigits}}(?:\\.\\d{1,${maxDecimalDigits}})?$`))
  .refine((value) => Number(value) > 0, "يجب أن تكون القيمة أكبر من صفر").nullish();
const positiveIntegerValue = z.union([
  z.number().int().positive(),
  z.string().regex(/^\d+$/).refine((value) => Number(value) > 0),
]).nullish();
const productColor = z.string().trim().min(1).max(40)
  .refine((color) => /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(color) ||
    /^[\p{L}\p{N} _-]+$/u.test(color), "لون الطباعة غير صالح");
const productColors = z.array(productColor).max(12).nullish();

const requiredAdminText = (max: number) => z.string().trim().min(1).max(max);
const optionalAdminText = (max: number) => z.string().trim().max(max).nullish();
const optionalAdminRelation = (max: number) => z.preprocess(
  (value) => typeof value === "string" && !value.trim() ? null : value,
  z.string().trim().min(1).max(max).nullable().optional(),
);
const adminDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "التاريخ غير صالح").nullish();
const decimalAdminValue = (maxIntegerDigits: number, maxDecimalDigits: number, positive = false) =>
  z.union([z.string(), z.number().finite().transform(String)]).nullish()
    .refine((value) => value == null || new RegExp(`^\\d{1,${maxIntegerDigits}}(?:\\.\\d{1,${maxDecimalDigits}})?$`).test(String(value)),
      "القيمة الرقمية غير صالحة")
    .refine((value) => value == null || (positive ? Number(value) > 0 : Number(value) >= 0),
      positive ? "يجب أن تكون القيمة أكبر من صفر" : "لا يمكن أن تكون القيمة سالبة")
    .transform((value) => value == null ? value : String(value));
const positiveAdminInteger = z.union([
  z.number().int().positive().transform(String),
  z.string().trim().regex(/^\d+$/)
    .refine((value) => Number.isSafeInteger(Number(value)) && Number(value) > 0),
]).nullish();
const adminRoleId = z.preprocess(
  (value) => value === "" ? null : value,
  z.union([
    z.number().int().positive(),
    z.string().trim().regex(/^\d+$/).transform(Number).refine(Number.isSafeInteger),
  ]).nullable().optional(),
);
const adminPermissions = z.array(z.string().trim().min(1).max(80)).nullable().optional();
const sectionAdminSchema = insertSectionSchema.strict().extend({
  name: requiredAdminText(100),
  name_ar: optionalAdminText(100),
  description: optionalAdminText(5000),
});
const roleAdminSchema = insertRoleSchema.strict().extend({
  name: requiredAdminText(50),
  name_ar: optionalAdminText(100),
  permissions: adminPermissions,
  production_role_binding: productionRoleBindingSchema.optional(),
});
const userAdminSchema = insertUserSchema.omit({ preferred_language: true }).strict().extend({
  username: z.string().trim().min(1).max(50).optional(),
  password: z.string().refine((value) => value.trim().length >= 8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل").optional(),
  display_name: optionalAdminText(100),
  display_name_ar: optionalAdminText(100),
  full_name: optionalAdminText(200),
  phone: optionalAdminText(20),
  email: optionalAdminText(100),
  role_id: adminRoleId,
  section_id: optionalAdminRelation(20),
  status: z.string().trim().pipe(z.enum(["active", "inactive"])).nullish(),
  national_id: optionalAdminText(20),
  nationality: optionalAdminText(30),
  birth_date: adminDate,
  service_start_date: adminDate,
  profession: optionalAdminText(100),
  first_name: optionalAdminText(100),
  last_name: optionalAdminText(100),
  profile_image_url: optionalAdminText(500),
});
const categoryAdminSchema = insertCategorySchema.strict().extend({
  name: requiredAdminText(100),
  name_ar: optionalAdminText(100),
  code: optionalAdminText(20),
  parent_id: optionalAdminRelation(20),
});
const itemAdminSchema = insertItemSchema.strict().extend({
  category_id: optionalAdminRelation(20),
  name: optionalAdminText(100),
  name_ar: optionalAdminText(100),
  code: optionalAdminText(50),
  status: z.string().trim().pipe(z.enum(["active", "inactive"])).nullish(),
});
const masterBatchTypeId = z.string().trim().refine(
  (value) => /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value) || value.toLowerCase() === "transparent",
  "يجب إدخال لون HEX صالح أو transparent",
);
const masterBatchAdminSchema = insertMasterBatchColorSchema.omit({ sort_order: true }).strict().extend({
  name: requiredAdminText(100),
  name_ar: requiredAdminText(100),
  color_hex: masterBatchTypeId,
  text_color: masterBatchTypeId,
  brand: optionalAdminText(100),
  aliases: optionalAdminText(5000),
  is_active: z.boolean().optional(),
});
const componentAdminSchema = insertMaintenanceComponentCatalogSchema.omit({ sort_order: true }).strict().extend({
  machine_type: z.string().trim().pipe(z.enum(["extruder", "printer", "cutter", "quality_check"])),
  name_ar: requiredAdminText(200),
  name_en: requiredAdminText(200),
  enabled: z.boolean().optional(),
});
const machineTypeInput = z.string().trim().pipe(z.enum(["extruder", "printer", "cutter", "quality_check", "printing", "cutting", "Printer", "Cutter"]));
const machineAdminSchema = insertMachineSchema.strict().extend({
  name: requiredAdminText(100),
  name_ar: optionalAdminText(100),
  type: machineTypeInput,
  section_id: optionalAdminRelation(20),
  status: z.string().trim().pipe(z.enum(["active", "maintenance", "down"])).optional(),
  capacity_small_kg_per_hour: decimalAdminValue(6, 2, true),
  capacity_medium_kg_per_hour: decimalAdminValue(6, 2, true),
  capacity_large_kg_per_hour: decimalAdminValue(6, 2, true),
  min_thickness: decimalAdminValue(5, 3),
  max_thickness: decimalAdminValue(5, 3),
  min_width_cm: decimalAdminValue(6, 2),
  max_width_cm: decimalAdminValue(6, 2),
  max_print_colors: positiveAdminInteger,
  min_cylinder_inch: decimalAdminValue(6, 2),
  max_cylinder_inch: decimalAdminValue(6, 2),
  min_length_cm: decimalAdminValue(6, 2),
  max_length_cm: decimalAdminValue(6, 2),
  width_cm: decimalAdminValue(8, 2, true),
  length_cm: decimalAdminValue(8, 2, true),
  height_cm: decimalAdminValue(8, 2, true),
  weight_kg: decimalAdminValue(8, 2, true),
  manufacture_date: adminDate,
  screw_type: z.string().trim().pipe(z.enum(["A", "ABA"])).nullish(),
  raw_material_type: optionalAdminText(20),
  inline_printer_id: optionalAdminRelation(20),
  manufacturer: optionalAdminText(100),
  serial_number: optionalAdminText(100),
  metal_plate: optionalAdminText(5000),
});
const customerProductInputSchema = insertCustomerProductSchema.strict().extend({
  width: positiveWhole,
  left_facing: nonnegativeWhole,
  right_facing: nonnegativeWhole,
  thickness: positiveWhole,
  cutting_length_cm: positiveIntegerValue,
  density: z.union([positiveDecimalString(3, 3), z.literal("")]).nullish(),
  unit_weight_kg: positiveDecimalString(5, 3),
  unit_quantity: positiveIntegerValue,
  front_print_colors: productColors,
  back_print_colors: productColors,
});

const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;
const productImageMimeTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/avif"]);

function invalidProduct(message: string, status = 400) {
  return Object.assign(new Error(message), { status });
}

function isExistingImageUrl(value: string) {
  return /^https?:\/\/[^\s]+$/i.test(value) ||
    /^(?:\/(?!\/)|\.{1,2}\/)[A-Za-z0-9_./%?=&-]+$/u.test(value) ||
    /^[A-Za-z0-9_-]+\/[A-Za-z0-9_./%?=&-]+$/u.test(value);
}

function validateProductImage(value: unknown, previousValue?: unknown) {
  if (value === null || value === undefined || value === "") return;
  if (typeof value !== "string") throw invalidProduct("صورة التصميم غير صالحة");
  if (value === previousValue && isExistingImageUrl(value)) return;
  const match = value.match(/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/i);
  if (!match || !productImageMimeTypes.has(match[1].toLowerCase())) {
    throw invalidProduct("يجب استخدام صورة PNG أو JPEG أو GIF أو WebP أو BMP أو AVIF");
  }
  const encoded = match[2];
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length > MAX_PRODUCT_IMAGE_BYTES || bytes.toString("base64") !== encoded) {
    throw invalidProduct("يجب ألا يتجاوز حجم الصورة 5 ميجابايت وأن تكون بياناتها صالحة");
  }
  const mime = match[1].toLowerCase();
  const starts = (signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  const validSignature =
    (mime === "image/png" && starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
    (mime === "image/jpeg" && starts([0xff, 0xd8, 0xff])) ||
    (mime === "image/gif" && ["GIF87a", "GIF89a"].some((signature) => bytes.subarray(0, 6).toString("ascii") === signature)) ||
    (mime === "image/webp" && bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WEBP") ||
    (mime === "image/bmp" && bytes.subarray(0, 2).toString("ascii") === "BM") ||
    (mime === "image/avif" && bytes.length >= 16 && bytes.subarray(4, 8).toString("ascii") === "ftyp" &&
      ["avif", "avis"].some((brand) => {
        for (let offset = 8; offset + 4 <= Math.min(bytes.length, 32); offset += 4) {
          if (bytes.subarray(offset, offset + 4).toString("ascii") === brand) return true;
        }
        return false;
      }));
  if (!validSignature) throw invalidProduct("نوع الصورة لا يطابق بيانات الملف");
}

function normalizeCustomerProductInput(input: Record<string, any>) {
  const normalized = { ...input };
  if (normalized.density === null || normalized.density === "") normalized.density = "0.95";
  for (const field of ["category_id", "item_id", "master_batch_id"] as const) {
    if (normalized[field] === "") normalized[field] = null;
  }
  for (const field of ["density", "unit_weight_kg"] as const) {
    if (normalized[field] !== null && normalized[field] !== undefined) normalized[field] = String(normalized[field]);
  }
  for (const field of ["cutting_length_cm", "unit_quantity"] as const) {
    if (typeof normalized[field] === "string") normalized[field] = Number(normalized[field]);
  }
  return normalized;
}

async function validateCustomerProductReferences(
  tx: any,
  input: Record<string, any>,
  oldBatchId?: string | null,
  oldItemId?: string | null,
  oldCategoryId?: string | null,
) {
  if (!input.customer_id) throw invalidProduct("يجب اختيار عميل صالح");
  const [customer] = await tx.select({ id: customers.id }).from(customers)
    .where(eq(customers.id, input.customer_id)).for("key share").limit(1);
  const [item] = input.item_id
    ? await tx.select({ id: items.id, category_id: items.category_id, status: items.status })
      .from(items).where(eq(items.id, input.item_id)).for("key share").limit(1)
    : [null];
  const [category] = input.category_id
    ? await tx.select({ id: categories.id, name: categories.name, name_ar: categories.name_ar })
      .from(categories).where(eq(categories.id, input.category_id)).for("key share").limit(1)
    : [null];
  if (!customer) throw invalidProduct("العميل المحدد غير موجود");
  if (input.category_id && !category) throw invalidProduct("التصنيف المحدد غير موجود");
  if (input.item_id && !item) throw invalidProduct("الصنف المحدد غير موجود");
  if (item && input.category_id && item.category_id !== input.category_id &&
    !(input.item_id === oldItemId && input.category_id === oldCategoryId)) {
    throw invalidProduct("الصنف لا ينتمي إلى التصنيف المحدد");
  }
  if (item && item.status === "inactive" && input.item_id !== oldItemId) {
    throw invalidProduct("لا يمكن اختيار صنف غير نشط");
  }
  if (input.master_batch_id) {
    const [batch] = await tx.select({ id: master_batch_colors.id, is_active: master_batch_colors.is_active })
      .from(master_batch_colors).where(eq(master_batch_colors.id, input.master_batch_id)).for("key share").limit(1);
    if (!batch) throw invalidProduct("لون الخامة المحدد غير موجود");
    if (!batch.is_active && input.master_batch_id !== oldBatchId) {
      throw invalidProduct("لا يمكن اختيار لون خامة غير نشط");
    }
  }
  return category ?? null;
}

async function createCustomerProductInTransaction(
  tx: any,
  rawProduct: unknown,
  customerId: string,
  options: {
    oldBatchId?: string | null;
    previousFrontImage?: unknown;
    previousBackImage?: unknown;
  } = {},
) {
  const product = normalizeCustomerProductInput(
    customerProductInputSchema.omit({ customer_id: true }).parse(rawProduct),
  );
  product.customer_id = customerId;

  const facingNotice = customerProductFacingNotice(product);
  if (facingNotice?.kind === "blocking") throw invalidProduct(facingNotice.message);

  const category = await validateCustomerProductReferences(tx, product, options.oldBatchId);
  validateProductImage(product.cliche_front_design, options.previousFrontImage);
  validateProductImage(product.cliche_back_design, options.previousBackImage);

  const fields = deriveCustomerProductFields(
    { ...product, density: product.density === undefined ? "0.95" : product.density },
    `${category?.name_ar ?? ""} ${category?.name ?? ""}`,
  );
  return tx.insert(customer_products).values({
    ...product,
    ...fields,
    status: product.status ?? "active",
  }).returning();
}

const positiveKg = z.string().regex(/^\d{1,8}(?:\.\d{1,2})?$/, "الكمية يجب أن تكون بالكيلو وحتى منزلتين عشريتين")
  .refine((value) => Number(value) > 0, "الكمية يجب أن تكون أكبر من صفر");
const orderLineSchema = z.object({
  customer_product_id: z.number().int().positive().optional(),
  new_product: customerProductInputSchema.omit({ customer_id: true }).optional(),
  quantity_kg: positiveKg,
}).strict();
const validOrderLine = <T extends { customer_product_id?: number; new_product?: unknown }>(line: T) =>
  Boolean(line.customer_product_id) !== Boolean(line.new_product);
const orderWithItemsSchema = z.object({
  customer_id: z.string().trim().min(1).max(20),
  delivery_days: z.number().int().min(1).max(3650),
  notes: z.string().trim().max(5000).optional(),
  items: z.array(orderLineSchema.refine(validOrderLine,
    "اختر منتجًا مسجلًا أو أنشئ منتجًا جديدًا لكل سطر")).min(1).max(25),
}).strict();

const orderEditSchema = orderWithItemsSchema.omit({ customer_id: true }).extend({
  // Accept but ignore snapshots from editors opened before this fix.
  // Only dedicated transition actions may update order status.
  status: z.enum(["waiting", "on_hold", "in_production", "for_production", "paused", "cancelled", "completed", "delivered", "archived"]).optional(),
  original_items: z.array(z.object({
    id: z.number().int().positive(),
    customer_product_id: z.number().int().positive().nullable(),
    quantity_kg: positiveKg,
  }).strict()).max(25),
  // Existing lines carry their production-order ID. New lines have no ID.
  items: orderLineSchema.extend({ id: z.number().int().positive().optional() }).refine(validOrderLine,
    "اختر منتجًا مسجلًا أو أنشئ منتجًا جديدًا لكل سطر").array().min(1).max(25),
}).strict();

const numericIdInput = z.union([
  z.number().int().positive(),
  z.string().regex(/^\d+$/).transform(Number).refine((value) => Number.isSafeInteger(value) && value > 0),
]);
const productionQuantity = z.union([z.string(), z.number().finite().transform(String)])
  .pipe(positiveKg);
const productionOverrun = z.union([z.string(), z.number().finite().transform(String)])
  .pipe(z.string().regex(/^\d{1,3}(?:\.\d{1,2})?$/)
    .refine((value) => Number(value) >= 0 && Number(value) <= 50, "نسبة الهالك يجب أن تكون بين 0 و50"));
const productionOrderInputSchema = z.object({
  production_order_number: z.string().trim().min(1).max(50).optional(),
  order_id: numericIdInput.optional(),
  customer_product_id: numericIdInput.nullable().optional(),
  quantity_kg: productionQuantity.optional(),
  overrun_percentage: productionOverrun.optional(),
  final_quantity_kg: productionQuantity.optional(),
  status: z.enum(["pending", "active", "completed", "cancelled", "archived"]).optional(),
  previous_status: z.string().max(30).nullable().optional(),
  batch_number: z.string().max(50).nullable().optional(),
}).strict();

function orderError(message: string, status = 409) {
  return Object.assign(new Error(message), { status });
}

function page(req: Request) {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  return { limit, offset, search };
}

function parsed(schema: { parse: (value: unknown) => any }, body: unknown) {
  return schema.parse(body);
}

function assertGrantWithinActor(actorPermissions: unknown, grant: unknown) {
  if (!canGrantPermissions(actorPermissions, Array.isArray(grant) ? grant : [])) {
    throw Object.assign(new Error("لا يمكن منح صلاحيات تتجاوز صلاحياتك الفعلية"), { status: 403 });
  }
}

async function assertProductionProductMatchesOrder(tx: any, orderId: number, productId?: number | null) {
  const [order] = await tx.select({ id: orders.id, customer_id: orders.customer_id }).from(orders)
    .where(eq(orders.id, orderId)).for("share").limit(1);
  if (!order) throw orderError("الطلب المحدد غير موجود", 400);
  if (productId == null) return;

  const [product] = await tx.select({ id: customer_products.id, customer_id: customer_products.customer_id })
    .from(customer_products).where(eq(customer_products.id, productId)).for("update").limit(1);
  if (!product) throw orderError("المنتج المحدد غير موجود", 400);
  if (product.customer_id !== order.customer_id) {
    throw orderError("المنتج غير تابع لعميل الطلب", 400);
  }
}

async function assertProductCanTransfer(tx: any, productId: number, customerId: string | null) {
  const [conflict] = await tx.select({ id: production_orders.id }).from(production_orders)
    .innerJoin(orders, eq(production_orders.order_id, orders.id))
    .where(and(
      eq(production_orders.customer_product_id, productId),
      sql`${orders.customer_id} IS DISTINCT FROM ${customerId}`,
    )).limit(1);
  if (conflict) throw orderError("لا يمكن نقل المنتج؛ فهو مرتبط بطلب إنتاج لعميل آخر", 409);
}

async function validateUserRoleGrant(
  tx: any,
  roleId: number | null | undefined,
  actorPermissions: unknown,
  allowMissingUnchangedLegacyRole = false,
) {
  if (roleId == null) return;
  const [role] = await tx.select({ permissions: roles.permissions }).from(roles)
    .where(eq(roles.id, roleId)).for("update").limit(1);
  if (!role) {
    if (allowMissingUnchangedLegacyRole) return;
    throw Object.assign(new Error("الدور المحدد غير موجود"), { status: 400 });
  }
  assertGrantWithinActor(actorPermissions, role.permissions);
}

function adminValidationError(message: string, status = 400) {
  return Object.assign(new Error(message), { status });
}

function stripCreateId(input: Record<string, any>) {
  const { id: _ignoredId, ...body } = input;
  return body;
}

function assertPutIdIsImmutable(input: Record<string, any>, key: string | number) {
  if (!Object.prototype.hasOwnProperty.call(input, "id")) return;
  if (String(input.id) !== String(key)) throw adminValidationError("لا يمكن تغيير المعرّف بعد الإنشاء");
  delete input.id;
}

async function validateOptionalReference(
  tx: any,
  table: any,
  column: any,
  value: string | number | null | undefined,
  oldValue: string | number | null | undefined,
  message: string,
) {
  if (value == null || value === "") return;
  const [row] = await tx.select({ id: table.id }).from(table).where(eq(column, value)).for("key share").limit(1);
  if (!row && value !== oldValue) throw adminValidationError(message);
}

async function validateCategoryParent(
  tx: any,
  parentId: string | null | undefined,
  currentId?: string,
  oldParentId?: string | null,
) {
  if (!parentId) return;
  if (currentId && parentId === oldParentId) {
    if (parentId === currentId) return;
    const [parent] = await tx.select({ id: categories.id }).from(categories)
      .where(eq(categories.id, parentId)).for("key share").limit(1);
    // Permit an unchanged dangling legacy relation, but never a new one.
    if (!parent) return;
    return;
  }
  if (currentId && parentId === currentId) throw adminValidationError("لا يمكن جعل التصنيف أبًا لنفسه");
  const rows = await tx.select({ id: categories.id, parent_id: categories.parent_id }).from(categories);
  const byId = new Map<string, string | null>(rows.map((row: any) => [row.id, row.parent_id]));
  if (!byId.has(parentId)) throw adminValidationError("التصنيف الأب المحدد غير موجود");
  const visited = new Set<string>();
  let cursor: string | null | undefined = parentId;
  while (cursor) {
    if (cursor === currentId) throw adminValidationError("لا يمكن إنشاء دورة في شجرة التصنيفات");
    if (visited.has(cursor)) throw adminValidationError("سلسلة التصنيفات الأب تحتوي على دورة غير صالحة");
    visited.add(cursor);
    cursor = byId.get(cursor);
  }
}

function canonicalMachineType(value: string) {
  if (value === "printing" || value === "Printer") return "printer";
  if (value === "cutting" || value === "Cutter") return "cutter";
  return value;
}

function normalizeChangedMachineType(input: Record<string, any>, oldType?: string | null) {
  if (typeof input.type !== "string") return;
  if (oldType !== undefined && input.type === oldType) return;
  input.type = canonicalMachineType(input.type);
}

async function validateMachineReferences(
  tx: any,
  input: Record<string, any>,
  current?: { id: string; section_id: string | null; inline_printer_id: string | null; type: string | null },
  revalidateUnchangedInlinePrinter = false,
) {
  await validateOptionalReference(tx, sections, sections.id, input.section_id, current?.section_id, "القسم المحدد غير موجود");
  if (input.inline_printer_id == null || input.inline_printer_id === "") return;
  if (current?.inline_printer_id === input.inline_printer_id && !revalidateUnchangedInlinePrinter) return;
  const machineType = input.type ?? current?.type;
  if (machineType !== "extruder") throw adminValidationError("يمكن ربط الطابعة الداخلية بماكينة بثق فقط");
  if (input.inline_printer_id === current?.id) throw adminValidationError("لا يمكن ربط الماكينة بنفسها كطابعة داخلية");
  const [printer] = await tx.select({ id: machines.id, type: machines.type }).from(machines)
    .where(eq(machines.id, input.inline_printer_id)).for("key share").limit(1);
  if (!printer) throw adminValidationError("الطابعة الداخلية المحددة غير موجودة");
  if (canonicalMachineType(printer.type ?? "") !== "printer") {
    throw adminValidationError("يجب اختيار ماكينة من نوع طابعة للطابعة الداخلية");
  }
}

async function hasInlinePrinterDependents(tx: any, printerId: string) {
  const [reference] = await tx.select({ id: machines.id }).from(machines)
    .where(eq(machines.inline_printer_id, printerId)).limit(1);
  return Boolean(reference);
}

async function validateMachineTypeTransition(
  tx: any,
  current: { id: string; type: string | null; inline_printer_id: string | null },
  merged: Record<string, any>,
  body: Record<string, any>,
) {
  if (!Object.prototype.hasOwnProperty.call(body, "type")) return false;
  const previousType = canonicalMachineType(current.type ?? "");
  const nextType = canonicalMachineType(merged.type ?? "");
  if (previousType === nextType) return false;

  const currentInlinePrinter = typeof current.inline_printer_id === "string" && current.inline_printer_id.trim().length > 0;
  const mergedInlinePrinter = typeof merged.inline_printer_id === "string" && merged.inline_printer_id.trim().length > 0;
  if (previousType === "extruder" && currentInlinePrinter && nextType !== "extruder" && mergedInlinePrinter) {
    throw adminValidationError("أزل الطابعة الداخلية أولاً بإرسال inline_printer_id فارغًا قبل تغيير نوع ماكينة البثق");
  }
  if (previousType === "printer" && nextType !== "printer" &&
    await hasInlinePrinterDependents(tx, current.id)) {
    throw adminValidationError("لا يمكن تغيير نوع الطابعة لأنها مرتبطة بماكينات بثق؛ أزل الارتباطات أولاً");
  }
  return true;
}

function actorHasAdminPermission(permissions: unknown) {
  return Array.isArray(permissions) && permissions.includes("admin");
}

function validateMachineRanges(input: Record<string, any>) {
  for (const [minimum, maximum] of [
    ["min_thickness", "max_thickness"], ["min_width_cm", "max_width_cm"],
    ["min_cylinder_inch", "max_cylinder_inch"], ["min_length_cm", "max_length_cm"],
  ]) {
    if (input[minimum] != null && input[maximum] != null && Number(input[minimum]) > Number(input[maximum])) {
      throw adminValidationError(`${minimum} لا يمكن أن تتجاوز ${maximum}`);
    }
  }
}

function userId(raw: string) {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    const error = new Error("المعرّف الرقمي غير صالح");
    (error as Error & { status?: number }).status = 400;
    throw error;
  }
  return value;
}

router.get("/health", (_req, res) => res.json({ status: "ok" }));
router.use("/me/role-preview", rolePreviewRouter);
router.use("/self", selfService);
router.use("/hr", hr);
router.use("/production", factoryProduction);
router.use("/data-transfer", dataTransfer);
router.use("/database-backups", databaseBackups);
router.get("/public-branding", async (_req, res, next) => {
  try {
    const profile = (await db.select().from(company_profile).limit(1))[0] ?? null;
    const settings = await db
      .select({ setting_key: system_settings.setting_key, setting_value: system_settings.setting_value })
      .from(system_settings)
      .where(eq(system_settings.setting_key, "company_logo_data_url"))
      .limit(1);

    const logoSetting = settings[0]?.setting_value;
    const logoSrc = typeof logoSetting === "string" && logoSetting.trim()
      ? logoSetting.trim()
      : typeof profile?.logo_url === "string" && profile.logo_url.trim()
        ? profile.logo_url.trim()
        : "";

    res.json({
      companyNameAr: profile?.name_ar || profile?.name || "MPBF",
      companyNameEn: profile?.name || profile?.name_ar || "PLASTIC MANUFACTURING",
      logoSrc,
      defaultLanguage: profile?.default_language === "en" ? "en" : "ar",
    });
  } catch (error) {
    next(error);
  }
});
router.get("/me", (req, res) => {
  if (!req.user) return res.status(401).json({ success: false, message: "تسجيل الدخول مطلوب" });
  return res.json({ success: true, user: req.user });
});
router.put("/me/language", requireAuth, async (req, res, next) => {
  try {
    const { preferred_language } = z.object({ preferred_language: z.enum(["ar", "en"]).nullable() }).strict().parse(req.body);
    const [user] = await db.update(users)
      .set({ preferred_language })
      .where(eq(users.id, req.user!.id))
      .returning({ preferred_language: users.preferred_language });
    if (!user) return res.status(401).json({ success: false, message: "تسجيل الدخول مطلوب" });
    return res.json({ preferred_language: user.preferred_language });
  } catch (error) {
    return next(error);
  }
});

const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LIMIT = 10;

function loginKey(req: Request, identifier: string) {
  return `${req.ip}:${identifier.toLowerCase()}`;
}

router.post("/login", async (req, res, next) => {
  try {
    const identifier = String(req.body?.username ?? req.body?.national_id ?? "").trim();
    const password = String(req.body?.password ?? "");
    if (!identifier || password.length < 1) return res.status(400).json({ message: "اسم المستخدم وكلمة المرور مطلوبان" });
    const key = loginKey(req, identifier);
    const now = Date.now();
    for (const [attemptKey, value] of loginAttempts) {
      if (value.resetAt <= now) loginAttempts.delete(attemptKey);
    }
    const attempt = loginAttempts.get(key);
    if (attempt && attempt.resetAt > now && attempt.count >= LOGIN_LIMIT) {
      return res.status(429).json({ message: "محاولات دخول كثيرة، حاول لاحقاً" });
    }
    const user = await authenticate(identifier, password);
    if (!user) {
      const current = attempt && attempt.resetAt > now ? attempt : { count: 0, resetAt: now + LOGIN_WINDOW_MS };
      current.count += 1;
      loginAttempts.set(key, current);
      return res.status(401).json({ message: "بيانات الدخول غير صحيحة" });
    }
    loginAttempts.delete(key);
    req.session.userId = user.id;
    await new Promise<void>((resolve, reject) => req.session.save((error: Error | null) => (error ? reject(error) : resolve())));
    res.json({ success: true, user });
  } catch (error) {
    next(error);
  }
});

router.post("/logout", (req, res, next) => {
  (req.session.destroy as any)((error: Error | null) => {
    if (error) return next(error);
    res.clearCookie("plastic-bag-session");
    res.json({ success: true });
  });
});

router.post("/change-password", requireAuth, async (req, res, next) => {
  try {
    const password = String(req.body?.password ?? "");
    if (password.length < 8) return res.status(400).json({ message: "كلمة المرور يجب أن تكون 8 أحرف على الأقل" });
    await db.update(users).set({ password: await hashPassword(password), must_change_password: false }).where(eq(users.id, req.user!.id));
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.get("/dashboard", admin, async (_req, res, next) => {
  try {
    const names = [
      ["customers", customers],
      ["orders", orders],
      ["production_orders", production_orders],
      ["machines", machines],
      ["users", users],
    ] as const;
    const entries = await Promise.all(names.map(async ([name, table]) => [name, Number((await db.select({ value: count() }).from(table))[0]?.value ?? 0)] as const));
    res.json(Object.fromEntries(entries));
  } catch (error) {
    next(error);
  }
});

router.get("/users", usersRead, async (req, res, next) => {
  try {
    const { limit, offset, search } = page(req);
    const where = search
      ? or(
        ilike(users.username, `%${search}%`),
        ilike(users.display_name, `%${search}%`),
        ilike(users.display_name_ar, `%${search}%`),
        ilike(users.full_name, `%${search}%`),
        ilike(users.email, `%${search}%`),
        ilike(users.phone, `%${search}%`),
        ilike(users.national_id, `%${search}%`),
        sql`${users.id}::text ILIKE ${`%${search}%`}`,
      )
      : undefined;
    const rows = await db
      .select({
        id: users.id,
        username: users.username,
        display_name: users.display_name,
        display_name_ar: users.display_name_ar,
        full_name: users.full_name,
        phone: users.phone,
        email: users.email,
        role_id: users.role_id,
        role_name: roles.name,
        role_name_ar: roles.name_ar,
        section_id: users.section_id,
        section_name: sections.name,
        section_name_ar: sections.name_ar,
        status: users.status,
        must_change_password: users.must_change_password,
        is_system_user: users.is_system_user,
        include_in_attendance: users.include_in_attendance,
        national_id: users.national_id,
        nationality: users.nationality,
        birth_date: users.birth_date,
        service_start_date: users.service_start_date,
        profession: users.profession,
        first_name: users.first_name,
        last_name: users.last_name,
        created_at: users.created_at,
        updated_at: users.updated_at,
      })
      .from(users)
      .leftJoin(roles, eq(users.role_id, roles.id))
      .leftJoin(sections, eq(users.section_id, sections.id))
      .where(where)
      .orderBy(desc(users.id))
      .limit(limit)
      .offset(offset);
    res.json(rows);
  } catch (error) { next(error); }
});
router.post("/users", usersRead, async (req, res, next) => {
  try {
    const raw = stripCreateId({ ...(req.body ?? {}) });
    if (raw.is_system_user === true && !actorHasAdminPermission(req.user?.permissions)) {
      throw adminValidationError("يتطلب إنشاء مستخدم نظام صلاحية المسؤول", 403);
    }
    const username = typeof raw.username === "string" ? raw.username.trim() : "";
    const password = typeof raw.password === "string" ? raw.password : "";
    if (!username) return res.status(400).json({ message: "اسم المستخدم مطلوب" });
    if (password.trim().length < 8) return res.status(400).json({ message: "كلمة المرور يجب أن تكون 8 أحرف على الأقل" });
    const body = parsed(userAdminSchema.extend({
      username: requiredAdminText(50),
      password: z.string().refine((value) => value.trim().length >= 8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل"),
    }), { ...raw, username, password });
    const inserted = await db.transaction(async (tx) => {
      await validateUserRoleGrant(tx, body.role_id, req.user?.permissions ?? []);
      await validateOptionalReference(tx, sections, sections.id, body.section_id, undefined, "القسم المحدد غير موجود");
      return tx.insert(users).values({ ...body, password: await bcrypt.hash(password, 12) }).returning({ id: users.id });
    });
    res.status(201).json({ id: inserted[0].id });
  } catch (error) { next(error); }
});
router.put("/users/:id", usersRead, async (req, res, next) => {
  try {
    const id = userId(req.params.id);
    const raw = { ...(req.body ?? {}) };
    assertPutIdIsImmutable(raw, id);
    if ("password" in raw) {
      if (typeof raw.password !== "string") {
        return res.status(400).json({ message: "كلمة المرور غير صالحة" });
      }
      if (!raw.password.trim()) {
        delete raw.password;
      } else if (raw.password.trim().length < 8) {
        return res.status(400).json({ message: "كلمة المرور يجب أن تكون 8 أحرف على الأقل" });
      }
    }
    const body = parsed(userAdminSchema.partial(), raw);
    if (!Object.keys(body).length) return res.status(400).json({ message: "لا توجد بيانات للتعديل" });
    const row: any[] = await db.transaction(async (tx) => {
      const [target] = await tx.select({
        id: users.id, role_id: users.role_id, section_id: users.section_id, is_system_user: users.is_system_user,
      }).from(users)
        .where(eq(users.id, id)).for("update").limit(1);
      if (!target) return [];
      if (Object.prototype.hasOwnProperty.call(body, "is_system_user") &&
        body.is_system_user !== target.is_system_user &&
        !actorHasAdminPermission(req.user?.permissions)) {
        throw adminValidationError("يتطلب تغيير حالة مستخدم النظام صلاحية المسؤول", 403);
      }
      if (target.role_id != null) {
        await validateUserRoleGrant(tx, target.role_id, req.user?.permissions ?? [], true);
      }
      if (Object.prototype.hasOwnProperty.call(body, "role_id") && body.role_id !== target.role_id) {
        await validateUserRoleGrant(tx, body.role_id, req.user?.permissions ?? []);
      }
      await validateOptionalReference(tx, sections, sections.id, body.section_id, target.section_id, "القسم المحدد غير موجود");
      const values = { ...body };
      if (typeof values.password === "string") values.password = await bcrypt.hash(values.password, 12);
      return tx.update(users).set(values).where(eq(users.id, id))
        .returning({ id: users.id, username: users.username, status: users.status });
    });
    if (!row[0]) return res.status(404).json({ message: "المستخدم غير موجود" });
    res.json(row[0]);
  } catch (error) { next(error); }
});
router.delete("/users/:id", admin, async (req, res, next) => {
  try {
    const id = userId(req.params.id);
    if (id === req.user!.id) return res.status(409).json({ message: "لا يمكن حذف المستخدم الحالي" });
    const target = (await db
      .select({ id: users.id, is_system_user: users.is_system_user })
      .from(users)
      .where(eq(users.id, id))
      .limit(1))[0];
    if (!target) return res.status(404).json({ message: "المستخدم غير موجود" });
    if (target.is_system_user) return res.status(409).json({ message: "لا يمكن حذف مستخدم النظام" });

    const row = await db.transaction(async (tx) => {
      // These are historical/assignment references and should survive deleting
      // the login account. Clear them explicitly because the live database uses
      // NO ACTION/RESTRICT for these nullable foreign keys.
      await tx.update(customers).set({ sales_rep_id: null }).where(eq(customers.sales_rep_id, id));
      // Compatibility for databases not yet migrated: old rolls.created_by
      // restricts user deletion. The development database no longer has rolls.
      const legacyRolls = await tx.execute<{ table_name: string | null }>(
        sql`SELECT to_regclass('public.rolls')::text AS table_name`,
      );
      if (legacyRolls.rows[0]?.table_name) {
        await tx.execute(sql`UPDATE public.rolls SET created_by = NULL WHERE created_by = ${id}`);
      }
      await tx.update(system_settings).set({ updated_by: null }).where(eq(system_settings.updated_by, id));
      return (await tx.delete(users).where(eq(users.id, id)).returning({ id: users.id }))[0];
    });
    if (!row) return res.status(404).json({ message: "المستخدم غير موجود" });
    res.json({ success: true, id: row.id });
  } catch (error) { next(error); }
});

router.get("/roles", rolesRead, async (req, res, next) => {
  try {
    const { search } = page(req);
    const found = await db.select().from(roles)
      .where(search ? or(
        ilike(roles.name, `%${search}%`),
        ilike(roles.name_ar, `%${search}%`),
        sql`${roles.id}::text ILIKE ${`%${search}%`}`,
      ) : undefined)
      .orderBy(roles.id);
    res.json(await Promise.all(found.map(async role => ({
      ...role, production_role_binding: await resolveProductionRoleBinding(role.id),
    }))));
  } catch (e) { next(e); }
});
router.get("/sections", sectionsRead, async (req, res, next) => {
  try {
    const { search } = page(req);
    res.json(await db.select().from(sections)
      .where(search ? or(
        ilike(sections.id, `%${search}%`),
        ilike(sections.name, `%${search}%`),
        ilike(sections.name_ar, `%${search}%`),
      ) : undefined)
      .orderBy(sections.id));
  } catch (e) { next(e); }
});
router.post("/roles", rolesWrite, async (req, res, next) => {
  try {
    const body = parsed(roleAdminSchema, stripCreateId({ ...(req.body ?? {}) }));
    assertGrantWithinActor(req.user?.permissions ?? [], body.permissions);
    const { production_role_binding = { mode: "general", stages: [] }, ...fields } = body;
    const row = await db.transaction(async tx => {
      const inserted = await tx.insert(roles).values(fields).returning();
      await saveProductionRoleBinding(tx, inserted[0].id, production_role_binding);
      return inserted.map(role => ({ ...role, production_role_binding }));
    });
    res.status(201).json(row[0]);
  } catch (e) { next(e); }
});
router.post("/sections", sectionsWrite, async (req, res, next) => {
  try {
    const body = parsed(sectionAdminSchema, stripCreateId({ ...(req.body ?? {}) }));
    const row = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${29832}, ${4})`);
      const sequence = await tx.execute<{ max_number: string | null; suffix_width: number | null }>(sql`
        SELECT MAX(substring(id from 4)::numeric)::text AS max_number,
               MAX(length(id) - 3)::int AS suffix_width
        FROM sections WHERE id ~ '^SEC[0-9]+$'
      `);
      const number = await nextAdminIdNumber(tx, "sections", sequence.rows[0]?.max_number ?? null);
      const id = nextSectionId((BigInt(number) - 1n).toString(), sequence.rows[0]?.suffix_width ?? null);
      return tx.insert(sections).values({ ...body, id }).returning();
    });
    res.status(201).json(row[0]);
  } catch (e) { next(e); }
});
router.put("/roles/:id", rolesWrite, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ message: "المعرّف الرقمي غير صالح" });
    const input = { ...(req.body ?? {}) };
    assertPutIdIsImmutable(input, id);
    const body = parsed(roleAdminSchema.partial(), input);
    const row = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(roles)
        .where(eq(roles.id, id)).for("update").limit(1);
      if (!current) return [];
      assertGrantWithinActor(req.user?.permissions ?? [], current.permissions);
      if (Object.prototype.hasOwnProperty.call(body, "permissions")) {
        assertGrantWithinActor(req.user?.permissions ?? [], body.permissions);
      }
      const { production_role_binding, ...fields } = body;
      const previousBinding = await ensureProductionRoleBinding(tx, current);
      if (production_role_binding) await saveProductionRoleBinding(tx, id, production_role_binding);
      const updated = Object.keys(fields).length
        ? await tx.update(roles).set(fields).where(eq(roles.id, id)).returning()
        : [current];
      return updated.map(role => ({ ...role, production_role_binding: production_role_binding ?? previousBinding }));
    });
    if (!row[0]) return res.status(404).json({ message: "الدور غير موجود" });
    res.json(row[0]);
  } catch (e) { next(e); }
});
router.put("/sections/:id", sectionsWrite, async (req, res, next) => {
  try {
    const id = req.params.id;
    const input = { ...(req.body ?? {}) };
    assertPutIdIsImmutable(input, id);
    const body = parsed(sectionAdminSchema.partial(), input);
    const row = await db.update(sections).set(body).where(eq(sections.id, id)).returning();
    if (!row[0]) return res.status(404).json({ message: "القسم غير موجود" });
    res.json(row[0]);
  } catch (e) { next(e); }
});
router.delete("/roles/:id", admin, async (req, res, next) => { try { const id = Number(req.params.id); if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ message: "المعرّف الرقمي غير صالح" }); const row = await db.delete(roles).where(eq(roles.id, id)).returning({ id: roles.id }); if (!row[0]) return res.status(404).json({ message: "الدور غير موجود" }); res.json({ success: true, id: row[0].id }); } catch (e) { next(e); } });
router.delete("/sections/:id", admin, async (req, res, next) => {
  try {
    const id = req.params.id;
    const row = await db.transaction(async (tx) => {
      const [current] = await tx.select({ id: sections.id }).from(sections)
        .where(eq(sections.id, id)).for("update").limit(1);
      if (!current) return null;
      const [userReference] = await tx.select({ id: users.id }).from(users)
        .where(eq(users.section_id, id)).limit(1);
      const [machineReference] = await tx.select({ id: machines.id }).from(machines)
        .where(eq(machines.section_id, id)).limit(1);
      if (userReference || machineReference) {
        throw orderError("لا يمكن حذف القسم لارتباطه بمستخدمين أو ماكينات", 409);
      }
      return (await tx.delete(sections).where(eq(sections.id, id)).returning({ id: sections.id }))[0] ?? null;
    });
    if (!row) return res.status(404).json({ message: "القسم غير موجود" });
    res.json({ success: true, id: row.id });
  } catch (e) { next(e); }
});

router.get("/orders/next-number", ordersWrite, async (_req, res, next) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json({ order_number: await previewOrderNumber(db) });
  } catch (error) { next(error); }
});

// Save the order and every planned line in one transaction. An invalid item
// or conflicting number leaves no partial order behind.
router.post("/orders/with-items", ordersWrite, async (req, res, next) => {
  try {
    const input = orderWithItemsSchema.parse(req.body);

    const result = await db.transaction(async (tx) => {
      // Serialize number allocation with the insert, so concurrent requests
      // cannot both claim the same number and a rolled-back order leaves no gap.
      const orderNumber = await allocateOrderNumber(tx);
      const customer = await tx.select({ id: customers.id }).from(customers)
        .where(eq(customers.id, input.customer_id)).limit(1);
      if (!customer.length) {
        const error = new Error("العميل المحدد غير موجود");
        (error as Error & { status: number }).status = 400;
        throw error;
      }
      const createdAt = new Date();
      const deliveryDate = deliveryDateFromDays(orderDateInRiyadh(createdAt), input.delivery_days);
      const [order] = await tx.insert(orders).values({
        order_number: orderNumber,
        customer_id: input.customer_id,
        created_at: createdAt,
        delivery_days: input.delivery_days,
        delivery_date: deliveryDate,
        notes: input.notes,
        status: "waiting",
        created_by: req.user!.id,
      }).returning();
      const createdLines = [];
      for (const [index, line] of input.items.entries()) {
        let productId = line.customer_product_id;
        if (line.new_product) {
          const [created] = await createCustomerProductInTransaction(tx, line.new_product, input.customer_id);
          productId = created.id;
        } else {
          const [existing] = await tx.select({ id: customer_products.id }).from(customer_products)
            .where(and(eq(customer_products.id, productId!), eq(customer_products.customer_id, input.customer_id)))
            .for("update").limit(1);
          if (!existing) {
            const error = new Error(`منتج السطر ${index + 1} غير تابع للعميل المحدد`);
            (error as Error & { status: number }).status = 400;
            throw error;
          }
        }
        const plan = await categoryProductionPlan(tx, productId, line.quantity_kg);
        const [productionOrder] = await tx.insert(production_orders).values({
          production_order_number: productionOrderNumber(orderNumber, index + 1),
          order_id: order.id,
          customer_product_id: productId,
          quantity_kg: line.quantity_kg,
          ...plan,
          status: "pending",
        }).returning();
        createdLines.push(productionOrder);
      }
      return { order, production_orders: createdLines };
    });
    res.status(201).json(result);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return res.status(409).json({ message: "رقم الطلب أو رقم أمر الإنتاج مستخدم مسبقًا" });
    }
    next(error);
  }
});

const workspaceItems = z.array(z.object({
  id: z.number().int().positive().max(2147483647),
  expected_status: z.enum(ORDER_WORKSPACE_STATUSES),
}).strict()).min(1).max(100).refine(items => new Set(items.map(item => item.id)).size === items.length);
const workspaceFailure = (error: unknown, res: Response, next: (error?: unknown) => void) => {
  const failure = error as Error & { status?: number; message_en?: string };
  if (failure.status) { res.status(failure.status).json({ message: failure.message, message_en: failure.message_en }); return; }
  next(error);
};
router.get("/orders/display-folders", ordersRead, async (_req, res, next) => {
  try { res.json(await orderFolderCounts()); } catch (error) { workspaceFailure(error, res, next); }
});
router.post("/orders/actions", ordersWrite, async (req, res, next) => {
  try {
    const input = z.object({ action: z.enum(ORDER_WORKSPACE_ACTIONS), items: workspaceItems }).strict().parse(req.body);
    res.json(await applyOrderActions(input.action, input.items));
  } catch (error) { workspaceFailure(error, res, next); }
});
router.post("/orders/bulk-delete", admin, async (req, res, next) => {
  try {
    const input = z.object({ items: workspaceItems }).strict().parse(req.body);
    res.json(await deleteOrdersAtomically(input.items));
  } catch (error) { workspaceFailure(error, res, next); }
});
router.post("/orders/display-folders/move", ordersWrite, async (req, res, next) => {
  try {
    const input = z.object({
      folder: z.enum(ORDER_DISPLAY_FOLDERS),
      items: z.array(z.object({ id: z.number().int().positive().max(2147483647),
        expected_folder: z.enum(ORDER_DISPLAY_FOLDERS) }).strict()).min(1).max(100)
        .refine(items => new Set(items.map(item => item.id)).size === items.length),
    }).strict().parse(req.body);
    res.json(await moveOrderFolders(input.folder, input.items, req.user!.id));
  } catch (error) { workspaceFailure(error, res, next); }
});

router.post("/orders/:id/release-production", ordersWrite, async (req, res, next) => {
  try {
    const id = entityId("orders", req.params.id) as number;
    const input = z.object({ expected_status: z.enum(ORDER_PRODUCTION_RELEASE_STATUSES) }).strict().parse(req.body);
    res.json(await releaseOrderToProduction(id, input.expected_status));
  } catch (error) { next(error); }
});

router.get("/orders/:id/print-link", ordersRead, async (req, res, next) => {
  res.set("Cache-Control", "no-store");
  try {
    const id = entityId("orders", req.params.id) as number;
    const [order] = await db.select({ id: orders.id }).from(orders).where(eq(orders.id, id)).limit(1);
    if (!order) return res.status(404).json({ message: "الطلب غير موجود" });
    res.json({ path: publicOrderPrintPath(id) });
  } catch (error) { next(error); }
});

router.get("/orders/:id/details", ordersRead, async (req, res, next) => {
  try {
    const id = entityId("orders", req.params.id) as number;
    const details = await getOrderDetails(id);
    if (!details) return res.status(404).json({ message: "الطلب غير موجود" });
    res.json(details);
  } catch (error) { next(error); }
});

router.get("/orders/:id/with-items", ordersRead, async (req, res, next) => {
  try {
    const id = entityId("orders", req.params.id);
    const [order] = await db.select().from(orders).where(eq(orders.id, id as number)).limit(1);
    if (!order) return res.status(404).json({ message: "الطلب غير موجود" });
    const lines = await db.select({
      id: production_orders.id,
      production_order_number: production_orders.production_order_number,
      customer_product_id: production_orders.customer_product_id,
      quantity_kg: production_orders.quantity_kg,
      status: production_orders.status,
      batch_number: production_orders.batch_number,
    }).from(production_orders).where(eq(production_orders.order_id, order.id)).orderBy(production_orders.id);
    res.json({ order, items: lines });
  } catch (error) { next(error); }
});

// Reconcile by ID rather than deleting/recreating every production order: existing
// references and production history must survive an edit, including a failed edit.
router.put("/orders/:id/with-items", ordersWrite, async (req, res, next) => {
  try {
    const id = entityId("orders", req.params.id) as number;
    const input = orderEditSchema.parse(req.body);
    const result = await db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, id)).for("update");
      if (!order) throw orderError("الطلب غير موجود", 404);
      const deliveryDate = deliveryDateFromDays(orderDateInRiyadh(new Date(order.created_at)), input.delivery_days);
      const existing = await tx.select().from(production_orders)
        .where(eq(production_orders.order_id, id)).orderBy(production_orders.id).for("update");
      const byId = new Map(existing.map((line) => [line.id, line]));
      const submittedIds = input.items.flatMap((line) => line.id ? [line.id] : []);
      if (new Set(submittedIds).size !== submittedIds.length || submittedIds.some((lineId) => !byId.has(lineId))) {
        throw orderError("تغيرت بنود الطلب؛ أعد فتح الطلب قبل التعديل");
      }
      const remaining = new Set(submittedIds);
      for (const line of existing) {
        const unchanged = input.items.find((item) => item.id === line.id);
        if (isProtectedProductionOrder(line.status, line.batch_number, line.previous_status) &&
          (!unchanged || unchanged.new_product || unchanged.customer_product_id !== line.customer_product_id ||
            Number(unchanged.quantity_kg) !== Number(line.quantity_kg))) {
          throw orderError(`بدأ العمل على أمر الإنتاج ${line.production_order_number}؛ لا يمكن تغيير منتجه أو كميته أو حذفه`);
        }
      }
      // An unchanged existing line still has to match the version the editor saw.
      // The client sends a snapshot separately so concurrent edits cannot be lost.
      if (existing.length !== input.original_items.length ||
        existing.some((line) => !input.original_items.some((snapshot) =>
          snapshot.id === line.id && snapshot.customer_product_id === line.customer_product_id &&
          Number(snapshot.quantity_kg) === Number(line.quantity_kg)))) {
        throw orderError("تغيرت بنود الطلب منذ فتحها؛ أعد فتح الطلب قبل الحفظ");
      }
      let nextSuffix = existing.reduce((max, line) => {
        return Math.max(max, productionOrderSequence(order.order_number, line.production_order_number));
      }, 0);
      const [updatedOrder] = await tx.update(orders).set({
        notes: input.notes ?? null,
        delivery_days: input.delivery_days,
        delivery_date: deliveryDate,
      }).where(eq(orders.id, id)).returning();
      const resultLines = [];
      for (const line of input.items) {
        let productId = line.customer_product_id;
        if (line.new_product) {
          const [created] = await createCustomerProductInTransaction(tx, line.new_product, order.customer_id);
          productId = created.id;
        } else {
          const [product] = await tx.select({ id: customer_products.id }).from(customer_products)
            .where(and(eq(customer_products.id, productId!), eq(customer_products.customer_id, order.customer_id)))
            .for("update").limit(1);
          if (!product) throw orderError("المنتج غير تابع لعميل الطلب", 400);
        }
        if (line.id) {
          const previous = byId.get(line.id)!;
          if (previous.customer_product_id === productId && Number(previous.quantity_kg) === Number(line.quantity_kg)) {
            resultLines.push(previous);
          } else {
            const quantityChanged = Number(previous.quantity_kg) !== Number(line.quantity_kg);
            const finalQuantity = quantityChanged
              ? productionQuantity.parse(plannedFinalQuantity(
                line.quantity_kg,
                productionOverrun.parse(String(previous.overrun_percentage ?? "0")),
              ))
              : previous.final_quantity_kg;
            const [updated] = await tx.update(production_orders).set({
              customer_product_id: productId, quantity_kg: line.quantity_kg, final_quantity_kg: finalQuantity,
            }).where(eq(production_orders.id, line.id)).returning();
            resultLines.push(updated);
          }
        } else {
          nextSuffix += 1;
          const plan = await categoryProductionPlan(tx, productId, line.quantity_kg);
          const [created] = await tx.insert(production_orders).values({
            production_order_number: productionOrderNumber(order.order_number, nextSuffix),
            order_id: id, customer_product_id: productId, quantity_kg: line.quantity_kg,
            ...plan, status: "pending",
          }).returning();
          resultLines.push(created);
        }
      }
      for (const line of existing) {
        if (!remaining.has(line.id)) await tx.delete(production_orders).where(eq(production_orders.id, line.id));
      }
      return { order: updatedOrder, production_orders: resultLines };
    });
    res.json(result);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return res.status(409).json({ message: "رقم أمر الإنتاج مستخدم مسبقًا؛ أعد فتح الطلب" });
    if ((error as { code?: string }).code === "23503") return res.status(409).json({ message: "أمر الإنتاج مرتبط ببيانات أخرى ولا يمكن حذفه" });
    next(error);
  }
});

type Entity = "customers" | "categories" | "items" | "master-batch-colors" | "customer-products" | "machines" | "orders" | "production-orders" | "maintenance-component-catalog" | "system-settings";
const entities: Record<Entity, any> = { customers, categories, items, "master-batch-colors": master_batch_colors, "customer-products": customer_products, machines, orders, "production-orders": production_orders, "maintenance-component-catalog": maintenance_component_catalog, "system-settings": system_settings };
const schemas: Record<Entity, any> = { customers: insertCustomerSchema, categories: insertCategorySchema, items: insertItemSchema, "master-batch-colors": insertMasterBatchColorSchema, "customer-products": insertCustomerProductSchema, machines: insertMachineSchema, orders: insertNewOrderSchema, "production-orders": insertProductionOrderSchema, "maintenance-component-catalog": insertMaintenanceComponentCatalogSchema, "system-settings": insertSystemSettingSchema };
const numericEntityIds = new Set<Entity>(["customer-products", "orders", "production-orders", "maintenance-component-catalog", "system-settings"]);

function entityId(path: Entity, raw: string) {
  if (!numericEntityIds.has(path)) return raw;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    const error = new Error("المعرّف الرقمي غير صالح");
    (error as Error & { status?: number }).status = 400;
    throw error;
  }
  return value;
}

const entityRead: Record<Entity, any> = {
  customers: businessRead, categories: categoriesRead, items: itemsRead,
  "master-batch-colors": masterBatchRead, "customer-products": customerProductsRead,
  machines: machinesRead, orders: ordersRead, "production-orders": productionRead,
  "maintenance-component-catalog": maintenanceRead,
  "system-settings": settingsRead,
};
const entityWrite: Record<Entity, any> = {
  customers: businessWrite, categories: categoriesWrite, items: itemsWrite,
  "master-batch-colors": masterBatchWrite, "customer-products": businessWrite,
  machines: machinesWrite, orders: ordersWrite, "production-orders": productionWrite,
  "maintenance-component-catalog": maintenanceWrite,
  "system-settings": settingsRead,
};
const entitySearch: Record<Entity, any[]> = {
  customers: [customers.name, customers.name_ar, customers.code, customers.plate_drawer_code, customers.city, customers.phone],
  categories: [categories.id, categories.name, categories.name_ar, categories.code],
  items: [items.id, items.name, items.name_ar, items.code],
  "master-batch-colors": [master_batch_colors.id, master_batch_colors.name, master_batch_colors.name_ar, master_batch_colors.brand, master_batch_colors.aliases],
  "customer-products": [customer_products.size_caption, customer_products.raw_material, customer_products.printing_cylinder, customer_products.master_batch_id, customer_products.cutting_unit, customer_products.punching, customer_products.notes, customer_products.status],
  machines: [machines.id, machines.name, machines.name_ar, machines.type, machines.status, machines.manufacturer, machines.serial_number],
  orders: [orders.order_number, orders.status, orders.previous_status, orders.notes, orders.share_token],
  "production-orders": [production_orders.production_order_number, production_orders.status, production_orders.previous_status, production_orders.batch_number],
  "maintenance-component-catalog": [maintenance_component_catalog.id, maintenance_component_catalog.machine_type, maintenance_component_catalog.name_ar, maintenance_component_catalog.name_en],
  "system-settings": [system_settings.setting_key, system_settings.setting_value, system_settings.setting_type, system_settings.description],
};

const categoryParent = aliasedTable(categories, "category_parent");
const itemCategory = aliasedTable(categories, "item_category");
const customerSalesRep = aliasedTable(users, "customer_sales_rep");

router.get("/customers/sales-representatives", businessRead, async (_req, res, next) => {
  try {
    const representatives = await db.select({
      id: users.id,
      display_name: users.display_name,
      display_name_ar: users.display_name_ar,
    }).from(users).innerJoin(roles, eq(users.role_id, roles.id))
      .where(salesRepresentativeRoleCondition)
      .orderBy(asc(users.display_name_ar), asc(users.display_name), asc(users.id));
    res.json(representatives);
  } catch (error) { next(error); }
});

router.get("/customer-products/form-options", customerProductsRead, async (_req, res, next) => {
  try {
    const rows = await db.selectDistinct({ printing_cylinder: customer_products.printing_cylinder })
      .from(customer_products);
    const seen = new Set(PRINTING_CYLINDERS);
    const printing_cylinders = [...PRINTING_CYLINDERS];
    for (const row of rows) {
      const value = row.printing_cylinder;
      if (value?.trim() && !seen.has(value)) {
        seen.add(value);
        printing_cylinders.push(value);
      }
    }
    res.json({ printing_cylinders });
  } catch (error) { next(error); }
});

// Item readers need classification labels for filtering, not category-management
// access. Keep this lookup narrow and retain the existing category CRUD guards.
router.get("/items/category-options", itemsRead, async (req, res, next) => {
  try {
    const { limit, offset } = page(req);
    const rows = await db.select({
      id: categories.id,
      name: categories.name,
      name_ar: categories.name_ar,
    }).from(categories).orderBy(asc(categories.id)).limit(limit).offset(offset);
    res.json(rows);
  } catch (error) { next(error); }
});

for (const [path, table] of Object.entries(entities) as [Entity, any][]) {
  const mutationGuard = entityWrite[path];
  router.get(`/${path}`, entityRead[path], async (req, res, next) => {
    try {
      const { limit, offset, search } = page(req);
      const term = `%${search}%`;
      let rows: any[];
      if (path === "customers") {
        const conditions = [
          ...entitySearch[path],
          customerSalesRep.display_name,
          customerSalesRep.display_name_ar,
        ].map((column) => ilike(column, term));
        rows = await db.select({
          ...getTableColumns(customers),
          sales_rep_name: customerSalesRep.display_name,
          sales_rep_name_ar: customerSalesRep.display_name_ar,
        }).from(customers)
          .leftJoin(customerSalesRep, eq(customers.sales_rep_id, customerSalesRep.id))
          .where(search ? or(...conditions) : undefined)
          .orderBy(desc(customers.id)).limit(limit).offset(offset);
      } else if (path === "customer-products") {
        const conditions = [
          ...entitySearch[path],
          customers.name, customers.name_ar, categories.name, categories.name_ar,
          items.name, items.name_ar, master_batch_colors.name, master_batch_colors.name_ar,
        ].map((column) => ilike(column, term));
        rows = await db.select({
          ...getTableColumns(customer_products),
          customer_name: customers.name,
          customer_name_ar: customers.name_ar,
          category_name: categories.name,
          category_name_ar: categories.name_ar,
          item_name: items.name,
          item_name_ar: items.name_ar,
          master_batch_name: master_batch_colors.name,
          master_batch_name_ar: master_batch_colors.name_ar,
          master_batch_color_hex: master_batch_colors.color_hex,
        }).from(customer_products)
          .leftJoin(customers, eq(customer_products.customer_id, customers.id))
          .leftJoin(categories, eq(customer_products.category_id, categories.id))
          .leftJoin(items, eq(customer_products.item_id, items.id))
          .leftJoin(master_batch_colors, eq(customer_products.master_batch_id, master_batch_colors.id))
          .where(search ? or(...conditions) : undefined)
          .orderBy(desc(customer_products.id)).limit(limit).offset(offset);
      } else if (path === "orders") {
        const folder = z.enum(ORDER_DISPLAY_FILTERS).optional().parse(req.query.display_folder);
        const conditions = [...entitySearch[path], customers.name, customers.name_ar].map((column) => ilike(column, term));
        rows = await db.select({
          ...getTableColumns(orders),
          display_folder: sql<string>`COALESCE(${order_display_folder_assignments.folder}, 'new')`,
          customer_name: customers.name,
          customer_name_ar: customers.name_ar,
        }).from(orders)
          .leftJoin(customers, eq(orders.customer_id, customers.id))
          .leftJoin(order_display_folder_assignments, eq(order_display_folder_assignments.order_id, orders.id))
          .where(and(search ? or(...conditions) : undefined,
            folder === "active" ? inArray(orders.status, [...ORDER_ACTIVE_STATUSES])
              : folder === "new" ? or(isNull(order_display_folder_assignments.order_id), eq(order_display_folder_assignments.folder, "new"))
              : folder ? eq(order_display_folder_assignments.folder, folder) : undefined))
          .orderBy(desc(orders.id)).limit(limit).offset(offset);
        if (rows.length) {
          const linked = await db.select({
            id: production_orders.id,
            order_id: production_orders.order_id,
            production_order_number: production_orders.production_order_number,
            quantity_kg: production_orders.quantity_kg,
            item_name: items.name,
            item_name_ar: items.name_ar,
            item_id: customer_products.item_id,
          }).from(production_orders)
            .leftJoin(customer_products, eq(production_orders.customer_product_id, customer_products.id))
            .leftJoin(items, eq(customer_products.item_id, items.id))
            .where(inArray(production_orders.order_id, rows.map((row) => row.id)))
            .orderBy(production_orders.id);
          const byOrder = new Map<number, typeof linked>();
          for (const production of linked) {
            const entries = byOrder.get(production.order_id) ?? [];
            entries.push(production);
            byOrder.set(production.order_id, entries);
          }
          rows = rows.map((order) => ({ ...order, production_orders_summary: byOrder.get(order.id) ?? [] }));
        }
      } else if (path === "production-orders") {
        const conditions = [
          ...entitySearch[path], orders.order_number, customer_products.size_caption,
          customers.name, customers.name_ar,
        ].map((column) => ilike(column, term));
        rows = await db.select({
          ...getTableColumns(production_orders),
          order_number: orders.order_number,
          product_size_caption: customer_products.size_caption,
          customer_name: customers.name,
          customer_name_ar: customers.name_ar,
        }).from(production_orders)
          .leftJoin(orders, eq(production_orders.order_id, orders.id))
          .leftJoin(customer_products, eq(production_orders.customer_product_id, customer_products.id))
          .leftJoin(customers, eq(orders.customer_id, customers.id))
          .where(search ? or(...conditions) : undefined)
          .orderBy(desc(production_orders.id)).limit(limit).offset(offset);
      } else if (path === "machines") {
        const conditions = [...entitySearch[path], sections.name, sections.name_ar].map((column) => ilike(column, term));
        rows = await db.select({
          ...getTableColumns(machines),
          section_name: sections.name,
          section_name_ar: sections.name_ar,
        }).from(machines)
          .leftJoin(sections, eq(machines.section_id, sections.id))
          .where(search ? or(...conditions) : undefined)
          .orderBy(desc(machines.id)).limit(limit).offset(offset);
      } else if (path === "categories") {
        const conditions = [...entitySearch[path], categoryParent.name, categoryParent.name_ar].map((column) => ilike(column, term));
        rows = await db.select({
          ...getTableColumns(categories),
          parent_name: categoryParent.name,
          parent_name_ar: categoryParent.name_ar,
        }).from(categories)
          .leftJoin(categoryParent, eq(categories.parent_id, categoryParent.id))
          .where(search ? or(...conditions) : undefined)
           .orderBy(
             sql`regexp_replace(${categories.id}, '[0-9]+$', '')`,
             sql`substring(${categories.id} from '[0-9]+$')::numeric ASC NULLS LAST`,
             asc(categories.id),
           ).limit(limit).offset(offset);
      } else if (path === "items") {
        const categoryId = parsed(z.string().trim().max(20).optional(), req.query.category_id);
        const conditions = [...entitySearch[path], itemCategory.name, itemCategory.name_ar].map((column) => ilike(column, term));
        rows = await db.select({
          ...getTableColumns(items),
          category_name: itemCategory.name,
          category_name_ar: itemCategory.name_ar,
        }).from(items)
          .leftJoin(itemCategory, eq(items.category_id, itemCategory.id))
          .where(and(
            categoryId ? eq(items.category_id, categoryId) : undefined,
            search ? or(...conditions) : undefined,
          ))
           .orderBy(
             sql`regexp_replace(${items.id}, '[0-9]+$', '')`,
             sql`substring(${items.id} from '[0-9]+$')::numeric ASC NULLS LAST`,
             asc(items.id),
           ).limit(limit).offset(offset);
      } else {
        const conditions = entitySearch[path].map((column) => ilike(column, term));
        rows = await db.select().from(table)
          .where(search ? or(...conditions) : undefined)
          .orderBy(desc(table.id)).limit(limit).offset(offset);
      }
      res.json(rows);
    } catch (error) { next(error); }
  });
  router.post(`/${path}`, mutationGuard, async (req, res, next) => {
    try {
      const input = { ...(req.body ?? {}) };
      if (path === "customers") {
        delete input.id;
        const body = parsed(customerFormSchema, input);
        const [customer] = await db.transaction(async (tx) => {
          // Keep allocation and insertion on one connection under one lock.
          await tx.execute(sql`SELECT pg_advisory_xact_lock(${29832}, ${6})`);
          await validateCustomerSalesRepresentative(tx, body.sales_rep_id);
          const sequence = await tx.execute<{ max_number: string | null; suffix_width: number | null }>(sql`
            SELECT MAX(substring(id from 4)::numeric)::text AS max_number,
                   MAX(length(substring(id from 4)))::int AS suffix_width
            FROM customers WHERE id ~ '^CID[0-9]+$'
          `);
          const id = nextCustomerId(sequence.rows[0]?.max_number ?? null, sequence.rows[0]?.suffix_width ?? null);
          return tx.insert(customers).values({ ...body, id }).returning();
        });
        return res.status(201).json(customer);
      }
      if (path === "customer-products") {
        const cloneSourceId = z.number().int().positive().optional().parse(input.clone_source_id);
        const { clone_source_id: _cloneSourceMetadata, ...productInput } = input;
        const body = normalizeCustomerProductInput(parsed(customerProductInputSchema, productInput));
        const facingNotice = customerProductFacingNotice(body);
        if (facingNotice?.kind === "blocking") throw invalidProduct(facingNotice.message);
        const row = await db.transaction(async (tx) => {
          let cloneSource: Record<string, any> | null = null;
          if (cloneSourceId !== undefined) {
            [cloneSource] = await tx.select({
              id: customer_products.id,
              master_batch_id: customer_products.master_batch_id,
              cliche_front_design: customer_products.cliche_front_design,
              cliche_back_design: customer_products.cliche_back_design,
            }).from(customer_products).where(eq(customer_products.id, cloneSourceId)).limit(1);
            if (!cloneSource) throw invalidProduct("المنتج المصدر للنسخ غير موجود");
          }
          const { customer_id: customerId, ...product } = body;
          return createCustomerProductInTransaction(tx, product, customerId, {
            oldBatchId: cloneSource?.master_batch_id,
            previousFrontImage: cloneSource?.cliche_front_design,
            previousBackImage: cloneSource?.cliche_back_design,
          });
        });
        return res.status(201).json(row[0]);
      }
      if (path === "production-orders") {
        const productionInput = parsed(productionOrderInputSchema, input);
        if (!productionInput.order_id || !productionInput.quantity_kg) {
          return res.status(400).json({ message: "الطلب والكمية المطلوبة حقول إلزامية" });
        }
        const row = await db.transaction(async (tx) => {
          // Share the parent lock with order editing before allocating a child.
          const [parent] = await tx.select().from(orders)
            .where(eq(orders.id, productionInput.order_id!)).for("update").limit(1);
          if (!parent) throw orderError("الطلب المحدد غير موجود", 400);
          let number = productionInput.production_order_number;
          if (/^O[0-9]+$/.test(parent.order_number) || !number) {
            const siblings = await tx.select({ production_order_number: production_orders.production_order_number })
              .from(production_orders).where(eq(production_orders.order_id, parent.id));
            const sequence = siblings.reduce((max, sibling) =>
              Math.max(max, productionOrderSequence(parent.order_number, sibling.production_order_number)), 0) + 1;
            number = productionOrderNumber(parent.order_number, sequence);
          }
          await assertProductionProductMatchesOrder(tx, productionInput.order_id!, productionInput.customer_product_id);
          const plan = await categoryProductionPlan(tx, productionInput.customer_product_id, productionInput.quantity_kg!);
          const values = {
            ...productionInput,
            production_order_number: number,
            ...plan,
            final_quantity_kg: productionQuantity.parse(plan.final_quantity_kg),
          };
          return tx.insert(production_orders).values(values).returning();
        });
        return res.status(201).json(row[0]);
      }
      if (path === "categories") {
        const { code: _ignoredCode, ...categoryInput } = stripCreateId(input);
        if (categoryInput.parent_id === "") categoryInput.parent_id = null;
        const body = parsed(categoryAdminSchema.omit({ code: true }), categoryInput);
        const row = await db.transaction(async (tx) => {
          // This lock is shared by category inserts and reparenting writes so
          // cycle checks see one serialized category tree.
          await tx.execute(sql`SELECT pg_advisory_xact_lock(${29832}, ${2})`);
          const sequence = await tx.execute<{ max_number: string | null; suffix_width: number | null }>(sql`
            SELECT MAX(substring(id from 4)::numeric)::text AS max_number,
                   MAX(length(id) - 3)::int AS suffix_width
            FROM categories
            WHERE id ~ '^CAT[0-9]+$'
          `);
          await validateCategoryParent(tx, body.parent_id);
          const number = await nextAdminIdNumber(tx, "categories", sequence.rows[0]?.max_number ?? null);
          const id = nextCategoryId((BigInt(number) - 1n).toString(), sequence.rows[0]?.suffix_width ?? null);
          return tx.insert(categories).values({ ...body, id, code: id }).returning();
        });
        return res.status(201).json(row[0]);
      }
      if (path === "items") {
        const { code: _ignoredCode, ...itemInput } = stripCreateId(input);
        if (itemInput.category_id === "") itemInput.category_id = null;
        const body = parsed(itemAdminSchema.omit({ code: true }), itemInput);
        const row = await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(${29832}, ${3})`);
          const sequence = await tx.execute<{ max_number: string | null; suffix_width: number | null }>(sql`
            SELECT MAX(substring(id from 4)::numeric)::text AS max_number,
                   MAX(length(id) - 3)::int AS suffix_width
            FROM items
            WHERE id ~ '^ITM[0-9]+$'
          `);
          await validateOptionalReference(tx, categories, categories.id, body.category_id, undefined, "التصنيف المحدد غير موجود");
          const number = await nextAdminIdNumber(tx, "items", sequence.rows[0]?.max_number ?? null);
          const id = nextItemId((BigInt(number) - 1n).toString(), sequence.rows[0]?.suffix_width ?? null);
          return tx.insert(items).values({ ...body, id, code: id }).returning();
        });
        return res.status(201).json(row[0]);
      }
      if (path === "master-batch-colors") {
        const colorInput = stripCreateId(input);
        delete colorInput.sort_order;
        const body = parsed(masterBatchAdminSchema, colorInput);
        const row = await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(${29832}, ${6})`);
          const sequence = await tx.execute<{ max_number: string | null; suffix_width: number | null }>(sql`
            SELECT MAX(substring(id from 3)::numeric)::text AS max_number,
                   MAX(length(id) - 2)::int AS suffix_width
            FROM master_batch_colors WHERE id ~ '^MB[0-9]+$'
          `);
          const number = await nextAdminIdNumber(tx, "masterBatchColors", sequence.rows[0]?.max_number ?? null);
          const id = nextMasterBatchColorId((BigInt(number) - 1n).toString(), sequence.rows[0]?.suffix_width ?? null);
          return tx.insert(master_batch_colors).values({ ...body, id }).returning();
        });
        return res.status(201).json(row[0]);
      }
      if (path === "machines") {
        const body = parsed(machineAdminSchema, stripCreateId(input));
        normalizeChangedMachineType(body);
        if (body.section_id === "") body.section_id = null;
        if (body.inline_printer_id === "") body.inline_printer_id = null;
        validateMachineRanges(body);
        const row = await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(${29832}, ${5})`);
          const sequence = await tx.execute<{ max_number: string | null }>(sql`
            SELECT MAX(CASE WHEN id LIKE 'MAC%' THEN substring(id from 4)::numeric
                            ELSE substring(id from 2)::numeric END)::text AS max_number
            FROM machines WHERE id ~ '^(MAC|M)[0-9]+$'
          `);
          const number = await nextAdminIdNumber(tx, "machines", sequence.rows[0]?.max_number ?? null);
          const id = nextMachineId((BigInt(number) - 1n).toString());
          await validateMachineReferences(tx, body, { id, section_id: null, inline_printer_id: null, type: body.type });
          return tx.insert(machines).values({ ...body, id }).returning();
        });
        return res.status(201).json(row[0]);
      }
      if (path === "maintenance-component-catalog") {
        const componentInput = stripCreateId(input);
        delete componentInput.sort_order;
        const body = parsed(componentAdminSchema, componentInput);
        const row = await db.insert(maintenance_component_catalog).values(body).returning();
        return res.status(201).json(row[0]);
      }
      if (path === "orders") {
        if (!input.status) input.status = "waiting";
        const row = await db.transaction(async (tx) => {
          input.order_number = await allocateOrderNumber(tx);
          const body = parsed(schemas[path].strict(), input);
          return tx.insert(orders).values(body).returning();
        });
        return res.status(201).json(row[0]);
      }
      if (path === "system-settings") {
        if (String(input.setting_key ?? "").startsWith(productionRoleSettingPrefix)) {
          return res.status(403).json({ message: "يجب تعديل ربط الإنتاج من إعدادات الأدوار" });
        }
        input.updated_by = req.user!.id;
      }
      const body = parsed(schemas[path].strict(), input);
      const row: any[] = (await db.insert(table).values(body).returning()) as any;
      res.status(201).json(row[0]);
    } catch (error) { next(error); }
  });
  router.put(`/${path}/:id`, mutationGuard, async (req, res, next) => {
    try {
      const key = entityId(path, req.params.id);
      if (path === "customers") {
        const input = { ...(req.body ?? {}) };
        assertPutIdIsImmutable(input, key as string);
        const body = parsed(customerFormSchema.partial(), input);
        if (!Object.keys(body).length) throw adminValidationError("لا توجد بيانات للتعديل");
        const result = await db.transaction(async (tx) => {
          const [current] = await tx.select().from(customers)
            .where(eq(customers.id, key as string)).for("update").limit(1);
          if (!current) return null;
          if (body.sales_rep_id !== undefined && body.sales_rep_id !== current.sales_rep_id) {
            await validateCustomerSalesRepresentative(tx, body.sales_rep_id);
          }
          return tx.update(customers).set(body).where(eq(customers.id, key as string)).returning();
        });
        if (!result?.[0]) return res.status(404).json({ message: "العميل غير موجود" });
        return res.json(result[0]);
      }
      if (path === "system-settings") {
        const input = req.body ?? {};
        if (Object.keys(input).some((field) => field !== "setting_value")) {
          return res.status(400).json({ message: "يمكن تعديل قيمة الإعداد فقط" });
        }
        if (typeof input.setting_value !== "string" && input.setting_value !== null) {
          return res.status(400).json({ message: "قيمة الإعداد غير صالحة" });
        }
        const current = await db
          .select({ is_editable: system_settings.is_editable, setting_key: system_settings.setting_key })
          .from(system_settings)
          .where(eq(system_settings.id, key as number))
          .limit(1);
        if (!current[0]) return res.status(404).json({ message: "الإعداد غير موجود" });
        if (current[0].is_editable === false || current[0].setting_key.startsWith(productionRoleSettingPrefix)) {
          return res.status(403).json({ message: "هذا الإعداد غير قابل للتعديل" });
        }
        const updated = await db
          .update(system_settings)
          .set({ setting_value: input.setting_value, updated_at: new Date(), updated_by: req.user!.id })
          .where(eq(system_settings.id, key as number))
          .returning();
        return res.json(updated[0]);
      }
      if (path === "customer-products") {
        const input = normalizeCustomerProductInput(parsed(customerProductInputSchema.partial(), req.body ?? {}));
        const row = await db.transaction(async (tx) => {
          const [current] = await tx.select().from(customer_products)
            .where(eq(customer_products.id, key as number)).for("update").limit(1);
          if (!current) return null;
          const merged = { ...current, ...input };
          const facingNotice = customerProductFacingNotice(merged);
          if (facingNotice?.kind === "blocking") throw invalidProduct(facingNotice.message);
          const category = await validateCustomerProductReferences(
            tx, merged, current.master_batch_id, current.item_id, current.category_id,
          );
          if (merged.customer_id !== current.customer_id) {
            await assertProductCanTransfer(tx, current.id, merged.customer_id);
          }
          validateProductImage(merged.cliche_front_design, current.cliche_front_design);
          validateProductImage(merged.cliche_back_design, current.cliche_back_design);

          const sizeSourcesChanged = ["width", "left_facing", "right_facing", "printing_cylinder", "cutting_length_cm", "category_id"]
            .some((field) => Object.prototype.hasOwnProperty.call(input, field) && input[field] !== (current as any)[field]);
          const bagSourcesChanged = ["width", "left_facing", "right_facing", "thickness", "density", "printing_cylinder", "cutting_length_cm", "category_id"]
            .some((field) => Object.prototype.hasOwnProperty.call(input, field) && input[field] !== (current as any)[field]);
          const packageSourcesChanged = ["unit_weight_kg", "unit_quantity"]
            .some((field) => Object.prototype.hasOwnProperty.call(input, field) && input[field] !== (current as any)[field]);
          const cylinderUnchanged = merged.printing_cylinder === current.printing_cylinder;
          const categoryUnchanged = merged.category_id === current.category_id;
          const fields = deriveCustomerProductFields(
            {
              ...merged,
              density: merged.density === undefined ? "0.95" : merged.density,
              size_caption: sizeSourcesChanged ? null : current.size_caption,
            },
            `${category?.name_ar ?? ""} ${category?.name ?? ""}`,
            cylinderUnchanged && categoryUnchanged,
          );
          if (!bagSourcesChanged && fields.bag_weight_grams === null && fields.bags_per_kilo === null) {
            fields.bag_weight_grams = current.bag_weight_grams;
            fields.bags_per_kilo = current.bags_per_kilo;
          }
          if (!packageSourcesChanged && fields.package_weight_kg === null) fields.package_weight_kg = current.package_weight_kg;
          return tx.update(customer_products).set({ ...input, ...fields })
            .where(eq(customer_products.id, key as number)).returning();
        });
        if (!row) return res.status(404).json({ message: "المنتج غير موجود" });
        return res.json(row[0]);
      }
      if (path === "production-orders") {
        const readOnly = new Set(["id", "created_at"]);
        const input = parsed(productionOrderInputSchema, Object.fromEntries(
          Object.entries(req.body ?? {}).filter(([field]) => !readOnly.has(field)),
        ));
        if (Object.keys(input).length === 0) return res.status(400).json({ message: "لا توجد بيانات للتعديل" });
        const row = await db.transaction(async (tx) => {
          const [snapshot] = await tx.select({
            id: production_orders.id,
            order_id: production_orders.order_id,
          }).from(production_orders).where(eq(production_orders.id, key as number)).limit(1);
          if (!snapshot) return null;
          const orderIds = [...new Set([snapshot.order_id, input.order_id ?? snapshot.order_id])].sort((a, b) => a - b);
          for (const orderId of orderIds) {
            await tx.select({ id: orders.id }).from(orders).where(eq(orders.id, orderId)).for("share").limit(1);
          }
          const [current] = await tx.select().from(production_orders)
            .where(eq(production_orders.id, key as number)).for("update").limit(1);
          if (!current) return null;
          if (current.order_id !== snapshot.order_id) {
            throw orderError("تغير الطلب المرتبط؛ أعد تحميل أمر الإنتاج قبل التعديل", 409);
          }

          const currentIsProtected = isProtectedProductionOrder(
            current.status,
            current.batch_number,
            current.previous_status,
          );
          if (currentIsProtected) {
            const productChanged = Object.prototype.hasOwnProperty.call(input, "customer_product_id") &&
              input.customer_product_id !== current.customer_product_id;
            const quantityChanged = Object.prototype.hasOwnProperty.call(input, "quantity_kg") &&
              Number(input.quantity_kg) !== Number(current.quantity_kg);
            const orderChanged = Object.prototype.hasOwnProperty.call(input, "order_id") &&
              input.order_id !== current.order_id;
            if (productChanged || quantityChanged || orderChanged) {
              throw orderError("لا يمكن تغيير المنتج أو الكمية أو الطلب بعد بدء أمر الإنتاج", 409);
            }
            if (current.status !== "pending" && input.status === "pending") {
              throw orderError("لا يمكن إعادة أمر إنتاج بدأ العمل عليه إلى حالة الانتظار", 409);
            }
            if (current.batch_number != null &&
              Object.prototype.hasOwnProperty.call(input, "batch_number") &&
              (typeof input.batch_number !== "string" || !input.batch_number.trim())) {
              throw orderError("لا يمكن إزالة رقم تشغيلة من أمر إنتاج محفوظ", 409);
            }
            const hasProtectedPreviousStatus = current.status === "pending" &&
              current.previous_status != null && current.previous_status !== "pending";
            if (hasProtectedPreviousStatus &&
              Object.prototype.hasOwnProperty.call(input, "previous_status") &&
              input.previous_status !== current.previous_status) {
              throw orderError("لا يمكن إزالة سجل حالة أمر إنتاج سبق بدء العمل عليه", 409);
            }
          }

          const merged = { ...current, ...input };
          const quantity = productionQuantity.parse(String(merged.quantity_kg));
          const overrun = productionOverrun.parse(String(merged.overrun_percentage ?? "0"));
          const finalWasSubmitted = Object.prototype.hasOwnProperty.call(input, "final_quantity_kg");
          const quantityPlanChanged = Object.prototype.hasOwnProperty.call(input, "quantity_kg") ||
            Object.prototype.hasOwnProperty.call(input, "overrun_percentage");
          const finalQuantity = finalWasSubmitted
            ? productionQuantity.parse(String(input.final_quantity_kg))
            : quantityPlanChanged
              ? productionQuantity.parse(plannedFinalQuantity(quantity, overrun))
              : productionQuantity.parse(String(merged.final_quantity_kg));

          await assertProductionProductMatchesOrder(tx, merged.order_id, merged.customer_product_id);
          const values = {
            ...input,
            ...(quantityPlanChanged && !finalWasSubmitted ? { final_quantity_kg: finalQuantity } : {}),
            ...(finalWasSubmitted ? { final_quantity_kg: finalQuantity } : {}),
          };
          return tx.update(production_orders).set(values)
            .where(eq(production_orders.id, key as number)).returning();
        });
        if (!row) return res.status(404).json({ message: "العنصر غير موجود" });
        return res.json(row[0]);
      }
      if (path === "categories") {
        const input = { ...(req.body ?? {}) };
        assertPutIdIsImmutable(input, key as string);
        if (input.parent_id === "") input.parent_id = null;
        const row = await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(${29832}, ${2})`);
          const [current] = await tx.select({
            id: categories.id, parent_id: categories.parent_id, code: categories.code,
          }).from(categories).where(eq(categories.id, key as string)).for("update").limit(1);
          if (!current) return null;
          if (Object.prototype.hasOwnProperty.call(input, "code")) {
            if (input.code !== current.code) throw adminValidationError("لا يمكن تغيير كود التصنيف");
            delete input.code;
          }
          const body = parsed(categoryAdminSchema.omit({ code: true }).partial(), input);
          if (Object.prototype.hasOwnProperty.call(body, "parent_id")) {
            await validateCategoryParent(tx, body.parent_id, current.id, current.parent_id);
          }
          if (!Object.keys(body).length) throw adminValidationError("لا توجد بيانات للتعديل");
          return tx.update(categories).set(body).where(eq(categories.id, key as string)).returning();
        });
        if (!row) return res.status(404).json({ message: "التصنيف غير موجود" });
        return res.json(row[0]);
      }
      if (path === "items") {
        const input = { ...(req.body ?? {}) };
        assertPutIdIsImmutable(input, key as string);
        if (input.category_id === "") input.category_id = null;
        const row = await db.transaction(async (tx) => {
          const [current] = await tx.select({
            id: items.id, category_id: items.category_id, code: items.code,
          }).from(items).where(eq(items.id, key as string)).for("update").limit(1);
          if (!current) return null;
          if (Object.prototype.hasOwnProperty.call(input, "code")) {
            if (input.code !== current.code) throw adminValidationError("لا يمكن تغيير كود الصنف");
            delete input.code;
          }
          const body = parsed(itemAdminSchema.omit({ code: true }).partial(), input);
          await validateOptionalReference(
            tx, categories, categories.id, body.category_id, current.category_id, "التصنيف المحدد غير موجود",
          );
          if (!Object.keys(body).length) throw adminValidationError("لا توجد بيانات للتعديل");
          return tx.update(items).set(body).where(eq(items.id, key as string)).returning();
        });
        if (!row) return res.status(404).json({ message: "الصنف غير موجود" });
        return res.json(row[0]);
      }
      if (path === "master-batch-colors") {
        const input = { ...(req.body ?? {}) };
        assertPutIdIsImmutable(input, key as string);
        delete input.sort_order;
        const body = parsed(masterBatchAdminSchema.partial(), input);
        if (!Object.keys(body).length) throw adminValidationError("لا توجد بيانات للتعديل");
        const row: any[] = await db.update(master_batch_colors).set(body)
          .where(eq(master_batch_colors.id, key as string)).returning();
        if (!row[0]) return res.status(404).json({ message: "لون الخامة غير موجود" });
        return res.json(row[0]);
      }
      if (path === "machines") {
        const input = { ...(req.body ?? {}) };
        assertPutIdIsImmutable(input, key as string);
        if (input.section_id === "") input.section_id = null;
        if (input.inline_printer_id === "") input.inline_printer_id = null;
        const row = await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(${29832}, ${5})`);
          const [current] = await tx.select().from(machines)
            .where(eq(machines.id, key as string)).for("update").limit(1);
          if (!current) return null;
          normalizeChangedMachineType(input, current.type);
          const body = parsed(machineAdminSchema.partial(), input);
          if (!Object.keys(body).length) throw adminValidationError("لا توجد بيانات للتعديل");
          const merged = { ...current, ...body };
          validateMachineRanges(merged);
          const typeChanged = await validateMachineTypeTransition(tx, current, merged, body);
          await validateMachineReferences(tx, merged, current, typeChanged);
          return tx.update(machines).set(body).where(eq(machines.id, key as string)).returning();
        });
        if (!row) return res.status(404).json({ message: "الماكينة غير موجودة" });
        return res.json(row[0]);
      }
      if (path === "maintenance-component-catalog") {
        const input = { ...(req.body ?? {}) };
        assertPutIdIsImmutable(input, key as number);
        delete input.sort_order;
        const body = parsed(componentAdminSchema.partial(), input);
        if (!Object.keys(body).length) throw adminValidationError("لا توجد بيانات للتعديل");
        const row: any[] = await db.update(maintenance_component_catalog).set(body)
          .where(eq(maintenance_component_catalog.id, key as number)).returning();
        if (!row[0]) return res.status(404).json({ message: "مكوّن الصيانة غير موجود" });
        return res.json(row[0]);
      }
      const readOnly = new Set(["id", "created_at", "updated_at", "universal_thickness"]);
      const input = Object.fromEntries(Object.entries(req.body ?? {}).filter(([key]) => !readOnly.has(key)));
      if (path === "orders" && ("order_number" in input || "customer_id" in input)) {
        return res.status(400).json({ message: "رقم الطلب والعميل ثابتان بعد الإنشاء؛ استخدم تعديل الطلب لتغيير بنوده" });
      }
      const body = parsed(schemas[path].strict().partial(), input);
      const row: any[] = (await db.update(table).set(body).where(eq(table.id, key)).returning()) as any;
      if (!row[0]) return res.status(404).json({ message: "العنصر غير موجود" });
      res.json(row[0]);
    } catch (error) { next(error); }
  });
  router.delete(`/${path}/:id`, admin, async (req, res, next) => {
    try {
      const key = entityId(path, req.params.id);
      const row: any[] = await db.transaction(async (tx) => {
        // These locks must precede row locks in their corresponding write paths.
        if (path === "categories") await tx.execute(sql`SELECT pg_advisory_xact_lock(${29832}, ${2})`);
        if (path === "machines") await tx.execute(sql`SELECT pg_advisory_xact_lock(${29832}, ${5})`);
        if (path === "orders") await lockOrderProductionDeletion(tx);
        if (path === "system-settings") {
          const [setting] = await tx.select().from(system_settings).where(eq(system_settings.id, key as number)).for("update").limit(1);
          if (setting?.setting_key.startsWith(productionRoleSettingPrefix)) {
            throw orderError("يجب تعديل ربط الإنتاج من إعدادات الأدوار", 403);
          }
        }
        if (path === "customer-products") {
          const [current] = await tx.select({ id: customer_products.id }).from(customer_products)
            .where(eq(customer_products.id, key as number)).for("update").limit(1);
          if (!current) return [];
          const [reference] = await tx.select({ id: production_orders.id }).from(production_orders)
            .where(eq(production_orders.customer_product_id, key as number)).limit(1);
          if (reference) throw orderError("لا يمكن حذف المنتج لارتباطه بأوامر إنتاج", 409);
        } else if (path === "customers") {
          const [current] = await tx.select({ id: customers.id }).from(customers)
            .where(eq(customers.id, key as string)).for("update").limit(1);
          if (!current) return [];
          const [productReference] = await tx.select({ id: customer_products.id }).from(customer_products)
            .where(eq(customer_products.customer_id, key as string)).limit(1);
          const [orderReference] = await tx.select({ id: orders.id }).from(orders)
            .where(eq(orders.customer_id, key as string)).limit(1);
          if (productReference || orderReference) {
            throw orderError("لا يمكن حذف العميل لارتباطه بمنتجات أو طلبات", 409);
          }
        } else if (path === "categories") {
          const [current] = await tx.select({ id: categories.id }).from(categories)
            .where(eq(categories.id, key as string)).for("update").limit(1);
          if (!current) return [];
          const [productReference] = await tx.select({ id: customer_products.id }).from(customer_products)
            .where(eq(customer_products.category_id, key as string)).limit(1);
          const [itemReference] = await tx.select({ id: items.id }).from(items)
            .where(eq(items.category_id, key as string)).limit(1);
          const [childReference] = await tx.select({ id: categories.id }).from(categories)
            .where(eq(categories.parent_id, key as string)).limit(1);
          if (productReference || itemReference || childReference) {
            throw orderError("لا يمكن حذف التصنيف لارتباطه بمنتجات أو تصنيفات فرعية", 409);
          }
        } else if (path === "items") {
          const [current] = await tx.select({ id: items.id }).from(items)
            .where(eq(items.id, key as string)).for("update").limit(1);
          if (!current) return [];
          const [reference] = await tx.select({ id: customer_products.id }).from(customer_products)
            .where(eq(customer_products.item_id, key as string)).limit(1);
          if (reference) throw orderError("لا يمكن حذف الصنف لارتباطه بمنتجات العملاء", 409);
        } else if (path === "master-batch-colors") {
          const [current] = await tx.select({ id: master_batch_colors.id }).from(master_batch_colors)
            .where(eq(master_batch_colors.id, key as string)).for("update").limit(1);
          if (!current) return [];
          const [reference] = await tx.select({ id: customer_products.id }).from(customer_products)
            .where(eq(customer_products.master_batch_id, key as string)).limit(1);
          if (reference) throw orderError("لا يمكن حذف لون الخامة لارتباطه بمنتجات العملاء", 409);
        } else if (path === "machines") {
          const [current] = await tx.select({ id: machines.id }).from(machines)
            .where(eq(machines.id, key as string)).for("update").limit(1);
          if (!current) return [];
          if (await hasInlinePrinterDependents(tx, current.id)) {
            throw orderError("لا يمكن حذف الماكينة لأنها مرتبطة كطابعة داخلية بماكينات بثق", 409);
          }
        } else if (path === "production-orders") {
          const [current] = await tx.select({
            id: production_orders.id,
            status: production_orders.status,
            previous_status: production_orders.previous_status,
            batch_number: production_orders.batch_number,
          }).from(production_orders).where(eq(production_orders.id, key as number)).for("update").limit(1);
          if (!current) return [];
          if (isProtectedProductionOrder(current.status, current.batch_number, current.previous_status)) {
            throw orderError("لا يمكن حذف أمر إنتاج غير معلق أو مرتبط بتشغيلة", 409);
          }
        } else if (path === "orders") {
          const [current] = await tx.select({ id: orders.id }).from(orders)
            .where(eq(orders.id, key as number)).for("update").limit(1);
          if (!current) return [];
          await deleteOrderProduction(tx, key as number);
        }
        return tx.delete(table).where(eq(table.id, key)).returning({ id: table.id });
      });
      if (!row[0]) return res.status(404).json({ message: "العنصر غير موجود" });
      res.json({ success: true, id: row[0].id });
    } catch (error) { next(error); }
  });
}

router.get("/customers/:id/order-history", businessRead, async (req, res, next) => {
  try {
    const customerId = z.string().min(1).max(20).parse(req.params.id);
    const { limit, offset } = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(20),
      offset: z.coerce.number().int().min(0).max(2147483547).default(0),
    }).parse(req.query);
    res.json(await customerOrderHistory(pool, customerId, limit, offset));
  } catch (error) { next(error); }
});

router.get("/customers/:id/detail", businessRead, async (req, res, next) => {
  try {
    const customerId = req.params.id;
    const customer = await db.select({
      ...getTableColumns(customers),
      sales_rep_name: customerSalesRep.display_name,
      sales_rep_name_ar: customerSalesRep.display_name_ar,
    }).from(customers)
      .leftJoin(customerSalesRep, eq(customers.sales_rep_id, customerSalesRep.id))
      .where(eq(customers.id, customerId))
      .limit(1);
    if (!customer[0]) return res.status(404).json({ message: "العميل غير موجود" });
    const products = await db.select({
      ...getTableColumns(customer_products),
      customer_name: customers.name,
      customer_name_ar: customers.name_ar,
      category_name: categories.name,
      category_name_ar: categories.name_ar,
      item_name: items.name,
      item_name_ar: items.name_ar,
      master_batch_name: master_batch_colors.name,
      master_batch_name_ar: master_batch_colors.name_ar,
    }).from(customer_products)
      .leftJoin(customers, eq(customer_products.customer_id, customers.id))
      .leftJoin(categories, eq(customer_products.category_id, categories.id))
      .leftJoin(items, eq(customer_products.item_id, items.id))
      .leftJoin(master_batch_colors, eq(customer_products.master_batch_id, master_batch_colors.id))
      .where(eq(customer_products.customer_id, customerId))
      .orderBy(desc(customer_products.id));
    return res.json({ customer: customer[0], products });
  } catch (error) { next(error); }
});

router.get("/company-profile", settingsRead, async (_req, res, next) => { try { res.json((await db.select().from(company_profile).limit(1))[0] ?? null); } catch (e) { next(e); } });
router.put("/company-profile", settingsRead, async (req, res, next) => { try { const body = parsed(insertCompanyProfileSchema.strict(), req.body); const existing = (await db.select({ id: company_profile.id }).from(company_profile).limit(1))[0]; const row = existing ? await db.update(company_profile).set(body).where(eq(company_profile.id, existing.id)).returning() : await db.insert(company_profile).values(body).returning(); res.json(row[0]); } catch (e) { next(e); } });

export default router;
