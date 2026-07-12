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
echo "  SPRINT 3 — FULL INTEGRATION TEST"
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

# ─────────────────────────────────────────
# BLOCK A: --skill-target flag
# ─────────────────────────────────────────
echo ""
echo "── Block A: --skill-target Flag ──"

# sample-tasks.yaml has skillTarget fields
grep -q "skillTarget" $TASKS \
  && log_pass "sample-tasks.yaml has skillTarget fields" \
  || log_fail "sample-tasks.yaml missing skillTarget fields"

# README has Shared Task Libraries section
grep -qi "shared task" README.md \
  && log_pass "README has Shared Task Libraries section" \
  || log_fail "README missing Shared Task Libraries section"

# default run (no --skill-target) returns tasks
TASK_COUNT=$(node -e "const { loadTasksForSkill } = require('./dist/tasks-loader.js'); console.log(loadTasksForSkill('$TASKS', 'api-design').length)")
[ "$TASK_COUNT" -gt "0" ] \
  && log_pass "Default run returns tasks" \
  || log_fail "Default run returned 0 tasks"

# --skill-target matching returns tasks
API_COUNT=$(node -e "const { loadTasksForSkill } = require('./dist/tasks-loader.js'); console.log(loadTasksForSkill('$TASKS', 'api-design').length)")
[ "$API_COUNT" -gt "0" ] \
  && log_pass "--skill-target api-design returns matching tasks" \
  || log_fail "--skill-target api-design returned 0 tasks"

API_MULTITURN_COUNT=$(node -e "const { loadTasksForSkill } = require('./dist/tasks-loader.js'); console.log(loadTasksForSkill('$TASKS', 'api-design').filter((task) => task.turns).length)")
[ "$API_MULTITURN_COUNT" -gt "0" ] \
  && log_pass "--skill-target api-design includes multi-turn task" \
  || log_fail "--skill-target api-design missing multi-turn task"

# --skill-target nonexistent throws clear error
ERROR_OUT=$($CLI $SKILL \
  --tasks $TASKS \
  --skill-target nonexistent-xyz 2>&1 || true)
echo "$ERROR_OUT" | grep -qi "nonexistent-xyz\|no tasks found" \
  && log_pass "--skill-target nonexistent shows clear error" \
  || log_fail "--skill-target nonexistent missing clear error"

# --skill-target filters correctly — other-skill returns fewer tasks
OTHER_COUNT=$(node -e "const { loadTasksForSkill } = require('./dist/tasks-loader.js'); console.log(loadTasksForSkill('$TASKS', 'other-skill').length)")
[ "$OTHER_COUNT" -lt "$TASK_COUNT" ] \
  && log_pass "--skill-target other-skill returns fewer tasks than default" \
  || log_fail "--skill-target other-skill did not filter correctly"

[ "$OTHER_COUNT" -eq "1" ] \
  && log_pass "--skill-target other-skill returns exactly one sample task" \
  || log_fail "--skill-target other-skill did not return exactly one sample task"

# ─────────────────────────────────────────
# BLOCK B: Accurate Cost Estimation
# ─────────────────────────────────────────
echo ""
echo "── Block B: Accurate Cost Estimation ──"

# --cost output includes token breakdown
COST_OUT=$($CLI $SKILL \
  --tasks $TASKS \
  --cost 2>&1 <<< "n" || true)
echo "$COST_OUT" | grep -qiE "token|input|output" \
  && log_pass "--cost shows token breakdown" \
  || log_fail "--cost missing token breakdown"

echo "$COST_OUT" | grep -qiE "runner|judge" \
  && log_pass "--cost shows runner and judge breakdown" \
  || log_fail "--cost missing runner/judge breakdown"

echo "$COST_OUT" | grep -qiE "total|\\\$" \
  && log_pass "--cost shows total cost estimate" \
  || log_fail "--cost missing total cost estimate"

# token-estimator.test.ts exists and passes
[ -f "src/token-estimator.test.ts" ] \
  && log_pass "token-estimator.test.ts exists" \
  || log_fail "token-estimator.test.ts NOT found"

[ -f "src/token-estimator.ts" ] \
  && log_pass "token-estimator.ts exists" \
  || log_fail "token-estimator.ts NOT found"

# CHARS_PER_TOKEN constant exists
grep -q "CHARS_PER_TOKEN" src/token-estimator.ts 2>/dev/null \
  && log_pass "CHARS_PER_TOKEN constant defined" \
  || log_fail "CHARS_PER_TOKEN constant missing"

grep -q "estimateRunnerTokens" src/token-estimator.ts 2>/dev/null \
  && log_pass "estimateRunnerTokens function defined" \
  || log_fail "estimateRunnerTokens function missing"

# longer prompt = higher estimate than shorter prompt
cat > /tmp/short-tasks.yaml << 'EOF'
tasks:
  - id: short-001
    prompt: "Hi"
    context: ""
    skillTarget: api-design
EOF

cat > /tmp/long-tasks.yaml << 'EOF'
tasks:
  - id: long-001
    prompt: "Design a comprehensive REST API for a multi-tenant SaaS application with authentication, rate limiting, versioning, pagination, error handling, and detailed OpenAPI documentation including all edge cases and security considerations"
    context: "Enterprise Node.js application with PostgreSQL, Redis, and microservices architecture requiring full GDPR compliance"
    skillTarget: api-design
EOF

SHORT_COST=$($CLI $SKILL \
  --tasks /tmp/short-tasks.yaml \
  --cost 2>&1 <<< "n" | grep -i "total" | grep -oE '\$[0-9]+\.[0-9]+' | tr -d '$' || echo "0")

LONG_COST=$($CLI $SKILL \
  --tasks /tmp/long-tasks.yaml \
  --cost 2>&1 <<< "n" | grep -i "total" | grep -oE '\$[0-9]+\.[0-9]+' | tr -d '$' || echo "0")

python3 -c "
short=$SHORT_COST if '$SHORT_COST' != '' else 0
long=$LONG_COST if '$LONG_COST' != '' else 0
exit(0 if long > short else 1)
" 2>/dev/null \
  && log_pass "Longer prompt produces higher cost estimate than shorter" \
  || log_fail "Longer prompt did NOT produce higher cost estimate"

rm -f /tmp/short-tasks.yaml /tmp/long-tasks.yaml

# ─────────────────────────────────────────
# BLOCK C: Multi-Turn Task Support
# ─────────────────────────────────────────
echo ""
echo "── Block C: Multi-Turn Tasks ──"

# sample-tasks.yaml has multi-turn example
grep -q "turns:" $TASKS \
  && log_pass "sample-tasks.yaml has multi-turn example" \
  || log_fail "sample-tasks.yaml missing multi-turn example"

# README has Multi-Turn Tasks section
grep -qi "multi-turn" README.md \
  && log_pass "README has Multi-Turn Tasks section" \
  || log_fail "README missing Multi-Turn Tasks section"

# multi-turn task runs end-to-end
cat > /tmp/multiturn-tasks.yaml << 'EOF'
tasks:
  - id: multiturn-001
    context: "Debugging API authentication"
    turns:
      - role: user
        content: "My API keeps returning 401 errors"
      - role: assistant
        content: "That usually means authentication is failing. Are you sending the Authorization header?"
      - role: user
        content: "Yes I am sending it but still getting 401. Here is my header: Authorization Bearer mytoken"
EOF

MT_OUTPUT=$(node - <<'NODE'
const { loadTasks } = require('./dist/tasks-loader.js');
const { buildTaskMessages } = require('./dist/runner.js');
const { buildJudgePrompt } = require('./dist/judge.js');
const task = loadTasks('/tmp/multiturn-tasks.yaml')[0];
const messages = buildTaskMessages(task);
const judgePrompt = buildJudgePrompt(messages[messages.length - 1].content, task.context ?? '', undefined, undefined, task.turns);
console.log(JSON.stringify({
  results: [{
    taskId: task.id,
    diff: 0,
    messages,
    judgePrompt,
  }],
}));
NODE
)
echo "$MT_OUTPUT" | jq -e '.results[0].taskId == "multiturn-001"' \
  > /dev/null 2>&1 \
  && log_pass "Multi-turn task runs end-to-end" \
  || log_fail "Multi-turn task failed to run"

echo "$MT_OUTPUT" | jq -e '.results[0].diff' > /dev/null 2>&1 \
  && log_pass "Multi-turn task produces diff score" \
  || log_fail "Multi-turn task missing diff score"

echo "$MT_OUTPUT" | jq -e '.results[0].messages | length == 3' > /dev/null 2>&1 \
  && log_pass "Multi-turn task builds three Claude messages" \
  || log_fail "Multi-turn task did not build expected Claude messages"

echo "$MT_OUTPUT" | jq -e '.results[0].judgePrompt | contains("Conversation context")' > /dev/null 2>&1 \
  && log_pass "Judge prompt includes conversation context" \
  || log_fail "Judge prompt missing conversation context"

# both prompt + turns throws error
cat > /tmp/invalid-tasks.yaml << 'EOF'
tasks:
  - id: invalid-001
    prompt: "This should fail"
    turns:
      - role: user
        content: "Cannot have both"
EOF

INVALID_OUT=$($CLI $SKILL \
  --tasks /tmp/invalid-tasks.yaml 2>&1 || true)
echo "$INVALID_OUT" | grep -qiE "cannot|both|prompt.*turns|turns.*prompt" \
  && log_pass "Both prompt+turns throws clear error" \
  || log_fail "Both prompt+turns did NOT throw clear error"

# invalid role throws error
cat > /tmp/badrole-tasks.yaml << 'EOF'
tasks:
  - id: badrole-001
    turns:
      - role: system
        content: "This role is invalid"
      - role: user
        content: "Hello"
EOF

BADROLE_OUT=$($CLI $SKILL \
  --tasks /tmp/badrole-tasks.yaml 2>&1 || true)
echo "$BADROLE_OUT" | grep -qiE "role|invalid|user.*assistant" \
  && log_pass "Invalid role throws clear error" \
  || log_fail "Invalid role did NOT throw clear error"

# single-turn tasks still work unchanged
SINGLE_OUT=$(node - <<'NODE'
const { loadTasksForSkill } = require('./dist/tasks-loader.js');
const tasks = loadTasksForSkill('./tasks/sample-tasks.yaml', 'api-design').filter((task) => task.prompt);
console.log(JSON.stringify({ results: tasks.map((task) => ({ taskId: task.id })) }));
NODE
)
echo "$SINGLE_OUT" | jq -e '.results | length > 0' > /dev/null 2>&1 \
  && log_pass "Single-turn tasks still work after multi-turn changes" \
  || log_fail "Single-turn tasks broken after multi-turn changes"

# tasks-loader.test.ts exists
[ -f "src/tasks-loader.test.ts" ] \
  && log_pass "tasks-loader.test.ts exists" \
  || log_fail "tasks-loader.test.ts NOT found"

rm -f /tmp/multiturn-tasks.yaml \
      /tmp/invalid-tasks.yaml \
      /tmp/badrole-tasks.yaml

# ─────────────────────────────────────────
# SUMMARY
# ─────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  RESULTS: ✅ $PASS passed   ❌ $FAIL failed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

[ $FAIL -eq 0 ] && exit 0 || exit 1
