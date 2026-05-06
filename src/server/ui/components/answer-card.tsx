export function AnswerCard() {
  return (
    <section class="panel answer-panel" data-answer-panel data-new-ask-panel hidden>
      <div class="panel-heading compact">
        <div>
          <h2>Answer</h2>
          <p data-answer-summary>Markdown rendered locally in your browser.</p>
        </div>
        <div class="answer-actions">
          <button class="secondary-button" type="button" data-copy-answer>Copy</button>
          <button class="secondary-button" type="button" data-download-answer>Download Markdown</button>
        </div>
      </div>
      <article class="answer-content" data-answer-content></article>
    </section>
  );
}
