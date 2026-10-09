import { one, permission, rows, ProductionError, type ConnectionPool, type Connection } from "./core";

// Execution snapshots are frozen at start. Unstarted plans use current product data.
import { hasProductionPermission, isPlasticRoll, productionPermissions, type ProductionState, type ProductionStateScope, type ProductionUser, type ProductionRollRecord, type ProductionRollDetail, type ProductionOrderRecord, type ProductionHistoryKind, type ProductionHistoryFilter, type ProductionHistoryPage } from "../../shared/production";
import { orderSelect, rollSelect, filmMachineGroups, filmDurationJSON, productionActorJSON } from "./read-queries";
import { historyPage } from "./history";
export class ProductionReadService {
  constructor(readonly pool: ConnectionPool) {}
  async state(actor: ProductionUser, scope: ProductionStateScope = "management"): Promise<ProductionState> {
    permission(actor, ...productionPermissions);
    const canProduction = hasProductionPermission(actor, ...productionKeys);
    const production = canProduction && !["hall", "warehouse", "roll"].includes(scope);
    const hall = ["management", "hall"].includes(scope) && hasProductionPermission(actor, "view_production_hall", "receive_production");
    const warehouse = ["management", "hall", "warehouse"].includes(scope) && hasProductionPermission(actor, "view_finished_inventory", "manage_finished_warehouse", "receive_production");
    return this.read(async tx => {
      const state: ProductionState = { orders: [], rolls: [], queues: [], machines: [], locations: [], inventory: [], movements: [], receipts: [] };
      if (production || hall) {
        // Completed manufacture can still have unreceived output. This is NOT
        // capped by a history page, and film completion is not a receipt gate.
        const outstanding = scope === "management" || hall;
        state.orders = await rows(tx, `WITH ${outstanding ? `ready AS (
          SELECT r.production_order_id,sum(CASE WHEN e.is_roll_product THEN r.weight_kg ELSE r.net_weight_kg END) quantity
          FROM factory_rolls r JOIN factory_execution e ON e.production_order_id=r.production_order_id
          WHERE r.stage='done' GROUP BY r.production_order_id
        ), received AS (
          SELECT production_order_id,sum(quantity_kg) quantity FROM factory_receipt_items GROUP BY production_order_id
        ), outstanding AS (
          SELECT ready.production_order_id id FROM ready LEFT JOIN received USING(production_order_id)
          WHERE ready.quantity>COALESCE(received.quantity,0)
        ),` : ""} selected AS MATERIALIZED (
          ${outstanding ? `
          SELECT id FROM outstanding
          ${production ? "UNION" : ""}` : ""}
          ${production ? `SELECT p.id FROM production_orders p JOIN orders o ON o.id=p.order_id
            LEFT JOIN factory_execution e ON e.production_order_id=p.id
            WHERE (e.production_order_id IS NOT NULL AND e.completed_at IS NULL)
              OR (e.production_order_id IS NULL AND p.status NOT IN ('completed','cancelled','archived')
                AND o.status IN ('for_production','in_production'))
            UNION SELECT production_order_id FROM factory_queues` : ""}
        ) ${orderSelect}`);
        identifyRollProducts(state.orders);
      }
      if (production) {
        // Film shows all recorded rolls of still-open orders, including rolls
        // already processed downstream. Other boards keep executable work only.
        state.rolls = await rows(tx, `${rollSelect} WHERE ${scope === "film" ? "e.film_closed_at IS NULL AND e.completed_at IS NULL" : "r.stage<>'done'"}
          ${scope === "printing" ? "AND e.is_printed AND r.printed_at IS NULL" : ""}
          ${scope === "cutting" ? "AND NOT e.is_roll_product AND (NOT e.is_printed OR r.printed_at IS NOT NULL)" : ""}
          ORDER BY r.id DESC`);
        state.queues = await rows(tx, "SELECT * FROM factory_queues ORDER BY stage,machine_id,position,id");
      }
      if (production || (scope === "roll" && canProduction)) state.machines = await rows(tx, `SELECT id,name,name_ar,type,status,inline_printer_id,min_thickness,max_thickness,min_width_cm,max_width_cm FROM machines ORDER BY id`);
      if (warehouse || hall) state.locations = await rows(tx, "SELECT * FROM factory_locations ORDER BY id");
      state.totals = {
        orders: 0, rolls: 0, receipts: 0, movements: 0, inventory: 0, inventory_kg: "0",
        ...(production && scope === "management" ? await one(tx, `SELECT (SELECT count(*)::int FROM production_orders) orders,
          (SELECT count(*)::int FROM factory_rolls) rolls`) : {}),
        ...(warehouse ? await one(tx, `SELECT (SELECT count(*)::int FROM factory_receipts) receipts,
          (SELECT count(*)::int FROM factory_movements) movements,count(*)::int inventory,
          COALESCE(sum(quantity_kg),0)::text inventory_kg FROM factory_inventory`) : {}),
      };
      return state;
    });
  }
  async history<K extends ProductionHistoryKind>(actor: ProductionUser, kind: K, filters: ProductionHistoryFilter): Promise<ProductionHistoryPage<K>> {
    permission(actor, ...(kind === "orders" || kind === "rolls" ? productionKeys :
      ["view_finished_inventory", "manage_finished_warehouse", "receive_production"]));
    return this.read(tx => historyPage(tx, kind, filters));
  }
  async roll(actor: ProductionUser, id: number): Promise<ProductionRollDetail> {
    permission(actor, ...productionPermissions);
    return this.read(tx => one(tx, `SELECT detail.*,${filmDurationJSON} film_duration,
      ${productionActorJSON("printer")} printed_actor,
      ${productionActorJSON("cutter")} cut_actor
      FROM (${rollSelect} WHERE r.id=$1) detail
      LEFT JOIN users printer ON printer.id=detail.printed_by
      LEFT JOIN users cutter ON cutter.id=detail.cut_by
      JOIN LATERAL (${filmMachineGroups("detail.production_order_id", "detail.film_machine_id")}) g ON true`, [id]));
  }
  async labelPage(actor: ProductionUser, filters: Pick<ProductionHistoryFilter, "before" | "limit" | "search">): Promise<ProductionHistoryPage<"rolls">> {
    // Label discovery has the same access rules as labels and roll detail,
    // including hall/warehouse viewers. Do not broaden general history access.
    permission(actor, ...productionPermissions);
    return this.read(tx => historyPage(tx, "rolls", filters));
  }
  async labelRolls(actor: ProductionUser, ids: number[]): Promise<ProductionRollRecord[]> {
    // The same permissions as roll detail; one bounded, read-only query supplies
    // current data even when the operator's board has changed since selection.
    permission(actor, ...productionPermissions);
    return this.read(async tx => {
      const rolls = await rows<ProductionRollRecord>(tx, `${rollSelect} WHERE r.id=ANY($1::integer[])`, [ids]);
      const byId = new Map(rolls.map(roll => [roll.id, roll]));
      if (ids.some(id => !byId.has(id)))
        throw new ProductionError("أحد الرولات غير موجود؛ حدّث التحديد وأعد المحاولة", "A selected roll was not found. Refresh your selection and retry.", 404);
      return ids.map(id => byId.get(id)!);
    });
  }
  private async read<T>(action: (tx: Connection) => Promise<T>) {
    const tx = await this.pool.connect();
    try {
      await tx.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const result = await action(tx);
      await tx.query("COMMIT");
      return result;
    } catch (error) {
      await tx.query("ROLLBACK").catch(() => {});
      throw error;
    } finally { tx.release(); }
  }
}

const productionKeys = ["view_production", "manage_production", "operate_film", "operate_printing", "operate_cutting"];

export function identifyRollProducts(orders: ProductionOrderRecord[]) {
  orders.forEach(order => { if (!order.started_at) order.is_roll_product = isPlasticRoll(order.product?.name ?? null, order.product?.name_ar ?? null); });
}
