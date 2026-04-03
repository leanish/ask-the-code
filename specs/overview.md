# Overview

Archa is your personal code archaeologist. Ask your codebase how it behaves.

Archa exposes the same repo-aware question-answering core through a CLI and an optional HTTP server. Both adapters manage a configured set of repositories, keep local clones up to date, and run the local `codex exec` CLI against the most relevant repo workspace for a given question.

## Goals

- keep the repo-aware question-answering workflow reusable across installations
- avoid shipping organization-specific repo catalogs in source control
- preserve a simple local workflow around repo selection, sync, and Codex execution
- expose the same workflow programmatically through async HTTP jobs

## Core behavior

- user-level config defines the managed repo set and clone root
- `repos list` shows configured repos and whether they are cloned locally
- `repos sync` clones or fast-forwards the managed repos
- asking a question selects likely repos, syncs them, and runs Codex
- the HTTP adapter exposes the same ask flow as async jobs plus status streams
- when no repo matches heuristically, the first configured repo is used as a fallback
- output is written for readers without access to the analyzed source code

## Non-goals

- no bundled vector index or semantic retrieval layer
- no source-controlled organization catalog
- no durable shared state or multi-node coordination for HTTP jobs yet
