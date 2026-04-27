export function AfterTheRun({ expert = false }: { expert?: boolean } = {}) {
  return (
    <section class="card after-the-run" aria-labelledby="after-heading">
      <h2 id="after-heading">After the run</h2>
      <div id="after-empty">
        <p class="empty">
          We'll show you which repositories were used and a summary of what happened.
        </p>
      </div>
      <div id="after-content" hidden>
        <div id="after-repos"></div>
        {expert ? (
          <div class="run-summary" id="run-summary">
            <div>
              <strong id="summary-repo-count">0</strong>
              <small>Repositories used</small>
            </div>
            <div>
              <strong id="summary-duration">—</strong>
              <small>Total duration</small>
            </div>
            <div>
              <strong id="summary-steps">0</strong>
              <small>Steps completed</small>
            </div>
          </div>
        ) : null}
        <div id="run-summary-success" class="run-summary-success" hidden>
          ✓ Completed successfully
        </div>
      </div>
    </section>
  );
}
