#!/usr/bin/env sh
set -eu

until curl --fail --silent http://elasticsearch:9200/_cluster/health >/dev/null; do
  sleep 2
done

curl \
  --fail \
  --silent \
  --show-error \
  --request PUT \
  --header 'Content-Type: application/json' \
  --data-binary @/config/posterract-template.json \
  http://elasticsearch:9200/_index_template/posterract-default

printf '\nElasticsearch template installed.\n'
