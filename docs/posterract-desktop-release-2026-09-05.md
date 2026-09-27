# Desktop release 0.2.1 — September 5, 2026

This release contains the editor updates and the original animated **New post** button, restored from the previous calendar header and explicitly approved in the preview. Do not replace that button without a new request.

## Distribution

- Installed Mac app: `/Applications/Posterract.app`, version `0.2.1`.
- Public release directory: `https://www.posterract.app/releases/0.2.1/`.
- Files: `Posterract-arm64.dmg`, `Posterract-Setup.exe`, `Posterract-x86_64.AppImage`, `posterract_amd64.deb`.
- Release metadata: `manifest.json` and `SHA256SUMS` in that directory.
- VPS release files: `/srv/posterract/releases/desktop/0.2.1`.
- Previous packages retained as requested: `/srv/posterract/releases/desktop/pre-0.2.0-20260905` and the `0.2.0` release directory.
- Previous installed Mac apps retained under `apps/desktop/out/previous-installed-0.1.0` and `previous-installed-0.2.0`.
- The four download URL variables in `/srv/posterract/.env` point to `0.2.1`; other environment values were preserved.
- No Git commit or push was made. Production remains on the VPS Docker Compose stack.

## Validation

- Full desktop compilation and type checks passed.
- Each extracted Windows installer, Linux AppImage, and Debian package contains the same 297 release code files as the Mac app, verified by SHA-256, and app version `0.2.1`.
- Bundled compilers match esbuild `0.28.2` for each target OS/architecture. Linux TSX compilation passed; the same Windows compiler binary was also exercised with Wine during release preparation.
- Mac app and signed DMG passed Apple notarization/stapling. Gatekeeper accepted the DMG as a Notarized Developer ID release.
- Installed Mac app opened successfully; the original calendar header/button appeared, and all 13 packaged CLI doctor checks passed (no project was open, so project-specific checks were skipped).
- Native Windows/Linux manual desktop UI sessions were not available; their installer contents and compiler binaries were checked.

## Packaging notes

Windows/Linux packaging used a resource-limited Docker container with the existing Forge versions and target-specific esbuild binaries. An ancestor lockfile is required for Forge to locate Electron when sharing the builder's node_modules directory.

The DMG wrapper must be signed as well as the app. Forge maker overrides replace maker configuration, so pass signing options explicitly when overriding the DMG maker. The repository configuration now includes DMG signing options.

For a disk-image-only Mac distribution, Apple's documented workflow permits notarizing the outermost signed container; the nested app receives a ticket too. See [Apple's distribution packaging documentation](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution). The final 0.2.1 DMG and local app were both stapled.
