export function ModeSwitch({ active }: { active: "simple" | "expert" }) {
  return (
    <div class="mode-switch" role="tablist">
      <button type="button" data-mode="simple" aria-pressed={active === "simple" ? "true" : "false"}>
        ⚡ Simple
      </button>
      <button type="button" data-mode="expert" aria-pressed={active === "expert" ? "true" : "false"}>
        ✦ Expert
      </button>
    </div>
  );
}
