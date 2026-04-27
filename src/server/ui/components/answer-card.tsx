export function AnswerCard() {
  return (
    <section
      id="answer-card"
      class="card answer-card"
      aria-labelledby="answer-heading"
      hidden
    >
      <h2 id="answer-heading">Answer</h2>
      <div id="answer" class="answer"></div>
      <div class="answer-actions">
        <button id="copy-answer" class="button" type="button">📋 Copy Answer</button>
        <button id="download-answer" class="button" type="button">⬇ Download Markdown</button>
      </div>
    </section>
  );
}
