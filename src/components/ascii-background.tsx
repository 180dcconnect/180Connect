"use client";

import { useEffect, useRef } from "react";

/**
 * Canvas2D reimplementation of the 21st.dev "Forest" ASCII-art effect.
 *
 * Pipeline per frame:
 *   1. source photo -> work canvas (cover fit), tilt-shift blur applied
 *   2. colour adjustments (brightness/contrast/saturation/grayscale/tint)
 *   3. grid of `cellSize` cells, average colour + luminance sampled per cell
 *   4. background layer (`bgMode`) drawn, then a glyph per cell
 *   5. post-effects from `pfx`, in the documented order
 *
 * Cell sampling only re-runs on resize; the animation loop just re-shades
 * the cached cells, so the per-frame cost is one drawImage per cell.
 */

const CHAR_SETS = {
  standard: " .:-=+*#%@",
  blocks: " ░▒▓█",
  binary: " 01",
  minimal: " .:*#",
} as const;

export type AsciiConfig = {
  cellSize: number;
  charSet: keyof typeof CHAR_SETS;
  customChars: string;
  /** -100..100, 0 = neutral */
  brightness: number;
  /** 0..255, 128 = neutral */
  contrast: number;
  /** 0..200, 100 = neutral */
  saturation: number;
  /** 0..100 */
  grayscale: number;
  tint: string;
  /** 0..100 */
  tintOpacity: number;
  overlayBlend: GlobalCompositeOperation;
  invert: boolean;
  /** % of cells drawn, 0..100 */
  coverage: number;
  /** extra glyph weight, 0..100 */
  density: number;
  /** 0..100 */
  edgeEmphasis: number;
  bgMode: "blur" | "color" | "photo" | "none";
  /** px of blur on the background copy */
  bgBlur: number;
  /** 0..100 */
  bgOpacity: number;
  bgColor: string;
  blurType: "none" | "tilt";
  /** 0..100 */
  blurAmount: number;
  /** height of the sharp band, % of canvas */
  tiltFocus: number;
  /** centre of the sharp band, % of canvas */
  tiltPosition: number;
  /** falloff either side of the band, % of canvas */
  tiltFeather: number;
  animated: boolean;
  animStyle: "wave" | "pulse" | "shimmer" | "ripple" | "flicker";
  /** 0..100 */
  animSpeed: number;
  /** 0..100 */
  animIntensity: number;
  pfx: {
    chromatic: { enabled: boolean; intensity: number };
    halftone: { enabled: boolean; intensity: number };
    filmDust: { enabled: boolean; intensity: number };
    vignette: { enabled: boolean; intensity: number };
    scanLines: { enabled: boolean; intensity: number };
  };
};

/** The "Forest" preset. */
export const FOREST: AsciiConfig = {
  cellSize: 10,
  charSet: "standard",
  customChars: "",
  brightness: 0,
  contrast: 128,
  saturation: 0,
  grayscale: 100,
  tint: "#3ca6ff",
  tintOpacity: 0,
  overlayBlend: "multiply",
  invert: false,
  coverage: 100,
  density: 0,
  edgeEmphasis: 0,
  bgMode: "blur",
  bgBlur: 2,
  bgOpacity: 90,
  bgColor: "#000000",
  blurType: "tilt",
  blurAmount: 30,
  tiltFocus: 35,
  tiltPosition: 50,
  tiltFeather: 15,
  animated: true,
  animStyle: "shimmer",
  animSpeed: 100,
  animIntensity: 60,
  pfx: {
    chromatic: { enabled: true, intensity: 20 },
    halftone: { enabled: true, intensity: 20 },
    filmDust: { enabled: true, intensity: 20 },
    vignette: { enabled: false, intensity: 58 },
    scanLines: { enabled: false, intensity: 40 },
  },
};

type Cell = { x: number; y: number; lum: number; hash: number };

/** Draw `img` into `ctx` at cover fit for a w x h box. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  w: number,
  h: number,
) {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

export default function AsciiBackground({
  src,
  config,
  className,
}: {
  src: string;
  config?: Partial<AsciiConfig>;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Keep the latest config on a ref so overrides don't restart the raf loop.
  const cfgRef = useRef<AsciiConfig>({ ...FOREST, ...config });
  cfgRef.current = { ...FOREST, ...config, pfx: { ...FOREST.pfx, ...config?.pfx } };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let raf = 0;
    let cells: Cell[] = [];
    let cssW = 0;
    let cssH = 0;
    let dpr = 1;
    let img: HTMLImageElement | null = null;
    let disposed = false;

    // Layers reused across frames.
    const bgLayer = document.createElement("canvas");
    const scene = document.createElement("canvas");
    const tintLayer = document.createElement("canvas");
    const atlas = document.createElement("canvas");
    const ATLAS_STEPS = 48;
    let halftone: CanvasPattern | null = null;

    /** Photo -> tilt-shift blur -> colour grade. Returns the graded canvas. */
    function gradeSource(image: HTMLImageElement, w: number, h: number) {
      const cfg = cfgRef.current;
      const work = document.createElement("canvas");
      work.width = w;
      work.height = h;
      const wctx = work.getContext("2d")!;

      drawCover(wctx, image, w, h);

      if (cfg.blurType === "tilt" && cfg.blurAmount > 0) {
        const blurred = document.createElement("canvas");
        blurred.width = w;
        blurred.height = h;
        const bctx = blurred.getContext("2d")!;
        bctx.filter = `blur(${(cfg.blurAmount / 100) * 20}px)`;
        bctx.drawImage(work, 0, 0);

        // Feathered mask: transparent across the focus band, opaque outside.
        const centre = (cfg.tiltPosition / 100) * h;
        const half = ((cfg.tiltFocus / 100) * h) / 2;
        const feather = (cfg.tiltFeather / 100) * h;
        const grad = wctx.createLinearGradient(0, 0, 0, h);
        const stops: Array<[number, number]> = [
          [0, 1],
          [(centre - half - feather) / h, 1],
          [(centre - half) / h, 0],
          [(centre + half) / h, 0],
          [(centre + half + feather) / h, 1],
          [1, 1],
        ];
        for (const [at, alpha] of stops) {
          grad.addColorStop(Math.min(1, Math.max(0, at)), `rgba(0,0,0,${alpha})`);
        }
        const mask = document.createElement("canvas");
        mask.width = w;
        mask.height = h;
        const mctx = mask.getContext("2d")!;
        mctx.drawImage(blurred, 0, 0);
        mctx.globalCompositeOperation = "destination-in";
        mctx.fillStyle = grad;
        mctx.fillRect(0, 0, w, h);
        wctx.drawImage(mask, 0, 0);
      }

      // Step 4: brightness -> contrast -> saturation -> grayscale, then tint.
      const graded = document.createElement("canvas");
      graded.width = w;
      graded.height = h;
      const gctx = graded.getContext("2d")!;
      gctx.filter = [
        `brightness(${1 + cfg.brightness / 100})`,
        `contrast(${cfg.contrast / 128})`,
        `saturate(${cfg.saturation}%)`,
        `grayscale(${cfg.grayscale}%)`,
      ].join(" ");
      gctx.drawImage(work, 0, 0);
      gctx.filter = "none";

      if (cfg.tintOpacity > 0) {
        gctx.globalCompositeOperation = cfg.overlayBlend;
        gctx.globalAlpha = cfg.tintOpacity / 100;
        gctx.fillStyle = cfg.tint;
        gctx.fillRect(0, 0, w, h);
        gctx.globalAlpha = 1;
        gctx.globalCompositeOperation = "source-over";
      }
      return graded;
    }

    /** One glyph per luminance bucket, pre-rendered so frames are drawImage-only. */
    function buildAtlas() {
      const cfg = cfgRef.current;
      const chars = cfg.customChars || CHAR_SETS[cfg.charSet];
      const tile = Math.ceil(cfg.cellSize * dpr);
      atlas.width = tile * ATLAS_STEPS;
      atlas.height = tile;
      const actx = atlas.getContext("2d")!;
      actx.clearRect(0, 0, atlas.width, atlas.height);
      actx.textAlign = "center";
      actx.textBaseline = "middle";

      for (let i = 0; i < ATLAS_STEPS; i++) {
        let t = (i + 0.5) / ATLAS_STEPS;
        if (cfg.invert) t = 1 - t;
        const ci = Math.min(
          chars.length - 1,
          Math.round(t * (chars.length - 1) + (cfg.density / 100) * 1.5),
        );
        const ch = chars[ci];
        if (ch === " ") continue;
        const size = cfg.cellSize * dpr * (0.72 + 0.5 * t);
        const shade = Math.round(60 + 195 * t);
        actx.font = `${size}px ui-monospace, "SFMono-Regular", Menlo, monospace`;
        actx.fillStyle = `rgb(${shade},${shade},${shade})`;
        actx.fillText(ch, i * tile + tile / 2, tile / 2);
      }
    }

    function buildHalftone() {
      const cfg = cfgRef.current;
      const size = 4;
      const pc = document.createElement("canvas");
      pc.width = size;
      pc.height = size;
      const pctx = pc.getContext("2d")!;
      pctx.fillStyle = `rgba(0,0,0,${(cfg.pfx.halftone.intensity / 100) * 0.9})`;
      pctx.beginPath();
      pctx.arc(size / 2, size / 2, size / 3.2, 0, Math.PI * 2);
      pctx.fill();
      halftone = ctx!.createPattern(pc, "repeat");
    }

    function measure() {
      if (!img) return;
      const cfg = cfgRef.current;
      const rect = canvas!.getBoundingClientRect();
      cssW = Math.max(1, Math.round(rect.width));
      cssH = Math.max(1, Math.round(rect.height));
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);

      for (const c of [canvas!, scene, tintLayer]) {
        c.width = Math.round(cssW * dpr);
        c.height = Math.round(cssH * dpr);
      }
      bgLayer.width = canvas!.width;
      bgLayer.height = canvas!.height;

      const graded = gradeSource(img, cssW, cssH);

      // Background layer (step 1), drawn at device resolution.
      const bctx = bgLayer.getContext("2d")!;
      bctx.clearRect(0, 0, bgLayer.width, bgLayer.height);
      bctx.fillStyle = cfg.bgColor;
      bctx.fillRect(0, 0, bgLayer.width, bgLayer.height);
      if (cfg.bgMode !== "none" && cfg.bgMode !== "color") {
        bctx.save();
        // Held well under the glyph layer: the blurred photo is an underlay,
        // not a second copy of the image competing with the ASCII.
        bctx.globalAlpha = (cfg.bgOpacity / 100) * 0.45;
        if (cfg.bgMode === "blur") bctx.filter = `blur(${cfg.bgBlur * 8}px)`;
        bctx.scale(dpr, dpr);
        bctx.drawImage(graded, 0, 0, cssW, cssH);
        bctx.restore();
      }

      // Step 2: average luminance per cell.
      const cs = cfg.cellSize;
      const cols = Math.ceil(cssW / cs);
      const rows = Math.ceil(cssH / cs);
      const data = graded.getContext("2d")!.getImageData(0, 0, cssW, cssH).data;
      const next: Cell[] = [];
      for (let ry = 0; ry < rows; ry++) {
        for (let rx = 0; rx < cols; rx++) {
          const x0 = rx * cs;
          const y0 = ry * cs;
          const x1 = Math.min(x0 + cs, cssW);
          const y1 = Math.min(y0 + cs, cssH);
          let sum = 0;
          let n = 0;
          for (let y = y0; y < y1; y += 2) {
            let p = (y * cssW + x0) * 4;
            for (let x = x0; x < x1; x += 2, p += 8) {
              sum += 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2];
              n++;
            }
          }
          const lum = n ? sum / n / 255 : 0;
          // Deterministic per-cell offset, used by the shimmer/flicker styles.
          const hash = ((rx * 73856093) ^ (ry * 19349663)) % 1000;
          next.push({ x: x0, y: y0, lum, hash: (hash / 1000) * Math.PI * 2 });
        }
      }
      cells = next;

      buildAtlas();
      buildHalftone();
    }

    function animOffset(cell: Cell, t: number) {
      const cfg = cfgRef.current;
      if (!cfg.animated || reduceMotion) return 0;
      const amp = (cfg.animIntensity / 100) * 0.35;
      const speed = 0.3 + (cfg.animSpeed / 100) * 2.2;
      const p = t * speed;
      switch (cfg.animStyle) {
        case "wave":
          return Math.sin(p + cell.x * 0.02) * amp;
        case "pulse":
          return Math.sin(p) * amp;
        case "ripple": {
          const d = Math.hypot(cell.x - cssW / 2, cell.y - cssH / 2);
          return Math.sin(p * 2 - d * 0.03) * amp;
        }
        case "flicker":
          return (Math.sin(p * 6 + cell.hash * 9) > 0.7 ? 1 : 0) * amp;
        case "shimmer":
        default:
          return Math.sin(p + cell.hash) * amp;
      }
    }

    function drawGlyphs(target: CanvasRenderingContext2D, t: number) {
      const cfg = cfgRef.current;
      const tile = Math.ceil(cfg.cellSize * dpr);
      const step = cfg.cellSize * dpr;
      const cover = cfg.coverage / 100;
      for (const cell of cells) {
        if (cover < 1 && cell.hash / (Math.PI * 2) > cover) continue;
        const lum = Math.min(0.999, Math.max(0, cell.lum + animOffset(cell, t)));
        const bucket = Math.floor(lum * ATLAS_STEPS);
        target.drawImage(
          atlas,
          bucket * tile,
          0,
          tile,
          tile,
          Math.round((cell.x / cfg.cellSize) * step),
          Math.round((cell.y / cfg.cellSize) * step),
          tile,
          tile,
        );
      }
    }

    /** Offset copy of `scene` tinted to one channel, for chromatic aberration. */
    function channel(dx: number, colour: string) {
      const tctx = tintLayer.getContext("2d")!;
      tctx.globalCompositeOperation = "source-over";
      tctx.clearRect(0, 0, tintLayer.width, tintLayer.height);
      tctx.drawImage(scene, dx, 0);
      tctx.globalCompositeOperation = "multiply";
      tctx.fillStyle = colour;
      tctx.fillRect(0, 0, tintLayer.width, tintLayer.height);
      tctx.globalCompositeOperation = "destination-in";
      tctx.drawImage(scene, dx, 0);
      return tintLayer;
    }

    function frame(now: number) {
      if (disposed) return;
      const cfg = cfgRef.current;
      const t = now / 1000;
      const W = canvas!.width;
      const H = canvas!.height;

      const sctx = scene.getContext("2d")!;
      sctx.clearRect(0, 0, W, H);
      sctx.drawImage(bgLayer, 0, 0);
      drawGlyphs(sctx, t);

      ctx!.clearRect(0, 0, W, H);

      // Step 5, in the documented pfx order (only chromatic/halftone/dust here).
      if (cfg.pfx.chromatic.enabled && cfg.pfx.chromatic.intensity > 0) {
        const d = (cfg.pfx.chromatic.intensity / 100) * 6 * dpr;
        ctx!.globalCompositeOperation = "lighter";
        ctx!.drawImage(channel(-d, "#ff0000"), 0, 0);
        ctx!.drawImage(channel(d, "#00ffff"), 0, 0);
        ctx!.globalCompositeOperation = "source-over";
        ctx!.globalAlpha = 0.85;
        ctx!.drawImage(scene, 0, 0);
        ctx!.globalAlpha = 1;
      } else {
        ctx!.drawImage(scene, 0, 0);
      }

      if (cfg.pfx.scanLines.enabled) {
        ctx!.fillStyle = `rgba(0,0,0,${(cfg.pfx.scanLines.intensity / 100) * 0.4})`;
        for (let y = 0; y < H; y += 3 * dpr) ctx!.fillRect(0, y, W, dpr);
      }

      if (cfg.pfx.halftone.enabled && halftone) {
        ctx!.globalCompositeOperation = "multiply";
        ctx!.fillStyle = halftone;
        ctx!.fillRect(0, 0, W, H);
        ctx!.globalCompositeOperation = "source-over";
      }

      if (cfg.pfx.vignette.enabled) {
        const g = ctx!.createRadialGradient(
          W / 2,
          H / 2,
          Math.min(W, H) * 0.25,
          W / 2,
          H / 2,
          Math.max(W, H) * 0.75,
        );
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(1, `rgba(0,0,0,${cfg.pfx.vignette.intensity / 100})`);
        ctx!.fillStyle = g;
        ctx!.fillRect(0, 0, W, H);
      }

      if (cfg.pfx.filmDust.enabled) {
        const k = cfg.pfx.filmDust.intensity;
        ctx!.fillStyle = "rgba(255,255,255,0.5)";
        for (let i = 0; i < k; i++) {
          ctx!.fillRect(Math.random() * W, Math.random() * H, dpr, dpr);
        }
        if (Math.random() < k / 400) {
          const x = Math.random() * W;
          ctx!.fillRect(x, Math.random() * H, dpr, (20 + Math.random() * 60) * dpr);
        }
      }

      if (cfg.animated && !reduceMotion) raf = requestAnimationFrame(frame);
    }

    const image = new Image();
    image.decoding = "async";
    image.src = src;
    image.onload = () => {
      if (disposed) return;
      img = image;
      measure();
      raf = requestAnimationFrame(frame);
    };

    let resizeTimer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (disposed || !img) return;
        measure();
        if (!cfgRef.current.animated || reduceMotion) {
          raf = requestAnimationFrame(frame);
        }
      }, 150);
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(canvas);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      clearTimeout(resizeTimer);
      observer.disconnect();
    };
  }, [src]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={className ?? "pointer-events-none absolute inset-0 h-full w-full"}
    />
  );
}
