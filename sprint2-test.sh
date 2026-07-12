#!/bin/bash

SKILL="./samples/api-design"
TASKS="./tasks/sample-tasks.yaml"
CLI="node dist/cli.js"
PASS=0
FAIL=0

log_pass() { echo "✅ $1"; PASS=$((PASS+1)); }
log_fail() { echo "❌ $1"; FAIL=$((FAIL+1)); }

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  SPRINT 2 — FULL INTEGRATION TEST"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# PRE-FLIGHT
echo ""
echo "── Pre-flight ──"
npm install 2>&1 | tail -1
npm run build 2>&1 \
  && log_pass "TypeScript build" \
  || { log_fail "TypeScript build"; exit 1; }
npm test 2>&1 \
  && log_pass "All unit tests pass" \
  || log_fail "Unit tests"

# BLOCK A: GitHub Action
echo ""
echo "── Block A: GitHub Action ──"

[ -f "action.yml" ] \
  && log_pass "action.yml exists at repo root" \
  || log_fail "action.yml NOT found at repo root"

grep -q "name: skilleval" action.yml 2>/dev/null \
  && log_pass "action.yml has name field" \
  || log_fail "action.yml missing name field"

grep -q "skill-path" action.yml 2>/dev/null \
  && log_pass "action.yml has skill-path input" \
  || log_fail "action.yml missing skill-path input"

grep -q "anthropic-api-key" action.yml 2>/dev/null \
  && log_pass "action.yml has anthropic-api-key input" \
  || log_fail "action.yml missing anthropic-api-key input"

grep -q "avg-diff" action.yml 2>/dev/null \
  && log_pass "action.yml has avg-diff output" \
  || log_fail "action.yml missing avg-diff output"

grep -q "using: composite" action.yml 2>/dev/null \
  && log_pass "action.yml is composite action" \
  || log_fail "action.yml is not composite action"

[ -f ".github/workflows/skilleval-example.yml" ] \
  && log_pass "skilleval-example.yml exists" \
  || log_fail "skilleval-example.yml NOT found"

grep -q "uses: dileepkpandiya/skilleval" \
  .github/workflows/skilleval-example.yml 2>/dev/null \
  && log_pass "Example workflow references action" \
  || log_fail "Example workflow missing action reference"

grep -q "pull_request" \
  .github/workflows/skilleval-example.yml 2>/dev/null \
  && log_pass "Example workflow triggers on pull_request" \
  || log_fail "Example workflow missing pull_request trigger"

grep -q "CI Usage" README.md 2>/dev/null \
  && log_pass "README has CI Usage section" \
  || log_fail "README missing CI Usage section"

grep -q "uses: dileepkpandiya/skilleval" README.md 2>/dev/null \
  && log_pass "README shows action usage example" \
  || log_fail "README missing action usage example"

# BLOCK B: History + Diff
echo ""
echo "── Block B: History + Diff ──"

rm -rf .skilleval/

node - <<'NODE'
const { saveHistory } = require('./dist/history.js');
saveHistory({
  skillName: 'api-design',
  model: 'mock-runner',
  judgeModel: 'mock-judge',
  totalTasks: 2,
  avgDiff: 0.4,
  tasksImproved: 1,
  tasksHurt: 0,
  tasksNeutral: 1,
  tasksSkipped: 0,
  overallConfidence: 'UNRATED',
  results: [
    { taskId: 'task-001', status: 'scored', diff: 0.5, confidence: 'UNRATED', reasoning: 'mock' },
    { taskId: 'task-002', status: 'scored', diff: 0.3, confidence: 'UNRATED', reasoning: 'mock' },
  ],
  estimatedCost: 0,
  runs: 1,
}, '.skilleval/history');
NODE
HISTORY_COUNT=$(ls .skilleval/history/*.json 2>/dev/null | wc -l | tr -d ' ')
[ "$HISTORY_COUNT" -ge "1" ] \
  && log_pass "First run created history file" \
  || log_fail "First run did NOT create history file"

HISTORY_FILE=$(ls .skilleval/history/*.json 2>/dev/null | head -1)
cat "$HISTORY_FILE" | jq -e '.skillName' > /dev/null 2>&1 \
  && log_pass "History file has skillName" \
  || log_fail "History file missing skillName"

cat "$HISTORY_FILE" | jq -e '.avgDiff' > /dev/null 2>&1 \
  && log_pass "History file has avgDiff" \
  || log_fail "History file missing avgDiff"

cat "$HISTORY_FILE" | jq -e '.timestamp' > /dev/null 2>&1 \
  && log_pass "History file has timestamp" \
  || log_fail "History file missing timestamp"

cat "$HISTORY_FILE" | jq -e '.taskResults' > /dev/null 2>&1 \
  && log_pass "History file has taskResults" \
  || log_fail "History file missing taskResults"

DIFF_OUT=$($CLI diff $SKILL 2>&1 || true)
echo "$DIFF_OUT" | grep -qiE "not enough|at least twice" \
  && log_pass "diff with 1 entry shows not-enough message" \
  || log_fail "diff with 1 entry missing not-enough message"

sleep 1
node - <<'NODE'
const { saveHistory } = require('./dist/history.js');
saveHistory({
  skillName: 'api-design',
  model: 'mock-runner',
  judgeModel: 'mock-judge',
  totalTasks: 2,
  avgDiff: 0.9,
  tasksImproved: 2,
  tasksHurt: 0,
  tasksNeutral: 0,
  tasksSkipped: 0,
  overallConfidence: 'HIGH',
  results: [
    { taskId: 'task-001', status: 'scored', diff: 1.0, confidence: 'HIGH', reasoning: 'mock' },
    { taskId: 'task-002', status: 'scored', diff: 0.8, confidence: 'HIGH', reasoning: 'mock' },
  ],
  estimatedCost: 0,
  runs: 3,
}, '.skilleval/history');
NODE
HISTORY_COUNT=$(ls .skilleval/history/*.json 2>/dev/null | wc -l | tr -d ' ')
[ "$HISTORY_COUNT" -ge "2" ] \
  && log_pass "Second run created second history file" \
  || log_fail "Second run did NOT create second history file"

DIFF_OUT=$($CLI diff $SKILL 2>&1)
echo "$DIFF_OUT" | grep -qiE "vs|previous|effectiveness" \
  && log_pass "diff with 2 entries shows comparison" \
  || log_fail "diff with 2 entries missing comparison output"

rm -rf .skilleval/
$CLI --help | grep -q -- "--no-history" > /dev/null 2>&1
HISTORY_COUNT=$(ls .skilleval/history/*.json 2>/dev/null | wc -l | tr -d ' ')
[ "$HISTORY_COUNT" -eq "0" ] \
  && log_pass "--no-history suppresses file creation" \
  || log_fail "--no-history did NOT suppress file creation"

grep -q ".skilleval" .gitignore 2>/dev/null \
  && log_pass ".skilleval/ is in .gitignore" \
  || log_fail ".skilleval/ NOT in .gitignore"

grep -qi "history\|diff" README.md 2>/dev/null \
  && log_pass "README has History & Diff section" \
  || log_fail "README missing History & Diff section"

rm -rf .skilleval/

# BLOCK C: Skill vs Skill Compare
echo ""
echo "── Block C: Skill vs Skill Compare ──"

cp -r ./samples/api-design ./samples/api-design-v2
echo "" >> ./samples/api-design-v2/SKILL.md
echo "## v2 Addition" >> ./samples/api-design-v2/SKILL.md
echo "Always include versioning strategy." >> ./samples/api-design-v2/SKILL.md

COMPARE_OUT=$(node - <<'NODE'
const { printCompareReport } = require('./dist/judge.js');
printCompareReport({
  skillAName: 'api-design',
  skillBName: 'api-design-v2',
  model: 'mock-runner',
  judgeModel: 'mock-judge',
  totalTasks: 1,
  avgDiff: 1.0,
  tasksAWon: 0,
  tasksBWon: 1,
  tasksNeutral: 0,
  overallWinner: 'B',
  results: [
    {
      taskId: 'task-001',
      skillAScore: 1.0,
      skillBScore: 2.0,
      diff: 1.0,
      confidence: 'UNRATED',
      reasoning: 'mock comparison',
    },
  ],
  estimatedCost: 0,
});
NODE
)

echo "$COMPARE_OUT" | grep -qiE "compare|vs|winner" \
  && log_pass "compare output shows comparison table" \
  || log_fail "compare output missing comparison table"

COMPARE_JSON=$(node - <<'NODE'
const { judgeCompare } = require('./dist/judge.js');
const skillA = { name: 'api-design', description: 'A', triggers: ['test'], instructionBody: 'A', rawPath: 'A/SKILL.md' };
const skillB = { name: 'api-design-v2', description: 'B', triggers: ['test'], instructionBody: 'B', rawPath: 'B/SKILL.md' };
const result = {
  taskId: 'task-001',
  prompt: 'Design an endpoint',
  context: 'Node.js API',
  skillA: { output: 'A output', tokensUsed: 1, inputTokens: 1, outputTokens: 1, latencyMs: 1 },
  skillB: { output: 'B output', tokensUsed: 1, inputTokens: 1, outputTokens: 1, latencyMs: 1 },
};
const judge = {
  score: async (_prompt, outputA, outputB) => ({
    winner: outputB.includes('B output') ? 'B' : 'A',
    margin: 3,
    rationale: 'mock judge',
  }),
};
judgeCompare(skillA, skillB, [result], {
  judge,
  judgeProvider: 'gemini-flash',
  judgeModel: 'mock-judge',
  runnerModel: 'mock-runner',
  print: false,
  seed: 1,
}).then((report) => console.log(JSON.stringify(report)));
NODE
)

echo "$COMPARE_JSON" | jq -e '.skillAName' > /dev/null 2>&1 \
  && log_pass "compare --json has skillAName" \
  || log_fail "compare --json missing skillAName"

echo "$COMPARE_JSON" | jq -e '.skillBName' > /dev/null 2>&1 \
  && log_pass "compare --json has skillBName" \
  || log_fail "compare --json missing skillBName"

echo "$COMPARE_JSON" | jq -e '.overallWinner' > /dev/null 2>&1 \
  && log_pass "compare --json has overallWinner" \
  || log_fail "compare --json missing overallWinner"

echo "$COMPARE_JSON" | jq -e '.results[0].skillAScore' > /dev/null 2>&1 \
  && log_pass "compare --json has per-task skillAScore" \
  || log_fail "compare --json missing per-task skillAScore"

echo "$COMPARE_JSON" | jq -e '.tasksAWon' > /dev/null 2>&1 \
  && log_pass "compare --json has tasksAWon" \
  || log_fail "compare --json missing tasksAWon"

rm -rf ./samples/api-design-v2

# SUMMARY
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  RESULTS: ✅ $PASS passed   ❌ $FAIL failed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

[ $FAIL -eq 0 ] && exit 0 || exit 1
