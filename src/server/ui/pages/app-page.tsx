import { AfterTheRun } from "../components/after-the-run.tsx";
import { AnswerCard } from "../components/answer-card.tsx";
import { AskCard } from "../components/ask-card.tsx";
import { ExpertViewPanels } from "../components/expert-view-panels.tsx";
import { Header } from "../components/header.tsx";
import { ModeSwitch } from "../components/mode-switch.tsx";
import { OptionsPanel } from "../components/options-panel.tsx";
import { PreviousQuestionStrip } from "../components/previous-question-strip.tsx";
import { ProgressPanel } from "../components/progress-panel.tsx";
import { Sidebar } from "../components/sidebar.tsx";
import { resolvePackageVersion } from "../package-version.ts";

export type AppMode = "simple" | "expert";

export interface AppPageProps {
  mode: AppMode;
}

export function AppPage({ mode }: AppPageProps) {
  const version = resolvePackageVersion();
  return (
    <html lang="en" data-theme="light">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>ask-the-code</title>
        <link rel="stylesheet" href="/ui/assets/styles.css" />
        <link rel="icon" type="image/svg+xml" href="/ui/assets/logo.svg" />
        <script src="/ui/assets/vendor/marked.min.js" defer></script>
        <script src="/ui/assets/vendor/purify.min.js" defer></script>
        <script type="module" src="/ui/assets/app.js" defer></script>
      </head>
      <body data-mode={mode}>
        <div class="app-shell" data-mode={mode} data-view="new-ask">
          <Sidebar version={version} />
          <main class="main-area" id="main-area">
            <Header />
            <ModeSwitch active={mode} />
            <AskCard />
            <OptionsPanel />
            <ProgressPanel />
            <AnswerCard />
            <PreviousQuestionStrip />
            <AfterTheRun />
            <ExpertViewPanels />
          </main>
        </div>
        <div class="toast-region" data-toast-region aria-live="polite"></div>
      </body>
    </html>
  );
}
