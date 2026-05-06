# Overview

ask-the-code is your personal code archaeologist. Ask your codebase how it behaves.

ask-the-code exposes the same repo-aware question-answering core through a CLI and an optional HTTP server. Both adapters manage a configured set of repositories, keep local clones up to date, and run the local `codex exec` CLI against either a user-selected repo workspace or the managed repos root chosen by automatic selection.

ask-the-code is implemented as a TypeScript ESM codebase under `src/` and builds publishable runtime artifacts into `dist/`. The published package is CLI-only and does not expose a library import entrypoint.

The source tree is organized by adapter and shared logic:

- `src/cli/` for terminal-facing command dispatch, parsing, rendering, and interactive setup
- `src/server/` for server startup, HTTP routes, and the built-in web UI
- `src/core/` for shared config, discovery, repo, Codex, and job logic
- `dist/` for compiled runtime entrypoints and modules used by the published package

## Goals

- keep the repo-aware question-answering workflow reusable across installations
- avoid shipping organization-specific repo catalogs in source control
- preserve a simple local workflow around repo selection, sync, and Codex execution
- expose the same workflow programmatically through async HTTP jobs

## Core behavior

- user-level config defines the managed repo set and clone root
- when a repo entry still uses legacy `topics` / `classifications` fields and omits `routing`, config loading drafts a fallback routing card from those legacy values so automatic selection does not drop to empty routing until discovery is rerun
- config can be bootstrapped from a local catalog file or discovered from a GitHub owner before being selectively added to or overridden in local config, using authenticated GitHub access from `GH_TOKEN` / `GITHUB_TOKEN` or, if those env vars are unset, the current `gh` login, including private repos visible to that credential; direct `discover-github` can omit `--owner`, prompting on a TTY and otherwise defaulting to `@accessible`; discovery uses a combined interactive selection list of new and already configured repos, defaults Enter to all new repos behind a confirmation prompt, and then refines only the selected subset with repo-content inspection, routing-card drafting from GitHub/README/route/dependency signals, a Codex cleanup pass, visible progress updates, and one final config write
- interactive discovery can target a specific owner or the special `@accessible` scope, which lists repos visible through the authenticated GitHub account across personal and organization memberships and presents multi-owner results in owner-grouped sections, falling back to owner-qualified repo names only when collisions need disambiguation; when two discovered GitHub repos would otherwise collide by plain repo name, discovery automatically qualifies the managed name as `<owner>/<repo>` so both can be added, while GitHub-managed checkouts always live under owner-scoped paths inside `managedReposRoot`
- both `atc` and `atc-server` prompt interactively to initialize a missing config and can continue straight into `discover-github` when the new config still has zero repos; outside that CLI bootstrap flow, zero-repo installs surface a direct `discover-github` hint during `config init`, server startup, repo listing, and the web UI empty state
- commands that require Git fail fast when the local `git` CLI is missing, suggesting installation via Homebrew before retrying
- discovery commands fail fast when neither `GH_TOKEN` / `GITHUB_TOKEN` nor, as a fallback, a usable `gh` login is available
- commands that require Codex fail fast when the local `codex` CLI is missing or not logged in, suggesting installation via Homebrew and then completing the Codex login/connection flow before retrying
- repo names and aliases are validated eagerly and must be unique case-insensitively
- `repos list` shows configured repos and whether they are cloned locally
- `repos sync` clones missing managed repos, syncs existing ones against their configured tracked branch, and first unshallows any previously shallow managed checkout
- asking a question uses automatic repo selection by default, or an explicit repo subset when provided; automatic selection now routes on structured repo metadata, uses `selectionMode: "single"` by default for one `none`-effort selector pass with heuristic fallback, can escalate through `cascade` mode when requested, can use every configured repo with `selectionMode: "all"`, and can optionally keep a background `none`/`low`/`high` shadow comparison for diagnostics while syncing the final repo set and running Codex for the answer; that shadow mode is intended for benchmarking rather than routine use because it starts 3 parallel selector runs
- the HTTP adapter exposes the same ask flow as async jobs plus status streams, optional JSON or multipart uploaded attachments, built-in web UI GitHub SSO endpoints with signed 30-day sliding session cookies, and a signed Simple-mode API ask endpoint for integrations
- the built-in web UI can load the configured repo catalog and present it as a picker instead of raw comma-separated input
- repos can be pinned into automatic selection with `alwaysSelect`, and automatic selection still falls back to all configured repos when neither the Codex selector nor the heuristic fallback can narrow the repo set usefully
- repo metadata is stored as a routing card with `role`, `reach`, `responsibilities`, `owns`, `exposes`, `consumes`, `workflows`, `boundaries`, `selectWhen`, and `selectWithOtherReposWhen`, so selection can prefer owned behavior and exposed surfaces over generic ecosystem overlap
- answers default to non-engineering readers with plain-language, low-reference explanations and can optionally target codebase-aware readers

## Non-goals

- no bundled vector index or semantic retrieval layer
- no source-controlled organization catalog
- no durable shared state or multi-node coordination for HTTP jobs yet; API conversation history is local JSON intended for one server process
