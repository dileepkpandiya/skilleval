#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "Missing ANTHROPIC_API_KEY" >&2
  exit 2
fi

if [[ -z "${GEMINI_API_KEY:-}" ]]; then
  echo "Missing GEMINI_API_KEY" >&2
  exit 2
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

tasks_file="$tmpdir/gemini-reliability-tasks.yaml"
cat > "$tasks_file" <<'YAML'
tasks:
  - id: task-003
    skillTarget: api-design
    prompt: "How should I design a bulk user import API that can partially fail?"
    context: "Public REST API, enterprise customers, needs retry safety and auditability."
  - id: task-004
    skillTarget: api-design
    prompt: "How should I version a breaking API change without deprecating v1 immediately?"
    context: "Existing customers rely on v1. We need a migration path that minimizes surprises."
YAML

skipped=0
total=0

for run in $(seq 1 10); do
  output_file="$tmpdir/run-$run.json"
  npx ts-node src/cli.ts ./samples/api-design \
    --tasks "$tasks_file" \
    --judge-provider gemini-flash \
    --json > "$output_file"

  read -r run_total run_skipped < <(node -e "
const fs = require('fs');
const text = fs.readFileSync(process.argv[1], 'utf8');
const start = text.indexOf('{');
const end = text.lastIndexOf('}');
const report = JSON.parse(text.slice(start, end + 1));
process.stdout.write(String(report.totalTasks) + ' ' + String(report.tasksSkipped ?? 0));
" "$output_file")

  total=$((total + run_total))
  skipped=$((skipped + run_skipped))
  echo "run $run: skipped $run_skipped / $run_total"
done

echo "total skipped: $skipped / $total"

if (( skipped * 10 >= total )); then
  echo "Gemini reliability check failed: skip rate is not below 10%" >&2
  exit 1
fi

echo "Gemini reliability check passed: skip rate below 10%"
