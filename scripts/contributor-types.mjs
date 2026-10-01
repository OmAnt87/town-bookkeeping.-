// Classifies a campaign-finance contributor into a Town Ledger influence category.
// Returns null for individuals and anything that is not organized outside money.
export function classifyContributor(type = '', name = '') {
  const t = `${type} ${name}`.toLowerCase();
  if (/lobby/.test(t)) return 'lobbyingPaid';
  if (/\bunion\b|\blocal \d+|brotherhood|federation of labor|afl-cio|teamsters/.test(t)) return 'unionContributions';
  if (/\bpac\b|political action|committee/.test(t)) return 'pacContributions';
  if (/develop|contract|builder|construct|paving|engineer|realty|real estate|llc|inc\b|corp/.test(t)) return 'developerContributions';
  return null;
}
