import { kgHundredths, kgString } from "../../shared/production";
import type { FilmMixTracking } from "../../shared/production-monitoring";
import { one, rows, type Connection } from "./core";

/** Request advisory lock -> machine advisory lock -> resource rows, in both writers. */
export async function lockMixMachine(tx: Connection, machineId: string) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`factory-mix-pool:${machineId}`]);
}

export async function consumeMixes(tx: Connection, rollId: number, machineId: string, weight: string): Promise<FilmMixTracking> {
  const activation = await one<{ last_roll_id: number; last_mix_id: number }>(tx,
    "SELECT last_roll_id,last_mix_id FROM factory_mix_activation WHERE id=1");
  if (rollId <= activation.last_roll_id) throw new Error("New roll did not cross the monitoring activation boundary");
  let uncovered = kgHundredths(weight);
  await tx.query(`INSERT INTO factory_roll_mix_tracking(roll_id,machine_id,weight_kg,uncovered_kg)
    VALUES($1,$2,$3,$3)`, [rollId,machineId,weight]);
  // The shared machine lock precedes insertion in either writer. Only committed
  // mixes already present at registration may participate; never fill old gaps.
  let after: {id:number; at:string} | null = null;
  while (uncovered > 0n) {
  const mixes: {id:number;remaining:string;cursor_at:string}[] = await rows(tx, `SELECT m.id,
    to_char(m.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_at,
    (m.total_kg-COALESCE((SELECT sum(a.allocated_kg) FROM factory_mix_allocations a WHERE a.mix_id=m.id),0))::text remaining
    FROM factory_mixes m WHERE m.machine_id=$1 AND m.id>$2
    AND m.created_at<=(SELECT created_at FROM factory_rolls WHERE id=$3)
    AND ($4::timestamptz IS NULL OR (m.created_at,m.id)>($4::timestamptz,$5::integer))
    AND m.total_kg>COALESCE((SELECT sum(a.allocated_kg) FROM factory_mix_allocations a WHERE a.mix_id=m.id),0)
    ORDER BY m.created_at,m.id LIMIT 100 FOR UPDATE OF m`, [machineId,activation.last_mix_id,rollId,after?.at??null,after?.id??null]);
  if (!mixes.length) break;
  for (const mix of mixes) {
    if (!uncovered) break;
    // A mix total sums up to 100 individually validated lines and can exceed
    // the input helper's 12-digit limit. Parse the database's numeric(18,2)
    // without converting it to a floating point number.
    if (!/^\d{1,16}\.\d{2}$/.test(mix.remaining)) throw new Error("Invalid recorded mix balance");
    const remaining = BigInt(mix.remaining.replace(".",""));
    const allocated = remaining < uncovered ? remaining : uncovered;
    await tx.query("INSERT INTO factory_mix_allocations(mix_id,roll_id,allocated_kg) VALUES($1,$2,$3)",
      [mix.id,rollId,kgString(allocated)]);
    uncovered -= allocated;
  }
  const last=mixes[mixes.length-1];
  after={id:last.id,at:last.cursor_at};
  }
  await tx.query("UPDATE factory_roll_mix_tracking SET uncovered_kg=$2 WHERE roll_id=$1", [rollId,kgString(uncovered)]);
  return { consumed_kg: kgString(kgHundredths(weight)-uncovered), uncovered_kg: kgString(uncovered) };
}
