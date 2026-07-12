#!/bin/bash
set -e

SKILL="./samples/api-design"
TASKS="./tasks/sample-tasks.yaml"
CLI="node dist/cli.js"
PASS=0
FAIL=0

log_pass() { echo "✅ $1"; PASS=$((PASS+1)); }
log_fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }

export ANTHROPIC_API_KEY_BACKUP="${ANTHROPIC_API_KEY_BACKUP:-${ANTHROPIC_API_KEY}}"
export GEMINI_API_KEY_BACKUP="${GEMINI_API_KEY_BACKUP:-${GEMINI_API_KEY:-${GOOGLE_API_KEY}}}"

cleanup() {
  [ -f /tmp/skilleval-judge.ts.bak ] && cp /tmp/skilleval-judge.ts.bak src/judge.ts
  [ -f ${TASKS}.bak ] && cp ${TASKS}.bak $TASKS && rm -f ${TASKS}.bak
  [ -f skilleval.config.json.sprint1-bak ] && mv skilleval.config.json.sprint1-bak skilleval.config.json
}
trap cleanup EXIT

if [ -f skilleval.config.json ]; then
  mv skilleval.config.json skilleval.config.json.sprint1-bak
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  SPRINT 1 — FULL INTEGRATION TEST"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo ""
echo "── Block A: Build + Unit Tests ──"

npm run build 2>&1 && log_pass "TypeScript build" || log_fail "TypeScript build"
npm test 2>&1 && log_pass "All unit tests pass" || log_fail "Unit tests"

unset ANTHROPIC_API_KEY GEMINI_API_KEY OPENAI_API_KEY
npm test 2>&1 && log_pass "Unit tests pass without API keys" \
  || log_fail "Unit tests require API keys (bad)"
export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY_BACKUP}"
export GEMINI_API_KEY="${GEMINI_API_KEY_BACKUP}"

cp src/judge.ts /tmp/skilleval-judge.ts.bak
perl -0pi -e 's/\(3 \+ clamped\) \/ 2/(3 + clamped) \/ 3/' src/judge.ts
npm run build 2>/dev/null
npm test 2>&1 | grep -q "failed" \
  && log_pass "Mutation test: wrong formula caught by tests" \
  || log_fail "Mutation test: tests did NOT catch wrong formula"
cp /tmp/skilleval-judge.ts.bak src/judge.ts
npm run build 2>/dev/null

echo ""
echo "── Block B: Confidence Label Fix ──"

export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-${ANTHROPIC_API_KEY_BACKUP}}"
export GEMINI_API_KEY="${GEMINI_API_KEY:-${GEMINI_API_KEY_BACKUP:-${GOOGLE_API_KEY}}}"

OUTPUT=$($CLI $SKILL --tasks $TASKS 2>&1 || true)
echo "$OUTPUT" | grep -qi "UNRATED" \
  && log_pass "--runs 1 shows UNRATED" \
  || log_fail "--runs 1 does NOT show UNRATED"
echo "$OUTPUT" | grep -qi "runs 3" \
  && log_pass "--runs 1 shows --runs 3+ hint" \
  || log_fail "--runs 1 missing --runs 3+ hint"

OUTPUT=$($CLI $SKILL --tasks $TASKS --runs 3 2>&1 || true)
echo "$OUTPUT" | grep -qi "UNRATED" \
  && log_fail "--runs 3 incorrectly shows UNRATED" \
  || log_pass "--runs 3 shows no UNRATED"
echo "$OUTPUT" | grep -qiE "HIGH|MEDIUM|LOW" \
  && log_pass "--runs 3 shows HIGH/MEDIUM/LOW" \
  || log_fail "--runs 3 missing real confidence label"

JSON=$($CLI $SKILL --tasks $TASKS --json 2>/dev/null || true)
echo "$JSON" | jq -e '[.results[].confidence] | all(. == "UNRATED")' \
  > /dev/null 2>&1 \
  && log_pass "--json --runs 1 all confidence = UNRATED" \
  || log_fail "--json --runs 1 confidence != UNRATED"

JSON=$($CLI $SKILL --tasks $TASKS --runs 3 --json 2>/dev/null || true)
echo "$JSON" | jq -e '[.results[].confidence] | all(. != "UNRATED")' \
  > /dev/null 2>&1 \
  && log_pass "--json --runs 3 no UNRATED confidence" \
  || log_fail "--json --runs 3 has UNRATED (wrong)"

echo ""
echo "── Block C: Per-Task Assertions ──"

cp $TASKS ${TASKS}.bak

node - <<'EOF'
const fs = require('node:fs');
const yaml = require('js-yaml');
const path = 'tasks/sample-tasks.yaml';
const data = yaml.load(fs.readFileSync(path, 'utf8'));
const task = data.tasks.find((item) => item.skillTarget === 'api-design');
task.assertions = { must_contain: ['INTENTIONAL_FAIL_STRING_XYZ'] };
fs.writeFileSync(path, yaml.dump(data), 'utf8');
EOF

OUTPUT=$($CLI $SKILL --tasks $TASKS 2>&1 || true)
echo "$OUTPUT" | grep -qi "INTENTIONAL_FAIL" \
  && log_pass "Failing assertion message printed" \
  || log_fail "Failing assertion message NOT printed"

JSON=$($CLI $SKILL --tasks $TASKS --json 2>/dev/null || true)
echo "$JSON" | jq -e '.results[0].assertionsPassed == false' \
  > /dev/null 2>&1 \
  && log_pass "JSON assertionsPassed=false for failing task" \
  || log_fail "JSON assertionsPassed not false"
echo "$JSON" | jq -e '.results[0].diff <= -0.5' \
  > /dev/null 2>&1 \
  && log_pass "Failing assertion forces diff <= -0.5" \
  || log_fail "Failing assertion did NOT force negative diff"

node - <<'EOF'
const fs = require('node:fs');
const yaml = require('js-yaml');
const path = 'tasks/sample-tasks.yaml';
const data = yaml.load(fs.readFileSync(path, 'utf8'));
const task = data.tasks.find((item) => item.skillTarget === 'api-design');
task.assertions = { min_length: 5 };
fs.writeFileSync(path, yaml.dump(data), 'utf8');
EOF

JSON=$($CLI $SKILL --tasks $TASKS --json 2>/dev/null || true)
echo "$JSON" | jq -e '.results[0].assertionsPassed == true' \
  > /dev/null 2>&1 \
  && log_pass "Passing assertion assertionsPassed=true" \
  || log_fail "Passing assertion assertionsPassed not true"

cp ${TASKS}.bak $TASKS

node - <<'EOF'
const fs = require('node:fs');
const yaml = require('js-yaml');
const path = 'tasks/sample-tasks.yaml';
const data = yaml.load(fs.readFileSync(path, 'utf8'));
for (const task of data.tasks) delete task.assertions;
fs.writeFileSync(path, yaml.dump(data), 'utf8');
EOF

JSON=$($CLI $SKILL --tasks $TASKS --json 2>/dev/null || true)
echo "$JSON" | jq -e '[.results[].assertionsPassed] | all(. == null)' \
  > /dev/null 2>&1 \
  && log_pass "Backward compat: no assertions omit assertion fields" \
  || log_fail "Backward compat: assertion fields present without assertions"
echo "$JSON" | jq -e '[.results[].assertionFailures] | all(. == null)' \
  > /dev/null 2>&1 \
  && log_pass "Backward compat: no assertions omit failure fields" \
  || log_fail "Backward compat: assertion failure fields present without assertions"

cp ${TASKS}.bak $TASKS
rm -f ${TASKS}.bak

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  RESULTS: ✅ $PASS passed   ❌ $FAIL failed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

[ $FAIL -eq 0 ] && exit 0 || exit 1
