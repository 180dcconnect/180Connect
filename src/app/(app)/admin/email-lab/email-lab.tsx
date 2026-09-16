"use client";

import { useMemo, useState } from "react";
import { Rise } from "@/components/dashboard-stage";
import { Pill, SectionCard } from "@/app/(app)/clients/[id]/section-card";
import { DialGroup } from "./lab-ui";
import { StageOnePanel } from "./stage-one-panel";
import { StageTwoPanel } from "./stage-two-panel";

export type LabClientOption = {
  id: string;
  /** What the person calls this client — trading name where there is one. */
  name: string;
  /** Legal name and/or town, to tell two similar names apart. */
  secondary: string;
};

/**
 * The lab's shell: which email we are testing, and who it is to.
 *
 * Both questions are shared, so they sit above the two panels rather than
 * being asked twice. Everything below — the options, the prompt, the result —
 * belongs to the stage and lives in its own panel.
 *
 * The panels are mounted with `key={stage + client}` so switching either one
 * starts clean. A prompt half-edited for one client, still on screen under
 * another client's name, is exactly the confusion this page exists to remove.
 */
export function EmailLab({
  clients,
  viewOnly,
}: {
  clients: LabClientOption[];
  viewOnly: boolean;
}) {
  const [stage, setStage] = useState<"one" | "two">("one");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = clients.find((client) => client.id === selectedId) ?? null;

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const pool = needle
      ? clients.filter(
          (client) =>
            client.name.toLowerCase().includes(needle) ||
            client.secondary.toLowerCase().includes(needle),
        )
      : clients;
    return pool.slice(0, 40);
  }, [clients, query]);

  return (
    <>
      <Rise>
        <SectionCard
          headingId="lab-stage"
          title="Which email are we testing?"
          hint="The app writes two kinds, and they are written from different instructions."
        >
          <DialGroup
            label="Kind of email"
            name="lab-stage"
            value={stage}
            options={[
              { value: "one", label: "The first email to a new client" },
              { value: "two", label: "A follow-up, or a reply to what they said" },
            ]}
            onChange={(value) => setStage(value as "one" | "two")}
          />
        </SectionCard>
      </Rise>

      <Rise>
        <SectionCard
          headingId="lab-client"
          title="Who are we writing to?"
          hint="Pick a client. The lab loads everything we know about them — their profile, their booklet, anything read out of their uploaded documents — exactly as a real draft would."
          action={selected ? <Pill tone="go">{selected.name}</Pill> : undefined}
        >
          <div className="space-y-4">
            <div>
              <label htmlFor="lab-client-search" className="text-sm font-medium text-ink">
                Search by name or town
              </label>
              <input
                id="lab-client-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Start typing a client's name"
                className="mt-2 w-full rounded-inset border border-rule bg-paper px-3 py-2 text-sm text-ink outline-none focus-visible:border-lead"
              />
            </div>

            {clients.length === 0 ? (
              <p className="text-sm leading-[1.65] text-dim">
                There are no clients on this environment yet, so there is nothing
                to write to. Add a client first.
              </p>
            ) : (
              <ul className="max-h-72 divide-y divide-rule-soft overflow-y-auto rounded-inset border border-rule bg-paper">
                {matches.map((client) => {
                  const isSelected = client.id === selectedId;
                  return (
                    <li key={client.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(client.id)}
                        aria-pressed={isSelected}
                        className={`flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left transition-colors ${
                          isSelected ? "bg-white" : "hover:bg-white/60"
                        }`}
                      >
                        <span className="text-sm font-medium text-ink">{client.name}</span>
                        {client.secondary && (
                          <span className="text-[13px] text-dim">{client.secondary}</span>
                        )}
                      </button>
                    </li>
                  );
                })}
                {matches.length === 0 && (
                  <li className="px-3 py-3 text-sm text-dim">
                    No client matches that. Try part of the name instead.
                  </li>
                )}
              </ul>
            )}
          </div>
        </SectionCard>
      </Rise>

      {selectedId === null ? (
        <Rise>
          <SectionCard
            headingId="lab-waiting"
            title="What we tell the writer"
            hint="The instructions appear once you have picked somebody to write to."
          >
            <p className="text-sm leading-[1.65] text-dim">
              Pick a client above to see exactly what we ask the writer to do.
            </p>
          </SectionCard>
        </Rise>
      ) : stage === "one" ? (
        <StageOnePanel key={`one-${selectedId}`} organisationId={selectedId} viewOnly={viewOnly} />
      ) : (
        <StageTwoPanel key={`two-${selectedId}`} organisationId={selectedId} viewOnly={viewOnly} />
      )}
    </>
  );
}
