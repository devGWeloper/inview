// 이벤트-FAB 매핑.

export const FAB_IDS = ["C2", "M10", "M11", "M14", "M15", "M16", "Y17"] as const;
export type FabId = typeof FAB_IDS[number];

export interface EventFabMapping {
  eventId: string;
  fabs: string[];
}
