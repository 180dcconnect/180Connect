"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { Plus } from "lucide-react";

import { EASE } from "@/components/brand/motion";
import { BackButton } from "@/components/ui/back-button";
import { OriginButton } from "@/components/ui/origin-button";
import type { CharityCommissionRun } from "./bulk-funnel";

/**
 * Which of the screen's two jobs is on show.
 *
 * The page has exactly two modes and they are not equally common: checking
 * whether an import worked (often, quickly) and composing a new one (rarely,
 * carefully). Stacking both meant the frequent job was three screens below the
 * rare one. So history is the landing view and the composer is entered.
 *
 * ── Why this is state and not a route ──
 *
 * A `?new=1` search param would be shareable and survive a reload, which sounds
 * strictly better until you leave the composer: a route change unmounts it, and
 * a half-built selection — six chips, an income band, a date range — is gone
 * for good if you tap back to check when the last import ran. Both panels stay
 * mounted and one is hidden, so that round trip costs nothing. Nothing here is
 * worth linking to anyway: the composer is always entered empty.
 */

export interface ConsoleContextValue {
  openComposer: () => void;
  closeComposer: () => void;
  recordSimulatedRun: (run: CharityCommissionRun) => void;
  simulatedRuns: CharityCommissionRun[];
}

export const ConsoleContext = createContext<ConsoleContextValue | null>(null);

export function useConsole() {
  return useContext(ConsoleContext);
}

/**
 * The primary action, rendered wherever it belongs in the layout rather than
 * where the state lives — it sits in the run history's header, which is a
 * server component, so it reaches the shell through context instead of a prop.
 */
export function NewImportButton() {
  const context = useContext(ConsoleContext);
  if (!context) return null;

  return (
    <OriginButton onClick={context.openComposer} size="md" type="button">
      <span className="inline-flex items-center gap-1.5">
        <Plus className="h-3.5 w-3.5" strokeWidth={2.6} />
        New import
      </span>
    </OriginButton>
  );
}

export function ImportConsole({
  home,
  composer,
}: {
  home: ReactNode;
  composer: ReactNode;
}) {
  const [mode, setMode] = useState<"home" | "composer">("home");
  const [simulatedRuns, setSimulatedRuns] = useState<CharityCommissionRun[]>([]);

  const go = (next: "home" | "composer") => {
    setMode(next);
    // The composer's sticky bar is pinned to the top of the viewport; arriving
    // mid-scroll would put it behind whatever the reader was already looking at.
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  };

  const recordSimulatedRun = (run: CharityCommissionRun) => {
    setSimulatedRuns((prev) => [run, ...prev]);
  };

  return (
    <ConsoleContext.Provider
      value={{
        openComposer: () => go("composer"),
        closeComposer: () => go("home"),
        recordSimulatedRun,
        simulatedRuns,
      }}
    >
      <motion.div
        animate={{ opacity: mode === "home" ? 1 : 0, y: mode === "home" ? 0 : 6 }}
        transition={{ duration: 0.25, ease: EASE }}
        className={mode === "home" ? "space-y-4" : "hidden"}
      >
        {home}
      </motion.div>

      <motion.div
        animate={{ opacity: mode === "composer" ? 1 : 0, y: mode === "composer" ? 0 : 6 }}
        transition={{ duration: 0.25, ease: EASE }}
        className={mode === "composer" ? "space-y-4" : "hidden"}
      >
        <BackButton onClick={() => go("home")} label="Imports" />
        {composer}
      </motion.div>
    </ConsoleContext.Provider>
  );
}
