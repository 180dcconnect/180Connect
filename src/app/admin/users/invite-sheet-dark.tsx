"use client";

import { useState, useTransition, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Liquid } from "liquid-gooey";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetClose,
} from "@/components/animate-ui/components/radix/sheet";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/animate-ui/components/radix/radio-group";
import { AnimateIcon } from "@/components/animate-ui/icons/icon";
import { XIcon } from "@/components/animate-ui/icons/x";
import {
  sendInviteAction,
  sendBulkInvitesAction,
  type BulkInviteRecipient,
} from "./invite-actions";
import { GooeyActionButton } from "@/components/ui/gooey-action-button";
import { OriginButton } from "@/components/ui/origin-button";
import { FloatingLabelInput } from "@/components/spectrumui/floating-label-input";
import { fieldClass, fieldVars } from "@/components/brand/fields";
import type { InviteRole, InviteState } from "@/lib/auth/invite";
import { cn } from "@/lib/utils";
import { entranceSoft } from "@/components/brand/motion";
import { GROUND, INK_RAISED } from "@/components/brand/tokens";
import {
  UserPlus,
  Plus,
  Trash2,
  AlertCircle,
  Mail,
  Check,
  Info,
  ChevronDown,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { ROLE_OPTIONS } from "./role-options";
import {
  MAX_BULK_RECIPIENTS,
  validateInviteEmail,
  validateInviteName,
} from "./invite-validation";
import { DEFAULT_ALLOWED_EMAIL_DOMAIN, describeDomains } from "@/lib/auth/email-domain";

type InviteMode = "single" | "multiple";

interface StagedRecipient {
  id: string;
  email: string;
  fullName: string;
  role: InviteRole;
  isValid: boolean;
  error?: string;
  /** Filled in from the server's per-recipient result after a send attempt. */
  serverError?: string;
}

function getStagedInitials(name: string, email: string): string {
  if (name.trim()) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

const STAGED_ROLE_CONFIG: Record<
  InviteRole,
  { label: string; badge: string; optionClass: string }
> = {
  cam: {
    label: "CAM",
    badge: "border-[#e6f5c0]/30 bg-[#e6f5c0]/15 text-[#e6f5c0]",
    optionClass: "bg-[#161d26] text-[#e6f5c0]",
  },
  admin: {
    label: "Admin",
    badge: "border-[#f5efc6]/30 bg-[#f5efc6]/15 text-[#f5efc6]",
    optionClass: "bg-[#161d26] text-[#f5efc6]",
  },
  viewer: {
    label: "Viewer",
    badge: "border-sky-400/30 bg-sky-400/15 text-sky-200",
    optionClass: "bg-[#161d26] text-sky-200",
  },
};

export interface DarkInviteSheetProps {
  /**
   * The domains an invite may be sent to, resolved on the server from
   * AUTH_ALLOWED_EMAIL_DOMAIN. Defaulted so the sheet still refuses obviously
   * wrong addresses if a caller forgets to pass it — never widened.
   */
  allowedDomains?: readonly string[];
  /** Emails that already have an active pending invitation */
  pendingEmails?: readonly string[];
  /** Emails of already registered / active team members */
  existingUserEmails?: readonly string[];
  /** Emails of previously deactivated team members */
  deactivatedEmails?: readonly string[];
}

/**
 * Dark-tone Invite Sheet adhering to the Hero Menu / Dark Login Dialog design system:
 * - Surface: INK_RAISED (#161b21) solid obsidian glass
 * - Typography: Bold headline (text-[clamp(1.75rem,4vw,2.25rem)] font-black tracking-[-0.03em])
 * - Subtext: GROUND (#f4f4ef) at 55% opacity
 * - Floating inputs notched with INK_RAISED
 * - Signature dual-capsule Brand CTA buttons (BrandCtaButton)
 * - AnimateIcon close trigger with hover/tap animations
 */
export function DarkInviteSheet({
  allowedDomains = [DEFAULT_ALLOWED_EMAIL_DOMAIN],
  pendingEmails = [],
  existingUserEmails = [],
  deactivatedEmails = [],
}: DarkInviteSheetProps = {}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<InviteMode>("single");
  const [defaultRole, setDefaultRole] = useState<InviteRole>("cam");

  const pendingSet = new Set((pendingEmails ?? []).map((e) => e.toLowerCase().trim()));
  const existingUsersSet = new Set((existingUserEmails ?? []).map((e) => e.toLowerCase().trim()));
  const deactivatedSet = new Set((deactivatedEmails ?? []).map((e) => e.toLowerCase().trim()));

  // Single mode state
  const [singleName, setSingleName] = useState("");
  const [singleEmail, setSingleEmail] = useState("");
  const [singleStatus, setSingleStatus] = useState<InviteState>({ status: "idle" });
  const [isPendingSingle, startSingleTransition] = useTransition();

  // Touched-state so a pristine form is not scolded for being empty; the send
  // button is gated on validity either way.
  const [singleEmailTouched, setSingleEmailTouched] = useState(false);
  const [singleNameTouched, setSingleNameTouched] = useState(false);

  const isPendingInvite = pendingSet.has(singleEmail.toLowerCase().trim());
  const isExistingUser = existingUsersSet.has(singleEmail.toLowerCase().trim());
  const isDeactivated = deactivatedSet.has(singleEmail.toLowerCase().trim());

  const singleEmailBaseError = validateInviteEmail(singleEmail, allowedDomains);
  const singleEmailError =
    isPendingInvite
      ? "This email already has a pending invitation."
      : isDeactivated
      ? "This email belongs to a deactivated account. Reactivate them from the team list instead."
      : isExistingUser
      ? "A team member with this email address already exists."
      : singleEmailBaseError;
  const singleNameError = validateInviteName(singleName);
  const isSingleFormValid = singleEmailError === null && singleNameError === null;

  const domainHint = describeDomains([...allowedDomains]);


  /**
   * What to show under the email field: the server's field error wins (it saw
   * the real insert), then the server's general error, then our own check once
   * the admin has actually typed something.
   */
  const visibleSingleEmailError =
    singleStatus.fieldErrors?.email?.[0] ??
    (singleEmailTouched && singleEmail.trim() !== "" ? singleEmailError : null);
  const visibleSingleNameError =
    singleStatus.fieldErrors?.fullName?.[0] ??
    (singleNameTouched && singleName.trim() !== "" ? singleNameError : null);

  // Multiple mode state
  const [rawEmailsInput, setRawEmailsInput] = useState("");
  const [stagedRecipients, setStagedRecipients] = useState<StagedRecipient[]>([]);
  const [duplicateToast, setDuplicateToast] = useState<string | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [bulkStatus, setBulkStatus] = useState<{
    status: "idle" | "success" | "warning" | "error";
    message?: string;
  }>({ status: "idle" });
  const [isPendingBulk, startBulkTransition] = useTransition();
  const isBulkFormValid =
    stagedRecipients.length > 0 &&
    stagedRecipients.length <= MAX_BULK_RECIPIENTS &&
    stagedRecipients.every(
      (r) =>
        validateInviteEmail(r.email, allowedDomains) === null &&
        validateInviteName(r.fullName) === null,
    );

  function resetForm() {
    setSingleName("");
    setSingleEmail("");
    setSingleStatus({ status: "idle" });
    setRawEmailsInput("");
    setStagedRecipients([]);
    setBulkStatus({ status: "idle" });
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setDuplicateToast(null);
  }

  function handleParseEmails() {
    if (!rawEmailsInput.trim()) return;

    // Parse lines, comma/semicolon delimiters, and RFC822 "Name <email@domain>" format
    const extractedEntries: Array<{ email: string; fullName?: string }> = [];
    const lines = rawEmailsInput.split(/[\r\n;]+/);

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      const chunks = trimmedLine.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
      for (const chunk of chunks) {
        const trimmed = chunk.trim();
        if (!trimmed) continue;

        const angleMatch = trimmed.match(/^(?:["']?([^"']+)["']?\s+)?<([^>]+)>$/);
        if (angleMatch) {
          const name = angleMatch[1]?.trim();
          const email = angleMatch[2]?.trim();
          if (email) {
            extractedEntries.push({ email, fullName: name || undefined });
            continue;
          }
        }

        const spaceTokens = trimmed.split(/[\s\t]+/);
        for (const token of spaceTokens) {
          const clean = token.replace(/^[<"']+|[>"']+$/g, "").trim();
          if (clean) {
            extractedEntries.push({ email: clean });
          }
        }
      }
    }

    const existingMap = new Map(stagedRecipients.map((r) => [r.email, r]));
    const seenBatchEmails = new Set<string>();
    const uniqueNew: StagedRecipient[] = [];
    const updatedStagedIds = new Set<string>();
    const duplicateEmails: string[] = [];
    const pendingSkipped: string[] = [];
    const existingUserSkipped: string[] = [];
    const deactivatedSkipped: string[] = [];
    let overflowCount = 0;

    extractedEntries.forEach((entry, idx) => {
      const lower = entry.email.toLowerCase();

      if (pendingSet.has(lower)) {
        pendingSkipped.push(lower);
        return;
      }

      if (deactivatedSet.has(lower)) {
        deactivatedSkipped.push(lower);
        return;
      }

      if (existingUsersSet.has(lower)) {
        existingUserSkipped.push(lower);
        return;
      }

      if (seenBatchEmails.has(lower)) {
        duplicateEmails.push(lower);
        return;
      }

      seenBatchEmails.add(lower);

      // If already staged in the list, re-staging updates its role to the currently selected role
      if (existingMap.has(lower)) {
        const existing = existingMap.get(lower)!;
        existingMap.set(lower, {
          ...existing,
          role: defaultRole,
        });
        updatedStagedIds.add(existing.id);
        return;
      }

      // Refuse past the cap rather than staging rows the send cannot finish.
      if (stagedRecipients.length + uniqueNew.length >= MAX_BULK_RECIPIENTS) {
        overflowCount++;
        return;
      }

      const namePart = lower.split("@")[0].replace(/[._-]/g, " ");
      const derivedName = namePart
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ")
        .trim();

      const finalName = entry.fullName?.trim() || derivedName;

      // The derived name is a guess and can come out empty ("___@…"), so it
      // goes through the same check the admin's own edit does.
      const error =
        validateInviteEmail(lower, allowedDomains) ??
        validateInviteName(finalName) ??
        undefined;
      const isValid = error === undefined;

      uniqueNew.push({
        id: `dark-staged-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
        email: lower,
        fullName: finalName,
        role: defaultRole,
        isValid,
        error,
      });
    });

    if (uniqueNew.length > 0 || updatedStagedIds.size > 0) {
      setStagedRecipients((curr) => {
        const updated = curr.map((r) => (existingMap.has(r.email) ? existingMap.get(r.email)! : r));
        return [...updated, ...uniqueNew];
      });
    }
    setBulkStatus(
      overflowCount > 0
        ? {
            status: "error",
            message: `${MAX_BULK_RECIPIENTS} recipients is the limit for one batch — ${overflowCount} address${overflowCount === 1 ? " was" : "es were"} not staged. Send these first, then paste the rest.`,
          }
        : { status: "idle" },
    );

    const totalSkipped =
      duplicateEmails.length +
      pendingSkipped.length +
      existingUserSkipped.length +
      deactivatedSkipped.length;

    if (totalSkipped > 0) {
      let message = "";
      if (
        pendingSkipped.length > 0 &&
        duplicateEmails.length === 0 &&
        existingUserSkipped.length === 0 &&
        deactivatedSkipped.length === 0
      ) {
        const uniquePending = Array.from(new Set(pendingSkipped));
        message =
          uniquePending.length === 1
            ? `Skipped: ${uniquePending[0]} already has a pending invitation.`
            : `${pendingSkipped.length} email(s) skipped: already have pending invitations.`;
      } else if (
        deactivatedSkipped.length > 0 &&
        duplicateEmails.length === 0 &&
        pendingSkipped.length === 0 &&
        existingUserSkipped.length === 0
      ) {
        const uniqueDeactivated = Array.from(new Set(deactivatedSkipped));
        message =
          uniqueDeactivated.length === 1
            ? `Skipped: ${uniqueDeactivated[0]} is deactivated (reactivate from team list).`
            : `${deactivatedSkipped.length} email(s) skipped: deactivated accounts (reactivate from list).`;
      } else if (
        existingUserSkipped.length > 0 &&
        duplicateEmails.length === 0 &&
        pendingSkipped.length === 0 &&
        deactivatedSkipped.length === 0
      ) {
        const uniqueExisting = Array.from(new Set(existingUserSkipped));
        message =
          uniqueExisting.length === 1
            ? `Skipped: ${uniqueExisting[0]} is already an active team member.`
            : `${existingUserSkipped.length} email(s) skipped: already existing team members.`;
      } else if (
        duplicateEmails.length > 0 &&
        pendingSkipped.length === 0 &&
        existingUserSkipped.length === 0 &&
        deactivatedSkipped.length === 0
      ) {
        const uniqueDupes = Array.from(new Set(duplicateEmails));
        message =
          uniqueDupes.length === 1
            ? `Duplicate skipped: ${uniqueDupes[0]} is already staged.`
            : `${duplicateEmails.length} duplicate email(s) skipped (kept single copy).`;
      } else {
        message = `${totalSkipped} email(s) skipped (duplicate, pending, deactivated, or existing).`;
      }

      setDuplicateToast(message);
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = setTimeout(() => {
        setDuplicateToast(null);
      }, 5000);
    }
  }

  function handleRemoveStaged(id: string) {
    setStagedRecipients((curr) => curr.filter((r) => r.id !== id));
  }

  function handleUpdateStaged(
    id: string,
    updates: Partial<Pick<StagedRecipient, "fullName" | "role">>,
  ) {
    setStagedRecipients((curr) =>
      curr.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, ...updates, serverError: undefined };
        // Clearing the name is the easy way to stage a row the server will
        // take but nobody wants: an account with a blank name.
        const error =
          validateInviteEmail(next.email, allowedDomains) ??
          validateInviteName(next.fullName) ??
          undefined;
        return { ...next, error, isValid: error === undefined };
      }),
    );
  }

  async function handleSingleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // The droplet button is disabled while invalid, but a form can also be
    // submitted with Enter, and `required`/`type=email` do not know about the
    // allowlist — so the guard is here rather than only on the button.
    setSingleNameTouched(true);
    setSingleEmailTouched(true);
    if (singleNameError || singleEmailError) {
      setSingleStatus({
        status: "error",
        fieldErrors: {
          ...(singleNameError ? { fullName: [singleNameError] } : {}),
          ...(singleEmailError ? { email: [singleEmailError] } : {}),
        },
      });
      return;
    }

    setSingleStatus({ status: "idle" });

    startSingleTransition(async () => {
      const formData = new FormData();
      formData.set("email", singleEmail.trim());
      formData.set("role", defaultRole);
      formData.set("fullName", singleName.trim());

      try {
        const result = await sendInviteAction({ status: "idle" }, formData);
        setSingleStatus(result);

        // `warning` means the account exists but the email never went out, so
        // the list has a new pending row either way.
        if (result.status === "success" || result.status === "warning") {
          router.refresh();
        }
      } catch {
        // A Server Action can fail before it returns state at all — network
        // drop, a redeploy mid-request. Without this the sheet just sits in
        // its pending state forever with no explanation.
        setSingleStatus({
          status: "error",
          message: "Could not reach the server. Check your connection and try again.",
        });
      }
    });
  }

  async function handleBulkSubmit() {
    if (stagedRecipients.length === 0) {
      setBulkStatus({ status: "error", message: "Stage at least one email address first." });
      return;
    }

    if (stagedRecipients.length > MAX_BULK_RECIPIENTS) {
      setBulkStatus({
        status: "error",
        message: `Remove ${stagedRecipients.length - MAX_BULK_RECIPIENTS} recipient${
          stagedRecipients.length - MAX_BULK_RECIPIENTS === 1 ? "" : "s"
        } — ${MAX_BULK_RECIPIENTS} is the limit for one batch.`,
      });
      return;
    }

    // Re-run the check at send time rather than trusting the flag stored when
    // the row was staged: `allowedDomains` is a prop and the row could have
    // been edited since.
    const invalid = stagedRecipients.filter(
      (r) =>
        validateInviteEmail(r.email, allowedDomains) !== null ||
        validateInviteName(r.fullName) !== null,
    );
    if (invalid.length > 0) {
      setStagedRecipients((curr) =>
        curr.map((r) => {
          const error =
            validateInviteEmail(r.email, allowedDomains) ??
            validateInviteName(r.fullName) ??
            undefined;
          return { ...r, error, isValid: error === undefined };
        }),
      );
      setBulkStatus({
        status: "error",
        message: `Correct or remove ${invalid.length} recipient${
          invalid.length === 1 ? "" : "s"
        } before sending.`,
      });
      return;
    }

    startBulkTransition(async () => {
      const payload: BulkInviteRecipient[] = stagedRecipients.map((r) => ({
        email: r.email,
        role: r.role,
        fullName: r.fullName.trim(),
      }));

      try {
        const res = await sendBulkInvitesAction(payload);
        setBulkStatus({ status: res.status, message: res.message });

        // The aggregate message says "3 failed"; without this the admin has no
        // way to learn *which* three, or why.
        const failures = new Map(
          res.results
            .filter((r) => !r.success)
            .map((r) => [r.email, r.message ?? "Could not send invite."] as const),
        );
        setStagedRecipients((curr) =>
          curr
            // Drop the ones that went out, so a retry cannot double-send them.
            .filter((r) => failures.has(r.email) || !res.results.some((x) => x.email === r.email))
            .map((r) => ({ ...r, serverError: failures.get(r.email) })),
        );

        if (res.successCount > 0) {
          router.refresh();
        }
      } catch {
        setBulkStatus({
          status: "error",
          message:
            "Could not reach the server. Some invites may have been sent — reload the page before retrying.",
        });
      }
    });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(val) => {
        setOpen(val);
        if (!val) {
          resetForm();
        }
      }}
    >
      <SheetTrigger asChild>
        <OriginButton size="md" type="button" className="shadow-xs">
          <span className="flex items-center gap-2">
            <UserPlus className="size-4" />
            <span>Invite a team member</span>
          </span>
        </OriginButton>
      </SheetTrigger>

      <SheetContent
        side="right"
        showCloseButton={false}
        className="flex h-full w-full flex-col overflow-hidden p-0 sm:max-w-xl md:max-w-2xl border-l border-white/15 text-[#f4f4ef] shadow-2xl relative"
        style={{
          backgroundColor: INK_RAISED,
          boxShadow: "-20px 0 60px rgba(0, 0, 0, 0.7)",
          ...fieldVars("dark", INK_RAISED),
        }}
      >
        {/* Unified Scrollable Container (Natural top, nothing sticky) */}
        <div className="relative z-10 flex-1 overflow-y-auto px-7 pt-7 pb-32 sm:px-9 sm:pt-8 sm:pb-36 space-y-7 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {/* Header Section */}
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-4">
              <SheetHeader className="p-0 text-left">
                <SheetTitle
                  className="font-body text-[clamp(1.5rem,3.5vw,2rem)] font-black leading-[1.05] tracking-[-0.03em]"
                  style={{ color: GROUND }}
                >
                  Invite team members.
                </SheetTitle>
                <SheetDescription className="mt-2 font-body text-xs sm:text-sm leading-[1.65] text-[#f4f4ef]/55">
                  Accounts are created by an admin. Send invitations to onboard colleagues.
                </SheetDescription>
              </SheetHeader>

              <SheetClose asChild>
                <AnimateIcon asChild animateOnHover animateOnTap>
                  <button
                    type="button"
                    aria-label="Close"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#f4f4ef]/45 transition-colors hover:bg-white/10 hover:text-[#f4f4ef] focus-visible:outline-[#f4f4ef]"
                  >
                    <XIcon size={16} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                </AnimateIcon>
              </SheetClose>
            </div>

            {/* Mode Switcher: Gooey Tabs (from preview-gooey) */}
            <div>
              <Liquid
                blur={5}
                contrast={18}
                fill="#ffffff"
                shadow="0 2px 8px rgba(0,0,0,0.3)"
                className="relative inline-flex items-center gap-1 p-1 rounded-full border bg-white/[0.06] border-white/[0.08]"
              >
                <Liquid.Item
                  effect="move"
                  move={{ springiness: 0.6, trail: 0.5, stretch: 0.25 }}
                >
                  <div
                    className="absolute top-1 bottom-1 h-8 rounded-full transition-all duration-300 pointer-events-none bg-white"
                    style={{
                      width: "136px",
                      transform: `translateX(${(mode === "single" ? 0 : 1) * 140}px)`,
                    }}
                  />
                </Liquid.Item>

                <div className="relative z-10 flex items-center">
                  {(["Single member", "Multiple members"] as const).map((tab, idx) => {
                    const isSelected = (mode === "single" ? 0 : 1) === idx;
                    return (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => {
                          setMode(idx === 0 ? "single" : "multiple");
                          setBulkStatus({ status: "idle" });
                          setSingleStatus({ status: "idle" });
                        }}
                        className={`w-[136px] h-8 text-xs font-semibold rounded-full transition-colors duration-200 focus-visible:outline-none ${
                          isSelected
                            ? "text-neutral-900 font-bold"
                            : "text-white/60 hover:text-white"
                        }`}
                      >
                        {tab}
                      </button>
                    );
                  })}
                </div>
              </Liquid>
            </div>
          </div>
          {/* Role Selection */}
          <motion.div
            variants={entranceSoft}
            initial="hidden"
            animate="show"
            className="flex flex-col gap-2.5"
          >
            <label className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#f4f4ef]/70">
              Role
            </label>
            <RadioGroup
              value={defaultRole}
              onValueChange={(val) => {
                setDefaultRole(val as InviteRole);
              }}
              className="grid gap-2.5"
            >
              {ROLE_OPTIONS.map((opt) => {
                const isSelected = defaultRole === opt.value;
                return (
                  <label
                    key={opt.value}
                    htmlFor={`dark-role-${opt.value}`}
                    className={cn(
                      "relative flex cursor-pointer items-start gap-3 rounded-2xl p-3.5 transition-all text-left overflow-hidden",
                      isSelected
                        ? "bg-[#e6f5c0] shadow-md"
                        : "bg-white/[0.05] hover:bg-white/[0.09]",
                    )}
                  >
                    <RadioGroupItem
                      value={opt.value}
                      id={`dark-role-${opt.value}`}
                      className={cn(
                        "mt-0.5 shrink-0 border-0",
                        isSelected
                          ? "text-[#141414] [&_svg]:fill-[#141414] bg-black/10"
                          : "text-[#e6f5c0] [&_svg]:fill-[#e6f5c0] bg-white/10",
                      )}
                    />
                    <div className="flex flex-col gap-1 pr-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "font-bold text-xs",
                            isSelected ? "text-[#141414]" : "text-[#f4f4ef]",
                          )}
                        >
                          {opt.title}
                        </span>
                        <span
                          className={cn(
                            "rounded-full px-2.5 py-0.5 text-[10px] tracking-wide transition-colors",
                            isSelected
                              ? "bg-gradient-to-b from-white via-neutral-100 to-neutral-200 font-bold text-neutral-800 shadow-2xs"
                              : cn("font-semibold", opt.badgeStyle),
                          )}
                        >
                          {opt.badge}
                        </span>
                      </div>
                      <span
                        className={cn(
                          "text-[11.5px] leading-normal",
                          isSelected
                            ? "text-[#141414]/80 font-medium"
                            : "text-[#f4f4ef]/65 font-normal",
                        )}
                      >
                        {opt.description}
                      </span>
                    </div>
                  </label>
                );
              })}
            </RadioGroup>
          </motion.div>

          {/* SINGLE MEMBER MODE FORM */}
          {mode === "single" && (
            <motion.form
              key="dark-single-form"
              variants={entranceSoft}
              initial="hidden"
              animate="show"
              id="dark-single-invite-form"
              onSubmit={handleSingleSubmit}
              className="space-y-4 pt-1"
            >
              {/* Floating Full Name */}
              <div className="flex flex-col gap-1.5">
                <FloatingLabelInput
                  id="dark-single-fullname"
                  name="fullName"
                  type="text"
                  value={singleName}
                  onChange={(e) => {
                    setSingleName(e.target.value);
                    setSingleStatus({ status: "idle" });
                  }}
                  onBlur={() => setSingleNameTouched(true)}
                  aria-invalid={Boolean(visibleSingleNameError)}
                  aria-describedby="dark-single-fullname-hint"
                  className={cn(
                    fieldClass("dark"),
                    visibleSingleNameError && "border-red-400 focus:border-red-400",
                  )}
                  label="Full name"
                  required
                />
                <p
                  id="dark-single-fullname-hint"
                  className={cn(
                    "px-3 text-[11px] font-body",
                    visibleSingleNameError ? "text-red-300" : "text-[#f4f4ef]/50",
                  )}
                >
                  {visibleSingleNameError ??
                    "Preset for their account. The invited member can see and edit this during first sign-in."}
                </p>
              </div>

              {/* Floating Email */}
              <div className="flex flex-col gap-1.5">
                <FloatingLabelInput
                  id="dark-single-email"
                  name="email"
                  type="email"
                  value={singleEmail}
                  onChange={(e) => {
                    setSingleEmail(e.target.value);
                    setSingleStatus({ status: "idle" });
                  }}
                  onBlur={() => setSingleEmailTouched(true)}
                  aria-invalid={Boolean(visibleSingleEmailError)}
                  aria-describedby="dark-single-email-hint"
                  className={cn(
                    fieldClass("dark"),
                    visibleSingleEmailError && "border-red-400 focus:border-red-400",
                  )}
                  label="Email address"
                  required
                />
                <p
                  id="dark-single-email-hint"
                  className={cn(
                    "px-3 text-[11px] font-body",
                    visibleSingleEmailError ? "text-red-300" : "text-[#f4f4ef]/50",
                  )}
                >
                  {visibleSingleEmailError ?? `Invites can only go to a ${domainHint} address.`}
                </p>
              </div>

              {/* Status Alerts. Field-level errors render under their own
                  field above; this is for the outcome of the send. */}
              {singleStatus.status === "error" && singleStatus.message ? (
                <div className="rounded-xl border border-red-500/30 bg-red-500/15 p-3 text-xs text-red-200">
                  {singleStatus.message}
                </div>
              ) : singleStatus.status === "warning" && singleStatus.message ? (
                // The account was created but the email never left. Showing
                // this in the success colour would be a lie — somebody is
                // waiting for a message that is not coming.
                <div className="flex flex-col gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/15 p-3 text-xs text-amber-100">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="size-4 shrink-0 text-amber-300" />
                    <span>{singleStatus.message}</span>
                  </div>
                  {singleStatus.link && (
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(singleStatus.link!);
                      }}
                      className="cursor-pointer text-left text-xs font-semibold text-amber-200 underline underline-offset-2 hover:opacity-80"
                    >
                      Copy the invite link and send it to them yourself
                    </button>
                  )}
                </div>
              ) : singleStatus.status === "success" && singleStatus.message ? (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/15 p-3 text-xs text-emerald-200 flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <Check className="size-4 text-[#e6f5c0]" />
                    <span>{singleStatus.message}</span>
                  </div>
                  {singleStatus.link && (
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(singleStatus.link!);
                      }}
                      className="text-xs font-semibold text-[#e6f5c0] underline underline-offset-2 hover:opacity-80 text-left cursor-pointer"
                    >
                      Copy invite link to clipboard
                    </button>
                  )}
                </div>
              ) : null}
            </motion.form>
          )}

          {/* MULTIPLE MEMBERS MODE FORM */}
          {mode === "multiple" && (
            <motion.div
              key="dark-multiple-form"
              variants={entranceSoft}
              initial="hidden"
              animate="show"
              className="space-y-5 pt-1"
            >
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="dark-bulk-emails"
                    className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#f4f4ef]/70"
                  >
                    Paste Email Addresses
                  </label>
                  <span className="text-[11px] text-[#f4f4ef]/45">
                    Separated by commas, spaces, or lines
                  </span>
                </div>

                <div className="relative">
                  <textarea
                    id="dark-bulk-emails"
                    value={rawEmailsInput}
                    onChange={(e) => setRawEmailsInput(e.target.value)}
                    placeholder={`alex${domainHint.split(" ")[0]}, sam${domainHint.split(" ")[0]}, jordan${domainHint.split(" ")[0]}`}
                    rows={4}
                    className="font-body w-full rounded-2xl border border-white/15 bg-white/[0.06] p-3.5 text-[13.5px] text-[#f4f4ef] placeholder:text-[#f4f4ef]/35 outline-none transition-all focus:border-[#e6f5c0] focus:ring-1 focus:ring-[#e6f5c0]"
                  />
                </div>

                <div className="flex items-center justify-between pt-1">
                  <p className="text-[11px] text-[#f4f4ef]/50">
                    Must be {domainHint} addresses. Up to {MAX_BULK_RECIPIENTS} per batch.
                  </p>
                  <button
                    type="button"
                    onClick={handleParseEmails}
                    disabled={!rawEmailsInput.trim()}
                    className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white/10 px-3.5 text-xs font-semibold text-[#f4f4ef] transition-colors hover:bg-white/20 disabled:opacity-40 disabled:pointer-events-none"
                  >
                    <Plus className="size-3.5 text-[#e6f5c0]" />
                    <span>Stage emails</span>
                  </button>
                </div>

                {/* Duplicate Notification Toast */}
                <AnimatePresence>
                  {duplicateToast && (
                    <motion.div
                      initial={{ opacity: 0, y: -6, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.98 }}
                      transition={{ duration: 0.2 }}
                      className="flex items-center justify-between gap-3 rounded-xl border border-amber-400/25 bg-amber-400/10 px-3.5 py-2.5 text-xs text-amber-200 shadow-md backdrop-blur-md"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Info className="size-4 shrink-0 text-amber-400" />
                        <span className="font-medium">{duplicateToast}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setDuplicateToast(null)}
                        className="shrink-0 rounded-full p-1 text-amber-300/70 hover:text-amber-100 hover:bg-amber-400/20 transition-colors"
                        aria-label="Dismiss toast"
                      >
                        <XIcon size={12} />
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Staged Recipients List */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-[#f4f4ef]/80">
                      Staged Invitations
                    </span>
                    <span className="inline-flex size-5 items-center justify-center rounded-full bg-white/10 text-[11px] font-bold text-[#e6f5c0]">
                      {stagedRecipients.length}
                    </span>
                  </div>

                  {stagedRecipients.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setStagedRecipients([])}
                      className="cursor-pointer text-xs font-medium text-red-400/80 transition-colors hover:text-red-300 hover:underline"
                    >
                      Clear all
                    </button>
                  )}
                </div>

                {stagedRecipients.length === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-8 text-center">
                    <Mail className="mb-2 size-8 text-[#f4f4ef]/30" />
                    <p className="text-xs font-medium text-[#f4f4ef]/60">
                      No invitations staged yet
                    </p>
                    <p className="mt-0.5 text-[11px] text-[#f4f4ef]/40">
                      Paste emails above and click &quot;Stage emails&quot; to customize names and roles.
                    </p>
                  </div>
                ) : (
                  <div className="max-h-[300px] space-y-2.5 overflow-y-auto pr-1">
                    {stagedRecipients.map((recipient) => {
                      const hasError = !recipient.isValid || Boolean(recipient.serverError);
                      const errorMessage = recipient.error ?? recipient.serverError;
                      const initials = getStagedInitials(recipient.fullName, recipient.email);

                      return (
                        <div
                          key={recipient.id}
                          className={cn(
                            "group flex flex-col gap-2 rounded-2xl border p-3.5 transition-all duration-150 backdrop-blur-xs",
                            hasError
                              ? "border-red-500/40 bg-red-500/10 shadow-xs shadow-red-500/10"
                              : "border-white/10 bg-white/[0.04] hover:border-white/20 hover:bg-white/[0.06]",
                          )}
                        >
                          {/* Row Top: Avatar + Email + Role Selector + Remove */}
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="relative flex size-8 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10 font-mono text-[11px] font-bold text-[#f4f4ef]">
                                {initials}
                                <span
                                  className={cn(
                                    "absolute -right-0.5 -bottom-0.5 size-2 rounded-full border border-[#141a22]",
                                    hasError ? "bg-red-400 animate-pulse" : "bg-emerald-400",
                                  )}
                                  title={hasError ? "Needs correction" : "Valid"}
                                />
                              </div>
                              <span className="truncate text-xs font-semibold text-[#f4f4ef]">
                                {recipient.email}
                              </span>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <div className="relative">
                                <select
                                  value={recipient.role}
                                  onChange={(e) =>
                                    handleUpdateStaged(recipient.id, {
                                      role: e.target.value as InviteRole,
                                    })
                                  }
                                  aria-label={`Role for ${recipient.email}`}
                                  className={cn(
                                    "h-7 appearance-none cursor-pointer rounded-lg border pl-2.5 pr-6 text-[11px] font-bold tracking-wide outline-none transition-all",
                                    STAGED_ROLE_CONFIG[recipient.role].badge,
                                  )}
                                >
                                  <option value="cam" className={STAGED_ROLE_CONFIG.cam.optionClass}>
                                    CAM
                                  </option>
                                  <option value="admin" className={STAGED_ROLE_CONFIG.admin.optionClass}>
                                    Admin
                                  </option>
                                  <option value="viewer" className={STAGED_ROLE_CONFIG.viewer.optionClass}>
                                    Viewer
                                  </option>
                                </select>
                                <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 size-3 opacity-60 text-current" />
                              </div>

                              <button
                                type="button"
                                onClick={() => handleRemoveStaged(recipient.id)}
                                className="grid size-7 cursor-pointer place-items-center rounded-lg text-[#f4f4ef]/40 transition-colors hover:bg-red-500/15 hover:text-red-300"
                                title="Remove recipient"
                                aria-label={`Remove ${recipient.email}`}
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </div>
                          </div>

                          {/* Row Bottom: Full Name Input */}
                          <div>
                            <input
                              type="text"
                              value={recipient.fullName}
                              onChange={(e) =>
                                handleUpdateStaged(recipient.id, {
                                  fullName: e.target.value,
                                })
                              }
                              placeholder="Full name (required)"
                              className={cn(
                                "h-8 w-full rounded-xl border bg-white/[0.04] px-3 text-xs text-[#f4f4ef] placeholder:text-[#f4f4ef]/30 outline-none transition-all focus:border-[#e6f5c0] focus:bg-white/[0.08] focus:ring-1 focus:ring-[#e6f5c0]",
                                !recipient.fullName.trim() && "border-amber-400/40 bg-amber-400/5",
                                hasError ? "border-red-400/40" : "border-white/10",
                              )}
                            />
                          </div>

                          {/* Inline Error Message */}
                          {errorMessage && (
                            <div className="flex items-center gap-1.5 rounded-lg border border-red-500/25 bg-red-500/15 px-2.5 py-1 text-[11px] font-medium text-red-300">
                              <AlertCircle className="size-3.5 shrink-0 text-red-400" />
                              <span className="truncate">{errorMessage}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Bulk Status Alert */}
              {bulkStatus.message && (
                <div
                  className={cn(
                    "rounded-xl border p-3 text-xs",
                    bulkStatus.status === "error"
                      ? "border-red-500/30 bg-red-500/15 text-red-200"
                      : bulkStatus.status === "warning"
                        ? "border-amber-500/30 bg-amber-500/15 text-amber-100"
                        : "border-emerald-500/30 bg-emerald-500/15 text-emerald-200",
                  )}
                >
                  {bulkStatus.message}
                </div>
              )}
            </motion.div>
          )}
        </div>

        {/* Floating Footer Actions (Transparent background with high z-index) */}
        <div className="pointer-events-none absolute bottom-0 inset-x-0 z-30 bg-transparent px-7 py-6 sm:px-9 flex items-center justify-between gap-4">
          <SheetClose asChild>
            <button
              type="button"
              className="pointer-events-auto font-body inline-flex h-9 items-center justify-center rounded-full bg-white/10 px-4 text-xs font-semibold text-[#f4f4ef] transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e6f5c0] shadow-md backdrop-blur-xs"
            >
              Cancel
            </button>
          </SheetClose>

          <div className="pointer-events-auto">
            {mode === "single" ? (
              <GooeyActionButton
                type="submit"
                form="dark-single-invite-form"
                variant="obsidian"
                size="sm"
                buttonIcon="arrow"
                gooBlur={6}
                gooContrast={13}
                gap={48}
                duration={640}
                ease="cubic-bezier(0.4, 0, 0.2, 1)"
                open={isSingleFormValid}
                loading={isPendingSingle}
                disabled={isPendingSingle || !isSingleFormValid}
                label={isPendingSingle ? "Sending invite…" : "Send invitation"}
              />
            ) : (
              <GooeyActionButton
                type="button"
                variant="obsidian"
                size="sm"
                buttonIcon="arrow"
                gooBlur={6}
                gooContrast={13}
                gap={48}
                duration={640}
                ease="cubic-bezier(0.4, 0, 0.2, 1)"
                loading={isPendingBulk}
                open={isBulkFormValid}
                disabled={isPendingBulk || !isBulkFormValid}
                onClick={handleBulkSubmit}
                label={
                  isPendingBulk
                    ? "Sending invites…"
                    : `Send ${stagedRecipients.length > 0 ? stagedRecipients.length : ""} invitation${stagedRecipients.length !== 1 ? "s" : ""}`
                }
              />
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
