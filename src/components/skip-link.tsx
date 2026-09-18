/**
 * "Skip to content" — the first thing Tab reaches on a signed-in page, so a
 * keyboard or screen-reader user does not walk the whole sidebar on every
 * navigation. Invisible until focused. Targets the shell's `<main id="main-content">`.
 */
export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="sr-only rounded-inset bg-ink px-3 py-2 text-[13px] font-medium text-white focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100]"
    >
      Skip to content
    </a>
  );
}
