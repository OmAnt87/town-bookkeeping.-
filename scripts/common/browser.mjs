// A headless browser for state sites that sit behind a bot check (an Incapsula or Cloudflare page a
// plain download cannot pass). Playwright comes from the project (npm i playwright) or from a path
// in PLAYWRIGHT_MODULE.
export async function launchBrowser() {
  let pw;
  try { pw = await import('playwright'); } catch {
    if (!process.env.PLAYWRIGHT_MODULE) throw new Error('This download needs Playwright: npm i playwright (or set PLAYWRIGHT_MODULE to its index.mjs).');
    pw = await import(process.env.PLAYWRIGHT_MODULE);
  }
  const browser = await pw.chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  // A fresh context starts a new session (cookies), which some bot checks need between downloads.
  const newContext = () => browser.newContext({ acceptDownloads: true, userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36' });
  return { browser, context: await newContext(), newContext };
}
