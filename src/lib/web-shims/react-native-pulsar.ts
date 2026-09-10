/**
 * Web shim for `react-native-pulsar` (haptics).
 *
 * The browser has no haptic engine, so every entry point is a no-op. The
 * pattern shape is preserved so the vendored component's `Pattern`
 * constants still typecheck.
 */

export interface PatternPoint {
  time: number;
  amplitude: number;
  frequency: number;
}

export interface Pattern {
  discretePattern: PatternPoint[];
  continuousPattern: {
    amplitude: { time: number; value: number }[];
    frequency: { time: number; value: number }[];
  };
}

export const Presets = {
  System: {
    impactLight: () => {},
    impactMedium: () => {},
    impactHeavy: () => {},
    impactRigid: () => {},
    impactSoft: () => {},
    notificationSuccess: () => {},
    notificationWarning: () => {},
    notificationError: () => {},
  },
};

export const Settings = {
  stopHaptics: () => {},
  setEnabled: () => {},
};

export function usePatternComposer(..._pattern: Pattern[]): { play: () => void } {
  void _pattern;
  return { play: () => {} };
}
