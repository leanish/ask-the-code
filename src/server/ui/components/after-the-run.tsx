type AfterTheRunProps = {
  expert?: boolean;
};

export function AfterTheRun({ expert = false }: AfterTheRunProps) {
  return (
    <section class="panel after-run-panel collapsible-panel" data-collapsible-panel="run-summary">
      <div class="panel-heading compact collapsible-heading">
        <div>
          <h2>{expert ? "Run summary" : "After The Run"}</h2>
          <p data-run-summary data-collapsible-summary="run-summary">No repositories used yet.</p>
        </div>
        <button
          class="collapse-toggle"
          type="button"
          aria-expanded="false"
          aria-controls="run-summary-panel-body"
          aria-label={expert ? "Toggle Run summary" : "Toggle After The Run"}
          data-collapsible-trigger="run-summary"
        ></button>
      </div>
      <div id="run-summary-panel-body" data-collapsible-body="run-summary" hidden>
        <div class="empty-state" data-run-empty>No repositories used yet.</div>
        <ul class="repo-result-list" data-selected-repos hidden></ul>
      </div>
    </section>
  );
}
