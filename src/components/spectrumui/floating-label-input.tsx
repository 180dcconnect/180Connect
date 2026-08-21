import * as React from "react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const FloatingInput = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => {
    return (
      <Input
        placeholder=" "
        className={cn("peer", className)}
        ref={ref}
        {...props}
      />
    );
  },
);
FloatingInput.displayName = "FloatingInput";

const FloatingLabel = React.forwardRef<
  React.ElementRef<typeof Label>,
  React.ComponentPropsWithoutRef<typeof Label>
>(({ className, ...props }, ref) => {
  return (
    <Label
      className={cn(
        // The floated label sits across the field's top border, so it has to
        // paint its container's own colour behind itself to cut the line. That
        // colour is whatever surface the field landed on, which the field cannot
        // know — so it reads three CSS variables, set by that surface (see the
        // TONES table in components/auth-dialog.tsx). The fallbacks are the bone
        // page, so a field dropped anywhere else still looks right.
        "absolute left-4 top-0 z-10 origin-left -translate-y-1/2 transform rounded-full bg-[var(--field-notch,#f4f4ef)] px-1.5 font-body text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--field-label,rgba(12,16,20,0.5))] transition-all duration-200 ease-out pointer-events-none peer-placeholder-shown:left-5 peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:bg-transparent peer-placeholder-shown:px-0 peer-placeholder-shown:text-xs peer-placeholder-shown:font-normal peer-placeholder-shown:normal-case peer-placeholder-shown:tracking-normal peer-placeholder-shown:text-[var(--field-placeholder,rgba(12,16,20,0.4))] peer-focus:left-4 peer-focus:top-0 peer-focus:-translate-y-1/2 peer-focus:rounded-full peer-focus:bg-[var(--field-notch,#f4f4ef)] peer-focus:px-1.5 peer-focus:font-body peer-focus:text-[11px] peer-focus:font-bold peer-focus:uppercase peer-focus:tracking-[0.12em] peer-focus:text-[var(--field-label-focus,rgba(12,16,20,0.7))]",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
FloatingLabel.displayName = "FloatingLabel";

type FloatingLabelInputProps = InputProps & { label?: string };

const FloatingLabelInput = React.forwardRef<
  React.ElementRef<typeof FloatingInput>,
  React.PropsWithoutRef<FloatingLabelInputProps>
>(({ id, label, className, ...props }, ref) => {
  return (
    <div className="relative">
      <FloatingInput ref={ref} id={id} className={className} {...props} />
      {label && <FloatingLabel htmlFor={id}>{label}</FloatingLabel>}
    </div>
  );
});
FloatingLabelInput.displayName = "FloatingLabelInput";

export { FloatingInput, FloatingLabel, FloatingLabelInput };

