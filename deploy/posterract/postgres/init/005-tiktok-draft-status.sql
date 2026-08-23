-- TikTok Upload sends media to the creator's inbox for final review/posting.
-- Represent that state explicitly instead of falsely reporting the media live.

alter table projections
  drop constraint if exists projections_status_check;

alter table projections
  add constraint projections_status_check check (
    status in (
      'pending', 'scheduled', 'uploading', 'publishing', 'processing',
      'awaiting_user', 'live', 'failed', 'retrying', 'needs_reauth',
      'blocked', 'canceled'
    )
  );

alter table transmissions
  drop constraint if exists transmissions_status_check;

alter table transmissions
  add constraint transmissions_status_check check (
    status in (
      'draft', 'scheduled', 'transmitting', 'awaiting_user', 'live',
      'partial', 'failed', 'canceled'
    )
  );
