import { describe, expect, it, jest } from "@jest/globals";
import { hasProductionPermission, productionStageReadPermissions } from "../shared/production";
import { ProductionReadService } from "../server/production/read";

describe("legacy operator dashboard read permissions", () => {
  it.each(["film", "printing", "cutting"] as const)("loads the %s board under its existing read grant", async stage => {
    const query = jest.fn(async (_sql: string) => ({ rows: [] }));
    const release = jest.fn();
    const connect = jest.fn(async () => ({ query, release }));
    const reader = new ProductionReadService({ connect });
    const actor = { id: 7, permissions: [productionStageReadPermissions[stage][1]] };
    const state = await reader.state(actor, stage);
    expect(state.orders).toEqual([]);
    expect(query.mock.calls.some(([sql]) => sql.includes("factory_rolls"))).toBe(true);
    expect(query.mock.calls[0][0]).toMatch(/READ ONLY/);
    expect(release).toHaveBeenCalledTimes(1);
    expect(hasProductionPermission(actor, `operate_${stage}`)).toBe(false);
    for (const other of ["film", "printing", "cutting", "management"] as const) {
      if (other !== stage) await expect(reader.state(actor, other)).rejects.toMatchObject({ status: 403 });
    }
    expect(connect).toHaveBeenCalledTimes(1);
  });
  it("preserves the actual film role's existing general production read grant", async () => {
    const query = jest.fn(async (_sql: string) => ({ rows: [] }));
    const reader = new ProductionReadService({ connect: async () => ({ query, release: () => {} }) });
    const actor = { id: 7, permissions: ["view_film_dashboard", "view_production"] };
    await expect(reader.state(actor, "film")).resolves.toMatchObject({ orders: [], rolls: [] });
    expect(hasProductionPermission(actor, "operate_film")).toBe(false);
  });
});
