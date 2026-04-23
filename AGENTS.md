# AGENTS.md

## What This Repo Is

- `ask-the-code` is a Node.js ESM project.
- It exposes the same repo-aware Q&A flow through:
  - a CLI: `atc`
  - an HTTP server: `atc-server`
- The core workflow is: load config -> select repos -> sync repos -> run Codex -> render result.

## Code Map

- `src/cli/`: CLI parsing, rendering, and interactive setup only
- `src/server/`: HTTP transport, request handling, SSE, and built-in UI only
- `src/core/`: shared logic
  - `config/`: config loading and mutation
  - `answer/`: transport-agnostic ask flow
  - `repos/`: repo selection, paths, sync, sync coordination
  - `codex/`: local `codex exec` integration
  - `discovery/`: GitHub discovery, inspection, metadata curation
  - `jobs/`: in-memory async job manager
  - `status/`: status reporting adapters

## Working Rules

- Keep adapter code thin. Shared behavior belongs in `src/core/`, not duplicated across CLI and server.
- Preserve a clear split of responsibilities. Do not mix parsing, transport, sync, and Codex concerns in one place.
- Prefer small pure helpers and dependency injection over hidden coupling. The tests rely heavily on injectable functions.
- Keep error messages explicit and user-facing.
- Avoid new dependencies unless they materially simplify the code.

## Behavior To Preserve

- Repo selection uses explicit repo names when provided; otherwise it uses heuristic scoring with `alwaysSelect` support and fallback to all repos.
- Question answering can run in retrieval-only mode without Codex synthesis.
- HTTP jobs are in-memory, async, and stream status through SSE.
- GitHub discovery is two-phase: cheap discovery first, deeper refinement only for selected repos.
- Config lives in user space, not in this repository.

## Commands

- Install deps: `npm install`
- Run tests: `npm test`
- Coverage: `npm run test:coverage`

## Verification

- Run the relevant Vitest tests after code changes.
- For broad or cross-cutting changes, run `npm test`.
- If behavior, config shape, or HTTP contract changes, update:
  - `README.md`
  - `specs/overview.md`
  - `specs/architecture.md`
  - `specs/http-api.md`

## Useful Entry Points

- CLI entry: `src/cli/main.js`
- Server entry: `src/server/main.js`
- Ask flow: `src/core/answer/question-answering.js`
- HTTP API: `src/server/api/http-server.js`
- Repo selection: `src/core/repos/repo-selection.js`
- Repo sync: `src/core/repos/repo-sync.js`
- Codex runner: `src/core/codex/codex-runner.js`
- Discovery pipeline: `src/core/discovery/discovery-pipeline.js`
