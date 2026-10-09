-- Development-only additive migration. Never edits existing application rows.
-- Persistent high-water marks prevent reusing a code after its row is deleted.
-- Repeatable: existing sequences are only advanced, never reset backwards.
BEGIN;

CREATE SEQUENCE IF NOT EXISTS public.admin_section_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.admin_category_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.admin_item_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.admin_master_batch_color_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.admin_machine_id_seq;

DO $$
DECLARE
  entry record;
  observed bigint;
  previous bigint;
  previously_called boolean;
BEGIN
  -- The same locks as allocation routes prevent races with concurrent inserts.
  PERFORM pg_advisory_xact_lock(29832, 2);
  PERFORM pg_advisory_xact_lock(29832, 3);
  PERFORM pg_advisory_xact_lock(29832, 4);
  PERFORM pg_advisory_xact_lock(29832, 5);
  PERFORM pg_advisory_xact_lock(29832, 6);

  FOR entry IN
    SELECT * FROM (VALUES
      ('admin_section_id_seq', 'sections', '^SEC[0-9]+$', 4),
      ('admin_category_id_seq', 'categories', '^CAT[0-9]+$', 4),
      ('admin_item_id_seq', 'items', '^ITM[0-9]+$', 4),
      ('admin_master_batch_color_id_seq', 'master_batch_colors', '^MB[0-9]+$', 3)
    ) AS specifications(sequence_name, table_name, id_pattern, suffix_start)
  LOOP
    EXECUTE format(
      'SELECT COALESCE(MAX(substring(id FROM %s)::numeric), 0)::bigint FROM public.%I WHERE id ~ %L',
      entry.suffix_start, entry.table_name, entry.id_pattern
    ) INTO observed;
    EXECUTE format('SELECT last_value, is_called FROM public.%I', entry.sequence_name)
      INTO previous, previously_called;
    IF observed > previous OR (observed = previous AND NOT previously_called) THEN
      PERFORM setval(('public.' || entry.sequence_name)::regclass, observed, true);
    END IF;
  END LOOP;

  SELECT COALESCE(MAX(
    CASE WHEN id LIKE 'MAC%' THEN substring(id FROM 4)::numeric
         ELSE substring(id FROM 2)::numeric END
  ), 0)::bigint INTO observed
  FROM public.machines WHERE id ~ '^(MAC|M)[0-9]+$';
  SELECT last_value, is_called INTO previous, previously_called
    FROM public.admin_machine_id_seq;
  IF observed > previous OR (observed = previous AND NOT previously_called) THEN
    PERFORM setval('public.admin_machine_id_seq'::regclass, observed, true);
  END IF;
END $$;

COMMIT;