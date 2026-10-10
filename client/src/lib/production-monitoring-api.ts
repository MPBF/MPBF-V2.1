import { productionRequest } from "./production-api";
import type { MonitoringFilter, MonitoringPage, ProductionEvent, MonitoringSummary, MixMonitorRecord, MixMonitorDetail, RollMixDetail } from "../../../shared/production-monitoring";

const query = (filters: MonitoringFilter) => {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key,value]) => { if (value !== undefined && value !== "") params.set(key,String(value)); });
  return params.toString();
};
export const monitoringApi = {
  log: (filters: MonitoringFilter = {}) => productionRequest<MonitoringPage<ProductionEvent>>(`/monitoring/log?${query(filters)}`),
  summary: () => productionRequest<MonitoringSummary>("/monitoring/summary"),
  mixes: (filters: Pick<MonitoringFilter,"cursor"|"limit"|"machine_id"> = {}) =>
    productionRequest<MonitoringPage<MixMonitorRecord>>(`/monitoring/mixes?${query(filters)}`),
  mix: (id: number, cursor?: string) => productionRequest<MixMonitorDetail>(`/monitoring/mixes/${id}?${query({cursor})}`),
  roll: (id: number, cursor?: string) => productionRequest<RollMixDetail>(`/monitoring/rolls/${id}?${query({cursor})}`),
};
