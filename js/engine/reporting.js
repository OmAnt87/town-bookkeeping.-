// Infer only from identified importer records and their existing source notes.
// Do not infer provenance from a state abbreviation alone.
export function reportingFor(town) {
  if (town.reporting) return town.reporting;
  const text = [...(town.sources || []).map((s) => s.label), ...(town.notes || [])].join(' ');
  let basis, scope;
  if (town.njMuniCode && /User Friendly Budget/.test(text)) { basis = 'Adopted budget'; scope = 'Municipal operations; excludes schools and county'; }
  if (town.nyOscCode && /State Comptroller/.test(text)) { basis = 'Actual results'; scope = 'Municipal reporting funds; excludes pass-through funds'; }
  if (/PA DCED Statewide Municipal Annual Financial Reports/.test(text)) { basis = 'Actual results'; scope = /combined city and county/.test(text) ? 'Combined city and county' : 'Municipal operations; excludes independent authorities'; }
  if (/CT OPM Municipal Fiscal Indicators/.test(text)) { basis = 'Actual results'; scope = town.name === 'City of Groton' ? 'General fund; City of Groton' : 'General fund; includes schools'; }
  if (!basis) return {};
  const politicalSource = (town.sources || []).find((s) => /since \d{4}/.test(s.label) && /ELEC|Elections|party town committees/.test(s.label));
  return {
    basis, scope,
    ...(politicalSource ? {
      politicalPeriod: `Since ${politicalSource.label.match(/since (\d{4}(?:-\d{2}-\d{2})?)/)[1]}; retrieved ${town.asOf || 'Not recorded'}`,
      politicalScope: town.state === 'CT' ? 'Party town committees; excludes candidate committees' : 'Municipal candidate committees',
    } : {}),
  };
}
export function reportingText(town) {
  const r = town.reporting || {};
  return `Basis: ${r.basis || 'Not recorded'} · Scope: ${r.scope || 'Not recorded'} · Political period: ${r.politicalPeriod || 'Not recorded'} · Recipients: ${r.politicalScope || 'Not recorded'}`;
}
