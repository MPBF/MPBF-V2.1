import { productionRequest } from "./production-api";
import type { MixingInput, MixingState, RawMovementInput, MixRevisionPage } from "../../../shared/raw-mixing";

export const rawMixingApi = {
  revisions: (mixId?: number, before?: string) => {
    const params = new URLSearchParams();
    if (mixId !== undefined) params.set("mix_id", String(mixId));
    if (before !== undefined) params.set("before", before);
    return productionRequest<MixRevisionPage>(`/mixing/revisions?${params}`);
  },
  state: (before?: number) => productionRequest<MixingState>(`/mixing${before ? `?before=${before}` : ""}`),
  record: (input: MixingInput) => productionRequest<{ id: number; balances: { id: number; quantity_kg: string }[] }>("/mixing", input),
  movement: (input: RawMovementInput) => productionRequest<{ id: number; kind: "receipt" | "issue"; total_kg: string; created_at: string; created_by: number; balances: { id: number; quantity_kg: string }[] }>("/raw-materials/movements", input),
};
