"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Rise } from "@/components/dashboard-stage";
import { Pill, SectionCard } from "@/app/(app)/clients/[id]/section-card";
import {
  EMAIL_LENGTH_LABELS,
  EMAIL_LENGTHS,
  EMAIL_REGISTER_LABELS,
  EMAIL_REGISTERS,
  REPLY_CLOSING_APPROACH_LABELS,
  REPLY_CLOSING_APPROACHES,
  type EmailLength,
  type EmailRegister,
  type ReplyClosingApproach,
} from "@/lib/outreach/stage-one-prompt";
import {
  REPLY_INTENTS,
  REPLY_SENTIMENTS,
  type ReplyIntent,
  type ReplySentiment,
} from "@/lib/outreach/stage-two-prompt";
import {
  buildLabStageTwoPrompt,
  loadLabPreviousEmail,
  lookupLabNewsHook,
  runLabStageTwoGeneration,
  type LabPrompt,
} from "./actions";
import {
  DialGroup,
  NewsCard,
  PromptBox,
  PromptEditor,
  ResultCard,
  type LabResult,
  type NewsState,
} from "./lab-ui";

/**
 * Stage 2 — the second email: a chase-up when nobody answered, or a reply when
 * somebody did. Which of the two it is comes from one thing only: whether
 * there is a reply to answer. That is a real difference in the prompt (a
 * different opening instruction, a different closing set, the reply's own
 * classification), so it is the first choice on the panel rather than a dial.
 *
 * Unlike Stage 1, this panel has typed-in fields. A follow-up needs the email
 * that went out and, for the reply shape, what came back — and on a branch
 * where most clients have never been written to, waiting for a real thread
 * would mean the reply shape could never be tried at all. The last real sent
 * email is loaded where there is one, and everything is editable from there.
 */

const SENTIMENT_LABELS: Record<ReplySentiment, string> = {
  positive: "Warm",
  neutral: "Neutral",
  negative: "Cool",
};

const INTENT_LABELS: Record<ReplyIntent, string> = {
  interested: "They are interested",
  more_info: "They want more information",
  not_interested: "They have said no",
  referral: "They pointed us to somebody else",
};

/**
 * The closing a given intent forces, mirroring INTENT_FORCED_CLOSING in
 * stage-two-prompt.ts. Repeated here so the screen can *say* the choice has
 * been made rather than silently ignoring the picker — a dial that does
 * nothing is worse than a dial that explains itself.
 */
const FORCED_CLOSING: Partial<Record<ReplyIntent, ReplyClosingApproach>> = {
  not_interested: "graceful_close",
  referral: "referral_next_step",
};

type Conversation = {
  previousSubject: string;
  previousBody: string;
  replyBody: string;
  replyAuthorName: string;
  replySentiment: ReplySentiment | null;
  replyIntent: ReplyIntent | null;
};

type Dials = {
  length: EmailLength;
  register: EmailRegister;
  closing: ReplyClosingApproach;
  attachFlyer: boolean;
};

const DEFAULT_DIALS: Dials = {
  length: "standard",
  register: "professional",
  closing: "soft_cta",
  attachFlyer: false,
};

const EMPTY_CONVERSATION: Conversation = {
  previousSubject: "",
  previousBody: "",
  replyBody: "",
  replyAuthorName: "",
  replySentiment: null,
  replyIntent: null,
};

export function StageTwoPanel({
  organisationId,
  viewOnly,
}: {
  organisationId: string;
  viewOnly: boolean;
}) {
  const [dials, setDials] = useState<Dials>(DEFAULT_DIALS);
  const [conversation, setConversation] = useState<Conversation>(EMPTY_CONVERSATION);
  const [hasReply, setHasReply] = useState(false);
  const [previousLoaded, setPreviousLoaded] = useState<"none" | "found" | "missing">("none");
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

  // A new client brings its own last sent email, and drops whatever was typed
  // about the previous one — a reply to one charity pasted under another's
  // name is exactly the confusion this page exists to avoid.
  const loadRef = useRef(0);
  useEffect(() => {
    const token = ++loadRef.current;
    startBuilding(async () => {
      const response = await loadLabPreviousEmail(organisationId);
      if (token !== loadRef.current) return;
      setNews({ status: "idle" });
      setResult(null);
      setRunError(null);
      if (!response.ok) {
        setConversation(EMPTY_CONVERSATION);
        setPreviousLoaded("missing");
        return;
      }
      setConversation({ ...EMPTY_CONVERSATION, ...(response.previous ?? {}) });
      setPreviousLoaded(response.previous ? "found" : "missing");
    });
  }, [organisationId]);

  // Everything the prompt is built from, in one dependency: the dials, the
  // conversation and whichever news hook has been looked up.
  const newsHook = news.status === "found" ? news.text : "";
  const newsUrl = news.status === "found" ? (news.url ?? "") : "";
  const buildRef = useRef(0);
  useEffect(() => {
    const token = ++buildRef.current;
    startBuilding(async () => {
      const response = await buildLabStageTwoPrompt({
        organisationId,
        ...dials,
        previousSubject: conversation.previousSubject,
        previousBody: conversation.previousBody,
        // A reply is only a reply when the panel is in reply mode *and* there
        // is text. Empty text in reply mode builds the chase-up shape, which is
        // exactly what the real prompt does with a blank reply.
        replyBody: hasReply ? conversation.replyBody : "",
        replyAuthorName: hasReply ? conversation.replyAuthorName : "",
        replySentiment: hasReply ? conversation.replySentiment : null,
        replyIntent: hasReply ? conversation.replyIntent : null,
        newsHook,
        newsUrl,
      });
      if (token !== buildRef.current) return;
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
  }, [organisationId, dials, conversation, hasReply, newsHook, newsUrl]);

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
      const response = await runLabStageTwoGeneration({ system, user });
      if (!response.ok) {
        setRunError(response.error);
        setResult(null);
        return;
      }
      setResult(response);
    });
  }

  const forced = hasReply && conversation.replyIntent ? FORCED_CLOSING[conversation.replyIntent] : undefined;

  return (
    <>
      <Rise>
        <SectionCard
          headingId="stage-two-shape"
          title="What kind of second email is this?"
          hint="The two are written differently, so this is the first thing the writer is told."
        >
          <DialGroup
            label="Where the conversation stands"
            name="s2-shape"
            value={hasReply ? "reply" : "chase"}
            options={[
              { value: "chase", label: "Nobody has answered yet — chase it up" },
              { value: "reply", label: "They replied — answer them" },
            ]}
            onChange={(value) => setHasReply(value === "reply")}
          />
        </SectionCard>
      </Rise>

      <Rise>
        <SectionCard
          headingId="stage-two-thread"
          title="The conversation so far"
          hint="What we sent, and what came back. Edit any of it — this is the only way to try a follow-up for a client nobody has written to yet."
          action={
            previousLoaded === "found" ? (
              <Pill tone="go">Loaded the last email we sent</Pill>
            ) : previousLoaded === "missing" ? (
              <Pill tone="neutral">Nothing sent to this client yet</Pill>
            ) : undefined
          }
        >
          <div className="space-y-5">
            {previousLoaded === "missing" && (
              <p className="text-sm leading-[1.65] text-dim">
                We have never emailed this client, so there is no thread to
                follow up. Write a first email below and the follow-up will build
                on it — or pick a client we have written to.
              </p>
            )}

            <div>
              <label htmlFor="s2-previous-subject" className="text-sm font-medium text-ink">
                Subject of the email we sent
              </label>
              <input
                id="s2-previous-subject"
                type="text"
                value={conversation.previousSubject}
                onChange={(event) =>
                  setConversation((prev) => ({ ...prev, previousSubject: event.target.value }))
                }
                readOnly={viewOnly}
                className="mt-2 w-full rounded-inset border border-rule bg-paper px-3 py-2 text-sm text-ink outline-none focus-visible:border-lead"
              />
            </div>

            <PromptBox
              id="s2-previous-body"
              label="The email we sent"
              hint="Referred to but never copied — the follow-up acknowledges it rather than repeating it."
              value={conversation.previousBody}
              onChange={(value) => setConversation((prev) => ({ ...prev, previousBody: value }))}
              readOnly={viewOnly}
              rows={10}
              mono={false}
            />

            {hasReply && (
              <>
                <PromptBox
                  id="s2-reply-body"
                  label="What they wrote back"
                  hint="Paste it as it arrived. Our own quoted email underneath is stripped out, exactly as it would be on a real reply."
                  value={conversation.replyBody}
                  onChange={(value) => setConversation((prev) => ({ ...prev, replyBody: value }))}
                  readOnly={viewOnly}
                  rows={8}
                  mono={false}
                />

                <div>
                  <label htmlFor="s2-reply-author" className="text-sm font-medium text-ink">
                    Who wrote back
                  </label>
                  <p className="mt-0.5 text-[13px] leading-[1.55] text-dim">
                    Leave this empty if you do not know. The writer then greets
                    the team rather than naming the wrong person.
                  </p>
                  <input
                    id="s2-reply-author"
                    type="text"
                    value={conversation.replyAuthorName}
                    onChange={(event) =>
                      setConversation((prev) => ({ ...prev, replyAuthorName: event.target.value }))
                    }
                    readOnly={viewOnly}
                    className="mt-2 w-full rounded-inset border border-rule bg-paper px-3 py-2 text-sm text-ink outline-none focus-visible:border-lead"
                  />
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <DialGroup
                    label="How the reply reads"
                    name="s2-sentiment"
                    value={conversation.replySentiment ?? ""}
                    options={[
                      { value: "", label: "Not decided" },
                      ...REPLY_SENTIMENTS.map((value) => ({ value, label: SENTIMENT_LABELS[value] })),
                    ]}
                    onChange={(value) =>
                      setConversation((prev) => ({
                        ...prev,
                        replySentiment: value ? (value as ReplySentiment) : null,
                      }))
                    }
                  />
                  <DialGroup
                    label="What they are asking for"
                    name="s2-intent"
                    value={conversation.replyIntent ?? ""}
                    options={[
                      { value: "", label: "Not decided" },
                      ...REPLY_INTENTS.map((value) => ({ value, label: INTENT_LABELS[value] })),
                    ]}
                    onChange={(value) =>
                      setConversation((prev) => ({
                        ...prev,
                        replyIntent: value ? (value as ReplyIntent) : null,
                      }))
                    }
                  />
                </div>
              </>
            )}
          </div>
        </SectionCard>
      </Rise>

      <Rise>
        <NewsCard
          idPrefix="stage-two"
          hint="A real follow-up looks this up every time, so the email has a natural reason to reconnect. Here it is a button, because the instructions below rebuild every time you change an option and a lookup costs a little each time."
          news={news}
          onLookup={lookUpNews}
          lookingUp={lookingUp}
          viewOnly={viewOnly}
          idleMessage="Nothing looked up yet, so the follow-up below is being written without a news angle."
        />
      </Rise>

      <Rise>
        <SectionCard
          headingId="stage-two-options"
          title="The options a CAM would choose"
          hint="The same choices that sit behind the reply composer, plus the flyer."
        >
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            <DialGroup
              label="How long"
              name="s2-length"
              value={dials.length}
              options={EMAIL_LENGTHS.map((value) => ({ value, label: EMAIL_LENGTH_LABELS[value] }))}
              onChange={(value) => setDials((prev) => ({ ...prev, length: value as EmailLength }))}
            />
            <DialGroup
              label="How it should sound"
              name="s2-register"
              value={dials.register}
              options={EMAIL_REGISTERS.map((value) => ({ value, label: EMAIL_REGISTER_LABELS[value] }))}
              onChange={(value) => setDials((prev) => ({ ...prev, register: value as EmailRegister }))}
            />
            <DialGroup
              label="How it closes"
              name="s2-closing"
              value={forced ?? dials.closing}
              options={REPLY_CLOSING_APPROACHES.map((value) => ({
                value,
                label: REPLY_CLOSING_APPROACH_LABELS[value],
              }))}
              onChange={(value) => setDials((prev) => ({ ...prev, closing: value as ReplyClosingApproach }))}
              disabled={forced !== undefined}
              hint={
                forced
                  ? "There is only one right way to close this one, so the choice has been made for you."
                  : undefined
              }
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

      <Rise>
        <PromptEditor
          idPrefix="stage-two"
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
          runLabel="Write a follow-up with this"
          userLabel="This client and this conversation"
        />
      </Rise>

      {result && (
        <Rise>
          <ResultCard
            idPrefix="stage-two"
            hint="A follow-up has no subject of its own — it goes out as a reply on the same thread. Nothing was saved and nobody was emailed."
            result={result}
          />
        </Rise>
      )}
    </>
  );
}
