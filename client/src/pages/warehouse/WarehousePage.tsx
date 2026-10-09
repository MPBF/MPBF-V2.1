import ProductionPage from "../production/ProductionPage";
import type { ProductionUser } from "../../../../shared/production";

export type WarehousePageProps = {
  user: ProductionUser;
  view: "hall" | "warehouse" | "roll";
  rollId?: string;
};

/**
 * The warehouse module deliberately composes the production business views:
 * receiving and finished-stock operations continue to use the same API,
 * authorization checks, forms, and state refresh behavior.
 */
export default function WarehousePage({ user, view, rollId }: WarehousePageProps) {
  return <ProductionPage user={user} view={view} rollId={rollId} moduleContext="warehouse" />;
}
