# Following towns and change alerts

Readers can press **☆ Follow** on any town report to get an email when that
town's books change.

## How it works

- **In the browser** (`js/follows.js`, `js/views/follow-ui.js`, `js/views/following.js`):
  followed towns are kept in `localStorage['tv-follows']` with a fingerprint of
  each town's books (`townFingerprint` in `js/engine/changes.js`). The
  **Following** page lists them and marks any whose books changed since they
  were saved. Following also sends the email to the Buttondown embed
  subscribe form, tagged `town:<id>`. Buttondown sends a confirmation email
  first (double opt-in).
- **On data pushes** (`.github/workflows/notify-followers.yml`): when a push to
  the default branch changes `data/real/**`, `scripts/notify-changes.mjs`
  compares each town in the changed county files with its record at the
  previous commit (`townVersions`, `diffDatasets`; a renamed file is matched
  through the old `summary.json`). It then lists the tags subscribers carry and
  sends one email per changed town that someone follows, only to subscribers
  with that town's tag (`scripts/notifiers/buttondown.mjs`). Towns new to the
  site are skipped, since nobody can follow them yet.

No IP addresses or visit logs are recorded. The only personal data is the
email address a reader enters, held by Buttondown.

## Setup

1. Create a Buttondown newsletter. Turn on double opt-in.
2. Set `BUTTONDOWN_USER` in `js/follows.js` to the newsletter's username.
3. Add the repository secret `BUTTONDOWN_API_KEY` (Buttondown → Settings → API).
4. Test: run the **Notify followers** workflow by hand with `dry_run` on and
   check the printed emails, then once with it off using a test subscriber.

Preview locally without sending:

```sh
node scripts/notify-changes.mjs --base HEAD~1 --head HEAD --dry-run
```
