import { Logo } from "./logo.tsx";

export function Header() {
  return (
    <header class="app-header">
      <div class="brand-lockup">
        <Logo />
        <div>
          <h1>ask-the-code (ATC)</h1>
          <p>Repo-aware · Codex</p>
        </div>
      </div>
      <div class="header-actions">
        <HeaderActions />
      </div>
    </header>
  );
}

export function HeaderActions() {
  return (
    <>
      <button class="icon-button" type="button" data-theme-toggle aria-label="Toggle theme" title="Toggle theme">
        <span data-theme-icon>◐</span>
      </button>
      <button class="secondary-button" type="button" data-auth-signin>Sign in with GitHub</button>
    </>
  );
}
