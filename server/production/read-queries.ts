// Select the order IDs first; expensive JSON projection and indexed totals only
// run for work-list candidates or the requested history page.
// Only internal SQL expressions are accepted here, never request values.
// Group the full source, not the active feed or a page of history.
export const filmMachineGroups = (orderId: string, machineId?: string) => `SELECT
  fr.film_machine_id machine_id,m.name machine_name,m.name_ar machine_name_ar,
  count(*)::int roll_count,min(fr.created_at) first_roll_at,max(fr.created_at) last_roll_at,
  CASE WHEN count(*)<2 THEN NULL ELSE greatest(0,floor(extract(epoch FROM
    max(fr.created_at)-min(fr.created_at)))) END duration_seconds,
  sum(fr.weight_kg) produced,sum(fr.waste_kg) waste,
  sum(CASE WHEN fr.stage='done' THEN fr.weight_kg ELSE 0 END) ready_roll,
  sum(CASE WHEN fr.stage='done' THEN fr.net_weight_kg ELSE 0 END) ready_net
  FROM factory_rolls fr LEFT JOIN machines m ON m.id=fr.film_machine_id
  WHERE fr.production_order_id=${orderId}${machineId ? ` AND fr.film_machine_id=${machineId}` : ""}
  GROUP BY fr.film_machine_id,m.name,m.name_ar`;
export const filmDurationJSON = `jsonb_build_object('machine_id',g.machine_id,
  'machine_name',g.machine_name,'machine_name_ar',g.machine_name_ar,'roll_count',g.roll_count,
  'first_roll_at',g.first_roll_at,'last_roll_at',g.last_roll_at,'duration_seconds',g.duration_seconds)`;
// Explicit allowlist: never project a complete users row into roll traceability.
export const productionActorJSON = (alias: string) => `CASE WHEN ${alias}.id IS NULL THEN NULL
  ELSE jsonb_build_object('id',${alias}.id,'display_name',${alias}.display_name,
    'display_name_ar',${alias}.display_name_ar,'full_name',${alias}.full_name,
    'username',${alias}.username) END`;
export const masterBatchJSON = `CASE WHEN mb.id IS NULL THEN NULL ELSE jsonb_build_object(
  'id',mb.id,'name',mb.name,'name_ar',mb.name_ar,'color_hex',mb.color_hex) END`;
export const liveProduct = `jsonb_build_object('id',cp.id,'item_id',cp.item_id,'name',i.name,'name_ar',i.name_ar,
  'customer_name',c.name,'customer_name_ar',c.name_ar,'width',cp.width::text,
  'left_facing',cp.left_facing::text,'right_facing',cp.right_facing::text,
  'universal_thickness',cp.universal_thickness::text,'cutting_length_cm',cp.cutting_length_cm,
  'raw_material',cp.raw_material,'printing_cylinder',cp.printing_cylinder,'punching',cp.punching,
   'notes',cp.notes,'front_print_colors',cp.front_print_colors,'back_print_colors',cp.back_print_colors,
   'size_caption',cp.size_caption,'plate_drawer_code',c.plate_drawer_code,'master_batch',${masterBatchJSON})`;
// Supplement only fields absent from older snapshots, without rewriting them
// or replacing deliberately saved nulls. All original execution specs stay frozen.
const displayedProduct = `e.product ||
  CASE WHEN e.product ? 'size_caption' THEN '{}'::jsonb ELSE jsonb_build_object('size_caption',
    CASE WHEN (e.product->>'width') IS NOT DISTINCT FROM cp.width::text
      AND (e.product->>'left_facing') IS NOT DISTINCT FROM cp.left_facing::text
      AND (e.product->>'right_facing') IS NOT DISTINCT FROM cp.right_facing::text
    THEN cp.size_caption ELSE NULL END) END ||
  CASE WHEN e.product ? 'master_batch' THEN '{}'::jsonb ELSE jsonb_build_object('master_batch',${masterBatchJSON}) END ||
  CASE WHEN e.product ? 'plate_drawer_code' THEN '{}'::jsonb ELSE jsonb_build_object('plate_drawer_code',c.plate_drawer_code) END`;
export const orderSelect = `SELECT p.id,p.order_id,p.production_order_number,p.customer_product_id,
  p.quantity_kg,p.final_quantity_kg,p.status,p.previous_status,p.batch_number,o.order_number,o.status order_status,
   CASE WHEN cp.id IS NULL THEN e.product WHEN e.product IS NULL THEN ${liveProduct}
     ELSE ${displayedProduct} END product,
  e.started_at,e.film_closed_at,e.completed_at,e.stage,COALESCE(e.is_printed,cp.is_printed,false) is_printed,
  COALESCE(e.is_roll_product,false) is_roll_product,
  COALESCE(r.produced,0)::text produced_kg,COALESCE(r.ready,0)::text ready_kg,COALESCE(r.waste,0)::text waste_kg,
  COALESCE(r.roll_count,0)::int roll_count,
  COALESCE(r.film_durations,'[]'::jsonb) film_durations,
  COALESCE(received.quantity,0)::text received_kg,(COALESCE(r.ready,0)-COALESCE(received.quantity,0))::text remaining_kg
  FROM selected s JOIN production_orders p ON p.id=s.id JOIN orders o ON o.id=p.order_id
  LEFT JOIN factory_execution e ON e.production_order_id=p.id
  LEFT JOIN customer_products cp ON cp.id=p.customer_product_id LEFT JOIN items i ON i.id=cp.item_id
  LEFT JOIN customers c ON c.id=o.customer_id
   LEFT JOIN master_batch_colors mb ON mb.id=cp.master_batch_id
  LEFT JOIN LATERAL (SELECT sum(g.produced) produced,sum(g.waste) waste,sum(g.roll_count) roll_count,
    sum(CASE WHEN e.is_roll_product THEN g.ready_roll ELSE g.ready_net END) ready,
    jsonb_agg(${filmDurationJSON} ORDER BY g.first_roll_at,g.machine_id) film_durations
    FROM (${filmMachineGroups("p.id")}) g) r ON true
  LEFT JOIN LATERAL (SELECT sum(quantity_kg) quantity FROM factory_receipt_items WHERE production_order_id=p.id) received ON true
  ORDER BY p.id DESC`;
export const rollSelect = `SELECT r.*,p.production_order_number,p.batch_number,p.status production_order_status,
  o.order_number,o.status order_status,e.stage production_stage,e.product,e.is_printed,e.is_roll_product,
  ${productionActorJSON("roll_creator")} created_actor
  FROM factory_rolls r JOIN production_orders p ON p.id=r.production_order_id
  JOIN orders o ON o.id=p.order_id JOIN factory_execution e ON e.production_order_id=r.production_order_id
  LEFT JOIN users roll_creator ON roll_creator.id=r.created_by`;
export const receiptSelect = `SELECT r.*,COALESCE((SELECT jsonb_agg(to_jsonb(ri)||jsonb_build_object(
  'production_order_number',p.production_order_number,'location_name',l.name,'location_name_ar',l.name_ar) ORDER BY ri.id)
  FROM factory_receipt_items ri JOIN production_orders p ON p.id=ri.production_order_id
  JOIN factory_locations l ON l.id=ri.location_id WHERE ri.receipt_id=r.id),'[]'::jsonb) items
  FROM factory_receipts r`;
export const inventorySelect = `SELECT inv.*,p.production_order_number,p.batch_number,p.status production_order_status,e.product,
  l.name location_name,l.name_ar location_name_ar FROM factory_inventory inv
  JOIN factory_execution e ON e.production_order_id=inv.production_order_id
  JOIN production_orders p ON p.id=inv.production_order_id JOIN factory_locations l ON l.id=inv.location_id`;
export const movementSelect = `SELECT m.*,r.voucher_number,ri.production_order_id,ri.location_id,p.production_order_number
  FROM factory_movements m JOIN factory_receipts r ON r.id=m.receipt_id
  JOIN factory_receipt_items ri ON ri.id=m.receipt_item_id JOIN production_orders p ON p.id=ri.production_order_id`;