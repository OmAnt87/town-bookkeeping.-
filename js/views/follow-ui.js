// Follow button and email dialog shown on a town report.

import { escapeHTML } from '../engine/format.js';
import { getFollows, isFollowing, follow, unfollow, isEmail } from '../follows.js';

const label = (on) => (on ? '★ Following' : '☆ Follow');

export const followButton = (town) => {
  const on = isFollowing(town.id);
  return `<button class="btn${on ? ' btn-following' : ''}" id="follow-btn" type="button" aria-pressed="${on}" title="Get an email when this town's books change">${label(on)}</button>`;
};

export function wireFollow(root, town) {
  const btn = root.querySelector('#follow-btn');
  if (!btn) return;
  const sync = () => {
    const on = isFollowing(town.id);
    btn.textContent = label(on);
    btn.setAttribute('aria-pressed', String(on));
    btn.classList.toggle('btn-following', on);
  };
  btn.addEventListener('click', () => {
    if (isFollowing(town.id)) { unfollow(town.id); sync(); return; }
    openDialog(town, sync);
  });
}

function openDialog(town, onDone) {
  const { email } = getFollows();
  const dlg = document.createElement('dialog');
  dlg.className = 'follow-dialog';
  dlg.innerHTML = `
    <form method="dialog" class="follow-form">
      <h2>Follow ${escapeHTML(town.name)}</h2>
      <p class="small">We'll email you when this town's books change. Your email is used only for these alerts, and every email has an unsubscribe link.</p>
      <label class="field"><span class="small">Email</span>
        <input class="input" type="email" name="email" required autocomplete="email" value="${escapeHTML(email)}" placeholder="you@example.com"></label>
      <div class="small" id="follow-msg" role="status"></div>
      <div class="follow-actions">
        <button class="btn" type="button" value="cancel" id="follow-cancel">Cancel</button>
        <button class="btn btn-primary" type="submit">Follow</button>
      </div>
      <p class="small muted">New addresses get one confirmation email first. Saved towns are listed on <a href="#/following">Following</a>.</p>
    </form>`;
  document.body.append(dlg);
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.querySelector('#follow-cancel').addEventListener('click', close);
  dlg.addEventListener('cancel', () => dlg.remove());
  dlg.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = dlg.querySelector('input').value;
    const msg = dlg.querySelector('#follow-msg');
    if (!isEmail(value)) { msg.textContent = 'Enter a valid email address.'; return; }
    msg.textContent = 'Saving...';
    try {
      await follow(town, value);
      onDone();
      close();
    } catch {
      // Saved locally even if the signup request failed; say so.
      onDone();
      msg.textContent = 'Saved in this browser, but the email signup did not go through. Try again later.';
    }
  });
  dlg.showModal();
  dlg.querySelector('input').focus();
}
