import { EmptyState } from "./empty-state.tsx";

export function ExpertViewPanels() {
  return (
    <div class="expert-view-panels" data-expert-only>
      <section class="panel expert-view-panel" data-view-panel="history" hidden>
        <EmptyState message="No previous questions yet." />
      </section>
      <section class="panel expert-view-panel" data-view-panel="repos" hidden>
        <div class="panel-heading compact">
          <div>
            <h2>All Repositories</h2>
            <p>Configured repositories available to ask-the-code.</p>
          </div>
        </div>
        <div data-repos-view>
          <EmptyState message="Loading repositories..." />
        </div>
      </section>
      <section class="panel expert-view-panel" data-view-panel="sync-status" hidden>
        <EmptyState message="Sync status view is coming soon." />
      </section>
      <section class="panel expert-view-panel" data-view-panel="config-path" hidden>
        <EmptyState message="Config Path is not available in the web UI yet." />
      </section>
      <section class="panel expert-view-panel" data-view-panel="edit-config" hidden>
        <EmptyState message="Edit Config is not available in the web UI yet." />
      </section>
      <section class="panel expert-view-panel" data-view-panel="init-config" hidden>
        <EmptyState message="Init Config is not available in the web UI yet." />
      </section>
      <section class="panel expert-view-panel" data-view-panel="discover" hidden>
        <EmptyState message="Discover GitHub is not available in the web UI yet." />
      </section>
      <section class="panel expert-view-panel" data-view-panel="add-repository" hidden>
        <EmptyState message="Add Repository is not available in the web UI yet." />
      </section>
    </div>
  );
}
