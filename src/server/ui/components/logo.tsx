export function Logo() {
  return (
    <svg class="logo-mark" viewBox="0 0 48 48" role="img" aria-label="ATC">
      <defs>
        <linearGradient id="atc-logo-gradient" x1="4" x2="44" y1="42" y2="6" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#14b8a6" />
          <stop offset="0.35" stop-color="#38bdf8" />
          <stop offset="0.7" stop-color="#a855f7" />
          <stop offset="1" stop-color="#f97316" />
        </linearGradient>
      </defs>
      <rect x="5" y="5" width="38" height="38" rx="8" fill="url(#atc-logo-gradient)" />
      <path d="M15 31h4l1.4-4.2h7.2L29 31h4L25.8 13h-3.6L15 31Zm6.5-7.5 2.5-7.1 2.5 7.1h-5Z" fill="#fff" />
    </svg>
  );
}
