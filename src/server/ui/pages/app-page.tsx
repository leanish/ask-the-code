import { AfterTheRun } from "../components/after-the-run.tsx";
import { AnswerCard } from "../components/answer-card.tsx";
import { AskCard } from "../components/ask-card.tsx";
import { Header, HeaderActions } from "../components/header.tsx";
import { AdvancedViewPanels } from "../components/advanced-view-panels.tsx";
import { ModeSwitch } from "../components/mode-switch.tsx";
import { OptionsPanel } from "../components/options-panel.tsx";
import { ProgressPanel } from "../components/progress-panel.tsx";
import { Sidebar } from "../components/sidebar.tsx";
import { resolvePackageVersion } from "../package-version.ts";

type AppPageProps = {
  mode: "simple" | "advanced";
};

export function AppPage({ mode }: AppPageProps) {
  const version = resolvePackageVersion();

  return (
    <html lang="en" data-theme="system">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>ask-the-code</title>
        <link rel="icon" type="image/svg+xml" href="/ui/assets/logo.svg" />
        <link rel="stylesheet" href="/ui/assets/styles.css" />
        <script src="/ui/assets/vendor/marked.min.js"></script>
        <script src="/ui/assets/vendor/purify.min.js"></script>
        <script type="module" src="/ui/assets/app.js"></script>
      </head>
      <body data-mode={mode}>
        <div class="app-shell" data-app-root data-mode={mode}>
          <Sidebar version={version} />
          <div class="app-content">
            <div class="advanced-topbar" data-advanced-only>
              <ModeSwitch mode={mode} />
              <div class="header-actions">
                <HeaderActions />
              </div>
            </div>
            <div class="simple-only">
              <Header mode={mode} />
            </div>
            <main class="app-layout">
              <section class="workbench" aria-label="Ask the code">
                <AskCard />
                <AnswerCard />
                <AdvancedViewPanels />
              </section>
              <aside class="run-column" aria-label="Run details">
                <OptionsPanel />
                <ProgressPanel />
                <AfterTheRun advanced={mode === "advanced"} />
              </aside>
            </main>
          </div>
          <div class="toast-region" data-toast-region aria-live="polite"></div>
        </div>
      </body>
    </html>
  );
}
