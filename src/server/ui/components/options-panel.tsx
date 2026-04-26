export function OptionsPanel() {
  return (
    <section class="panel options-panel collapsible-panel" data-expert-only data-collapsible-panel="options">
      <div class="panel-heading compact collapsible-heading">
        <div>
          <h2>Options</h2>
        </div>
        <button
          class="collapse-toggle"
          type="button"
          aria-expanded="false"
          aria-controls="options-panel-body"
          aria-label="Toggle Options"
          data-collapsible-trigger="options"
        ></button>
      </div>
      <div id="options-panel-body" class="options-grid" data-collapsible-body="options" hidden>
        <fieldset>
          <legend>Audience</legend>
          <label class="segmented-option">
            <input type="radio" name="audience" value="general" checked />
            <span>General</span>
          </label>
          <label class="segmented-option">
            <input type="radio" name="audience" value="codebase" />
            <span>Codebase</span>
          </label>
        </fieldset>
        <label>
          <span>Model</span>
          <select name="model" data-expert-option>
            <option value="gpt-5.4">gpt-5.4</option>
            <option value="gpt-5.4-mini" selected>gpt-5.4-mini</option>
          </select>
        </label>
        <label>
          <span>Reasoning effort</span>
          <select name="reasoningEffort" data-expert-option>
            <option value="low" selected>Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
        <label>
          <span>Repo selection mode</span>
          <select name="selectionMode" data-expert-option>
            <option value="single">Single</option>
            <option value="cascade">Cascade (Smart)</option>
            <option value="all">All</option>
          </select>
        </label>
        <label class="toggle-row">
          <span>Skip repository sync</span>
          <input type="checkbox" name="noSync" data-expert-option />
        </label>
        <label class="toggle-row">
          <span>No synthesis (raw results)</span>
          <input type="checkbox" name="noSynthesis" data-expert-option />
        </label>
        <label class="toggle-row">
          <span>Selection shadow compare</span>
          <input type="checkbox" name="selectionShadowCompare" data-expert-option />
        </label>
      </div>
    </section>
  );
}
