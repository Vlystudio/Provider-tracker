export type DashboardReliability = {
  activeFacilities: number;
  callsThisWeek: number;
  activeWork: number;
  availabilityDue: number;
  freshAccepting: number;
  confirmedUnavailable: number;
  unconfirmedAvailability: number;
  importantChanges: number;
};

export type DashboardSummary = {
  cards: Array<{ label: string; value: string }>;
  reliability: DashboardReliability;
};
