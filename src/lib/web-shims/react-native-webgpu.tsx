/// <reference types="@webgpu/types" />

import * as React from "react";
import { forwardRef, useImperativeHandle, useRef } from "react";

/**
 * Web shim for `react-native-webgpu`.
 *
 * On native this package drives a Dawn-backed GPU surface; on the web its
 * canvas is a plain `<canvas>` and all of the WebGPU work (requestAdapter,
 * pipelines, render passes) is performed against the browser's own WebGPU
 * implementation. The vendored render loop in `use-web-gpu.ts` is unchanged —
 * it calls `context.present()` every frame, which is a react-native-webgpu
 * extension, so the shim exposes `present()` as a no-op (the browser presents
 * automatically on queue submit).
 */

declare global {
  interface GPUCanvasContext {
    present(): void;
  }
}

export interface CanvasRef {
  getContext(contextName: "webgpu"): GPUCanvasContext | null;
}

export const Canvas = forwardRef<CanvasRef, { style?: unknown }>(
  function Canvas(_props, ref) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    useImperativeHandle(ref, () => ({
      getContext(contextName: "webgpu"): GPUCanvasContext | null {
        if (contextName !== "webgpu") return null;
        const el = canvasRef.current;
        if (!el) return null;
        const context = el.getContext("webgpu");
        if (!context) return null;
        // The vendored render loop (use-web-gpu.ts) uses exactly these four
        // members, and `present()` is a react-native-webgpu extension the
        // browser handles automatically on queue submit. Returning an explicit
        // wrapper keeps the methods bound to the real context (a Proxy
        // receiver breaks WebGPU's internal-slot getters with an "Illegal
        // invocation" error).
        return {
          canvas: context.canvas ?? el,
          configure: (config: GPUCanvasConfiguration) =>
            context.configure(config),
          getCurrentTexture: () => context.getCurrentTexture(),
          unconfigure: () => context.unconfigure(),
          present: () => {},
        } as unknown as GPUCanvasContext;
      },
    }));

    return (
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
    );
  },
);
