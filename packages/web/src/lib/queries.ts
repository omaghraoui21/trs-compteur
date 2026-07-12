import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export const queryKeys = {
  rooms: ["ref", "rooms"] as const,
  equipments: (roomId?: string) => ["ref", "equipments", roomId ?? "all"] as const,
  products: ["ref", "products"] as const,
  session: (id: string) => ["session", id] as const,
  sessionTrs: (id: string) => ["session", id, "trs"] as const,
  pendingLots: (status = "closed") => ["lots", "pending", status] as const,
  pendingCount: ["lots", "pending", "count"] as const,
  liveOverview: ["dashboard", "live-overview"] as const,
  alerts: ["alerts", "active"] as const,
};

export const useRooms = () => useQuery({ queryKey: queryKeys.rooms, queryFn: api.rooms, staleTime: 5 * 60_000 });
export const useEquipments = (roomId?: string) => useQuery({ queryKey: queryKeys.equipments(roomId), queryFn: () => api.equipments(roomId), staleTime: 5 * 60_000 });
export const useProducts = () => useQuery({ queryKey: queryKeys.products, queryFn: api.products, staleTime: 5 * 60_000 });
export const useSessionDetail = (id?: string) => useQuery({ queryKey: queryKeys.session(id ?? ""), queryFn: () => api.session(id!), enabled: Boolean(id) });
export const useSessionTrs = (id?: string) => useQuery({ queryKey: queryKeys.sessionTrs(id ?? ""), queryFn: () => api.sessionTrs(id!), enabled: Boolean(id), refetchInterval: 60_000 });
export const usePendingLots = (status: "closed" | "validated" | "rejected" | "all" = "closed") => useQuery({ queryKey: queryKeys.pendingLots(status), queryFn: () => api.pendingLots(status) });
export const useLiveOverview = () => useQuery({ queryKey: queryKeys.liveOverview, queryFn: api.liveOverview, refetchInterval: 60_000 });
