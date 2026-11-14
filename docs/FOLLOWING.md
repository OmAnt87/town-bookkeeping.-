# Following towns and email alerts

Readers press **☆ Follow** on a town report. That always saves the town to the
**Following** page in their browser (`localStorage['tv-follows']`, never sent
anywhere), which marks towns whose books changed since they last looked. Every
town also has an RSS feed of changes (`scripts/build-feeds.mjs`).

Email alerts are an optional extra, switched off until you set them up.

## How email alerts work

- **Signing up** (`offerEmail` in `js/views/follow-ui.js`): after a Follow, a dialog offers email. The address is posted straight to the Buttondown signup form in a new tab, tagged `town:<id>`, and is not kept by TownView. Buttondown sends a confirmation email first (double opt-in).
- **Sending** (`.github/workflows/notify-followers.yml`): when a push to `main` changes `data/real/**`, `scripts/notify-changes.mjs` compares the changed county files with the previous commit. It uses the same comparison and change lines as the RSS feeds. A town gets an email only if its books changed (not just the retrieval date) and it has at least one confirmed follower. The email goes to that town's tag (`scripts/notifiers/buttondown.mjs`).
- **Safety stop:** a single push that would email more than 300 towns is stopped for a look (a statewide rebuild can change thousands at once). Run the workflow by hand once you have checked the push.
- **Unsubscribing:** every email carries Buttondown's unsubscribe link. Unfollowing in the browser does not touch the email list.

## Setup

1. Create a [Buttondown](https://buttondown.com) newsletter. Keep double opt-in on (the default).
2. Set `BUTTONDOWN_USER` in `js/follows.js` to the newsletter's username. This turns the email offer on.
3. Add the repository secret `BUTTONDOWN_API_KEY` (Buttondown > Settings > API; GitHub > Settings > Secrets and variables > Actions).
4. Test it:
   1. Follow a town yourself and confirm the email. The subscriber should show the tag `town:<id>` in Buttondown.
   2. Follow a second town with the same address and check that Buttondown added the second tag to the existing subscriber.
   3. Run **Notify followers** from the Actions tab with `dry_run` on, and read the printed emails.
   4. Run it once with `dry_run` off against a commit that changed your test town.

Preview locally without sending:

```sh
node scripts/notify-changes.mjs --base HEAD~1 --head HEAD --dry-run
```

One email goes out per changed town. Someone following three towns that change in the same push gets three emails: Buttondown sends to tags rather than to individual people, so a combined digest per person would need a different provider.
