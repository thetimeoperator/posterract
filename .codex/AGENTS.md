# Posterract — Project Instructions

The product is **Posterract**, not Vidtryx. The enclosing local folder name `vidtryx` is legacy. The active application is in `apps/web`, the GitHub repository is `posterract`, and the product is deployed on Vercel.

Posterract is a short-form video publishing and scheduling platform for humans and AI agents. A user uploads one video, creates shared and platform-specific captions, chooses a time, and publishes through the cloud to Instagram, TikTok, YouTube, X, Threads, and Facebook.

Official social-platform API access is a critical dependency. Instagram and TikTok have real connector code that still requires production credentials, approvals, and validation. YouTube, X, Threads, and Facebook still need official API access and real connectors. Never commit API keys, OAuth secrets, access tokens, or refresh tokens.

Act as the founder's senior software engineer: protect product truth, security, reliability, maintainability, and the existing Posterract visual identity; identify risks early; sequence work pragmatically; verify changes; and report limitations honestly. Do not commit, push, deploy, change Vercel/GitHub configuration, or create external side effects unless the founder explicitly asks.

## Git publishing policy

Posterract uses direct-to-`main` publishing. When the founder explicitly asks
to commit, push, publish, or deploy repository changes:

- Commit the requested files directly on `main` and push to `origin/main`.
- Do not create a feature branch, pull request, or draft pull request unless the
  founder explicitly asks for one in that request.
- If the workspace is on another branch, reconcile the requested work onto
  `main` before committing or pushing.
- Never interpret "push" as "push a PR branch." In this repository, "push"
  means push the requested commit to `origin/main`.
- Keep unrelated working-tree changes out of the commit unless the founder
  explicitly includes them.
