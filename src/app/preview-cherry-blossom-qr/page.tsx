"use client";

import * as React from "react";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { CherryBlossomQRCode } from "@/components/cherry-blossom-qrcode";

const SOURCE_URL =
  "https://github.com/enzomanuelmangano/demos/tree/main/src/animations/cherry-blossom-qrcode";

type WebGPUSupport = "checking" | "supported" | "unsupported";

// WebGPU availability never changes mid-session, so there is nothing to
// subscribe to; useSyncExternalStore still gives us a server snapshot for SSR
// (no hydration mismatch) and the real value on the client after hydration.
const emptySubscribe = () => () => {};

function getWebGPUStatus(): WebGPUSupport {
  if (typeof navigator === "undefined") return "checking";
  return navigator.gpu ? "supported" : "unsupported";
}

function getWebGPUServerStatus(): WebGPUSupport {
  return "checking";
}

export default function PreviewCherryBlossomQRPage() {
  const webgpu = useSyncExternalStore(
    emptySubscribe,
    getWebGPUStatus,
    getWebGPUServerStatus,
  );

  return (
    <div className="min-h-screen bg-[#f4f4ef]">
      <div className="mx-auto max-w-6xl px-6 py-8 sm:px-10">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-black/[0.08] pb-6">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand">
              Animation Preview
            </span>
            <h1 className="mt-1 text-2xl font-black tracking-[-0.02em] text-foreground">
              Cherry Blossom QR Code
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-foreground/60">
              A QR code rendered as a voxel cherry blossom tree — tap to
              flatten it for scanning, long-press to spawn a creeper.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {webgpu === "checking" && (
              <span className="rounded-full bg-black/5 px-3 py-1.5 text-xs font-bold text-foreground/50">
                Checking WebGPU…
              </span>
            )}
            {webgpu === "supported" && (
              <span className="rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-700">
                WebGPU ready
              </span>
            )}
            {webgpu === "unsupported" && (
              <span className="rounded-full bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-700">
                WebGPU unavailable
              </span>
            )}
            <Link
              href="/dashboard"
              className="rounded-full bg-black/5 px-4 py-2 text-xs font-bold text-foreground transition-colors hover:bg-black/10"
            >
              ← Back to Dashboard
            </Link>
          </div>
        </div>

        {/* Live component */}
        <div className="mt-6 h-[85vh] overflow-hidden rounded-3xl border border-black/[0.06] bg-white shadow-sm">
          {webgpu === "checking" ? (
            <div className="flex h-full items-center justify-center text-sm text-foreground/40">
              Loading preview…
            </div>
          ) : webgpu === "supported" ? (
            <CherryBlossomQRCode />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-base font-bold text-foreground">
                WebGPU is not available in this browser
              </p>
              <p className="max-w-md text-sm text-foreground/60">
                This animation renders through the WebGPU API. Open the preview
                in a WebGPU-capable browser (Chrome, Edge, or Firefox 141+)
                with hardware acceleration enabled.
              </p>
            </div>
          )}
        </div>

        {/* How it works / provenance */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand">
              Interactions
            </h2>
            <ul className="space-y-1.5 text-sm text-foreground/70">
              <li>
                <span className="font-bold text-foreground">Tap</span> — toggle
                the 3D tree and the flat, scannable QR view.
              </li>
              <li>
                <span className="font-bold text-foreground">Long-press</span> —
                spawn a creeper. It walks in, hisses, and blows the tree to
                voxel debris, then the tree reassembles.
              </li>
              <li>
                <span className="font-bold text-foreground">Edit the URL</span>{" "}
                — the input below the scene regenerates the QR code.
              </li>
            </ul>
          </div>
          <div className="space-y-2 rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand">
              About this preview
            </h2>
            <p className="text-sm text-foreground/70">
              The component is vendored word-for-word from{" "}
              <a
                href={SOURCE_URL}
                target="_blank"
                rel="noreferrer"
                className="font-bold text-brand underline-offset-2 hover:underline"
              >
                enzomanuelmangano/demos
              </a>{" "}
              into <code className="text-xs">src/components/cherry-blossom-qrcode/</code>.
              It is React Native source, so its runtime imports are bridged to
              the web (react-native-web + shims in{" "}
              <code className="text-xs">src/lib/web-shims/</code>); the WebGPU
              scene itself is unchanged.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
