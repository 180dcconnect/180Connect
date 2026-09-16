"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Rise } from "@/components/dashboard-stage";
import { SectionCard } from "@/app/(app)/clients/[id]/section-card";
import {
  CLOSING_APPROACH_LABELS,
  CLOSING_APPROACHES,
  EMAIL_LENGTH_LABELS,
  EMAIL_LENGTHS,
  EMAIL_REGISTER_LABELS,
  EMAIL_REGISTERS,
  OPENING_APPROACH_LABELS,
  OPENING_APPROACHES,
  type ClosingApproach,
  type EmailLength,
  type EmailRegister,
  type OpeningApproach,
} from "@/lib/outreach/stage-one-prompt";
import { buildLabPrompt, lookupLabNewsHook, runLabGeneration, type LabPrompt } from "./actions";
import {
  DialGroup,
  NewsCard,
  PromptEditor,
  ResultCard,
  type LabResult,
  type NewsState,
} from "./lab-ui";

type Dials = {
  length: EmailLength;
  register: EmailRegister;
  opening: OpeningApproach;
  closing: ClosingApproach;
  attachFlyer: boolean;
};

const DEFAULT_DIALS: Dials = {
  length: "standard",
  register: "professional",
  opening: "mission_led",
  closing: "soft_cta",
  attachFlyer: false,
};

/**
 * Stage 1 — the first email to a client who has never heard from us.
 *
 * The client comes from the shell above: "which client" is the same question
 * for both stages, so the picker is shared and this panel only renders once one
 * is chosen.
 */
export function StageOnePanel({
  organisationId,
  viewOnly,
}: {
  organisationId: string;
  viewOnly: boolean;
}) {
  const [dials, setDials] = useState<Dials>(DEFAULT_DIALS);
  const [news, setNews] = useState<NewsState>({ status: "idle" });
  const [lookingUp, startLookingUp] = useTransition();

  const [built, setBuilt] = useState<LabPrompt | null>(null);
  const [system, setSystem] = useState("");
  const [user, setUser] = useState("");
  const [buildError, setBuildError] = useState<string | null>(null);
  const [building, startBuilding] = useTransition();

  const [result, setResult] = useState<LabResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [running, startRunning] = useTransition();

  // Rebuilding costs nothing (no model call), so the preview follows the client
  // and the dials rather than making somebody ask for it. `requestRef` drops a
  // slow answer that arrives after a newer one — otherwise flicking through the
  // options can leave the box showing the prompt for a setting nobody selected.
  const newsHook = news.status === "found" ? news.text : "";
  const newsUrl = news.status === "found" ? (news.url ?? "") : "";
  const requestRef = useRef(0);
  useEffect(() => {
    const token = ++requestRef.current;
    startBuilding(async () => {
      const response = await buildLabPrompt({ organisationId, ...dials, newsHook, newsUrl });
      if (token !== requestRef.current) return;
      setResult(null);
      setRunError(null);
      if (!response.ok) {
        setBuildError(response.error);
        setBuilt(null);
        return;
      }
      setBuildError(null);
      setBuilt(response.prompt);
      setSystem(response.prompt.system);
      setUser(response.prompt.user);
    });
  }, [organisationId, dials, newsHook, newsUrl]);

  function lookUpNews() {
    startLookingUp(async () => {
      const response = await lookupLabNewsHook(organisationId);
      if (!response.ok) {
        setNews({ status: "error", message: response.error });
        return;
      }
      setNews(
        response.hook
          ? { status: "found", text: response.hook.text, url: response.hook.url }
          : { status: "none" },
      );
    });
  }

  function run() {
    setRunError(null);
    startRunning(async () => {
      const response = await runLabGeneration({ system, user });
      if (!response.ok) {
        setRunError(response.error);
        setResult(null);
        return;
      }
      setResult(response);
    });
  }

  return (
    <>
      <Rise>
        <SectionCard
          headingId="stage-one-options"
          title="The options a CAM would choose"
          hint="The same four choices that sit behind the Compose button, plus the flyer. Changing one rewrites the instructions below straight away."
        >
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <DialGroup
              label="How long"
              name="s1-length"
              value={dials.length}
              options={EMAIL_LENGTHS.map((value) => ({ value, label: EMAIL_LENGTH_LABELS[value] }))}
              onChange={(value) => setDials((prev) => ({ ...prev, length: value as EmailLength }))}
            />
            <DialGroup
              label="How it should sound"
              name="s1-register"
              value={dials.register}
              options={EMAIL_REGISTERS.map((value) => ({ value, label: EMAIL_REGISTER_LABELS[value] }))}
              onChange={(value) => setDials((prev) => ({ ...prev, register: value as EmailRegister }))}
            />
            <DialGroup
              label="How it opens"
              name="s1-opening"
              value={dials.opening}
              options={OPENING_APPROACHES.map((value) => ({ value, label: OPENING_APPROACH_LABELS[value] }))}
              onChange={(value) => setDials((prev) => ({ ...prev, opening: value as OpeningApproach }))}
              hint={
                dials.opening === "news_hook"
                  ? "Needs a story to open with — look one up below. Without one, the email opens on their mission instead."
                  : undefined
              }
            />
            <DialGroup
              label="How it closes"
              name="s1-closing"
              value={dials.closing}
              options={CLOSING_APPROACHES.map((value) => ({ value, label: CLOSING_APPROACH_LABELS[value] }))}
              onChange={(value) => setDials((prev) => ({ ...prev, closing: value as ClosingApproach }))}
            />
          </div>

          <label className="mt-5 flex items-center gap-2.5 text-sm text-ink">
            <input
              type="checkbox"
              checked={dials.attachFlyer}
              onChange={(event) =>
                setDials((prev) => ({ ...prev, attachFlyer: event.target.checked }))
              }
              className="size-4 rounded-[3px] border-rule accent-lead"
            />
            The send will carry our flyer
          </label>

          {built && (
            <p className="mt-4 text-[13px] leading-[1.55] text-dim">
              From this client&rsquo;s filed accounts, the writer is also told to{" "}
              <span className="text-ink">{built.sizeToneLabel.toLowerCase()}</span>.
            </p>
          )}
        </SectionCard>
      </Rise>

      {dials.opening === "news_hook" && (
        <Rise>
          <NewsCard
            idPrefix="stage-one"
            hint="You chose to open on a recent story, so a real send would look one up at this point. Here it is a button, because the instructions below rebuild every time you change an option and a lookup costs a little each time."
            news={news}
            onLookup={lookUpNews}
            lookingUp={lookingUp}
            viewOnly={viewOnly}
            idleMessage="Nothing looked up yet, so the email below is being written with a mission-led opening instead — exactly what a real send does when no story is found."
          />
        </Rise>
      )}

      <Rise>
        <PromptEditor
          idPrefix="stage-one"
          built={built}
          system={system}
          user={user}
          onSystemChange={setSystem}
          onUserChange={setUser}
          onReset={() => {
            if (!built) return;
            setSystem(built.system);
            setUser(built.user);
          }}
          onRun={run}
          running={running}
          building={building}
          buildError={buildError}
          runError={runError}
          viewOnly={viewOnly}
          emptyMessage="Pick a client above and the instructions will appear here."
          runLabel="Write an email with this"
          userLabel="This client's details"
        />
      </Rise>

      {result && (
        <Rise>
          <ResultCard
            idPrefix="stage-one"
            hint="The email as a CAM would see it before sending. Nothing was saved and nobody was emailed."
            result={result}
          />
        </Rise>
      )}
    </>
  );
}
