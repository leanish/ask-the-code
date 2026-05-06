type ModeSwitchProps = {
  mode: "simple" | "advanced";
};

export function ModeSwitch({ mode }: ModeSwitchProps) {
  return (
    <div class="mode-switch" role="tablist" aria-label="UI mode">
      <button type="button" role="tab" aria-selected={mode === "simple"} data-mode-target="simple">
        Simple
      </button>
      <button type="button" role="tab" aria-selected={mode === "advanced"} data-mode-target="advanced">
        Advanced
      </button>
    </div>
  );
}
