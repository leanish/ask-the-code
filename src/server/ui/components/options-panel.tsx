export function OptionsPanel() {
  return (
    <section class="card options-card" aria-labelledby="options-heading">
      <h2 id="options-heading">Options</h2>
      <div class="options-list">
        <label>
          Audience
          <select id="opt-audience">
            <option value="general" selected>General</option>
            <option value="codebase">Codebase</option>
          </select>
        </label>
        <label>
          Model
          <select id="opt-model">
            <option value="" selected>(default)</option>
            <option value="gpt-5.4">gpt-5.4</option>
            <option value="gpt-5.4-mini">gpt-5.4-mini</option>
          </select>
        </label>
        <label>
          Reasoning effort
          <select id="opt-reasoning">
            <option value="" selected>(default)</option>
            <option value="none">none</option>
            <option value="minimal">minimal</option>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="xhigh">xhigh</option>
          </select>
        </label>
        <label>
          Repo selection mode
          <select id="opt-selection-mode">
            <option value="" selected>(default)</option>
            <option value="cascade">cascade</option>
            <option value="single">single</option>
          </select>
        </label>
        <label class="toggle-row">
          Skip repository sync
          <input id="opt-no-sync" type="checkbox" />
        </label>
        <label class="toggle-row">
          No synthesis (raw results)
          <input id="opt-no-synthesis" type="checkbox" />
        </label>
        <label class="toggle-row">
          Selection shadow compare
          <input id="opt-shadow-compare" type="checkbox" />
        </label>
      </div>
    </section>
  );
}
