#!/usr/bin/env bash
set -euo pipefail

deployment_root="${1:-/srv/posterract}"
frontend_env="${2:-$deployment_root/frontend.env}"
target_env="$deployment_root/.env"

if [[ -f "$target_env" ]]; then
  echo "Existing $target_env preserved."
  exit 0
fi

if [[ ! -f "$frontend_env" ]]; then
  echo "Missing frontend environment file: $frontend_env" >&2
  exit 1
fi

env_value() {
  local key="$1"
  awk -F= -v key="$key" '$1 == key {sub(/^[^=]*=/, ""); print; exit}' "$frontend_env"
}

random_hex() {
  openssl rand -hex "$1"
}

umask 077
{
  printf 'POSTGRES_DB=posterract\n'
  printf 'POSTGRES_USER=posterract\n'
  printf 'POSTGRES_PASSWORD=%s\n' "$(random_hex 24)"
  printf 'TEMPORAL_POSTGRES_USER=temporal\n'
  printf 'TEMPORAL_POSTGRES_PASSWORD=%s\n' "$(random_hex 24)"
  printf 'REDIS_PASSWORD=%s\n' "$(random_hex 24)"
  printf 'INTERNAL_API_KEY=%s\n' "$(random_hex 32)"
  printf 'TOKEN_ENCRYPTION_KEY=%s\n' "$(random_hex 32)"
  printf 'BETTER_AUTH_SECRET=%s\n' "$(random_hex 32)"
  printf 'BETTER_AUTH_URL=https://www.posterract.app\n'
  printf 'PUBLIC_API_URL=https://www.posterract.app/api\n'
  printf 'TRUSTED_ORIGINS=\n'
  printf 'VITE_CONVEX_URL=%s\n' "$(env_value VITE_CONVEX_URL)"
  printf 'VITE_CONVEX_SITE_URL=%s\n' "$(env_value VITE_CONVEX_SITE_URL)"
  printf 'VITE_API_URL=/api\n'
  printf 'VITE_SITE_URL=%s\n' "$(env_value VITE_SITE_URL)"
  printf 'TAILSCALE_IP=100.93.122.0\n'
  printf 'R2_ACCOUNT_ID=\n'
  printf 'R2_ENDPOINT=\n'
  printf 'R2_REGION=auto\n'
  printf 'R2_ACCESS_KEY_ID=\n'
  printf 'R2_SECRET_ACCESS_KEY=\n'
  printf 'R2_BUCKET=posterract\n'
  printf 'INSTAGRAM_APP_ID=\n'
  printf 'INSTAGRAM_APP_SECRET=\n'
  printf 'FACEBOOK_APP_ID=\n'
  printf 'FACEBOOK_APP_SECRET=\n'
  printf 'THREADS_APP_ID=\n'
  printf 'THREADS_APP_SECRET=\n'
  printf 'TIKTOK_CLIENT_KEY=\n'
  printf 'TIKTOK_CLIENT_SECRET=\n'
  printf 'YOUTUBE_CLIENT_ID=\n'
  printf 'YOUTUBE_CLIENT_SECRET=\n'
  printf 'GOOGLE_AUTH_CLIENT_ID=\n'
  printf 'GOOGLE_AUTH_CLIENT_SECRET=\n'
  printf 'RESEND_API_KEY=\n'
  printf 'RESEND_FROM_EMAIL="Posterract <security@posterract.app>"\n'
} >"$target_env"

chmod 600 "$target_env"
echo "Created $target_env with generated service credentials."
