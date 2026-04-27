interface NavItem {
  id: string;
  label: string;
  badge?: string;
}

interface NavGroup {
  section: string;
  items: NavItem[];
}

const NAV: ReadonlyArray<NavGroup> = [
  {
    section: "Ask",
    items: [
      { id: "new-ask", label: "+ New Ask" },
      { id: "history", label: "History", badge: "—" }
    ]
  },
  {
    section: "Repositories",
    items: [
      { id: "repos", label: "All Repositories" },
      { id: "sync-status", label: "Sync Status" }
    ]
  },
  {
    section: "Config",
    items: [
      { id: "config-path", label: "Config Path" },
      { id: "edit-config", label: "Edit Config" },
      { id: "init-config", label: "Init Config" }
    ]
  },
  {
    section: "Tools",
    items: [
      { id: "discover", label: "Discover GitHub" },
      { id: "add-repository", label: "+ Add Repository" }
    ]
  }
];

export function Sidebar({ version }: { version: string }) {
  return (
    <aside class="sidebar">
      <div class="brand" style="gap:0.5rem">
        <img src="/ui/assets/logo.svg" alt="" width="48" height="24" />
        <div>
          <h1>ask-the-code (ATC)</h1>
          <small style="color:#8b95a0">Repo-aware · Local</small>
        </div>
      </div>
      {NAV.map(group => (
        <nav class="sidebar-section" aria-label={group.section}>
          <div class="sidebar-section-title">{group.section}</div>
          {group.items.map(item => (
            <a class="sidebar-link" href={`#${item.id}`} data-view={item.id}>
              <span>{item.label}</span>
              {item.badge ? (
                <span class="sidebar-badge" data-badge={item.id}>
                  {item.badge}
                </span>
              ) : null}
            </a>
          ))}
        </nav>
      ))}
      <div class="sidebar-footer">ATC v{version}</div>
    </aside>
  );
}
