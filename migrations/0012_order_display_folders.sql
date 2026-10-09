-- Team-shared manual display organization. Never derives from orders.status.
CREATE TABLE IF NOT EXISTS order_display_folder_assignments (
  order_id integer PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  folder varchar(20) NOT NULL CONSTRAINT order_display_folder_valid CHECK (folder IN ('new','production','urgent','archive')),
  updated_by integer REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_order_display_folder_order
  ON order_display_folder_assignments(folder, order_id);