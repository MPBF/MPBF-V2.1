export type CustomerHistoryProductionOrder = {
  id: number;
  production_order_number: string;
  requested_kg: string;
  produced_kg: string;
};

export type CustomerHistoryOrder = {
  id: number;
  order_number: string;
  created_at: string;
  production_orders: CustomerHistoryProductionOrder[];
};

export type CustomerOrderHistoryPage = {
  orders: CustomerHistoryOrder[];
  has_more: boolean;
  next_offset: number | null;
};
