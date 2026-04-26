export function Logo({ width = 48, height = 24 }: { width?: number; height?: number } = {}) {
  return <img class="logo" src="/ui/assets/logo.svg" alt="ATC" width={width} height={height} />;
}
