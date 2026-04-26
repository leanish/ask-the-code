export function DropZone() {
  return (
    <div class="drop-zone" data-drop-zone>
      <input class="file-input" type="file" multiple data-file-input aria-label="Attach files" />
      <div>
        <strong>Attach files</strong>
        <p>Drop files here or browse. Attachments are included in the run.</p>
      </div>
      <button class="secondary-button" type="button" data-browse-files>Browse</button>
    </div>
  );
}
