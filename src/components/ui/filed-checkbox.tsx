"use client";

import {
  Checkbox,
  type CheckboxProps,
} from "@/components/animate-ui/components/radix/checkbox";
import { cn } from "@/lib/utils";

/**
 * The app's checkbox: the animated animate-ui checkbox (the one on the Terms &
 * Conditions step of the reset-password form — the tick draws itself in) in
 * Filed Record tokens. Checked is `--lead`, not the stock brand green.
 *
 * Use this, never a native `<input type="checkbox">` with `accent-*`: the
 * native control ignores the app's tokens and differs per browser. Pair it
 * with a `<label htmlFor>` pointing at its `id` — it renders a button, so
 * wrapping it in a label is not enough for every screen reader.
 *
 * The checked-state classes repeat the base component's own arbitrary variant
 * (`[&[data-state=checked],&[data-state=indeterminate]]`) on purpose: that is
 * what lets tailwind-merge replace its green rather than emit both and leave
 * the winner to stylesheet order.
 */
export function FiledCheckbox({ className, ...props }: CheckboxProps) {
  return (
    <Checkbox
      size="sm"
      className={cn(
        "border-rule bg-white focus-visible:ring-2 focus-visible:ring-lead/30",
        "[&[data-state=checked],&[data-state=indeterminate]]:border-lead [&[data-state=checked],&[data-state=indeterminate]]:bg-lead [&[data-state=checked],&[data-state=indeterminate]]:text-white",
        className,
      )}
      {...props}
    />
  );
}
