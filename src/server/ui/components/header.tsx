import { Logo } from "./logo.tsx";

export function Header({ subtitle = "Repo-aware · Codex" }: { subtitle?: string } = {}) {
  return (
    <header class="header">
      <div class="brand">
        <Logo />
        <div class="brand-text">
          <strong>ask-the-code (ATC)</strong>
          <small>{subtitle}</small>
        </div>
      </div>
      <div class="header-actions">
        <button id="theme-toggle" class="icon-button" type="button" aria-label="Toggle theme">☀</button>
        <div id="auth-area" class="auth-area" data-auth-state="unknown">
          <button id="github-signin" class="button" type="button" hidden>
            <span aria-hidden="true">🐙</span> Sign in with GitHub
          </button>
          <span id="auth-user" class="auth-user" hidden>
            <img id="auth-avatar" alt="" width="20" height="20" />
            <span id="auth-name"></span>
            <button id="auth-logout" class="auth-logout" type="button" aria-label="Sign out">⎋</button>
          </span>
        </div>
      </div>
    </header>
  );
}
