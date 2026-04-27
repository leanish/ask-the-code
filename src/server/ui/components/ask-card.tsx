import { DropZone } from "./drop-zone.tsx";
import { FileList } from "./file-list.tsx";

export function AskCard() {
  return (
    <section class="card ask-card" aria-labelledby="ask-heading">
      <h2 id="ask-heading">Ask a question</h2>
      <textarea
        id="question"
        rows={6}
        placeholder="Ask a question about your code..."
      ></textarea>
      <div class="ask-actions">
        <button id="attach-button" class="button" type="button">📎 Attach files</button>
        <button
          id="ask-button"
          class="button primary"
          type="button"
          data-default-label="▶ Ask (Run Job)"
        >
          ▶ Ask (Run Job)
        </button>
      </div>
      <DropZone />
      <FileList />
    </section>
  );
}
