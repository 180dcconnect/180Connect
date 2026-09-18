/**
 * What the sidebar's frosted glass actually blurs: brand green, pooled at the
 * top-left where the navigation sits and lifted again along the bottom under
 * the account block, so the rail is brightest exactly where it is busiest.
 *
 * Both layers stay in green. The dark `--brand-hover` was tried here and is
 * too desaturated to survive a 40px blur — it lands as grey dirt rather than
 * depth. Neither fades to `transparent` either: that keyword is rgba(0,0,0,0),
 * so the ramp would run through grey for the same reason.
 *
 * The lower layer is linear, not a second ellipse — an ellipse's edge is still
 * legible through the blur at this scale, and read as a rendering fault.
 * The mask retires the panel's own right edge, so no boundary can show
 * whatever a page puts beside it or however wide the rail is collapsed to.
 *
 * Lives in its own file because two shells now sit on it — the app shell and
 * the settings shell — and docs/design-system.md §Source of truth is explicit
 * that a colour gets one definition, not a copy per caller.
 */
export function ShellWash() {
  const fadeOutRight = "linear-gradient(to right, #000 55%, rgba(0, 0, 0, 0) 100%)";

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-y-0 left-0 -z-10 w-[420px]"
      style={{
        background: [
          "radial-gradient(85% 55% at 0% 0%, rgba(114, 183, 68, 0.45), rgba(114, 183, 68, 0) 72%)",
          "linear-gradient(to bottom, rgba(114, 183, 68, 0) 22%, rgba(114, 183, 68, 0.26) 100%)",
        ].join(", "),
        WebkitMaskImage: fadeOutRight,
        maskImage: fadeOutRight,
      }}
    />
  );
}
