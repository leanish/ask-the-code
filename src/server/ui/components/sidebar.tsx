import { Logo } from "./logo.tsx";

type SidebarProps = {
  version: string;
};

export function Sidebar({ version }: SidebarProps) {
  return (
    <aside class="advanced-sidebar" data-advanced-sidebar>
      <div class="sidebar-brand">
        <Logo />
        <div>
          <h1>ask-the-code</h1>
        </div>
      </div>
      <nav class="sidebar-nav" aria-label="Advanced navigation">
        <SidebarSection title="ASK" items={[
          ["#new-ask", "Ask", null, true],
          ["#history", "History", null, false]
        ]} />
        <SidebarSection title="REPOSITORIES" items={[
          ["#repos", "All Repositories", null, false],
          ["#sync-status", "Sync Status", null, false]
        ]} />
        <SidebarSection title="CONFIG" items={[
          ["#config-path", "Config Path", null, false],
          ["#edit-config", "Edit Config", null, false],
          ["#init-config", "Init Config", null, false]
        ]} />
        <SidebarSection title="TOOLS" items={[
          ["#discover", "Discover GitHub", null, false],
          ["#add-repository", "Add Repository", null, false]
        ]} />
      </nav>
      <footer class="sidebar-footer">ATC v{version}</footer>
    </aside>
  );
}

type SidebarSectionProps = {
  title: string;
  items: Array<[href: string, label: string, count: string | null, active: boolean]>;
};

function SidebarSection({ title, items }: SidebarSectionProps) {
  return (
    <section class="sidebar-section">
      <h2>{title}</h2>
      {items.map(([href, label, count, active]) => (
        <a class={active ? "active" : ""} href={href} data-view-link={href.slice(1)}>
          <span>{label}</span>
          {count ? <span class="sidebar-count">{count}</span> : null}
        </a>
      ))}
    </section>
  );
}
