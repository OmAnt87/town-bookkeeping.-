// Maps New Jersey municipal budget lines (the standard DLGS budget / User
// Friendly Budget format every NJ municipality files) to Town Ledger categories.
//
// Returns a category key, 'shared' for costs that support every department
// (pensions, social security, group insurance), or 'exclude' for reserves that
// are not spending (e.g. reserve for uncollected taxes).

const APPROPRIATION_RULES = [
  [/uncollected taxes|reserve for tax appeals/i, 'exclude'],
  [/pension|retirement|pers\b|pfrs|social security|o\.?a\.?s\.?i|dcrp|defined contribution|group insurance|health (benefit|insurance)|employee (group )?(health|benefits)|unemployment (compensation|insurance)|workers'? comp|liability insurance|insurance/i, 'shared'],
  [/debt service|bond principal|interest on (bonds|notes)|bond anticipation|green trust|loan repayment|capital lease|deferred charges/i, 'debtService'],
  [/legal|attorney|prosecutor|public defender|engineer|audit|consult|professional services|appraisal/i, 'consultants'],
  [/police|fire|first aid|ems\b|emergency (management|medical)|dispatch|911|lifeguard|municipal court|crossing guard|safety/i, 'publicSafety'],
  [/road|street|snow|public works|vehicle|fleet|shade tree|sidewalk|storm|drainage|capital improvement|buildings and grounds|traffic|signal/i, 'roads'],
  [/sewer|water|solid waste|garbage|trash|recycl|landfill|sanitation|street lighting|electricity|natural gas|gasoline|fuel|telephone|utilit/i, 'utilities'],
  [/park|recreation|library|senior|youth|community (center|events)|celebration|pool|cultural|arts/i, 'parks'],
  [/health|animal control|human services|welfare|board of health|nursing|social services|environmental commission/i, 'healthServices'],
  [/admin|executive|mayor|council|committee|clerk|financial|tax (collect|assess)|assessment|revenue administration|personnel|human resources|information tech|computer|data processing|planning|zoning|construction code|election|ethics|general government|unclassified|contingent|salary adjustment|accumulated (leave|absence)|matching funds/i, 'administration'],
];

const REVENUE_RULES = [
  [/amount to be raised by taxation|raised by taxes|local tax for municipal|minimum library tax|delinquent taxes|tax levy/i, 'propertyTax'],
  [/energy receipts|cmptra|consolidated municipal property tax relief|garden state (trust|preservation)|state aid|business personal property|municipal relief fund|watershed moratorium/i, 'stateAid'],
  [/federal|fema|cdbg|community development block|arp\b|american rescue|cares act|homeland security|hud\b|u\.s\. /i, 'federalGrants'],
  [/clean communities|recycling tonnage|drunk driving|body armor|alcohol education|safe and secure|nj (dot|department)|state of new jersey|state grant|municipal aid|open space|county grant|green acres|grant/i, 'stateAid'],
  [/fines|costs.*court|municipal court|parking (tickets|fines)/i, 'finesForfeitures'],
  [/sewer|water utility|utility (operating )?surplus|utility charges|solid waste fees/i, 'utilityCharges'],
  [/licen|permit|fee|construction code|uniform fire|rental|cable|franchise|zoning|planning board|recreation (fees|programs)/i, 'feesPermits'],
  [/bond|note proceeds|loan proceeds/i, 'borrowing'],
  [/occupancy tax|hotel|motel/i, 'salesTax'],
  [/surplus|interest|pilot|payment in lieu|in lieu of tax|shared service|interlocal|reserve|sale of|cell tower|lease|hotel|other|miscellaneous/i, 'otherRevenue'],
];

export function mapNJLine(label, section) {
  const rules = section === 'revenue' ? REVENUE_RULES : APPROPRIATION_RULES;
  for (const [re, key] of rules) if (re.test(label)) return key;
  return section === 'revenue' ? 'otherRevenue' : 'administration';
}

// lines: [{ section: 'revenue' | 'appropriation', line, amount }]
// Returns { revenue, spending, unmatched, shared, excluded } with shared costs
// spread across spending categories in proportion to their size, so pensions
// and insurance neither inflate nor deflate any one category.
export function aggregateNJBudget(lines) {
  const revenue = {};
  const spending = {};
  let shared = 0;
  let excluded = 0;
  for (const l of lines) {
    const amount = Number(l.amount) || 0;
    if (!amount) continue;
    const key = mapNJLine(l.line, l.section);
    if (l.section === 'revenue') revenue[key] = (revenue[key] || 0) + amount;
    else if (key === 'shared') shared += amount;
    else if (key === 'exclude') excluded += amount;
    else spending[key] = (spending[key] || 0) + amount;
  }
  const base = Object.values(spending).reduce((a, b) => a + b, 0);
  if (shared && base) {
    for (const k of Object.keys(spending)) spending[k] += (spending[k] / base) * shared;
  }
  for (const k of Object.keys(spending)) spending[k] = Math.round(spending[k]);
  return { revenue, spending, shared, excluded };
}
