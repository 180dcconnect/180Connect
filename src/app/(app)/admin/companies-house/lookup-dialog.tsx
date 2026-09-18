"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Info, Search, TriangleAlert } from "lucide-react";

import { OriginButton } from "@/components/ui/origin-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/animate-ui/components/radix/dialog";
import {
  lookupCompany,
  previewCompanyForImport,
  type CompaniesHouseImportState,
  type CompanyPreviewState,
} from "./actions";
import type { CompanyGrantCoverage, CompanyLookupOutcome } from "./import-result";
import { CompanyPreviewCard } from "./company-preview-card";

const initialLookupState: CompaniesHouseImportState = {
  kind: "idle",
  message: "",
};

const SAVE_LABEL = {
  meets: "Add to the client list",
  needs_review: "Import and hold for review",
  does_not_meet: "Import anyway",
} as const;

function GrantLine({ grants }: { grants: CompanyGrantCoverage }) {
  if (grants.status === "queued") {
    return <>Grant history is queued — 360Giving is usually checked within the quarter hour.</>;
  }
  if (grants.count === 0) {
    return <>360Giving has been checked: no grants on record.</>;
  }
  return (
    <>
      {grants.count} grant{grants.count === 1 ? "" : "s"} already on record from 360Giving.
    </>
  );
}

const OUTCOME_TONE = {
  added: {
    surface: "bg-go-wash text-go",
    Icon: Check,
  },
  already_listed: {
    surface: "bg-lead-wash text-lead",
    Icon: Info,
  },
  held_for_review: {
    surface: "bg-hold-wash text-hold",
    Icon: TriangleAlert,
  },
  does_not_meet: {
    surface: "bg-hold-wash text-hold",
    Icon: TriangleAlert,
  },
  not_on_list: {
    surface: "bg-hold-wash text-hold",
    Icon: TriangleAlert,
  },
} as const;

function OutcomeCard({
  outcome,
  fallbackMessage,
}: {
  outcome: CompanyLookupOutcome;
  fallbackMessage: string;
}) {
  const { surface, Icon } = OUTCOME_TONE[outcome.kind];

  return (
    <div className={`rounded-xl p-4 ${surface}`} role="status">
      <div className="flex items-start gap-2.5">
        <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.4} />
        <div className="min-w-0 space-y-1.5">
          {outcome.kind === "added" || outcome.kind === "already_listed" ? (
            <>
              <p className="text-sm font-semibold">
                {outcome.kind === "added"
                  ? `Added ${outcome.name} to the client list.`
                  : `${outcome.name} is already on the client list.`}
              </p>
              <p className="text-[13px] leading-[1.55] opacity-80">
                <GrantLine grants={outcome.grants} />
              </p>
              <Link
                className="group inline-flex items-center gap-1 text-[13px] font-semibold underline underline-offset-2"
                href={`/clients/${outcome.organisationId}`}
              >
                Open the record
                <ArrowRight
                  aria-hidden="true"
                  className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                />
              </Link>
            </>
          ) : (
            <p className="text-sm font-semibold">
              {outcome.kind === "held_for_review"
                ? "That company was imported but is held for review, so it has not joined the client list yet."
                : outcome.kind === "does_not_meet"
                  ? "That company does not meet the branch's client criteria, so it was not added."
                  : fallbackMessage}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function LookupPanel({ configured, onReset }: { configured: boolean; onReset: () => void }) {
  const [preview, previewAction, previewing] = useActionState(
    previewCompanyForImport,
    { kind: "idle" } as CompanyPreviewState,
  );
  const [result, commitAction, committing] = useActionState(lookupCompany, initialLookupState);

  const phase =
    result.kind !== "idle" ? "done" : preview.kind === "preview" ? "review" : "search";

  if (phase === "done") {
    return (
      <>
        {result.outcome ? (
          <OutcomeCard outcome={result.outcome} fallbackMessage={result.message} />
        ) : (
          <div
            className={`rounded-xl p-4 text-sm font-semibold ${
              result.kind === "error" ? "bg-stop-wash text-stop" : "bg-hold-wash text-hold"
            }`}
            role={result.kind === "error" ? "alert" : "status"}
          >
            {result.message}
          </div>
        )}
        <button
          className="text-sm font-semibold text-brand hover:underline"
          onClick={onReset}
          type="button"
        >
          Look up another company
        </button>
      </>
    );
  }

  if (phase === "review" && preview.kind === "preview") {
    const alreadyListed = preview.alreadyListed;
    return (
      <>
        <CompanyPreviewCard preview={preview.preview} alreadyListed={alreadyListed} />

        <form action={commitAction} className="flex flex-wrap items-center gap-3">
          <input
            name="companyNumber"
            type="hidden"
            value={preview.preview.companyNumber}
          />
          {alreadyListed ? (
            <button
              className="text-sm font-semibold text-brand hover:underline"
              onClick={onReset}
              type="button"
            >
              Look up another company
            </button>
          ) : (
            <>
              <OriginButton loading={committing} size="md" type="submit">
                {committing ? "Saving…" : SAVE_LABEL[preview.preview.criteria.outcome]}
              </OriginButton>
              <button
                className="text-sm font-semibold text-dim hover:text-ink"
                onClick={onReset}
                type="button"
              >
                Cancel
              </button>
            </>
          )}
        </form>
      </>
    );
  }

  return (
    <>
      {!configured && (
        <p className="rounded-xl bg-hold-wash p-3 text-sm font-semibold text-hold" role="alert">
          Companies House API access is not configured. Add the server-side API key
          before running a lookup.
        </p>
      )}

      <form action={previewAction} className="space-y-4">
        <div>
          <label className="block text-sm font-semibold text-ink" htmlFor="companyNumber">
            Company number
          </label>
          <input
            autoComplete="off"
            className="mt-1.5 w-full rounded-lg border border-rule px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-brand focus:ring-1 focus:ring-brand focus:outline-none"
            disabled={!configured || previewing}
            id="companyNumber"
            name="companyNumber"
            placeholder="For example, 01234567"
          />
          <p className="mt-1 text-xs text-dim">Preferred when available.</p>
        </div>

        <div>
          <label className="block text-sm font-semibold text-ink" htmlFor="registeredName">
            Registered name
          </label>
          <input
            autoComplete="off"
            className="mt-1.5 w-full rounded-lg border border-rule px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-brand focus:ring-1 focus:ring-brand focus:outline-none"
            disabled={!configured || previewing}
            id="registeredName"
            name="registeredName"
            placeholder="Used only when the company number is unknown"
          />
        </div>

        <OriginButton
          disabled={!configured || previewing}
          loading={previewing}
          size="md"
          type="submit"
        >
          {previewing ? "Looking up…" : "Look up company"}
        </OriginButton>
      </form>

      {preview.kind === "error" && (
        <div className="rounded-xl bg-stop-wash p-4 text-sm font-semibold text-stop" role="alert">
          {preview.message}
        </div>
      )}
    </>
  );
}

export function CompaniesLookupDialog({ configured }: { configured: boolean }) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSession((value) => value + 1);
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="group inline-flex items-center gap-2 text-sm text-dim transition-colors hover:text-ink"
        >
          <Search className="h-3.5 w-3.5" strokeWidth={2.2} />
          Looking for one particular company?
          <span className="font-bold text-brand group-hover:underline">
            Look it up by number or name
          </span>
        </button>
      </DialogTrigger>

      <DialogContent className="max-h-[85vh] space-y-4 overflow-y-auto rounded-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Look up one company</DialogTitle>
          <DialogDescription className="leading-[1.65]">
            Fetches a single company straight from Companies House by its company
            number or registered name, and shows you what it found before anything
            is saved. No filters apply — the standard client checks still run,
            and the result says what they decided.
          </DialogDescription>
        </DialogHeader>

        <LookupPanel
          configured={configured}
          key={session}
          onReset={() => setSession((value) => value + 1)}
        />
      </DialogContent>
    </Dialog>
  );
}
