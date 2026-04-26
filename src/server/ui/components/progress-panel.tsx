const STAGES = [
  ["job-created", "Job Created"],
  ["repo-selection", "Repo Selection"],
  ["repository-sync", "Repository Sync"],
  ["codex-execution", "Codex Execution"],
  ["synthesis", "Synthesis"]
] as const;

export function ProgressPanel() {
  return (
    <section class="panel progress-panel collapsible-panel" data-progress-panel data-collapsible-panel="progress">
      <div class="panel-heading compact collapsible-heading">
        <div>
          <h2>Progress</h2>
          <p data-progress-summary data-collapsible-summary="progress">Waiting for a question.</p>
        </div>
        <button
          class="collapse-toggle"
          type="button"
          aria-expanded="false"
          aria-controls="progress-panel-body"
          aria-label="Toggle Progress"
          data-collapsible-trigger="progress"
        ></button>
      </div>
      <div id="progress-panel-body" data-collapsible-body="progress" hidden>
        <ol class="stage-list" data-stage-list>
          {STAGES.map(([id, label]) => (
            <li class="stage-row" data-stage={id} data-state="waiting">
              <span class="stage-dot"></span>
              <div>
                <div class="stage-title">{label}</div>
                <div class="stage-detail" data-stage-detail={id}>Waiting</div>
              </div>
              <time data-stage-time={id}></time>
            </li>
          ))}
        </ol>
        <button class="log-toggle" type="button" data-log-toggle>View Full Log</button>
        <pre class="status-log" data-status-log hidden></pre>
      </div>
    </section>
  );
}
