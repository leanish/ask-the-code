export function DropZone() {
  return (
    <div id="drop-zone" class="drop-zone">
      <div>Drag &amp; drop files here, or click to browse</div>
      <div style="font-size:0.78rem;margin-top:0.25rem">PDF, PNG, JPG, MP4, MOV, TXT · Max 100 MB each</div>
      <input id="file-input" type="file" multiple hidden />
    </div>
  );
}
