import { EmptyState } from "./empty-state.tsx";

interface ViewDefinition {
  id: string;
  title: string;
  body: string;
}

const STUB_VIEWS: ReadonlyArray<ViewDefinition> = [
  { id: "history", title: "No previous questions yet", body: "History is preview-only in this build." },
  { id: "sync-status", title: "Sync Status", body: "Sync status view is coming soon." },
  { id: "config-path", title: "Config Path", body: "Web view coming soon." },
  { id: "edit-config", title: "Edit Config", body: "Web view coming soon." },
  { id: "init-config", title: "Init Config", body: "Web view coming soon." },
  { id: "discover", title: "Discover GitHub", body: "Web view coming soon." },
  { id: "add-repository", title: "Add Repository", body: "Web view coming soon." }
];

export function ExpertViewPanels() {
  return (
    <div class="expert-view-panels" data-expert-view-panels>
      <section class="card expert-view-panel" data-view-panel="repos" hidden>
        <h2>All Repositories</h2>
        <div data-repos-view>
          <EmptyState title="Loading repositories..." />
        </div>
      </section>
      {STUB_VIEWS.map(view => (
        <section class="card expert-view-panel" data-view-panel={view.id} hidden>
          <EmptyState title={view.title} body={view.body} />
        </section>
      ))}
    </div>
  );
}
