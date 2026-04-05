# Overview

Archa is your personal code archaeologist. Ask your codebase how it behaves.

Archa exposes the same repo-aware question-answering core through a CLI and an optional HTTP server. Both adapters manage a configured set of repositories, keep local clones up to date, and run the local `codex exec` CLI against either a user-selected repo workspace or the managed repos root chosen by automatic selection.

## Goals

- keep the repo-aware question-answering workflow reusable across installations
- avoid shipping organization-specific repo catalogs in source control
- preserve a simple local workflow around repo selection, sync, and Codex execution
- expose the same workflow programmatically through async HTTP jobs

## Core behavior

- user-level config defines the managed repo set and clone root
- config can be bootstrapped from a local catalog file or discovered from a GitHub owner before being selectively added to or overridden in local config, showing a lightweight GitHub-metadata preview first, then refining only the selected repos with repo-content inspection, size-aware topic enrichment, separate repo classifications, a Codex cleanup pass, and progress updates before writing config
- both `archa` and `archa-server` prompt interactively to initialize a missing config and can continue straight into `discover-github` when the new config still has zero repos; outside that CLI bootstrap flow, zero-repo installs surface a direct `discover-github --apply` hint during `config init`, server startup, repo listing, and the web UI empty state
- commands that require Codex fail fast when the local `codex` CLI is missing and suggest installing it via Homebrew, then connecting/logging into Codex before retrying
- repo names and aliases are validated eagerly and must be unique case-insensitively
- `repos list` shows configured repos and whether they are cloned locally
- `repos sync` clones or fast-forwards the managed repos
- asking a question uses automatic repo selection by default, or an explicit repo subset when provided, then syncs them and runs Codex
- the HTTP adapter exposes the same ask flow as async jobs plus status streams
- the built-in web UI can load the configured repo catalog and present it as a picker instead of raw comma-separated input
- repos can be pinned into automatic selection with `alwaysSelect`, and automatic selection still falls back to all configured repos when nothing scores positively
- high-signal classifications such as `infra`, `library`, `internal`, `external`, and `microservice` are handled separately from generic topics, are additive when multiple roles apply, are weighted more strongly during automatic selection, and keep `external` reserved for clearly outward-facing repos rather than generic API integrations
- answers default to a general engineering audience and can optionally target codebase-aware readers

## Non-goals

- no bundled vector index or semantic retrieval layer
- no source-controlled organization catalog
- no durable shared state or multi-node coordination for HTTP jobs yet
