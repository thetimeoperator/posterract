-- Provenance for uploaded media: which composition produced this file.
--
-- A render leaves the desktop app knowing exactly what made it — the project,
-- the scene, and the revision of the TSX the encoder read. Without those on
-- the asset, the loop from a published post back to the composition that
-- produced it cannot be closed, and a creator has no way to ask "which edit
-- was this?" of a video that did well.
--
-- All nullable: assets uploaded before this, and any uploaded by an API client
-- that is not the desktop app, simply have no provenance to record.
alter table media_assets
  add column if not exists project_id text,
  add column if not exists scene_id text,
  add column if not exists source_revision text,
  add column if not exists cover_key text;

comment on column media_assets.project_id is
  'Posterract Desktop project id the render came from; null for uploads with no known origin.';
comment on column media_assets.scene_id is
  'Stable source id of the scene that was exported.';
comment on column media_assets.source_revision is
  'Content hash of the project source at export time, so the exact edit is recoverable.';
comment on column media_assets.cover_key is
  'R2 key of a chosen cover frame, when one has been selected.';

-- Looking up every render of one project is the query this exists for.
create index if not exists media_assets_project_idx
  on media_assets(workspace_id, project_id)
  where project_id is not null;
