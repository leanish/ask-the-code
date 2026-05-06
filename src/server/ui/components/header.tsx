import { Logo } from "./logo.tsx";
import { ModeSwitch } from "./mode-switch.tsx";

type HeaderProps = {
  mode: "simple" | "advanced";
};

export function Header({ mode }: HeaderProps) {
  return (
    <header class="app-header">
      <div class="brand-lockup">
        <Logo />
        <div>
          <h1>ask-the-code</h1>
        </div>
      </div>
      <div class="header-actions">
        <ModeSwitch mode={mode} />
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
