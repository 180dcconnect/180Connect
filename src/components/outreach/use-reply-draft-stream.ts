"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { StageOneDisplayStage, StageOneStreamStage } from "./use-stage-one-draft-stream";
import type { EmailLength, EmailRegister, ReplyClosingApproach } from "@/lib/outreach/stage-one-prompt";

export type ReplyDraftStreamResult = {
  id: string;
  subject: string;
  body: string;
  newsSource?: "live" | "stored" | "none";
  newsHook?: string | null;
  newsUrl?: string | null;
};

export type ReplyDraftStreamOutcome =
  | { ok: true; result: ReplyDraftStreamResult }
  | { ok: false; error?: string; warning?: { text: string; tone: "block" | "conflict" } };

export type ReplyDraftStreamStatus = "idle" | "generating" | "done" | "error";

const STAGE_ORDER: readonly StageOneDisplayStage[] = ["reading", "drafting", "saving", "done"];
/**
 * Minimum time each thinking step stays visibly active, matching stage-one's
 * compose flow. Even if the server responds quickly, each step dwells for at
 * least MIN_STEP_MS so the progress reads intentional rather than flashing.
 */
const MIN_STEP_MS = 1200;

export function useReplyDraftStream() {
  const [status, setStatus] = useState<ReplyDraftStreamStatus>("idle");
  const [stage, setStage] = useState<StageOneStreamStage | null>(null);
  const [displayStage, setDisplayStage] = useState<StageOneDisplayStage | null>(null);
  const displayEnteredAt = useRef(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReplyDraftStreamResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

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
    setResult(null);
  }, []);

  const start = useCallback(
    async (input: {
      organisationId: string;
      length: EmailLength;
      register: EmailRegister;
      closing: ReplyClosingApproach;
      replyEventId?: string;
      skipNews?: boolean;
    }): Promise<ReplyDraftStreamOutcome> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus("generating");
      setStage("reading");
      setDisplayStage("reading");
      displayEnteredAt.current = Date.now();
      setStartedAt(Date.now());
      setSubject("");
      setBody("");
      setError(null);
      setResult(null);

      // 1. Outreach preflight check
      try {
        const preflight = await fetch(`/api/clients/${input.organisationId}/outreach-preflight`, {
          method: "POST",
          signal: controller.signal,
        });
        const preflightBody = (await preflight.json().catch(() => null)) as {
          allowed?: boolean;
          error?: string;
          kind?: string;
        } | null;

        if (!preflight.ok || !preflightBody?.allowed) {
          const warning = {
            text:
              preflightBody?.error ??
              "Outreach permissions could not be verified. Nothing was sent.",
            tone:
              preflightBody?.kind === "ownership_conflict"
                ? ("conflict" as const)
                : ("block" as const),
          };
          setStatus("idle");
          setDisplayStage(null);
          return { ok: false, warning };
        }
      } catch {
        if (controller.signal.aborted) return { ok: false, error: "cancelled" };
        const message = "Could not reach the server. Check your connection and try again.";
        setStatus("error");
        setDisplayStage(null);
        setError(message);
        return { ok: false, error: message };
      }

      // 2. Preflight passed: advance to drafting step
      setStage("drafting");

      // 3. Generate the Stage 2 draft
      try {
        const response = await fetch(`/api/clients/${input.organisationId}/outreach-drafts/stage-two`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            length: input.length,
            register: input.register,
            closing: input.closing,
            replyEventId: input.replyEventId,
            skipNews: input.skipNews,
          }),
          signal: controller.signal,
        });

        const payload = (await response.json().catch(() => null)) as
          | (ReplyDraftStreamResult & { error?: string })
          | null;

        if (!response.ok || !payload || !payload.id) {
          const message = payload?.error ?? "The reply draft could not be generated. Try again.";
          setStatus("error");
          setDisplayStage(null);
          setError(message);
          return { ok: false, error: message };
        }

        const draftResult: ReplyDraftStreamResult = {
          id: payload.id,
          subject: payload.subject ?? "",
          body: payload.body ?? "",
          newsSource: payload.newsSource,
          newsHook: payload.newsHook,
          newsUrl: payload.newsUrl,
        };

        setSubject(draftResult.subject);
        setBody(draftResult.body);
        setResult(draftResult);
        setStatus("done");
        return { ok: true, result: draftResult };
      } catch {
        if (controller.signal.aborted) return { ok: false, error: "cancelled" };
        const message = "Could not reach the server. Check your connection and try again.";
        setStatus("error");
        setDisplayStage(null);
        setError(message);
        return { ok: false, error: message };
      }
    },
    [],
  );

  return {
    status,
    stage,
    displayStage,
    startedAt,
    subject,
    body,
    error,
    result,
    start,
    reset,
  };
}
