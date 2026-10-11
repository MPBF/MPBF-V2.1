import { productionRequest } from "./production-api";
import type { MixingInput, MixingState, RawMovementInput } from "../../../shared/raw-mixing";

export const rawMixingApi = {
  state: (before?: number) => productionRequest<MixingState>(`/mixing${before ? `?before=${before}` : ""}`),
  record: (input: MixingInput) => productionRequest<{ id: number; balances: { id: number; quantity_kg: string }[] }>("/mixing", input),
  movement: (input: RawMovementInput) => productionRequest<{ id: number; kind: "receipt" | "issue"; total_kg: string; created_at: string; created_by: number; balances: { id: number; quantity_kg: string }[] }>("/raw-materials/movements", input),
};
