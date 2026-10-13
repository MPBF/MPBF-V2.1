-- Explicitly approved retirement of finished-goods receipt units.
-- Do not run against the published database without separate approval.
BEGIN;
SET LOCAL lock_timeout = '12s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE factory_receipts, factory_receipt_items, factory_inventory,
  factory_movements, factory_operations IN ACCESS EXCLUSIVE MODE;

-- Check every surviving ledger field, not only grand totals.
CREATE TEMP TABLE kg_receipt_before ON COMMIT DROP AS
SELECT 'receipts' AS relation,
  md5(COALESCE(string_agg(md5(to_jsonb(r)::text), '' ORDER BY id), '')) AS fingerprint
FROM factory_receipts r
UNION ALL
SELECT 'items', md5(COALESCE(string_agg(
  md5((to_jsonb(r)-'packing'-'packaging')::text), '' ORDER BY id), ''))
FROM factory_receipt_items r
UNION ALL
SELECT 'inventory', md5(COALESCE(string_agg(md5(to_jsonb(r)::text), '' ORDER BY id), ''))
FROM factory_inventory r
UNION ALL
SELECT 'movements', md5(COALESCE(string_agg(md5(to_jsonb(r)::text), '' ORDER BY id), ''))
FROM factory_movements r;

-- RESTRICT is intentional: never cascade into unrelated data.
DROP TABLE IF EXISTS factory_inventory_units;
ALTER TABLE factory_receipt_items DROP COLUMN IF EXISTS packing;
ALTER TABLE factory_receipt_items DROP COLUMN IF EXISTS packaging;

-- Retain replay identities/fingerprints, but remove retired metadata from
-- cached receive responses as well as from the authoritative receipt rows.
UPDATE factory_operations o SET result = jsonb_set(o.result, '{items}',
  COALESCE((SELECT jsonb_agg(i.value-'packing'-'packaging' ORDER BY i.ordinality)
    FROM jsonb_array_elements(o.result->'items') WITH ORDINALITY i(value, ordinality)), '[]'::jsonb))
WHERE o.operation='receive' AND jsonb_typeof(o.result->'items')='array';

CREATE TEMP TABLE kg_receipt_after ON COMMIT DROP AS
SELECT 'receipts' AS relation,
  md5(COALESCE(string_agg(md5(to_jsonb(r)::text), '' ORDER BY id), '')) AS fingerprint
FROM factory_receipts r
UNION ALL
SELECT 'items', md5(COALESCE(string_agg(
  md5(to_jsonb(r)::text), '' ORDER BY id), ''))
FROM factory_receipt_items r
UNION ALL
SELECT 'inventory', md5(COALESCE(string_agg(md5(to_jsonb(r)::text), '' ORDER BY id), ''))
FROM factory_inventory r
UNION ALL
SELECT 'movements', md5(COALESCE(string_agg(md5(to_jsonb(r)::text), '' ORDER BY id), ''))
FROM factory_movements r;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM kg_receipt_before b FULL JOIN kg_receipt_after a USING(relation)
    WHERE b.fingerprint IS DISTINCT FROM a.fingerprint
  ) THEN RAISE EXCEPTION 'KG-only migration changed preserved warehouse ledger data'; END IF;
END $$;
COMMIT;
