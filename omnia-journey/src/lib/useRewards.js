import { useEffect, useMemo } from "react";
import {
  refreshRewardsState,
  useRewardsState,
} from "@/state/rewardsStore";

export default function useRewards() {
  const snapshot = useRewardsState();

  useEffect(() => {
    void refreshRewardsState();
  }, []);

  return useMemo(
    () => ({
      ...snapshot,
      balance: Number(snapshot.summary?.availableSleepPoints || 0),
      level: snapshot.summary?.currentBadge?.label || "Explorer",
      title: snapshot.summary?.currentBadge?.label || "Explorer",
      refresh: () => refreshRewardsState({ force: true }),
    }),
    [snapshot]
  );
}
