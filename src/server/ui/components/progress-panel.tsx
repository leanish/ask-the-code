interface StageDefinition {
  id: string;
  title: string;
  waitingSubtitle: string;
}

const STAGES: ReadonlyArray<StageDefinition> = [
  {
    id: "job-created",
    title: "Job Created",
    waitingSubtitle: "Your job will be created when you run it."
  },
  { id: "repo-selection", title: "Repo Selection", waitingSubtitle: "Waiting" },
  { id: "repository-sync", title: "Repository Sync", waitingSubtitle: "Waiting" },
  { id: "codex-execution", title: "Codex Execution", waitingSubtitle: "Waiting" },
  { id: "synthesis", title: "Synthesis", waitingSubtitle: "Waiting" }
];

export function ProgressPanel() {
  return (
    <section class="card progress-card" aria-labelledby="progress-heading">
      <h2 id="progress-heading">Progress</h2>
      <div id="progress-list" class="progress-list">
        {STAGES.map(stage => (
          <div class="progress-item" data-stage={stage.id} data-state="waiting">
            <div class="progress-marker" aria-hidden="true"></div>
            <div>
              <div class="progress-title">{stage.title}</div>
              <div class="progress-sub">{stage.waitingSubtitle}</div>
            </div>
            <div class="progress-time"></div>
          </div>
        ))}
      </div>
      <button id="toggle-full-log" class="button full-log-button" type="button">
        View Full Log
      </button>
      <pre id="full-log" class="full-log"></pre>
    </section>
  );
}
