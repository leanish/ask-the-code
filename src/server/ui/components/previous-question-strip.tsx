export function PreviousQuestionStrip() {
  return (
    <section class="card previous-question" aria-labelledby="previous-question-heading">
      <div>
        <h2 id="previous-question-heading">Your previous question</h2>
        <p class="empty">No previous questions yet.</p>
      </div>
      <span class="previous-question-meta">Today</span>
    </section>
  );
}
