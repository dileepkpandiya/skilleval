#!/usr/bin/env bash
set -euo pipefail

# Terminal demo script intended for vhs/asciinema recording.
# Run from the repo root.
# Requires ANTHROPIC_API_KEY and GOOGLE_API_KEY.

skilleval ./samples/code-review --cost
skilleval ./samples/code-review --tasks ./tasks/sample-tasks.yaml
skilleval ./samples/code-review --json > results.json
cat results.json
