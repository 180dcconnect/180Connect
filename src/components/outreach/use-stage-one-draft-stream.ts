"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Reads the stage-one streaming endpoint (`…/stage-one/stream`, SSE) and
 * accumulates the draft as it arrives.
 *
 * `start()` resolves like the old JSON POST did — `{ ok, result | error }` —
 * so callers keep their imperative flow (confirm dialogs, 409 handling, draft
 * state). Everything live (stage, subject, body) is also on state for the
 * thinking indicator and the streaming preview to render while it flows.
 *
 * A failure before the first token never reaches the stream: the route
 * answers those with a normal JSON error status, handled here exactly like
 * the old endpoint. Only mid-stream failures arrive as `error` events.
 */

export type StageOneStreamStage = "reading" | "drafting" | "saving";

export type StageOneStreamResult = {
  id: string;
  subject: string;
  body: string;
  sizeTemplate?: string;
  recipientOnFile: string | null;
};

export type StageOneStreamOutcome =
  | { ok: true; result: StageOneStreamResult }
  | { ok: false; error: string; status?: number };

export type StageOneStreamStatus = "idle" | "streaming" | "done" | "error";

/**
 * What the thinking indicator shows. The three real pipeline stages, plus a
 * terminal "done" — without it the Saving step would sit active-forever and
 * there would be no all-ticks-ticked moment for the text reveal to wait for.
 */
export type StageOneDisplayStage = StageOneStreamStage | "done";

const STAGE_ORDER: readonly StageOneDisplayStage[] = ["reading", "drafting", "saving", "done"];
/**
 * Minimum time each thinking step stays visibly active, even when the real
 * milestones arrive faster. A stream that blasts through all three steps in
 * half a second reads as a glitch; theatre with a floor reads as progress.
 */
const MIN_STEP_MS = 1200;

export function useStageOneDraftStream() {
  const [status, setStatus] = useState<StageOneStreamStatus>("idle");
  const [stage, setStage] = useState<StageOneStreamStage | null>(null);
  // What the thinking indicator shows: chases the real stage, but each step
  // holds for at least MIN_STEP_MS, and the streamed text stays hidden until
  // this reaches "done" — all ticks ticked before a word appears.
  const [displayStage, setDisplayStage] = useState<StageOneDisplayStage | null>(null);
  const displayEnteredAt = useRef(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | undefined>(undefined);
  const [result, setResult] = useState<StageOneStreamResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // The display stage chases the real one one step at a time, holding each
  // for the minimum dwell — and on past "saving" to "done" once the draft is
  // persisted. Slow runs already dwell longer; this only ever slows down runs
  // that would otherwise flash through.
  useEffect(() => {
    const target: StageOneDisplayStage | null = status === "done" ? "done" : stage;
    if (!target) return;
    if (displayStage === target) return;
    const currentIndex = displayStage ? STAGE_ORDER.indexOf(displayStage) : -1;
    if (STAGE_ORDER.indexOf(target) <= currentIndex) return;
    const elapsed = Date.now() - displayEnteredAt.current;
    const wait = displayStage === null ? 0 : Math.max(0, MIN_STEP_MS - elapsed);
    const timer = setTimeout(() => {
      displayEnteredAt.current = Date.now();
      setDisplayStage(STAGE_ORDER[currentIndex + 1]!);
    }, wait);
    return () => clearTimeout(timer);
  }, [stage, displayStage, status]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("idle");
    setStage(null);
    setDisplayStage(null);
    displayEnteredAt.current = 0;
    setStartedAt(null);
    setSubject("");
    setBody("");
    setError(null);
    setErrorStatus(undefined);
    setResult(null);
  }, []);

  const start = useCallback(
    async (input: {
      organisationId: string;
      draftId?: string;
      length: string;
      register: string;
      opening: string;
      closing: string;
    }): Promise<StageOneStreamOutcome> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus("streaming");
      setStage(null);
      setDisplayStage(null);
      displayEnteredAt.current = 0;
      setStartedAt(Date.now());
      setSubject("");
      setBody("");
      setError(null);
      setErrorStatus(undefined);
      setResult(null);

      let response: Response;
      try {
        response = await fetch(
          `/api/clients/${input.organisationId}/outreach-drafts/stage-one/stream`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...(input.draftId ? { draftId: input.draftId } : {}),
              length: input.length,
              register: input.register,
              opening: input.opening,
              closing: input.closing,
            }),
            signal: controller.signal,
          },
        );
      } catch {
        if (controller.signal.aborted) return { ok: false, error: "cancelled" };
        const message = "Could not reach the server. Check your connection and try again.";
        setStatus("error");
        setError(message);
        return { ok: false, error: message };
      }

      // Fast failures (auth, checks, allowance) answer as JSON, never SSE.
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || !contentType.includes("text/event-stream")) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        const message = payload?.error ?? "The email draft could not be generated. Try again.";
        setStatus("error");
        setError(message);
        setErrorStatus(response.ok ? undefined : response.status);
        return { ok: false, error: message, status: response.ok ? undefined : response.status };
      }

      if (!response.body) {
        const message = "The email draft could not be generated. Try again.";
        setStatus("error");
        setError(message);
        return { ok: false, error: message };
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;
      let outcome: StageOneStreamOutcome = {
        ok: false,
        error: "The stream ended before the draft arrived. Try again.",
      };
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const line = frame
              .split("\n")
              .map((part) => part.trim())
              .find((part) => part.startsWith("data:"));
            if (!line) continue;
            let event: unknown;
            try {
              event = JSON.parse(line.slice("data:".length).trim());
            } catch {
              continue;
            }
            if (!event || typeof event !== "object") continue;
            const typed = event as { type?: string };
            if (typed.type === "stage" && ("stage" in typed)) {
              setStage((typed as { stage: StageOneStreamStage }).stage);
            } else if (typed.type === "restart") {
              // The token stream proved unparseable; a one-shot regeneration
              // follows. Accumulated text belongs to the failed stream, so it
              // is discarded rather than welded to the replacement — and the
              // ticks re-run, because from the CAM's side it is a fresh attempt.
              setSubject("");
              setBody("");
              setStage("drafting");
              setDisplayStage("drafting");
              displayEnteredAt.current = Date.now();
            } else if (typed.type === "subject" && "subject" in typed) {
              setSubject(String((typed as { subject: unknown }).subject ?? ""));
            } else if (typed.type === "delta" && "text" in typed) {
              const text = String((typed as { text: unknown }).text ?? "");
              if (text) setBody((current) => current + text);
            } else if (typed.type === "done") {
              const done = typed as unknown as StageOneStreamResult;
              setSubject(done.subject);
              setBody(done.body);
              setResult(done);
              setStatus("done");
              finished = true;
              outcome = { ok: true, result: done };
            } else if (typed.type === "error") {
              const failure = typed as { error?: unknown; status?: unknown };
              const message =
                typeof failure.error === "string" && failure.error
                  ? failure.error
                  : "The email draft could not be generated. Try again.";
              const errorStatus =
                typeof failure.status === "number" ? failure.status : undefined;
              setStatus("error");
              setError(message);
              setErrorStatus(errorStatus);
              finished = true;
              outcome = { ok: false, error: message, status: errorStatus };
            }
          }
          if (finished) break;
        }
      } catch {
        if (controller.signal.aborted) return { ok: false, error: "cancelled" };
        const message = "The stream dropped before the draft arrived. Try again.";
        setStatus("error");
        setError(message);
        outcome = { ok: false, error: message };
      } finally {
        reader.releaseLock();
      }

      if (!outcome.ok) {
        setStatus("error");
        setError(outcome.error);
      }
      return outcome;
    },
    [],
  );

  return { status, stage, displayStage, startedAt, subject, body, error, errorStatus, result, start, reset };
}
