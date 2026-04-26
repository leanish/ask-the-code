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
        <button id="google-signin" class="button" type="button">Sign in with Google</button>
      </div>
    </header>
  );
}
