import * as React from "react";
import { useState, useSyncExternalStore } from "react";
import { View, type ViewProps } from "react-native";

/**
 * Web shim for `react-native-reanimated`, scoped to the API surface the
 * vendored CherryBlossomQRCode component uses.
 *
 * The real library requires the Worklets Babel plugin
 * (`react-native-worklets/plugin`), which cannot run in this Next.js 16 App
 * Router setup (custom Babel configs are dropped), and the component is
 * vendored verbatim so its hooks cannot be given the explicit dependency
 * arrays that would let Reanimated run without the plugin. These pieces are
 * therefore reimplemented against DOM primitives. The WebGPU scene the
 * component renders is plain JavaScript and is untouched by this shim.
 *
 * Reactivity note: `Animated.View` subscribes to shared-value changes itself
 * (via useSyncExternalStore) rather than relying on the parent re-rendering.
 * The React Compiler memoizes the parent's JSX on stable props, so a
 * re-rendered parent would otherwise hand `Animated.View` the same style
 * array and it would never pick up new values.
 */

export type EasingFunction = (t: number) => number;

export const Easing = {
  linear: (t: number) => t,
  quad: (t: number) => t * t,
  cubic: (t: number) => t * t * t,
  out: (f: EasingFunction): EasingFunction => (t) => 1 - f(1 - t),
  in: (f: EasingFunction): EasingFunction => (t) => f(t),
  inOut: (f: EasingFunction): EasingFunction => (t) =>
    t < 0.5 ? f(2 * t) / 2 : 1 - f(2 - 2 * t) / 2,
};

export interface Animation {
  kind: "timing" | "delay";
  target?: number;
  duration?: number;
  easing?: EasingFunction;
  delay?: number;
  child?: Animation;
}

export function withTiming(
  target: number,
  config: { duration?: number; easing?: EasingFunction } = {},
): Animation {
  return {
    kind: "timing",
    target,
    duration: config.duration ?? 300,
    easing: config.easing ?? Easing.linear,
  };
}

export function withDelay(delayMs: number, child: Animation): Animation {
  return { kind: "delay", delay: delayMs, child };
}

// ---- Shared-value store ---------------------------------------------------
// A single monotonic version plus a listener set. Any shared-value write bumps
// the version, which re-renders every Animated.View via useSyncExternalStore.
// All mutations happen in effects, timers and event handlers — never during
// render, so the React Compiler's rules are not violated.

let storeVersion = 0;
const storeListeners = new Set<() => void>();

function bumpStore(): void {
  storeVersion++;
  for (const listener of storeListeners) listener();
}

function subscribeStore(listener: () => void): () => void {
  storeListeners.add(listener);
  return () => {
    storeListeners.delete(listener);
  };
}

function getStoreVersion(): number {
  return storeVersion;
}

function getServerStoreVersion(): number {
  return 0;
}

interface SharedValueInternal<T> {
  value: T;
  rafId: number | null;
}

export interface SharedValue<T> {
  get(): T;
  set(value: T | Animation): void;
}

function isAnimation(value: unknown): value is Animation {
  if (typeof value !== "object" || value === null) return false;
  return (
    "kind" in value &&
    ((value as Animation).kind === "timing" ||
      (value as Animation).kind === "delay")
  );
}

function evaluate(
  animation: Animation,
  from: number,
  elapsed: number,
): { value: number; done: boolean } {
  if (animation.kind === "delay") {
    if (!animation.child) return { value: from, done: true };
    if (elapsed < (animation.delay ?? 0)) {
      return { value: from, done: false };
    }
    return evaluate(animation.child, from, elapsed - (animation.delay ?? 0));
  }
  const duration = animation.duration ?? 300;
  const easing = animation.easing ?? Easing.linear;
  const t = Math.min(1, Math.max(0, elapsed / duration));
  const target = animation.target ?? from;
  return { value: from + (target - from) * easing(t), done: t >= 1 };
}

function animate(sv: SharedValueInternal<number>, animation: Animation): void {
  if (sv.rafId !== null) cancelAnimationFrame(sv.rafId);
  const from = sv.value;
  const start = performance.now();
  const step = (now: number): void => {
    const { value, done } = evaluate(animation, from, now - start);
    sv.value = value;
    bumpStore();
    sv.rafId = done ? null : requestAnimationFrame(step);
  };
  sv.rafId = requestAnimationFrame(step);
}

export function useSharedValue<T>(initial: T): SharedValue<T> {
  // Lazy useState initializer keeps the instance stable across renders without
  // reading a ref during render (react-hooks/refs).
  const [sv] = useState<SharedValueInternal<T>>(() => ({
    value: initial,
    rafId: null,
  }));

  React.useEffect(() => {
    return () => {
      if (sv.rafId !== null) cancelAnimationFrame(sv.rafId);
    };
  }, [sv]);

  return {
    get: () => sv.value,
    set: (next: T | Animation) => {
      if (isAnimation(next)) {
        animate(sv as SharedValueInternal<number>, next);
      } else {
        // A shared value is deliberately a mutable box — that is its contract
        // (and real reanimated's), so the compiler's immutability rule does
        // not apply.
        // eslint-disable-next-line react-hooks/immutability
        sv.value = next;
        bumpStore();
      }
    },
  };
}

export interface AnimatedStyle<T extends object> {
  __getStyle(): T;
}

/**
 * Returns a descriptor whose `__getStyle()` re-runs the callback. Consumers
 * (`Animated.View`) re-resolve on every shared-value store bump.
 */
export function useAnimatedStyle<T extends object>(
  cb: () => T,
): AnimatedStyle<T> {
  // Stable descriptor created once (the callback closes over shared values,
  // which are stable, so capturing the first one is safe).
  const [descriptor] = useState(() => ({ cb }));
  return {
    __getStyle: () => descriptor.cb(),
  };
}

type StyleInput =
  | Record<string, unknown>
  | AnimatedStyle<Record<string, unknown>>
  | null
  | undefined
  | false;

function resolveStyles(
  style: StyleInput | StyleInput[] | undefined,
  version: number,
): Record<string, unknown> | Record<string, unknown>[] | undefined {
  // The version is a dependency for the React Compiler's memoization: when a
  // shared value bumps, this re-runs and re-reads every animated style.
  void version;
  const items = Array.isArray(style) ? style : [style];
  const resolved: Record<string, unknown>[] = [];
  for (const item of items) {
    if (!item) continue;
    if (
      "__getStyle" in item &&
      typeof (item as AnimatedStyle<Record<string, unknown>>).__getStyle ===
        "function"
    ) {
      resolved.push(
        (item as AnimatedStyle<Record<string, unknown>>).__getStyle(),
      );
    } else {
      resolved.push(item as Record<string, unknown>);
    }
  }
  if (resolved.length === 0) return undefined;
  return resolved.length === 1 ? resolved[0] : resolved;
}

interface AnimatedViewProps extends Omit<ViewProps, "style"> {
  style?: unknown;
}

export const Animated = {
  View: React.forwardRef<React.ElementRef<typeof View>, AnimatedViewProps>(
    function AnimatedView({ style, pointerEvents, ...rest }, ref) {
      const version = useSyncExternalStore(
        subscribeStore,
        getStoreVersion,
        getServerStoreVersion,
      );
      const resolved = resolveStyles(
        style as StyleInput | StyleInput[] | undefined,
        version,
      );
      // The vendored component passes `pointerEvents` as a prop (RN's old
      // API); react-native-web deprecates that and wants it in the style.
      const merged =
        pointerEvents !== undefined && resolved !== undefined
          ? Array.isArray(resolved)
            ? [...resolved, { pointerEvents }]
            : { ...resolved, pointerEvents }
          : resolved;
      return React.createElement(View, { ref, ...rest, style: merged });
    },
  ),
  createAnimatedComponent: <P extends object>(
    Component: React.ComponentType<P>,
  ): React.ComponentType<P> => Component,
};

export default Animated;
