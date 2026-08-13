#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"

python=${DEVORBIT_PILOT_PYTHON:-/usr/bin/python3.10}
work=${DEVORBIT_PILOT_WORKDIR:-/tmp/devorbit-public-pilot-sqlfluff-884}
archive="$work/source.tar.gz"
source="$work/source"
deps="$work/deps"
base='c0bad78f3fa9549591738c77f869724f721e6830'
archive_sha='8484d90c290fc06b8c331991605300a692266a6f71536d1cf1612e4dca8c4fbb'
expected_assertion='assert raw_seg.is_whitespace'

rm -rf "$work"
mkdir -p "$source" "$deps"
curl --noproxy '*' -fL --retry 3 --retry-all-errors --connect-timeout 15 --max-time 180 \
  -o "$archive" "https://codeload.github.com/sqlfluff/sqlfluff/tar.gz/$base"
echo "$archive_sha  $archive" | sha256sum -c -
tar -xzf "$archive" -C "$source" --strip-components=1
echo '6d1e394d2e68a47106733103e9ed87c9d1573d9b7a43f5d05989424fce6dae39  '"$source/"'LICENSE.md' | sha256sum -c -

"$python" -m pip install --disable-pip-version-check --no-input --no-deps --target "$deps" \
  -r evaluation/public-pilot/sqlfluff__sqlfluff-884/requirements.lock
(
  cd "$source"
  PYTHONNOUSERSITE=1 PYTHONPATH="$deps" "$python" -m pip install --disable-pip-version-check --no-input --no-deps --no-build-isolation --target "$deps" .
  git init -q
  git add .
  git -c user.name=DevOrbit -c user.email=devorbit@localhost commit -qm base
  git apply "$root/evaluation/public-pilot/sqlfluff__sqlfluff-884/test.patch"
  set +e
  PYTHONNOUSERSITE=1 PYTHONPATH="$deps" "$python" -m pytest -q \
    test/core/dialects/ansi_test.py::test__dialect__ansi_is_whitespace > "$work/baseline.log" 2>&1
  status=$?
  set -e
  [[ "$status" == 1 ]] || { cat "$work/baseline.log"; echo "FAIL expected pytest exit 1, received $status"; exit 1; }
  grep -Fq "$expected_assertion" "$work/baseline.log" || { cat "$work/baseline.log"; echo 'FAIL expected defect assertion was not reproduced'; exit 1; }
)

echo 'PASS public pilot baseline: exact FAIL_TO_PASS assertion reproduced; no gold patch accessed'
