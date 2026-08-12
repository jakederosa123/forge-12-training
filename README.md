# Forge 12 Training System

This repository is ready for GitHub Pages and Supabase synchronization. Its root contains the actual website, so GitHub Pages publishes the training app instead of this README.

## Before publishing

Open `config.js` and replace the two placeholder values with your Supabase Project URL and Publishable Key. Never put a service-role key or database password in the repository.

```js
window.FORGE_SYNC_CONFIG = {
  supabaseUrl: "https://YOUR_PROJECT.supabase.co",
  supabasePublishableKey: "sb_publishable_YOUR_KEY"
};
```

Run `supabase/setup.sql` in the Supabase SQL Editor. It is safe to run more than once.

If the published app still has placeholder values, Settings displays a device-only connection form. Updating `config.js` remains preferable because it makes the Supabase client available on every browser before email sign-in.

## GitHub Pages

In the repository, open Settings, then Pages. Under Build and deployment, set Source to GitHub Actions. Each push to `main` will run the included Publish Forge 12 workflow.

## Supabase URL configuration

In Supabase, open Authentication, then URL Configuration.

- Site URL: `https://jakederosa123.github.io/forge-12-training/`
- Redirect URL: `https://jakederosa123.github.io/forge-12-training/`

The exact production URL is intentional. The application sends email sign-in links back to this address.

## Replace the current repository from a Mac

The commands below replace the contents of a fresh local clone. This removes the old misplaced website and malformed workflow from the clone, while preserving the GitHub repository and its history.

```bash
cd ~/Downloads
git clone https://github.com/jakederosa123/forge-12-training.git forge-12-training-upload
rsync -av --delete --exclude '.git' --exclude '.DS_Store' forge-12-training-complete/ forge-12-training-upload/
cd forge-12-training-upload
git add -A
git commit -m "Publish complete Forge 12 training app with sync"
git push origin main
```

If `forge-12-training-upload` already exists, use a new name such as `forge-12-training-upload-2` in both commands.

## Synchronization behavior

- The app saves locally first.
- The app supports direct email-and-password sign-in on the laptop and iPhone Home Screen app.
- Existing email-link users can set or change a password while signed in.
- A one-time email link remains available as a fallback.
- Signed-in devices synchronize through the `training_state` table.
- Each account can read and write only its own row through Row Level Security.
- When laptop and phone both changed, session records are merged using per-record modification times.
- A local conflict snapshot is kept in browser storage before a merge.
- JSON backup and restore remain available in Settings.

## Logger behavior

- Typing a load or rep does not rebuild the workout screen or remove input focus.
- Expanded exercise cards remain expanded during automatic saving and after set completion.
- Medicine Ball Chest Pass, Medicine Ball Rotational Throw, and Medicine Ball Slam include load and rep fields while retaining their throw-quality note field.
- A built-in guide explains tempo, straight sets, final RIR, load, reps, and basic logging.
- Loaded exercises no longer show a duplicate `load × reps` result field. The app calculates volume automatically from the separate load and rep entries.
