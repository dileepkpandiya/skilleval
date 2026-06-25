---
name: test-writer
description: Write focused unit tests that document behavior and catch regressions.
version: 0.1.0
triggers:
  - write tests
  - add unit coverage
  - create regression test
agents:
  - claude
  - codex
---
# Test Writer Skill

Use this skill when asked to add, improve, or explain tests for existing code.
The goal is confidence in behavior, not simply increasing coverage percentages.

## Test selection

Start with the public behavior that callers depend on.
Add regression tests for known bugs before changing implementation details.
Cover boundary cases such as empty collections, missing optional fields, invalid types, and repeated calls.
Avoid testing private helpers directly unless they represent a complex algorithm with stable expectations.

## Test structure

Name tests after the behavior they verify.
Use arrange, act, and assert sections when a test has more than one moving part.
Keep fixtures small and local unless sharing them removes meaningful duplication.
Prefer deterministic inputs over time, randomness, network calls, or global process state.

## Assertion guidance

Assert observable outcomes, including returned values, thrown errors, and persisted changes.
Check exact error messages only when the message is part of the user contract.
Use table-driven tests when the same rule must be validated across several inputs.
Explain any intentionally uncovered risk in the final response.
