// The towns this browser follows, with the email used for alerts.

import { escapeHTML, formatDate } from '../engine/format.js';
import { getFollows, unfollow, setEmail, isEmail, hasChanged } from '../follows.js';

export function renderFollowing(root, state) {
  const draw = () => {
    const { email, towns } = getFollows();
    const ids = Object.keys(towns).sort((a, b) => towns[a].name.localeCompare(towns[b].name));
    const rows = ids.map((id) => {
      const saved = towns[id];
      const entry = state.byId.get(id);
      const updated = entry && hasChanged(entry.town);
      return `<li class="follow-row">
        <div><a href="#/town/${encodeURIComponent(id)}"><strong>${escapeHTML(saved.name)}</strong></a>${saved.state ? `, ${escapeHTML(saved.state)}` : ''}
          ${updated ? '<span class="pill pill-out">Books updated</span>' : ''}
          <div class="small muted">Saved ${formatDate(saved.savedAt.slice(0, 10))}${entry ? '' : ' · not in the loaded data'}</div></div>
        <button class="btn" type="button" data-unfollow="${escapeHTML(id)}">Unfollow</button></li>`;
    });
    root.innerHTML = `
    <div class="page">
      <div class="page-head"><div><h1>Following</h1><p>Towns you saved. We email you when their books change.</p></div></div>
      <div class="grid grid-2">
        <section class="card">
          <h2 style="margin-bottom:6px">Your towns</h2>
          ${rows.length ? `<ul class="follow-list">${rows.join('')}</ul>` : '<p class="muted">No towns yet. Open any town and press <strong>☆ Follow</strong>.</p>'}
        </section>
        <section class="card">
          <h2 style="margin-bottom:6px">Email for alerts</h2>
          <form id="email-form" class="follow-form">
            <input class="input" type="email" name="email" autocomplete="email" value="${escapeHTML(email)}" placeholder="you@example.com">
            <button class="btn" type="submit">Save email</button>
            <div class="small" id="email-msg" role="status"></div>
          </form>
          <p class="small muted">This list is kept in this browser only. Your email goes to our mailing list (Buttondown) with a tag for each town you follow, and is used for nothing else. Unfollowing here only removes a town from this list; to stop its emails, use the unsubscribe link at the bottom of any alert.</p>
        </section>
      </div>
    </div>`;
    root.querySelectorAll('[data-unfollow]').forEach((b) => b.addEventListener('click', () => { unfollow(b.dataset.unfollow); draw(); }));
    root.querySelector('#email-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const value = e.target.email.value;
      const msg = root.querySelector('#email-msg');
      if (!isEmail(value)) { msg.textContent = 'Enter a valid email address.'; return; }
      setEmail(value);
      msg.textContent = 'Saved. New follows will use this address.';
    });
  };
  draw();
}
