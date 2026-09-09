"use client";

import * as React from "react";
import {
  DeleteButton,
  type DeleteButtonSize,
  type DeleteButtonVariant,
} from "@/components/ui/delete-button";
import { DemoOne, SnapDeleteDemo } from "@/components/ui/demo";
import { SendButton } from "@/components/ui/send-button";
import { BackButton } from "@/components/ui/back-button";
import { Stage, Rise } from "@/components/dashboard-stage";
import {
  RotateCcw,
  ShieldAlert,
  Database,
  Sparkles,
  Mail,
  Paperclip,
  CheckCircle2,
  Copy,
  Check,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface MockRecord {
  id: string;
  name: string;
  category: string;
  createdAt: string;
  size: string;
}

const INITIAL_RECORDS: MockRecord[] = [
  {
    id: "rec-1",
    name: "Amnesty International UK Campaign",
    category: "Human Rights",
    createdAt: "24 Aug 2026",
    size: "2.4 MB",
  },
  {
    id: "rec-2",
    name: "Oxfam Clean Water Initiative 2026",
    category: "Poverty Relief",
    createdAt: "18 Aug 2026",
    size: "5.1 MB",
  },
  {
    id: "rec-3",
    name: "Greenpeace Ocean Renewal Strategy",
    category: "Conservation",
    createdAt: "12 Aug 2026",
    size: "1.8 MB",
  },
  {
    id: "rec-4",
    name: "Red Cross Emergency Response Plan",
    category: "Disaster Aid",
    createdAt: "05 Aug 2026",
    size: "4.2 MB",
  },
];

export default function PreviewDeleteButtonPage() {
  // Playground state
  const [playgroundKey, setPlaygroundKey] = React.useState(0);
  const [selectedSize, setSelectedSize] = React.useState<DeleteButtonSize>("md");
  const [selectedVariant, setSelectedVariant] =
    React.useState<DeleteButtonVariant>("solid");
  const [snapOnConfirm, setSnapOnConfirm] = React.useState(true);
  const [label, setLabel] = React.useState("Delete");
  const [confirmLabel, setConfirmLabel] = React.useState("Confirm");
  const [deletingDuration, setDeletingDuration] = React.useState<number>(650);
  const [autoResetTimeout, setAutoResetTimeout] = React.useState<number>(0);
  const [logs, setLogs] = React.useState<
    Array<{ id: string; time: string; text: string; type: "info" | "success" | "warn" }>
  >([]);

  // Send button demo state
  const [sendButtonLabel, setSendButtonLabel] = React.useState("Send");
  const [sendCount, setSendCount] = React.useState(0);
  const [lastSentMessage, setLastSentMessage] = React.useState<string | null>(null);
  const [composerSubject, setComposerSubject] = React.useState("Partnership Introduction — 180 Degrees Consulting");
  const [composerMessage, setComposerMessage] = React.useState("Hi Sarah, We would love to discuss the upcoming Q4 social impact initiatives for your team.");
  const [copiedCode, setCopiedCode] = React.useState(false);

  const handleSendAction = (context: string = "Playground") => {
    setSendCount((c) => c + 1);
    setLastSentMessage(`Message dispatched via ${context} at ${new Date().toLocaleTimeString()}`);
    addLog(`Send button clicked (${context}) — animated plane launched!`, "success");
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(`import Component from "@/components/ui/send-button";\n\nexport default function MyComponent() {\n  return <Component />;\n}`);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  // Real world table state
  const [records, setRecords] = React.useState<MockRecord[]>(INITIAL_RECORDS);
  const [deletedRecords, setDeletedRecords] = React.useState<MockRecord[]>([]);

  const addLog = (text: string, type: "info" | "success" | "warn" = "info") => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [{ id: Math.random().toString(), time, text, type }, ...prev.slice(0, 7)]);
  };

  const handlePlaygroundConfirm = async () => {
    addLog(`Confirm clicked — showing Deleting… for ${deletingDuration}ms then Thanos snap dissolve`, "info");
    await new Promise((resolve) => setTimeout(resolve, 300));
    addLog("Action completed — button dissolved into dust!", "success");
  };

  const handlePlaygroundCancel = () => {
    addLog("Confirmation cancelled by user", "warn");
  };

  const handlePlaygroundStartConfirm = () => {
    addLog("Button entered confirmation mode — awaiting confirmation or cancel", "info");
  };

  const handleResetPlayground = () => {
    setPlaygroundKey((k) => k + 1);
    addLog("Reset sandbox stage with fresh Delete button", "info");
  };

  const handleDeleteRecord = async (recordId: string) => {
    const record = records.find((r) => r.id === recordId);
    if (!record) return;

    // Simulate network deletion
    await new Promise((resolve) => setTimeout(resolve, 800));

    setRecords((prev) => prev.filter((r) => r.id !== recordId));
    setDeletedRecords((prev) => [record, ...prev]);
    addLog(`Deleted record "${record.name}" with Thanos particle dissolve`, "success");
  };

  const handleRestoreRecords = () => {
    setRecords(INITIAL_RECORDS);
    setDeletedRecords([]);
    addLog("Restored all table records to initial state", "info");
  };

  return (
    <div className="min-h-screen bg-[#f4f4ef] px-6 py-10 sm:px-10 sm:py-12">
      <Stage className="mx-auto w-full max-w-5xl space-y-10">
        {/* Page Header */}
        <Rise className="flex flex-wrap items-center justify-between gap-4 border-b border-black/[0.08] pb-6">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand">
                Component Showcase
              </span>
              <span className="rounded-sm bg-red-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-700">
                Thanos Snap FX
              </span>
            </div>
            <h1 className="text-2xl font-black tracking-[-0.02em] text-foreground sm:text-3xl">
              DeleteConfirmButton & Thanos Snap
            </h1>
            <p className="mt-1 text-sm text-foreground/60 max-w-2xl">
              Tap &ldquo;Delete&rdquo; to expand into &ldquo;Confirm&rdquo; with tick glyph and transparent bordered &ldquo;X&rdquo; button (<code className="text-xs bg-black/[0.05] px-1 py-0.5 rounded-sm">rounded-sm</code>). Tapping &ldquo;Confirm&rdquo; executes the <strong>Thanos Snap</strong> turbulent noise particle dissolve effect.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/preview-buttons"
              className="inline-flex items-center gap-1 text-xs font-semibold text-foreground/70 hover:text-foreground px-3 py-1.5 rounded-sm border border-black/10 bg-white shadow-xs hover:bg-neutral-50 transition-colors"
            >
              All Buttons
            </Link>
            <BackButton
              variant="sliding-door"
              size="sm"
              tone="bone"
              href="/dashboard"
            />
          </div>
        </Rise>

        {/* Section 1: Hero Interactive Playground */}
        <Rise className="rounded-3xl border border-black/[0.06] bg-white p-6 shadow-sm sm:p-8 space-y-8">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-black/[0.06] pb-5">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand">
                Interactive Playground
              </span>
              <h2 className="text-lg font-bold text-foreground">
                Live State & Thanos Snap Dissolve Sandbox
              </h2>
              <p className="text-xs text-foreground/60">
                Click Delete to expand to Confirm + X, then click Confirm to watch the Thanos Snap particle turbulence dissolve effect.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleResetPlayground}
                className="inline-flex items-center gap-1 text-xs font-semibold text-foreground/80 hover:text-foreground bg-neutral-100 hover:bg-neutral-200 px-2.5 py-1 rounded-sm transition-colors"
              >
                <RotateCcw className="h-3 w-3" /> Respawn Button
              </button>
              <button
                type="button"
                onClick={() => {
                  setLogs([]);
                  addLog("Logs cleared", "info");
                }}
                className="text-xs font-medium text-foreground/60 hover:text-foreground underline decoration-dotted"
              >
                Clear Log
              </button>
            </div>
          </div>

          {/* Playground Center Stage */}
          <div className="flex flex-col items-center justify-center rounded-2xl bg-[#fafaf8] border border-black/[0.06] p-10 min-h-[180px]">
            <div className="flex flex-col items-center gap-4">
              <span className="text-[11px] font-medium text-foreground/40 uppercase tracking-wider flex items-center gap-1">
                <Sparkles className="h-3 w-3 text-amber-500" /> Interactive Stage
              </span>
              <div className="p-4 bg-white rounded-xl shadow-xs border border-black/[0.05] min-h-[64px] min-w-[200px] flex items-center justify-center">
                <DeleteButton
                  key={playgroundKey}
                  size={selectedSize}
                  variant={selectedVariant}
                  snapOnConfirm={snapOnConfirm}
                  deletingDuration={deletingDuration}
                  label={label}
                  confirmLabel={confirmLabel}
                  autoResetTimeout={autoResetTimeout}
                  onConfirm={handlePlaygroundConfirm}
                  onCancel={handlePlaygroundCancel}
                  onStartConfirm={handlePlaygroundStartConfirm}
                />
              </div>
              <div className="flex items-center gap-3">
                <p className="text-[11px] text-foreground/50">
                  Press <kbd className="px-1 py-0.5 bg-neutral-200 text-neutral-800 rounded-sm text-[10px]">Esc</kbd> anytime during confirmation to cancel.
                </p>
                <button
                  type="button"
                  onClick={handleResetPlayground}
                  className="text-[11px] font-medium text-brand hover:text-brand-hover underline"
                >
                  Spawn New Button
                </button>
              </div>
            </div>
          </div>

          {/* Playground Controls Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 pt-2">
            {/* Control: Size */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-foreground/70">
                Size Scale
              </label>
              <div className="grid grid-cols-4 gap-1 rounded-lg bg-neutral-100 p-1">
                {(["xs", "sm", "md", "lg"] as DeleteButtonSize[]).map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => setSelectedSize(sz)}
                    className={cn(
                      "py-1 text-xs font-semibold rounded-sm transition-all text-center uppercase",
                      selectedSize === sz
                        ? "bg-white text-foreground shadow-xs"
                        : "text-foreground/60 hover:text-foreground"
                    )}
                  >
                    {sz}
                  </button>
                ))}
              </div>
            </div>

            {/* Control: Style Variant */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-foreground/70">
                Red Variant
              </label>
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-neutral-100 p-1">
                {(
                  [
                    { key: "solid", label: "Solid Red" },
                    { key: "subtle", label: "Subtle Soft" },
                    { key: "outline", label: "Outline" },
                    { key: "dark", label: "Dark Ruby" },
                  ] as { key: DeleteButtonVariant; label: string }[]
                ).map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => setSelectedVariant(v.key)}
                    className={cn(
                      "py-1 px-2 text-xs font-medium rounded-sm transition-all text-center truncate",
                      selectedVariant === v.key
                        ? "bg-white text-foreground shadow-xs font-semibold"
                        : "text-foreground/60 hover:text-foreground"
                    )}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Control: Thanos Snap Toggle */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-foreground/70">
                Thanos Snap FX
              </label>
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-neutral-100 p-1">
                <button
                  type="button"
                  onClick={() => setSnapOnConfirm(true)}
                  className={cn(
                    "py-1 px-2 text-xs font-semibold rounded-sm transition-all text-center",
                    snapOnConfirm
                      ? "bg-red-600 text-white shadow-xs"
                      : "text-foreground/60 hover:text-foreground"
                  )}
                >
                  Enabled ✨
                </button>
                <button
                  type="button"
                  onClick={() => setSnapOnConfirm(false)}
                  className={cn(
                    "py-1 px-2 text-xs font-semibold rounded-sm transition-all text-center",
                    !snapOnConfirm
                      ? "bg-white text-foreground shadow-xs"
                      : "text-foreground/60 hover:text-foreground"
                  )}
                >
                  Standard
                </button>
              </div>
            </div>

            {/* Control: Custom Labels */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-foreground/70">
                Labels
              </label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Idle label"
                  className="w-full px-2.5 py-1 text-xs rounded-sm border border-neutral-300 bg-white focus:outline-none focus:ring-1 focus:ring-red-500"
                />
                <input
                  type="text"
                  value={confirmLabel}
                  onChange={(e) => setConfirmLabel(e.target.value)}
                  placeholder="Confirm label"
                  className="w-full px-2.5 py-1 text-xs rounded-sm border border-neutral-300 bg-white focus:outline-none focus:ring-1 focus:ring-red-500"
                />
              </div>
            </div>

            {/* Control: Deleting… Duration & Auto Reset */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-foreground/70">
                  Deleting Hold
                </label>
                <label className="text-xs font-bold uppercase tracking-wider text-foreground/70">
                  Auto-Reset
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={deletingDuration}
                  onChange={(e) => setDeletingDuration(Number(e.target.value))}
                  className="w-full px-2 py-1.5 text-xs rounded-sm border border-neutral-300 bg-white focus:outline-none focus:ring-1 focus:ring-red-500"
                >
                  <option value={400}>0.4s hold</option>
                  <option value={650}>0.65s hold</option>
                  <option value={1000}>1.0s hold</option>
                </select>
                <select
                  value={autoResetTimeout}
                  onChange={(e) => setAutoResetTimeout(Number(e.target.value))}
                  className="w-full px-2 py-1.5 text-xs rounded-sm border border-neutral-300 bg-white focus:outline-none focus:ring-1 focus:ring-red-500"
                >
                  <option value={0}>Disabled</option>
                  <option value={3000}>3s timer</option>
                  <option value={5000}>5s timer</option>
                </select>
              </div>
            </div>
          </div>

          {/* Activity Event Stream */}
          <div className="space-y-2 rounded-xl bg-neutral-900 text-neutral-200 p-4 font-mono text-xs shadow-inner">
            <div className="flex items-center justify-between text-neutral-400 border-b border-neutral-800 pb-2">
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                Live Event Console
              </span>
              <span>{logs.length} events logged</span>
            </div>
            <div className="space-y-1 pt-1 min-h-[64px]">
              {logs.length === 0 ? (
                <p className="text-neutral-500 italic">No events yet. Click the Delete button above to begin.</p>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="flex items-start gap-2">
                    <span className="text-neutral-500 shrink-0">[{log.time}]</span>
                    <span
                      className={cn(
                        log.type === "success"
                          ? "text-emerald-400"
                          : log.type === "warn"
                          ? "text-amber-400"
                          : "text-neutral-300"
                      )}
                    >
                      {log.text}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </Rise>

        {/* Section 2: Standalone ThanosSnapEffect Wrapper Component Showcase */}
        <Rise className="rounded-3xl border border-black/[0.06] bg-white p-6 shadow-sm sm:p-8 space-y-6">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand">
              Reusable Wrapper
            </span>
            <h2 className="text-lg font-bold text-foreground">
              ThanosSnapEffect Component (<code className="text-xs bg-black/[0.05] px-1 py-0.5 rounded-sm">@/components/ui/thanos-snap-effect</code>)
            </h2>
            <p className="text-xs text-foreground/60">
              Wrap any card, button, or HTML block to give it the SVG turbulence displacement particle dissolve effect.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-6 p-6 rounded-2xl bg-[#fafaf8] border border-black/[0.05]">
            <div className="space-y-1">
              <p className="text-xs font-bold text-foreground">Standalone Thanos Particle Dissolve:</p>
              <p className="text-[11px] text-foreground/60">Click below to snap dissolve directly:</p>
            </div>
            <SnapDeleteDemo />
          </div>
        </Rise>

        {/* Section 2.5: Animated Send Button Showcase */}
        <Rise className="rounded-3xl border border-black/[0.06] bg-white p-6 shadow-sm sm:p-8 space-y-8">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-black/[0.06] pb-5">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand">
                  New Component
                </span>
                <span className="rounded-sm bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-700">
                  Paper Plane FX
                </span>
              </div>
              <h2 className="text-lg font-bold text-foreground">
                Animated Send Button (<code className="text-xs bg-black/[0.05] px-1 py-0.5 rounded-sm">@/components/ui/send-button</code>)
              </h2>
              <p className="text-xs text-foreground/60">
                Smooth micro-animated flight trajectory with styled-components keyframes, Tailwind CSS, and full TypeScript support.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopyCode}
                className="inline-flex items-center gap-1 text-xs font-semibold text-foreground/80 hover:text-foreground bg-neutral-100 hover:bg-neutral-200 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
              >
                {copiedCode ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-600" /> Copied!
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" /> Copy Code
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Send Button Interactive Showcase Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left: Demo Stage */}
            <div className="lg:col-span-5 flex flex-col justify-between rounded-2xl bg-[#fafaf8] border border-black/[0.06] p-6 space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-foreground/50 flex items-center gap-1">
                    <Sparkles className="h-3 w-3 text-blue-500" /> Live Interactive Demo
                  </span>
                  <span className="text-xs font-mono text-foreground/50">
                    Dispatched: <strong className="text-foreground">{sendCount}</strong>
                  </span>
                </div>

                <div className="p-8 bg-white rounded-xl shadow-xs border border-black/[0.05] flex flex-col items-center justify-center min-h-[140px] gap-3">
                  <SendButton
                    label={sendButtonLabel}
                    onClick={() => handleSendAction("Sandbox Button")}
                  />
                  <p className="text-[11px] text-foreground/40 text-center">
                    Hover over the button to trigger the paper plane flight animation
                  </p>
                </div>
              </div>

              {/* Label customization */}
              <div className="space-y-2 pt-2 border-t border-black/[0.05]">
                <label className="text-[11px] font-bold uppercase tracking-wider text-foreground/70">
                  Custom Button Label
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={sendButtonLabel}
                    onChange={(e) => setSendButtonLabel(e.target.value)}
                    placeholder="Button label..."
                    className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-neutral-300 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setSendButtonLabel("Send")}
                    className="text-xs px-2.5 py-1.5 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-foreground/70 font-medium cursor-pointer"
                  >
                    Reset
                  </button>
                </div>
              </div>

              {/* Standalone DemoOne Export Preview */}
              <div className="p-4 rounded-xl bg-blue-50/60 border border-blue-100/80 space-y-2">
                <p className="text-xs font-bold text-blue-900">Rendered via DemoOne component:</p>
                <div className="flex items-center gap-4">
                  <DemoOne />
                  <span className="text-[11px] text-blue-700/80 font-mono">
                    import DemoOne from &quot;@/components/ui/demo&quot;
                  </span>
                </div>
              </div>
            </div>

            {/* Right: In-Context Outreach Message Composer Preview */}
            <div className="lg:col-span-7 flex flex-col rounded-2xl bg-white border border-black/[0.08] shadow-xs overflow-hidden">
              <div className="bg-[#fcfcf9] px-5 py-3.5 border-b border-black/[0.06] flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="h-8 w-8 rounded-full overflow-hidden border border-black/10">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80"
                      alt="Sarah Jenkins"
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-foreground">Sarah Jenkins</h4>
                    <p className="text-[11px] text-foreground/50">Director of Partnerships &middot; Oxfam UK</p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200/60">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Active Lead
                </span>
              </div>

              <div className="p-5 space-y-4 flex-1 flex flex-col justify-between">
                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] font-semibold text-foreground/60 uppercase tracking-wider">
                      Subject
                    </label>
                    <input
                      type="text"
                      value={composerSubject}
                      onChange={(e) => setComposerSubject(e.target.value)}
                      className="mt-1 w-full px-3 py-1.5 text-xs rounded-lg border border-neutral-200 bg-neutral-50/50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium text-foreground"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-foreground/60 uppercase tracking-wider">
                      Message Draft
                    </label>
                    <textarea
                      rows={3}
                      value={composerMessage}
                      onChange={(e) => setComposerMessage(e.target.value)}
                      className="mt-1 w-full px-3 py-2 text-xs rounded-lg border border-neutral-200 bg-neutral-50/50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 text-foreground resize-none leading-relaxed"
                    />
                  </div>
                </div>

                <div className="pt-4 border-t border-black/[0.06] flex items-center justify-between">
                  <div className="flex items-center gap-2 text-foreground/50">
                    <button
                      type="button"
                      className="p-1.5 hover:bg-neutral-100 rounded-md transition-colors text-foreground/60 cursor-pointer"
                      title="Attach file"
                    >
                      <Paperclip className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="p-1.5 hover:bg-neutral-100 rounded-md transition-colors text-foreground/60 cursor-pointer"
                      title="Email template"
                    >
                      <Mail className="h-4 w-4" />
                    </button>
                    <span className="text-[11px]">Attach case study PDF</span>
                  </div>

                  <SendButton
                    label="Send"
                    onClick={() => handleSendAction("Outreach Composer")}
                  />
                </div>
              </div>

              {lastSentMessage && (
                <div className="bg-emerald-50/80 border-t border-emerald-200/70 px-5 py-2 flex items-center gap-2 text-xs text-emerald-800">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                  <span>{lastSentMessage}</span>
                </div>
              )}
            </div>
          </div>
        </Rise>

        {/* Section 3: Real-World In-Context Data Table Demo */}
        <Rise className="rounded-3xl border border-black/[0.06] bg-white p-6 shadow-sm sm:p-8 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-black/[0.06] pb-5">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand">
                In-Context Workflow
              </span>
              <h2 className="text-lg font-bold text-foreground">
                Client Records Table with Inline Row Deletion
              </h2>
              <p className="text-xs text-foreground/60">
                Confirming row deletion triggers the Thanos snap particle dissolve.
              </p>
            </div>
            {deletedRecords.length > 0 && (
              <button
                type="button"
                onClick={handleRestoreRecords}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand hover:text-brand-hover bg-brand/10 hover:bg-brand/20 px-3 py-1.5 rounded-sm transition-colors"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Restore {deletedRecords.length} Deleted {deletedRecords.length === 1 ? "Row" : "Rows"}
              </button>
            )}
          </div>

          <div className="overflow-x-auto rounded-xl border border-black/[0.06]">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#f8f8f5] text-foreground/70 font-semibold border-b border-black/[0.06]">
                <tr>
                  <th className="py-3 px-4">Record Name</th>
                  <th className="py-3 px-4">Sector</th>
                  <th className="py-3 px-4">Created Date</th>
                  <th className="py-3 px-4">Data Size</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.05]">
                {records.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-foreground/50">
                      All records deleted. Click &ldquo;Restore Rows&rdquo; above to reset.
                    </td>
                  </tr>
                ) : (
                  records.map((record) => (
                    <tr key={record.id} className="hover:bg-neutral-50/80 transition-colors">
                      <td className="py-3.5 px-4 font-semibold text-foreground">
                        {record.name}
                      </td>
                      <td className="py-3.5 px-4 text-foreground/70">
                        <span className="inline-block px-2 py-0.5 rounded-sm bg-neutral-100 font-medium">
                          {record.category}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-foreground/60">
                        {record.createdAt}
                      </td>
                      <td className="py-3.5 px-4 text-foreground/60 font-mono">
                        {record.size}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end">
                          <DeleteButton
                            size="sm"
                            variant="solid"
                            label="Delete"
                            confirmLabel="Confirm"
                            snapOnConfirm={true}
                            onConfirm={() => handleDeleteRecord(record.id)}
                            onCancel={() => addLog(`Cancelled deletion of "${record.name}"`, "warn")}
                          />
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Rise>

        {/* Section 4: Surface Themes & Danger Zone Cards */}
        <Rise className="space-y-6">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand">
              Surface & Tone Matrix
            </span>
            <h2 className="text-xl font-bold text-foreground">
              Dark Ink, Light Ground & Card Contexts
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Dark Ink Card */}
            <div className="rounded-3xl bg-[#0c1014] text-white p-6 shadow-xl space-y-5 border border-white/10">
              <div className="flex items-start justify-between">
                <div>
                  <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-red-400">
                    <ShieldAlert className="h-3.5 w-3.5" /> Danger Zone
                  </span>
                  <h3 className="text-base font-bold mt-1 text-white">
                    Production API Secret Key
                  </h3>
                  <p className="text-xs text-white/60 mt-1">
                    Revoking this key will immediately sever all live third-party webhooks and client sync tunnels.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-white/10">
                <span className="font-mono text-xs text-white/40">sk_live_983...f4a1</span>
                <DeleteButton
                  size="sm"
                  variant="dark"
                  label="Revoke Key"
                  confirmLabel="Revoke Now"
                  snapOnConfirm={true}
                  onConfirm={async () => {
                    await new Promise((r) => setTimeout(r, 600));
                    addLog("API Key revoked", "warn");
                  }}
                />
              </div>
            </div>

            {/* Light Settings Card */}
            <div className="rounded-3xl bg-white p-6 shadow-sm border border-black/[0.06] space-y-5">
              <div className="flex items-start justify-between">
                <div>
                  <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-600">
                    <Database className="h-3.5 w-3.5" /> Storage & Cache
                  </span>
                  <h3 className="text-base font-bold mt-1 text-foreground">
                    Purge Ingestion Staging DB
                  </h3>
                  <p className="text-xs text-foreground/60 mt-1">
                    Clears all unparsed Companies House and 360Giving staging caches. Non-destructive to client database.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-black/[0.06]">
                <span className="font-mono text-xs text-foreground/50">48,290 cached objects</span>
                <DeleteButton
                  size="sm"
                  variant="solid"
                  label="Purge Cache"
                  confirmLabel="Confirm Purge"
                  snapOnConfirm={true}
                  onConfirm={async () => {
                    await new Promise((r) => setTimeout(r, 600));
                    addLog("Staging cache purged", "info");
                  }}
                />
              </div>
            </div>
          </div>
        </Rise>

        {/* Section 5: Scale & Sizes Comparison */}
        <Rise className="rounded-3xl border border-black/[0.06] bg-white p-6 shadow-sm sm:p-8 space-y-6">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
              Design System Spec
            </span>
            <h2 className="text-lg font-bold text-foreground">
              Size Hierarchy (XS, SM, MD, LG)
            </h2>
            <p className="text-xs text-foreground/60">
              Each size maintains optical balance with appropriate icon sizes, padding, and square proportions for the X button.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
            {(
              [
                { size: "xs", name: "Extra Small (xs)", desc: "h-7 for compact tables" },
                { size: "sm", name: "Small (sm)", desc: "h-8 for toolbars & headers" },
                { size: "md", name: "Medium (md)", desc: "h-9 default standard" },
                { size: "lg", name: "Large (lg)", desc: "h-10 for prominent modals" },
              ] as const
            ).map((item) => (
              <div
                key={item.size}
                className="flex flex-col items-center justify-between gap-4 p-5 rounded-2xl bg-[#fafaf8] border border-black/[0.05]"
              >
                <div className="text-center">
                  <p className="text-xs font-bold text-foreground">{item.name}</p>
                  <p className="text-[10px] text-foreground/50 mt-0.5">{item.desc}</p>
                </div>
                <div className="py-2">
                  <DeleteButton size={item.size} snapOnConfirm={true} />
                </div>
              </div>
            ))}
          </div>
        </Rise>
      </Stage>
    </div>
  );
}
