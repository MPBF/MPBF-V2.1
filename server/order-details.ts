import { aliasedTable, eq, getTableColumns } from "drizzle-orm";
import { categories, customer_products, customers, items, master_batch_colors, orders, production_orders, users } from "@shared/schema";
import { orderProductionTotals } from "@shared/order-details";
import { db } from "./db";

const creator = aliasedTable(users, "order_creator");
const representative = aliasedTable(users, "order_representative");
const personFields = (table: typeof users) => ({
  id: table.id,
  display_name: table.display_name,
  display_name_ar: table.display_name_ar,
  full_name: table.full_name,
  username: table.username,
});

export async function getOrderDetails(id: number) {
  // The share token and all user authentication/contact/HR fields are deliberately
  // excluded. Reading an order does not grant access to the users directory.
  const { share_token: _shareToken, ...orderFields } = getTableColumns(orders);
  return db.transaction(async (tx) => {
    const [header] = await tx.select({
      order: orderFields,
      customer: getTableColumns(customers),
      creator: personFields(creator),
      sales_representative: personFields(representative),
    }).from(orders)
      .leftJoin(customers, eq(orders.customer_id, customers.id))
      .leftJoin(creator, eq(orders.created_by, creator.id))
      .leftJoin(representative, eq(customers.sales_rep_id, representative.id))
      .where(eq(orders.id, id)).limit(1);
    if (!header) return null;

    const lines = await tx.select({
      production_order: getTableColumns(production_orders),
      product: getTableColumns(customer_products),
      category: getTableColumns(categories),
      item: getTableColumns(items),
      color: getTableColumns(master_batch_colors),
    }).from(production_orders)
      .leftJoin(customer_products, eq(production_orders.customer_product_id, customer_products.id))
      .leftJoin(categories, eq(customer_products.category_id, categories.id))
      .leftJoin(items, eq(customer_products.item_id, items.id))
      .leftJoin(master_batch_colors, eq(customer_products.master_batch_id, master_batch_colors.id))
      .where(eq(production_orders.order_id, id))
      .orderBy(production_orders.id);

    const production = lines.map(({ production_order, product, category, item, color }) => ({
      ...production_order,
      product: product ? { ...product, category, item, color } : null,
    }));
    return {
      ...header,
      production_orders: production,
      totals: orderProductionTotals(production),
      // Order details and its printout remain planned-only. Actual execution
      // belongs to the permission-scoped production module, never this total.
      actual_production: {
        available: false as const,
        message: "تفاصيل الطلب تعرض الكميات المطلوبة والمخططة فقط. سجلات التنفيذ الفعلي متاحة في وحدة الإنتاج بحسب الصلاحيات.",
      },
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}