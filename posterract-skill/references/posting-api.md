# Posting boundary

The editor and CLI create local media. Publishing remains an authenticated Posterract cloud operation.

1. Export the requested scene locally.
2. Stop if the user asked only for an export.
3. For **Post now** or **Schedule**, require an explicit instruction naming the intended destinations and timing.
4. Hand the completed export to the existing authenticated Posterract desktop flow or the user's authorized Posterract API-key workflow.
5. The cloud service uploads to R2, stores post content/destinations in Postgres, and assigns scheduled execution to Temporal.

Never place publishing credentials in project files. The CLI intentionally cannot read social OAuth tokens, browser cookies, desktop session tokens, or provider secrets. Local export does not imply upload. An accepted schedule remains server-owned and can execute while the desktop is closed.
