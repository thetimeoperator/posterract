# Account-set typing and Vault deletion fixes

The account-set dialog passed a new `onClose` callback on every keystroke. The shared Modal initializes/restores focus whenever that callback changes, so typing moved focus onto Close (and a subsequent space could close the dialog). Portals now uses a stable callback. The shared Modal and desktop build were not changed.

The production media table contained two aborted uploads with `purged_at` set. Bootstrap excluded only status `purged`, so it returned those aborted entries as failed artifacts with no playable URL. DELETE excluded every row with `purged_at` set and returned `media_not_found`, leaving those cards stuck in the Vault.

Bootstrap now uses `loadVaultMedia`, which excludes aborted uploads, purged status, and any row already marked with `purged_at`. DELETE is idempotent for an absent or already-purged workspace asset. A missing R2 object (`NoSuchKey`/`NotFound`) does not block purging its library record. Workspace ownership and active scheduled/transmitting media protections remain enforced; storage permission, missing-bucket and service failures still return errors. The deletion transaction locks the asset to coordinate with post creation. No migration or manual deletion of customer media is needed.

Changed production files: `apps/web/src/routes/_app/portals.tsx`, `apps/api/src/server.js`, and new `apps/api/src/media.js`. No dependency changes.

Verification:

- Reproduced the original typing failure with real, delayed keyboard events before the fix.
- Three browser regressions passed using the actual HTTP engine with isolated API fixtures: type/create/edit/reload an account set; delete stale and missing-object Vault cards and verify they stay gone after reload; retain a card on a legitimate API rejection. The initial demo engine cannot save account sets, so the save/edit regression was moved to the HTTP engine fixture.
- Five existing product-loop browser tests passed.
- Nineteen API/domain/schema checks passed, including real SQL via PGlite for listing, missing records, missing storage objects, repeat deletion, active posts, workspace boundaries, permissions and storage failures.
- Web TypeScript check and production build, API syntax checks, and whitespace check passed.
- Tests did not publish social posts or delete live customer media.

Logs: `/tmp/posterract-account-set-repro.log`, `/tmp/posterract-account-vault-regressions.log`, `/tmp/posterract-account-vault-api-checks.log`, `/tmp/posterract-account-vault-typecheck.log`, `/tmp/posterract-account-vault-build.log`, `/tmp/posterract-account-vault-deploy.log`.

Deployed to the VPS after a three-file targeted dry-run. Backup of replaced files: `/srv/posterract/backups/account-set-vault-before-fixes-20260916.tar.gz`. Rebuilt/recreated only API and web. Both containers are healthy; readiness reports postgres, redis, elasticsearch, temporal and R2 OK. Source checksum comparison shows no differences for the release files. Public entry `index-OWVT46Dx.js` loads `portals-kK2AGobG.js`; the fetched public asset matches the running container's SHA-256 and contains the stable callback implementation.

A read-only check inside the deployed API container exercised `loadVaultMedia` against production: one valid Vault asset remains visible, and both previously visible aborted/purged placeholders are excluded. No customer file was manually removed. No desktop release, GitHub commit/push, or cache rule changes.
