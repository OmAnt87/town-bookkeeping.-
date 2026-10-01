// Canonical category definitions shared by the engine, the UI and the data pipeline.

export const REVENUE_CATEGORIES = [
  { key: 'propertyTax', label: 'Property tax', propertyTax: true },
  { key: 'salesTax', label: 'Sales, income & other local taxes' },
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
// `redFlag: true` marks spending that works against residents: mass surveillance
// and public money handed to private corporations.
export const SPENDING_CATEGORIES = [
  { key: 'publicSafety', label: 'Police, fire & EMS', direct: true },
  { key: 'roads', label: 'Roads & infrastructure', direct: true },
  { key: 'utilities', label: 'Water, sewer & sanitation', direct: true },
  { key: 'parks', label: 'Parks, library & recreation', direct: true },
  { key: 'healthServices', label: 'Health & human services', direct: true },
  // Connecticut towns run their schools; elsewhere school districts are separate
  // governments. Shown on reports but left out of the services and overhead
  // shares, so towns are compared on the same municipal services everywhere.
  { key: 'education', label: 'Schools (board of education)', direct: false, outsideShares: true },
  { key: 'administration', label: 'General administration', direct: false },
  { key: 'consultants', label: 'Outside consultants & legal', direct: false },
  { key: 'debtService', label: 'Debt service (interest & principal)', direct: false },
  // Spending a town reported only as a total. A town with any is not scored on
  // services or overhead, since the split is unknown.
  { key: 'otherSpending', label: 'Other spending (not broken down)', direct: false, unitemized: true },
  { key: 'surveillance', label: 'Surveillance tech (Flock cameras, plate readers, facial recognition)', direct: false, redFlag: true },
  { key: 'corporateDeals', label: 'Corporate deals (data center contracts, private-developer subsidies)', direct: false, redFlag: true },
];

// Revenue the town gave up for corporations: tax abatements and discounted
// PILOT agreements, usually won through lobbying. Not money in, so it is
// kept out of revenue totals and shown next to them.
export const TAX_BREAK_CATEGORIES = [
  { key: 'dataCenterAbatements', label: 'Data center tax breaks & PILOT discounts' },
  { key: 'corporateAbatements', label: 'Other corporate tax abatements' },
];

// Vendors and line items that are red flags wherever they show up in the
// ledger, even when a town files them under police or general spending.
export const RED_FLAG_PATTERNS = [
  { pattern: /flock|license[- ]plate|\balpr\b|\blpr\b|vigilant solutions/i, label: 'License-plate surveillance' },
  { pattern: /facial recognition|clearview|fusus|shotspotter|soundthinking|cellebrite|predictive policing|real[- ]time crime center/i, label: 'Surveillance tech' },
  { pattern: /data cent(er|re)|hyperscale|server farm/i, label: 'Data center deal' },
  { pattern: /tax abatement|\bpilot agreement|redevelopment subsidy|corporate incentive/i, label: 'Corporate subsidy' },
];

// Money that moves around the town but not through its treasury: campaign
// contributions to local officials, PACs, and lobbying paid by the town.
export const INFLUENCE_CATEGORIES = [
  { key: 'pacContributions', label: 'PAC contributions to local officials' },
  { key: 'developerContributions', label: 'Business & contractor contributions' },
  { key: 'unionContributions', label: 'Union contributions' },
  { key: 'corporateLobbying', label: 'Corporate lobbying of town officials' },
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
