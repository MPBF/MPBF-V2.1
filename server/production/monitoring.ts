import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { canMonitorProduction, type MonitoringFilter, type MonitoringPage, type ProductionEvent, type MixMonitorRecord, type MixMonitorDetail, type RollMixDetail, type MonitoringSummary, type RollMixAllocation } from "../../shared/production-monitoring";
import type { ProductionUser } from "../../shared/production";
import { one, rows, ProductionError, type Connection, type ConnectionPool } from "./core";
import { mixProjection } from "./mixing";

const cursorKey = randomBytes(32);
type Cursor = { snapshot: string; id: string; at?: string; scope: string };
const invalidCursor = () => new ProductionError("انتهت صلاحية الصفحة؛ حدّث البيانات", "This page cursor is invalid or expired. Refresh the data.",400);
function encode(cursor: Cursor) {
  const body = Buffer.from(JSON.stringify(cursor)).toString("base64url");
  return `${body}.${createHmac("sha256",cursorKey).update(body).digest("base64url")}`;
}
function decode(raw: string, scope: string): Cursor {
  try {
    const [body,signature,...extra] = raw.split(".");
    const expected = createHmac("sha256",cursorKey).update(body).digest();
    const actual = Buffer.from(signature,"base64url");
    if (extra.length || actual.length!==expected.length || !timingSafeEqual(actual,expected)) throw invalidCursor();
    const cursor = JSON.parse(Buffer.from(body,"base64url").toString());
    if (cursor.scope!==scope || !/^\d+$/.test(cursor.id) || typeof cursor.snapshot!=="string") throw invalidCursor();
    return cursor;
  } catch { throw invalidCursor(); }
}
export function monitoringPermission(user: ProductionUser) {
  if (!canMonitorProduction(user)) throw new ProductionError("مراقبة الإنتاج متاحة للمسؤول فقط", "Production monitoring is administrator-only.",403);
}
const mixRead = `${mixProjection},(m.id>b.last_mix_id) tracked,
  COALESCE(a.consumed,0)::text consumed_kg,
  CASE WHEN m.id>b.last_mix_id THEN (m.total_kg-COALESCE(a.consumed,0))::text ELSE NULL END remaining_kg`;
const mixJoins = `FROM factory_mixes m JOIN machines ma ON ma.id=m.machine_id
  LEFT JOIN users u ON u.id=m.created_by CROSS JOIN factory_mix_activation b
  LEFT JOIN LATERAL (SELECT sum(allocated_kg) consumed FROM factory_mix_allocations WHERE mix_id=m.id) a ON true`;
const allocationProjection = `a.mix_id,a.roll_id,r.roll_number,a.allocated_kg::text,m.screw,m.created_at mix_registered_at`;

export class ProductionMonitoringService {
  constructor(readonly pool: ConnectionPool) {}
  private async read<T>(actor: ProductionUser, action: (tx: Connection)=>Promise<T>) {
    monitoringPermission(actor); // Before connecting or reading any data.
    const tx = await this.pool.connect();
    try {
      await tx.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const result = await action(tx);
      await tx.query("COMMIT");
      return result;
    } catch (error) { await tx.query("ROLLBACK").catch(()=>{}); throw error; }
    finally { tx.release(); }
  }
  private async cursor(tx: Connection, scope: string, raw?: string): Promise<Cursor> {
    return raw ? decode(raw,scope) : {scope,id:"9223372036854775807",
      ...(await one<{snapshot:string}>(tx,"SELECT pg_current_snapshot()::text snapshot"))};
  }
  log(actor: ProductionUser, filters: MonitoringFilter = {}): Promise<MonitoringPage<ProductionEvent>> {
    return this.read(actor,async tx => {
      const limit = filters.limit ?? 50;
      const scope = JSON.stringify(["log",filters.stage??"",filters.machine_id??"",filters.from??"",filters.to??"",filters.search??""]);
      const cursor = await this.cursor(tx,scope,filters.cursor);
      const records = await rows<ProductionEvent & { cursor_at: string }>(tx,`SELECT e.id::text,e.stage,
        e.registered_at,to_char(e.registered_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_at,
        e.roll_id,r.roll_number,e.machine_id,ma.name machine_name,ma.name_ar machine_name_ar,
        e.actor_id,COALESCE(NULLIF(u.display_name,''),u.username) actor_name,
        COALESCE(NULLIF(u.display_name_ar,''),NULLIF(u.full_name,''),u.username) actor_name_ar,
        p.production_order_number,o.order_number,e.weight_kg::text,e.net_weight_kg::text,e.waste_kg::text
        FROM factory_production_events e JOIN factory_rolls r ON r.id=e.roll_id
        JOIN production_orders p ON p.id=r.production_order_id JOIN orders o ON o.id=p.order_id
        JOIN machines ma ON ma.id=e.machine_id LEFT JOIN users u ON u.id=e.actor_id
        WHERE pg_visible_in_snapshot(e.transaction_id,$1::pg_snapshot)
        AND ($2::timestamptz IS NULL OR (e.registered_at,e.id)<($2::timestamptz,$3::bigint))
        AND ($4::text IS NULL OR e.stage=$4) AND ($5::text IS NULL OR e.machine_id=$5)
        AND ($6::date IS NULL OR e.registered_at>=($6::date::timestamp AT TIME ZONE 'Asia/Riyadh'))
        AND ($7::date IS NULL OR e.registered_at<(($7::date+1)::timestamp AT TIME ZONE 'Asia/Riyadh'))
        AND ($8::text IS NULL OR strpos(lower(r.roll_number),lower($8))>0
          OR strpos(lower(p.production_order_number),lower($8))>0 OR strpos(lower(o.order_number),lower($8))>0)
        ORDER BY e.registered_at DESC,e.id DESC LIMIT $9`,
      [cursor.snapshot,cursor.at??null,cursor.id,filters.stage??null,filters.machine_id??null,
        filters.from??null,filters.to??null,filters.search||null,limit+1]);
      const page = records.slice(0,limit);
      const last = page.at(-1);
      return {records:page.map(({cursor_at,...record})=>record),next:records.length>limit && last
        ? encode({...cursor,id:last.id,at:last.cursor_at}) : null};
    });
  }
  summary(actor: ProductionUser): Promise<MonitoringSummary> {
    return this.read(actor,async tx => {
      const boundary = await one<{activated_at:string;last_mix_id:number}>(tx,"SELECT activated_at,last_mix_id FROM factory_mix_activation WHERE id=1");
      const machines = await rows<MonitoringSummary["machines"][number]>(tx,`SELECT ma.id machine_id,ma.name machine_name,ma.name_ar machine_name_ar,
        COALESCE(m.mixed,0)::text mixed_kg,COALESCE(r.consumed,0)::text consumed_kg,
        (COALESCE(m.mixed,0)-COALESCE(r.consumed,0))::text remaining_kg,
        COALESCE(r.film,0)::text film_kg,COALESCE(r.uncovered,0)::text uncovered_kg
        FROM machines ma
        LEFT JOIN LATERAL (SELECT sum(total_kg) mixed FROM factory_mixes WHERE machine_id=ma.id AND id>$1) m ON true
        LEFT JOIN LATERAL (SELECT sum(weight_kg) film,sum(uncovered_kg) uncovered,sum(weight_kg-uncovered_kg) consumed
          FROM factory_roll_mix_tracking WHERE machine_id=ma.id) r ON true
        WHERE lower(ma.type)='extruder' OR m.mixed IS NOT NULL OR r.film IS NOT NULL ORDER BY ma.id`,[boundary.last_mix_id]);
      const production_machines = await rows<MonitoringSummary["production_machines"][number]>(tx,
        `SELECT id machine_id,name machine_name,name_ar machine_name_ar FROM machines
        WHERE lower(type) IN ('extruder','printer','printing','cutter','cutting')
        OR EXISTS(SELECT 1 FROM factory_production_events e WHERE e.machine_id=machines.id) ORDER BY id`);
      return {activated_at:boundary.activated_at,machines,production_machines};
    });
  }
  mixes(actor: ProductionUser, filters: Pick<MonitoringFilter,"machine_id"|"cursor"|"limit"> = {}): Promise<MonitoringPage<MixMonitorRecord>> {
    return this.read(actor,async tx => {
      const limit = filters.limit??50, scope = JSON.stringify(["mixes",filters.machine_id??""]);
      const cursor = await this.cursor(tx,scope,filters.cursor);
      const records = await rows<MixMonitorRecord>(tx,`SELECT ${mixRead} ${mixJoins}
        WHERE m.id<$1::bigint AND ($2::text IS NULL OR m.machine_id=$2)
        AND pg_visible_in_snapshot(m.xmin::text::xid8,$3::pg_snapshot)
        ORDER BY m.id DESC LIMIT $4`,[cursor.id,filters.machine_id??null,cursor.snapshot,limit+1]);
      const page = records.slice(0,limit);
      return {records:page,next:records.length>limit ? encode({...cursor,id:String(page[limit-1].id)}) : null};
    });
  }
  private async allocations(tx: Connection, target: "mix"|"roll", id: number, raw?: string): Promise<MonitoringPage<RollMixAllocation>> {
    const cursor = await this.cursor(tx,`${target}:${id}`,raw);
    const key = target==="mix" ? "roll_id" : "mix_id";
    const records = await rows<RollMixAllocation>(tx,`SELECT ${allocationProjection}
      FROM factory_mix_allocations a JOIN factory_rolls r ON r.id=a.roll_id JOIN factory_mixes m ON m.id=a.mix_id
      WHERE a.${target==="mix"?"mix_id":"roll_id"}=$1 AND a.${key}<$2::bigint
      AND pg_visible_in_snapshot(a.xmin::text::xid8,$3::pg_snapshot)
      ORDER BY a.${key} DESC LIMIT 51`,[id,cursor.id,cursor.snapshot]);
    const page = records.slice(0,50);
    return {records:page,next:records.length>50 ? encode({...cursor,id:String(page[49][key])}) : null};
  }
  mix(actor: ProductionUser, id: number, cursor?: string): Promise<MixMonitorDetail> {
    return this.read(actor,async tx => ({
      mix:await one<MixMonitorRecord>(tx,`SELECT ${mixRead} ${mixJoins} WHERE m.id=$1`,[id]),
      allocations:await this.allocations(tx,"mix",id,cursor),
    }));
  }
  roll(actor: ProductionUser, id: number, cursor?: string): Promise<RollMixDetail> {
    return this.read(actor,async tx => {
      const record = await one<Omit<RollMixDetail,"allocations">>(tx,`SELECT r.id roll_id,r.roll_number,
        (t.roll_id IS NOT NULL) tracked,r.weight_kg::text,t.uncovered_kg::text
        FROM factory_rolls r LEFT JOIN factory_roll_mix_tracking t ON t.roll_id=r.id WHERE r.id=$1`,[id]);
      return {...record,allocations:await this.allocations(tx,"roll",id,cursor)};
    });
  }
}
