# Posterract repository rules

- The product is Posterract; `vidtryx` is only the legacy local folder name.
- Production is the Docker Compose stack on the VPS. **Never deploy Posterract to Vercel.**
- SSH: `root@100.93.122.0`
- Live source: `/srv/posterract/source`
- Environment: `/srv/posterract/.env`
- Compose file: `/srv/posterract/source/deploy/posterract/compose.yaml`
- Preserve secrets and unrelated working-tree changes. Never sync `.env*`, credentials, `.git`, `node_modules`, build output, or unrelated deleted/untracked files.
- Do not commit or push GitHub unless the founder explicitly asks.

For a web-only production deploy, verify locally, dry-run the targeted sync, sync the approved web source/package files to `/srv/posterract/source`, then run on the VPS:

```bash
cd /srv/posterract/source
docker compose --env-file /srv/posterract/.env -f deploy/posterract/compose.yaml build web
docker compose --env-file /srv/posterract/.env -f deploy/posterract/compose.yaml up -d --no-deps web
docker compose --env-file /srv/posterract/.env -f deploy/posterract/compose.yaml ps web
curl -fsS http://127.0.0.1:3000/health/ready
```

Rebuild only the affected services (`web`, `api`, or `orchestrator`) and report production health honestly.
