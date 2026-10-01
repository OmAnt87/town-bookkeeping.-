// Canonical category definitions shared by the engine, the UI and the data pipeline.

export const REVENUE_CATEGORIES = [
  { key: 'propertyTax', label: 'Property tax', propertyTax: true },
  { key: 'salesTax', label: 'Sales & local option tax' },
  { key: 'stateAid', label: 'State aid & shared revenue' },
  { key: 'federalGrants', label: 'Federal grants' },
  { key: 'localRevenue', label: 'Local revenue (fees, fines, interest, PILOTs)' },
  { key: 'grants', label: 'Grants (state, federal & private)' },
  { key: 'feesPermits', label: 'Fees, permits & licenses' },
  { key: 'utilityCharges', label: 'Utility charges' },
  { key: 'finesForfeitures', label: 'Fines & forfeitures' },
  { key: 'borrowing', label: 'Borrowing (bond proceeds)' },
  { key: 'otherRevenue', label: 'Other revenue' },
  // Money saved in earlier years and spent this year. Not new revenue, so it is
  // left out of the "not from property tax" figure.
  { key: 'surplusUsed', label: 'Surplus from prior years', reserve: true },
];

// `direct: true` marks spending that delivers a service residents use directly.
export const SPENDING_CATEGORIES = [
  { key: 'publicSafety', label: 'Police, fire & EMS', direct: true },
  { key: 'roads', label: 'Roads & infrastructure', direct: true },
  { key: 'utilities', label: 'Water, sewer & sanitation', direct: true },
  { key: 'parks', label: 'Parks, library & recreation', direct: true },
  { key: 'healthServices', label: 'Health & human services', direct: true },
  { key: 'administration', label: 'General administration', direct: false },
  { key: 'consultants', label: 'Outside consultants & legal', direct: false },
  { key: 'debtService', label: 'Debt service (interest & principal)', direct: false },
];

// Money that moves around the town but not through its treasury: campaign
// contributions to local officials, PACs, and lobbying paid by the town.
export const INFLUENCE_CATEGORIES = [
  { key: 'pacContributions', label: 'PAC contributions to local officials' },
  { key: 'developerContributions', label: 'Developer & contractor contributions' },
  { key: 'unionContributions', label: 'Union contributions' },
  { key: 'lobbyingPaid', label: 'Lobbying paid by the town' },
];

export const TRANSPARENCY_CHECKS = [
  { key: 'budgetOnline', label: 'Publishes its full budget online' },
  { key: 'openCheckbook', label: 'Posts an open checkbook of payments' },
  { key: 'auditOnTime', label: 'Files its annual audit on time' },
  { key: 'competitiveBidding', label: 'Bids out large contracts competitively' },
  { key: 'meetingsRecorded', label: 'Records and posts public meetings' },
  { key: 'conflictDisclosures', label: 'Officials file conflict-of-interest disclosures' },
];
