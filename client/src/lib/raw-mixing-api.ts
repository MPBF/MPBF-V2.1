import { productionRequest } from "./production-api";
import type { MixingInput, MixingState, RawMaterial, RawMaterialInput } from "../../../shared/raw-mixing";

export const rawMixingApi = {
  state: (before?: number) => productionRequest<MixingState>(`/mixing${before ? `?before=${before}` : ""}`),
  record: (input: MixingInput) => productionRequest<{ id: number; balances: { id: number; quantity_kg: string }[] }>("/mixing", input),
  createMaterial: (input: RawMaterialInput) => productionRequest<RawMaterial>("/raw-materials", input),
};
