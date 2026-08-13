#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
/usr/bin/python3 "$root/scripts/build_supporting_pdfs.py"
