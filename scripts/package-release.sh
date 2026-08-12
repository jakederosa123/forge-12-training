#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
release_dir="${project_root}/release"
archive="${release_dir}/hypertrophy-training-system.zip"

mkdir -p "${release_dir}"
rm -f "${archive}"

cd "${project_root}/.."
zip -rq "${archive}" "hypertrophy-training-system" \
  -x "hypertrophy-training-system/node_modules/*" \
     "hypertrophy-training-system/.git/*" \
     "hypertrophy-training-system/.sites-runtime/*" \
     "hypertrophy-training-system/.wrangler/*" \
     "hypertrophy-training-system/dist/*" \
     "hypertrophy-training-system/release/*" \
     "hypertrophy-training-system/.next/*"

echo "Created ${archive}"

