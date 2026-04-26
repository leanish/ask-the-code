export function FileList() {
  return (
    <>
      <div id="file-list" class="file-list" aria-live="polite"></div>
      <div id="attach-banner" class="attach-banner" hidden>
        Attachments are preview-only in this build.
      </div>
    </>
  );
}
