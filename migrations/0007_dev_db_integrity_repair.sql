-- Development-only integrity repair. This migration changes constraints only:
-- it never updates, deletes, backfills, or otherwise rewrites application rows.
-- Apply manually to the verified development database; do not run at startup or
-- against production. Production schema changes remain part of the Publish flow.
BEGIN;

-- Fail before any DDL if existing records cannot satisfy the intended constraints.
-- Counts are included in the exception so remediation requires explicit review.
DO $$
DECLARE
  orders_created_at_null bigint;
  delivery_days_invalid bigint;
  orders_customer_orphans bigint;
  production_created_at_null bigint;
  production_status_null bigint;
  quantity_invalid bigint;
  overrun_invalid bigint;
  final_quantity_invalid bigint;
  production_order_orphans bigint;
  production_product_orphans bigint;
  customer_product_customer_orphans bigint;
  category_orphans bigint;
BEGIN
  SELECT count(*) INTO orders_created_at_null
  FROM public.orders WHERE created_at IS NULL;

  SELECT count(*) INTO delivery_days_invalid
  FROM public.orders WHERE delivery_days IS NOT NULL AND delivery_days <= 0;

  SELECT count(*) INTO orders_customer_orphans
  FROM public.orders o
  LEFT JOIN public.customers c ON c.id = o.customer_id
  WHERE c.id IS NULL;

  SELECT count(*) INTO production_created_at_null
  FROM public.production_orders WHERE created_at IS NULL;

  SELECT count(*) INTO production_status_null
  FROM public.production_orders WHERE status IS NULL;

  SELECT count(*) INTO quantity_invalid
  FROM public.production_orders WHERE quantity_kg <= 0;

  SELECT count(*) INTO overrun_invalid
  FROM public.production_orders
  WHERE overrun_percentage < 0 OR overrun_percentage > 50;

  SELECT count(*) INTO final_quantity_invalid
  FROM public.production_orders WHERE final_quantity_kg <= 0;

  SELECT count(*) INTO production_order_orphans
  FROM public.production_orders p
  LEFT JOIN public.orders o ON o.id = p.order_id
  WHERE o.id IS NULL;

  SELECT count(*) INTO production_product_orphans
  FROM public.production_orders p
  LEFT JOIN public.customer_products cp ON cp.id = p.customer_product_id
  WHERE p.customer_product_id IS NOT NULL AND cp.id IS NULL;

  SELECT count(*) INTO customer_product_customer_orphans
  FROM public.customer_products cp
  LEFT JOIN public.customers c ON c.id = cp.customer_id
  WHERE cp.customer_id IS NOT NULL AND c.id IS NULL;

  SELECT count(*) INTO category_orphans
  FROM public.customer_products cp
  LEFT JOIN public.categories c ON c.id = cp.category_id
  WHERE cp.category_id IS NOT NULL AND c.id IS NULL;

  IF orders_created_at_null <> 0
    OR delivery_days_invalid <> 0
    OR orders_customer_orphans <> 0
    OR production_created_at_null <> 0
    OR production_status_null <> 0
    OR quantity_invalid <> 0
    OR overrun_invalid <> 0
    OR final_quantity_invalid <> 0
    OR production_order_orphans <> 0
    OR production_product_orphans <> 0
    OR customer_product_customer_orphans <> 0
    OR category_orphans <> 0
  THEN
    RAISE EXCEPTION
      'Integrity migration precheck failed; no DDL applied. orders.created_at NULL=%, orders.delivery_days invalid=%, orders.customer_id orphans=%, production_orders.created_at NULL=%, production_orders.status NULL=%, quantity_kg invalid=%, overrun_percentage invalid=%, final_quantity_kg invalid=%, production_orders.order_id orphans=%, production_orders.customer_product_id orphans=%, customer_products.customer_id orphans=%, customer_products.category_id orphans=%',
      orders_created_at_null,
      delivery_days_invalid,
      orders_customer_orphans,
      production_created_at_null,
      production_status_null,
      quantity_invalid,
      overrun_invalid,
      final_quantity_invalid,
      production_order_orphans,
      production_product_orphans,
      customer_product_customer_orphans,
      category_orphans;
  END IF;
END
$$;

ALTER TABLE public.orders
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL;

ALTER TABLE public.production_orders
  ALTER COLUMN status SET DEFAULT 'pending',
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN final_quantity_kg DROP DEFAULT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.orders'::regclass
      AND conname = 'delivery_days_positive'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT delivery_days_positive
      CHECK (delivery_days IS NULL OR delivery_days > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.production_orders'::regclass
      AND conname = 'quantity_kg_positive'
  ) THEN
    ALTER TABLE public.production_orders
      ADD CONSTRAINT quantity_kg_positive CHECK (quantity_kg > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.production_orders'::regclass
      AND conname = 'overrun_percentage_valid'
  ) THEN
    ALTER TABLE public.production_orders
      ADD CONSTRAINT overrun_percentage_valid
      CHECK (overrun_percentage >= 0 AND overrun_percentage <= 50);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.production_orders'::regclass
      AND conname = 'final_quantity_kg_positive'
  ) THEN
    ALTER TABLE public.production_orders
      ADD CONSTRAINT final_quantity_kg_positive CHECK (final_quantity_kg > 0);
  END IF;
END
$$;

-- Reconcile only these single-column relationships. Existing constraints are
-- retained when already equivalent; mismatched actions are replaced.
DO $$
DECLARE
  target record;
  existing record;
  child_att smallint;
  parent_att smallint;
  expected_found boolean;
BEGIN
  FOR target IN
    SELECT *
    FROM (VALUES
      ('public.orders'::regclass, 'customer_id', 'public.customers'::regclass, 'id', 'r', 'RESTRICT', 'orders_customer_id_customers_id_fk'),
      ('public.customer_products'::regclass, 'customer_id', 'public.customers'::regclass, 'id', 'r', 'RESTRICT', 'customer_products_customer_id_customers_id_fk'),
      ('public.customer_products'::regclass, 'category_id', 'public.categories'::regclass, 'id', 'a', 'NO ACTION', 'customer_products_category_id_categories_id_fk'),
      ('public.production_orders'::regclass, 'customer_product_id', 'public.customer_products'::regclass, 'id', 'r', 'RESTRICT', 'production_orders_customer_product_id_customer_products_id_fk'),
      ('public.production_orders'::regclass, 'order_id', 'public.orders'::regclass, 'id', 'c', 'CASCADE', 'production_orders_order_id_orders_id_fk')
    ) AS relationships(child_table, child_column, parent_table, parent_column, delete_code, delete_action, constraint_name)
  LOOP
    SELECT attnum INTO child_att
    FROM pg_attribute
    WHERE attrelid = target.child_table
      AND attname = target.child_column
      AND NOT attisdropped;

    SELECT attnum INTO parent_att
    FROM pg_attribute
    WHERE attrelid = target.parent_table
      AND attname = target.parent_column
      AND NOT attisdropped;

    expected_found := false;
    FOR existing IN
      SELECT conname, confrelid, confkey, confdeltype, convalidated
      FROM pg_constraint
      WHERE conrelid = target.child_table
        AND contype = 'f'
        AND conkey = ARRAY[child_att]::smallint[]
    LOOP
      IF NOT expected_found
        AND existing.confrelid = target.parent_table
        AND existing.confkey = ARRAY[parent_att]::smallint[]
        AND existing.confdeltype = target.delete_code
        AND existing.convalidated
      THEN
        expected_found := true;
      ELSE
        EXECUTE format(
          'ALTER TABLE %s DROP CONSTRAINT %I',
          target.child_table,
          existing.conname
        );
      END IF;
    END LOOP;

    IF NOT expected_found THEN
      EXECUTE format(
        'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %s (%I) ON UPDATE CASCADE ON DELETE %s',
        target.child_table,
        target.constraint_name,
        target.child_column,
        target.parent_table,
        target.parent_column,
        target.delete_action
      );
    END IF;
  END LOOP;
END
$$;

COMMIT;