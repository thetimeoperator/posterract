# Asset paths and fonts

`assets.yml` is the readable asset manifest. Project assets live under `assets/video`, `assets/audio`, `assets/images`, or `assets/generated`. Absolute local paths and temporary URLs may be used only when the user has explicitly granted access.

Imported assets stay local. Cache artifacts live under `.posterract/cache` and are regenerable. Use `posterract fonts --json` for available local family names. Exported files upload only after an explicit Post now or Schedule action.
