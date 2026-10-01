import { COMPONENTS } from '../engine/scoring.js';
import { TRANSPARENCY_CHECKS, SPENDING_CATEGORIES } from '../engine/categories.js';
import { gradeBadge } from '../charts.js';

const HOW = {
  services: 'Share of all spending that pays for services residents use directly: police, fire and EMS, roads, water and sewer, parks and libraries, and health and human services. Full points at 88% or more, zero at 50% or less.',
  overhead: 'Share spent on general administration plus outside consultants and lawyers. Full points at 6% or less, zero at 30% or more.',
  influence: 'Dollars per resident from PACs, developers, contractors and unions given to local officials’ campaigns, plus lobbying the town pays for. Full points at $0.50 or less per resident, zero at $12 or more.',
  transparency: 'One sixth of the points for each good-government practice the town follows (listed below).',
  fiscal: 'Mostly debt per resident (full points at $300 or less, zero at $6,000 or more), plus whether the town lives within its means this year.',
};

export function renderMethod(root) {
  root.innerHTML = `
  <div class="page prose">
    <h1>How scores work</h1>
    <p class="muted" style="margin-top:8px">The Community Return Score asks one question: <strong>how much of a town's money comes back to the people who live there?</strong> Every number behind a score is shown on the town's report so anyone can check it.</p>

    <h2>The five parts (100 points)</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Part</th><th class="r">Points</th><th>What it measures</th></tr></thead>
      <tbody>${COMPONENTS.map((c) => `<tr><td><strong>${c.label}</strong></td><td class="r num">${c.max}</td><td style="white-space:normal">${HOW[c.key]}</td></tr>`).join('')}</tbody>
    </table></div>

    <h2>Grades</h2>
    <div style="display:flex;flex-wrap:wrap;gap:16px">
      ${[['A', '85 and up'], ['B', '70 to 84'], ['C', '55 to 69'], ['D', '40 to 54'], ['F', 'below 40']].map(([g, r]) => `<span style="display:flex;gap:8px;align-items:center">${gradeBadge(g)} <span class="small">${r}</span></span>`).join('')}
    </div>

    <h2>Direct services vs. overhead</h2>
    <ul>
      <li><strong>Direct services:</strong> ${SPENDING_CATEGORIES.filter((c) => c.direct).map((c) => c.label.toLowerCase()).join(', ')}.</li>
      <li><strong>Overhead:</strong> ${SPENDING_CATEGORIES.filter((c) => !c.direct).map((c) => c.label.toLowerCase()).join(', ')}.</li>
    </ul>
    <p>Overhead is not wasted money. Towns need clerks, audits and lawyers, and debt pays for roads and buildings. But when overhead grows faster than services, residents get less for what they pay.</p>

    <h2>Transparency practices</h2>
    <ul>${TRANSPARENCY_CHECKS.map((c) => `<li>${c.label}</li>`).join('')}</ul>

    <h2>Why look beyond property tax?</h2>
    <p>Property tax is the line most people see on a bill, but many towns get half or more of their money elsewhere: sales tax, state aid, federal grants, fees, fines and borrowing. Fines and borrowing need extra attention. Heavy reliance on fines can mean residents are being used as a revenue source, and borrowing must be repaid with interest by future taxpayers.</p>

    <h2>Political money</h2>
    <p>PAC, developer, contractor and union contributions to local officials never pass through the town's books, but they can shape who wins contracts and zoning decisions. Town Ledger tracks them next to the budget so you can see both at once. A contribution is not proof of wrongdoing; it is context.</p>

    <h2>Glossary</h2>
    <dl class="glossary">
      <dt>PAC (political action committee)</dt><dd>A group that pools money to donate to candidates or campaigns.</dd>
      <dt>State aid / shared revenue</dt><dd>Money the state sends to towns, often from state income or sales taxes.</dd>
      <dt>Federal grants</dt><dd>Money from federal agencies for specific projects such as roads, housing or disaster recovery.</dd>
      <dt>Debt service</dt><dd>Payments of interest and principal on money the town borrowed.</dd>
      <dt>Bond</dt><dd>A loan the town takes from investors and repays over many years.</dd>
      <dt>Open checkbook</dt><dd>A public, searchable list of every payment a town makes.</dd>
      <dt>Fiscal year</dt><dd>The town's 12-month budget year. It often runs July to June.</dd>
    </dl>

    <h2>Limits</h2>
    <p>Towns report finances in different formats, and many small townships publish only totals. A score is a starting point for questions, not a verdict. Check the sources on each report, and attend a budget hearing if something looks off.</p>
  </div>`;
}
