# HTTP API

The optional `atc-server` adapter exposes the repo-aware question-answering flow as async HTTP jobs. Browser/UI jobs are created with `POST /ask`, API-only integration jobs are created with `POST /api/v1/ask`, and jobs are read back through `GET /jobs/:id` and `GET /jobs/:id/events`.

## Endpoints

### `GET /`

Serves the built-in web UI.

Mode resolution:

- `?mode=simple` or `?mode=expert` selects the first-byte render and writes the `atc_mode` cookie
- `atc_mode` cookie is used when no query mode is present
- default mode is `simple`

### `GET /health`

Returns the server status along with job counts by state:

```json
{
  "status": "ok",
  "jobs": {
    "queued": 0,
    "running": 0,
    "completed": 0,
    "failed": 0
  }
}
```

Notes:

- `jobs` is `null` when the server is using a custom job manager that does not expose stats
- `completed` and `failed` reflect only the jobs still retained in memory, not cumulative historical totals
- those counts reset after the job retention window expires and when the server process restarts

### `GET /repos`

Returns the configured repo catalog for the built-in web UI repositories view.

Response:

```json
{
  "repos": [
    {
      "name": "ask-the-code",
      "defaultBranch": "main",
      "description": "Repo-aware CLI for engineering Q&A with local Codex",
      "aliases": ["self"]
    }
  ],
  "setupHint": null
}
```

Notes:

- `setupHint` is `null` during normal operation
- when the configured repo list is empty, `setupHint` contains a suggested `discover-github` command for bootstrapping config

### `GET /auth/session`

Returns the current GitHub SSO session state for the built-in web UI.

Response without a signed-in user:

```json
{
  "authenticated": false,
  "githubConfigured": true,
  "user": null
}
```

Response with a signed-in user:

```json
{
  "authenticated": true,
  "githubConfigured": true,
  "user": {
    "email": "user@example.com",
    "name": "User Example",
    "picture": "https://example.com/user.png"
  }
}
```

### `GET /auth/github/start`

Starts the GitHub OAuth flow and redirects to GitHub. The endpoint requires `ATC_GITHUB_CLIENT_ID`, `ATC_GITHUB_CLIENT_SECRET`, and `ATC_AUTH_SECRET`.

### `GET /auth/github/callback`

Completes the GitHub OAuth flow, stores the signed local session cookie, clears the temporary OAuth state cookie, and redirects to `/`.

### `POST /auth/logout`

Clears the signed local session cookie.

### `POST /ask`

Creates a new async job for the built-in web UI and browser-like clients.

Legacy note:

- `POST /jobs` is no longer accepted; clients must use `POST /ask`

Request body:

```json
{
  "question": "How does ask-the-code choose the Codex working directory when one repo matches versus several?",
  "repoNames": ["ask-the-code"],
  "audience": "general",
  "model": "gpt-5.4-mini",
  "reasoningEffort": "low",
  "selectionMode": "single",
  "selectionShadowCompare": false,
  "attachments": [
    {
      "name": "requirements.txt",
      "mediaType": "text/plain",
      "contentBase64": "VXNlIEdvb2dsZSBTU08u"
    }
  ],
  "noSync": false,
  "noSynthesis": false
}
```

Rules:

- `question` is required and must be a non-empty string
- `repoNames` may be an array of repo names or a comma-separated string
- `repos` is accepted as an alias of `repoNames`
- `repoNames` and `repos` must not be provided together
- `audience` is optional and must be one of `general` or `codebase`
- omitted `audience` defaults to `general`
- `model` and `reasoningEffort` are optional strings
- omitted `model` and `reasoningEffort` use the same execution defaults as the CLI: `gpt-5.4-mini` and `low`
- `selectionMode` is optional and must be one of `single` or `cascade`
- omitted `selectionMode` defaults to `single`
- `selectionShadowCompare` is an optional boolean; when `true`, the server keeps background `none`, `low`, and `high` repo-selector runs for comparison diagnostics while the main ask continues
- `attachments` is optional and must be an array of `{ "name", "mediaType", "contentBase64" }` objects
- uploaded attachments are included in the Codex prompt; text-like files are decoded as UTF-8, and binary files are passed as base64 text
- attachment limits are 8 files, 1 MiB decoded per file, and 3 MiB decoded total
- when GitHub SSO is configured, clients must have a valid signed local session cookie; otherwise the endpoint returns `401`
- `noSync` and `noSynthesis` are optional booleans

Response:

```json
{
  "id": "job-id",
  "status": "queued",
  "request": {
    "question": "How does ask-the-code choose the Codex working directory when one repo matches versus several?",
    "repoNames": ["ask-the-code"],
    "audience": "general",
    "attachments": [],
    "model": null,
    "reasoningEffort": null,
    "selectionMode": "single",
    "selectionShadowCompare": false,
    "noSync": false,
    "noSynthesis": false
  },
  "createdAt": "2026-04-03T11:11:11.111Z",
  "startedAt": null,
  "finishedAt": null,
  "error": null,
  "result": null,
  "events": [
    {
      "sequence": 1,
      "type": "queued",
      "message": "Job queued.",
      "timestamp": "2026-04-03T11:11:11.111Z"
    }
  ],
  "links": {
    "self": "/jobs/job-id",
    "events": "/jobs/job-id/events"
  }
}
```

### `POST /api/v1/ask`

Creates a new async job for API-only integrations such as a future Slack bot.

Headers:

- `Authorization: Bearer <ATC_API_TOKEN>`
- `X-ATC-Interaction-User`: stable provider-scoped user id, for example `slack:T123:U123`
- `X-ATC-Conversation-Key`: stable provider-scoped thread/conversation id, for example `slack:T123:C123:171234.000001`
- `X-ATC-Interaction-Timestamp`: ISO timestamp, Unix seconds, or Unix milliseconds
- `X-ATC-Interaction-Signature`: hex HMAC-SHA256

Signature payload:

```text
<timestamp>
<interaction-user>
<conversation-key>
<raw-request-body>
```

Rules:

- the bearer token must match `ATC_API_TOKEN`
- the HMAC secret is `ATC_API_SIGNING_SECRET`
- timestamp skew must be five minutes or less
- the request body accepts only `question` and `attachments`
- advanced fields such as `repoNames`, `audience`, `model`, `reasoningEffort`, `selectionMode`, `noSync`, and `noSynthesis` are rejected
- server-side defaults are equivalent to Simple mode
- successful asks are recorded in local API conversation history

Request body:

```json
{
  "question": "What changed in this repo?",
  "attachments": []
}
```

Response:

```json
{
  "jobId": "job-id",
  "status": "queued",
  "interactionUser": "slack:T123:U123",
  "conversationKey": "slack:T123:C123:171234.000001"
}
```

### `GET /api/v1/history?conversationKey=...`

Returns local API conversation history for the signed conversation key.

The endpoint uses the same API auth headers as `POST /api/v1/ask`, but signs an empty body. The signed conversation key must match the `conversationKey` query parameter.

Response:

```json
{
  "conversation": {
    "conversationKey": "slack:T123:C123:171234.000001",
    "interactionUser": "slack:T123:U123",
    "createdAt": "2026-04-26T12:00:00.000Z",
    "updatedAt": "2026-04-26T12:01:00.000Z",
    "items": [
      {
        "type": "question",
        "jobId": "job-id",
        "text": "What changed in this repo?",
        "attachments": [],
        "createdAt": "2026-04-26T12:00:00.000Z"
      }
    ]
  }
}
```

### `GET /jobs/:id`

Returns the latest full job snapshot, including:

- current status
- original request
- event history
- terminal result or error

When automatic repo selection runs, terminal ask results also include a `selection` summary describing the final selector source and any completed selector runs.

Statuses:

- `queued`
- `running`
- `completed`
- `failed`

### `GET /jobs/:id/events`

Returns a server-sent event stream.

Behavior:

- the stream starts with a `snapshot` event containing the current full job snapshot
- if the job is already terminal, the server immediately sends a terminal event and closes the stream
- otherwise the server streams live job events until `completed` or `failed`

Event types:

- `snapshot`
- `started`
- `status`
- `completed`
- `failed`

## Operational characteristics

- job state is in-memory only
- completed jobs expire after a retention timeout
- job execution concurrency is bounded per process and defaults to 3 concurrent jobs
- repo sync coordination is per process and deduplicates overlapping syncs for the same repo directory
- the built-in web UI uses `GET /repos` for the Expert mode repositories view
- Expert mode serializes audience, model, reasoning, repo-selection, sync, synthesis, and selector comparison controls into `POST /ask`; Simple mode uses backend defaults
- API-only integrations use `POST /api/v1/ask`, cannot set Expert-mode fields, and persist local JSON conversation history
- API history defaults to `~/.local/share/atc/history.json`, can be overridden with `ATC_HISTORY_PATH`, keeps 24 items per conversation plus one limit-reached status, keeps the newest 500 conversations, and stores attachment metadata without attachment contents
