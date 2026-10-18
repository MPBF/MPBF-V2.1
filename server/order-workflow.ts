import type { OrderWorkflow } from "../shared/order-workflow";
import type { ConnectionPool } from "./production/core";
import { productionActorJSON } from "./production/read-queries";

export type WorkflowQuery = {
  limit: number; offset: number; production_order_id?: number;
  stage?: "film" | "printing" | "done"; search?: string;
};
const person = productionActorJSON("u");
const operation = (actor: string, machine: string, time: string) =>
  `jsonb_build_object('actor',${productionActorJSON(actor)},
    'machine_name',${machine}.name,'machine_name_ar',${machine}.name_ar,'at',${time})`;

// Scope the complete summary to one order before aggregating. Rolls and summary
// share a read-only snapshot; pagination/search never change summary quantities.
export const workflowSummarySql = `
 WITH lines AS MATERIALIZED (
   SELECT p.*,e.stage execution_stage,e.product,e.is_roll_product
   FROM production_orders p LEFT JOIN factory_execution e ON e.production_order_id=p.id
   WHERE p.order_id=$1
 ), rolls AS MATERIALIZED (
   SELECT r.*,p.is_roll_product FROM factory_rolls r JOIN lines p ON p.id=r.production_order_id
 ), contributions AS (
   SELECT r.production_order_id,v.stage,v.actor_id,count(*)::int roll_count,sum(v.quantity) quantity
   FROM rolls r CROSS JOIN LATERAL (VALUES
     ('film',r.created_by,r.weight_kg,true),
     ('printing',r.printed_by,r.weight_kg,r.printed_at IS NOT NULL),
     ('cutting',r.cut_by,r.net_weight_kg,r.cut_completed_at IS NOT NULL)
   ) v(stage,actor_id,quantity,recorded)
   WHERE v.recorded GROUP BY r.production_order_id,v.stage,v.actor_id
 )
 SELECT jsonb_build_object('id',o.id,'order_number',o.order_number,
   'created_at',o.created_at,'delivery_date',o.delivery_date,'status',o.status,
   'customer_name',c.name,'customer_name_ar',c.name_ar) "order",
 COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'id',p.id,'production_order_number',p.production_order_number,'status',p.status,
   'stage',p.execution_stage,
   'product_name',CASE WHEN p.product IS NOT NULL THEN p.product->>'name' ELSE i.name END,
   'product_name_ar',CASE WHEN p.product IS NOT NULL THEN p.product->>'name_ar' ELSE i.name_ar END,
   'requested_kg',p.quantity_kg::text,'planned_kg',p.final_quantity_kg::text,
   'produced_kg',COALESCE(t.produced,0)::text,'waste_kg',COALESCE(t.waste,0)::text,
   'roll_count',COALESCE(t.roll_count,0),'completed_rolls',COALESCE(t.completed_rolls,0),
   'contributions',COALESCE((SELECT jsonb_agg(jsonb_build_object(
     'stage',g.stage,'actor',${person},'quantity_kg',COALESCE(g.quantity,0)::text,
     'roll_count',g.roll_count) ORDER BY g.stage,g.actor_id NULLS LAST)
     FROM contributions g LEFT JOIN users u ON u.id=g.actor_id
     WHERE g.production_order_id=p.id),'[]'::jsonb)
 ) ORDER BY p.id)
 FROM lines p LEFT JOIN customer_products cp ON cp.id=p.customer_product_id
 LEFT JOIN items i ON i.id=cp.item_id
 LEFT JOIN LATERAL (
   SELECT count(*)::int roll_count,count(*) FILTER(WHERE r.stage='done')::int completed_rolls,
     sum(CASE WHEN r.stage='done' THEN
       CASE WHEN p.is_roll_product THEN r.weight_kg ELSE r.net_weight_kg END ELSE 0 END) produced,
     sum(r.waste_kg) waste
   FROM rolls r WHERE r.production_order_id=p.id
 ) t ON true),'[]'::jsonb) production_orders
 FROM orders o LEFT JOIN customers c ON c.id=o.customer_id WHERE o.id=$1`;

export const workflowRollsSql = `
 SELECT r.id,r.roll_number,r.production_order_id,p.production_order_number,r.stage,
   r.weight_kg::text,r.net_weight_kg::text,r.waste_kg::text,e.is_roll_product,
   ${operation("film_user", "film_machine", "r.created_at")} film,
   ${operation("print_user", "print_machine", "r.printed_at")} printing,
   ${operation("cut_user", "cut_machine", "r.cut_completed_at")} cutting
 FROM production_orders p JOIN factory_rolls r ON r.production_order_id=p.id
 JOIN factory_execution e ON e.production_order_id=p.id
 LEFT JOIN users film_user ON film_user.id=r.created_by
 LEFT JOIN users print_user ON print_user.id=r.printed_by
 LEFT JOIN users cut_user ON cut_user.id=r.cut_by
 LEFT JOIN machines film_machine ON film_machine.id=r.film_machine_id
 LEFT JOIN machines print_machine ON print_machine.id=r.printing_machine_id
 LEFT JOIN machines cut_machine ON cut_machine.id=r.cutting_machine_id
 WHERE p.order_id=$1 AND ($2::integer IS NULL OR p.id=$2)
 AND ($3::text IS NULL OR r.stage=$3)
 AND ($4::text IS NULL OR strpos(lower(r.roll_number),lower($4))>0)
 ORDER BY r.id DESC LIMIT $5 OFFSET $6`;

export async function orderWorkflow(source: ConnectionPool, id: number, filters: WorkflowQuery): Promise<OrderWorkflow> {
  const client = await source.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const summary = (await client.query(workflowSummarySql, [id])).rows[0];
    if (!summary) throw Object.assign(new Error("الطلب غير موجود"), {
      status: 404, message_en: "The order was not found.",
    });
    const result = await client.query(workflowRollsSql, [
      id, filters.production_order_id ?? null, filters.stage ?? null,
      filters.search || null, filters.limit + 1, filters.offset,
    ]);
    await client.query("COMMIT");
    const hasMore = result.rows.length > filters.limit;
    return { ...summary, rolls: result.rows.slice(0, filters.limit),
      has_more: hasMore, next_offset: hasMore ? filters.offset + filters.limit : null };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}
