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
- `repos list` shows configured repos and whether they are cloned locally
- `repos sync` clones or fast-forwards the managed repos
- asking a question uses automatic repo selection by default, or an explicit repo subset when provided, then syncs them and runs Codex
- the HTTP adapter exposes the same ask flow as async jobs plus status streams
- the built-in web UI can load the configured repo catalog and present it as a picker instead of raw comma-separated input
- repos can be pinned into automatic selection with `alwaysSelect`
- answers default to a general engineering audience and can optionally target codebase-aware readers

## Non-goals

- no bundled vector index or semantic retrieval layer
- no source-controlled organization catalog
- no durable shared state or multi-node coordination for HTTP jobs yet
