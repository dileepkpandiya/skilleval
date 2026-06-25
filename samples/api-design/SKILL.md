---
name: api-design
description: Guide API design decisions for clear, stable, and ergonomic interfaces.
version: 0.1.0
triggers:
  - design an api
  - review endpoint design
  - improve sdk interface
agents:
  - claude
---
# API Design Skill

Use this skill when designing HTTP APIs, SDK methods, command interfaces, or internal service contracts.
Optimize for predictable behavior, explicit errors, and long-term compatibility.

## Design checklist

Define the primary user journey before naming endpoints or methods.
Choose resource names that describe domain concepts rather than implementation details.
Use consistent pagination, filtering, sorting, and idempotency conventions across the API.
Treat versioning as a compatibility strategy, not as a substitute for careful change management.

## Request and response guidance

Prefer structured request bodies for operations with multiple parameters.
Return stable identifiers and timestamps in machine-readable formats.
Include error codes that clients can branch on, plus messages that humans can understand.
Make partial failure behavior explicit for batch operations.

## Evaluation guidance

Call out ambiguous ownership of resources, overloaded parameters, and hidden side effects.
Recommend defaults that reduce client surprise.
Explain tradeoffs when there are multiple acceptable designs.
When suggesting examples, keep payloads small but realistic enough to validate the contract.
