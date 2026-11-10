#!/bin/sh
set -eu
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"
gate_token=$(python3 -c 'import uuid; print(uuid.uuid4().hex)')
sdk="neighborhood-projection-web-sdk:$gate_token"
# Only the explicit SDK preparation acquires hash-locked npm artifacts.
docker build -f web/Dockerfile.prepare -t "$sdk" .
docker run --rm --pull=never --network none --user "$(id -u):$(id -g)" --cap-drop ALL --security-opt no-new-privileges --pids-limit 256 --memory 1g --cpus 2 --mount "type=bind,source=$project_dir,target=/work" --tmpfs /tmp:rw,exec,nosuid,nodev,size=512m --env HOME=/tmp -w /work "$sdk" node /opt/nps-web-gate.mjs all
