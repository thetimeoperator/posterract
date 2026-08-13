#!/usr/bin/env sh
set -eu

until temporal operator cluster health --address temporal:7233 >/dev/null 2>&1; do
  sleep 2
done

namespace="${TEMPORAL_NAMESPACE:-posterract}"

temporal operator namespace describe \
  --address temporal:7233 \
  --namespace "$namespace" >/dev/null 2>&1 ||
  temporal operator namespace create \
    --address temporal:7233 \
    --namespace "$namespace" \
    --retention 168h

until temporal operator namespace describe \
  --address temporal:7233 \
  --namespace "$namespace" >/dev/null 2>&1; do
  sleep 2
done

for attribute in workspaceId transmissionId projectionId provider; do
  if ! temporal operator search-attribute list \
    --address temporal:7233 \
    --namespace "$namespace" | grep -q "^[[:space:]]*$attribute[[:space:]]"; then
    temporal operator search-attribute create \
      --address temporal:7233 \
      --namespace "$namespace" \
      --name "$attribute" \
      --type Keyword
  fi
done

echo "Temporal search attributes are ready."
