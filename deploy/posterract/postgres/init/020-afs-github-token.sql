-- ============================================================================
-- GitHub connect no longer goes through the login provider: the site runs the
-- OAuth dance itself and hands the Hub the member's token, which the Hub keeps
-- so it can re-read the contribution calendar later.
--
-- The column holds AES-256-GCM ciphertext (see apps/hub/src/github-token.js);
-- the key is AFS_GITHUB_TOKEN_KEY in the Hub's environment and never in here.
-- Nothing outside the Hub selects it — accounts.js and every person-shaped
-- query name their columns.
-- ============================================================================

alter table afs.profiles
  add column if not exists github_token_enc bytea;

comment on column afs.profiles.github_token_enc is
  'AES-256-GCM sealed GitHub OAuth token: iv(12) || tag(16) || ciphertext. Key lives only in the Hub env.';
