// Share button on a town report. Shares the town's plain page (/town/<id>/,
// built by scripts/build-pages.mjs), which search engines and link previews can read.

const LABEL = 'Share';

export const shareButton = () => `<button class="btn" id="share-btn" type="button" data-track="share" title="Share a link to this report">${LABEL}</button>`;

// Public-record towns have a page of their own; an imported dataset does not.
export const shareUrl = (town, source, loc = location) =>
  (source === 'real' ? `${loc.origin}/town/${encodeURIComponent(town.id)}/` : loc.href);

export function wireShare(root, town, url) {
  const btn = root.querySelector('#share-btn');
  if (!btn) return;
  let timer;
  const flash = (text) => {
    btn.textContent = text;
    clearTimeout(timer);
    timer = setTimeout(() => { btn.textContent = LABEL; }, 2000);
  };
  btn.addEventListener('click', async () => {
    const title = `${town.name}, ${town.state} - TownView`;
    if (navigator.share) {
      // Closing the share sheet rejects; that is not an error to show.
      try { await navigator.share({ title, text: `Where ${town.name}'s money comes from and where it goes.`, url }); } catch { /* dismissed */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      flash('Link copied');
    } catch {
      window.prompt('Copy this link', url);
    }
  });
}
