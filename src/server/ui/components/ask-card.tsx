import { DropZone } from "./drop-zone.tsx";
import { FileList } from "./file-list.tsx";

export function AskCard() {
  return (
    <section class="panel ask-panel" data-new-ask-panel>
      <form data-ask-form>
        <div class="panel-heading">
          <div>
            <h2>New Ask</h2>
            <p>Ask a question about your configured repositories.</p>
          </div>
          <button class="primary-button" type="submit" data-submit-button>Ask</button>
        </div>
        <label class="input-label" for="question">Question</label>
        <textarea id="question" name="question" data-question-input placeholder="How does this code path work?" required></textarea>
        <DropZone />
        <FileList />
      </form>
    </section>
  );
}
