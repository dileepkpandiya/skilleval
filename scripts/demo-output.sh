#!/usr/bin/env bash

printf "> npx @dileeppandiya/skilleval ./samples/api-design --tasks ./tasks/sample-tasks.yaml\n"
sleep 1

printf "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
printf "  skilleval results - api-design - 2 tasks\n"
printf "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
printf "  Skill effectiveness:   +0.3 / 3\n"
printf "  Tasks improved:        1 / 2  (50%%)\n"
printf "  Tasks hurt:            1 / 2  (50%%)\n"
printf "  Confidence:            HIGH\n"
printf "\n"
printf "  task-003  +2.5  HIGH  Output A provides a more robust and production-ready API design, featuring critical real-world details like idempotency keys, index-based correlation to handle duplicate request items, and a detailed audit logging schema.\n"
printf "  task-004  -2.0  HIGH  Output A is more comprehensive and tailored to a public API, offering highly actionable long-term compatibility advice such as a phased migration strategy with Sunset headers and idempotency keys for safe retries.\n"
printf "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
printf "  Runner: claude-sonnet-4-6 | Judge: gemini-3.5-flash\n"
printf "  Estimated API cost this run: \$0.101\n"
printf "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
