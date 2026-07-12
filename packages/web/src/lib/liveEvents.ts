import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ACCESS_KEY } from "./api";
import { queryKeys } from "./queries";

export function useLiveEvents() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const token = localStorage.getItem(ACCESS_KEY);
    if (!token) return;
    const source = new EventSource(`/api/events/stream?token=${encodeURIComponent(token)}`);
    const onUpdate = () => {
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      void queryClient.invalidateQueries({ queryKey: ["lots"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.alerts });
    };
    source.addEventListener("update", onUpdate);
    return () => { source.removeEventListener("update", onUpdate); source.close(); };
  }, [queryClient]);
}
