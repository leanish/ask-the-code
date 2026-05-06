import { DropZone } from "./drop-zone.tsx";
import { FileList } from "./file-list.tsx";

export function AskCard() {
  return (
    <section class="panel ask-panel" data-new-ask-panel>
      <form data-ask-form>
        <label class="input-label" for="question">Ask a question about your configured repositories</label>
        <textarea id="question" name="question" data-question-input placeholder="How does this code path work?" required></textarea>
        <div class="ask-action-row">
          <DropZone />
          <button class="primary-button" type="submit" data-submit-button>Ask</button>
        </div>
        <FileList />
      </form>
    </section>
  );
}
