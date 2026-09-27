# Windows release 0.2.2 — September 7, 2026

Published Windows x64 installer:
[Posterract-Setup.exe](https://www.posterract.app/releases/0.2.2/Posterract-Setup.exe).

The asset importer now recognizes Windows backslashes when extracting filenames.
Importing a file from Downloads creates a project-relative asset destination,
without embedding the drive and source directory in the destination.

## Verification

- Six import regression tests passed, including Windows drive paths, UNC shares,
  mixed separators, POSIX paths, deduplication, and destination collisions.
- Asset package and desktop TypeScript checks passed. The desktop editor build passed.
- Rebuilding the editor with the pre-fix implementation reproduced all 28 editor
  files from the 0.2.1 release byte for byte. The new release changes the editor
  import code and package metadata; existing release functionality is preserved.
- Built Windows x64 with the existing isolated Forge/Wine packaging environment.
- Extracted the finished installer and verified all 301 payload files, version
  0.2.2, and the Windows x64 esbuild 0.28.2 executable. Four Windows/POSIX filename
  cases passed against the compiled helper extracted from the installer itself.
- Public installer download matched SHA-256
  `74e8a99e614b90f5e9519040ca132730f55b2577148635edf83866e2fa3a4741`.
- Installer size: 164,258,304 bytes.
- Native Windows manual UI testing was not available.

## Publication

- Updated the Windows download URL in the VPS environment, rebuilt the web image,
  and recreated only the web service. The web container is healthy and readiness
  reports all backing services healthy.
- Removed superseded Windows installers, extracted Windows packages, and obsolete
  Windows entries from release metadata. The current Mac/Linux downloads remain.
- No Windows download redirects or legacy aliases were retained. Retired Windows
  download URLs return HTTP 404 at the origin. The new installer returns HTTP 200.
- Public website download components were fetched and verified to contain only the
  new Windows URL. Public checks from Phoenix returned 404 for all retired URLs;
  the Cloudflare IAD cache still served the removed 0.2.1 file. A subsequent VPS
  credential audit found R2 credentials and an active tunnel API token in
  `/root/.cloudflared/cert.pem`. Token verification succeeded, but listing the
  accessible zones returned none and the targeted purge request was rejected
  with Cloudflare error `10000: Authentication error`. That credential did not
  authorize purging the remaining cached copy.
- No Git commit or push was made.

Release records and verification scripts are in `apps/desktop/out/release-0.2.2`
locally and `/srv/posterract/builds/desktop-0.2.2` on the VPS. Published files are in
`/srv/posterract/releases/desktop/0.2.2` and `/srv/posterract/downloads/0.2.2`.
