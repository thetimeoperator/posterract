-- Transcription is metered in minutes rather than credits.
--
-- At Qwen's $0.000035/second it costs about 13 cents an hour, so a subscriber
-- who uses a whole cycle's allowance costs us a quarter of a dollar. Charging
-- credits for that means a caption job can fail for want of a resource worth
-- pennies — on the feature that makes short-form video work at all. A flat
-- per-cycle allowance keeps the cost bounded without ever making the user do
-- arithmetic to caption a video.
--
-- Usage resets with the credit cycle, in the same grant that resets balances.

alter table workspace_credits
  add column if not exists transcribe_seconds_used integer not null default 0;
