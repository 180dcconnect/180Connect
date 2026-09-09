/**
 * Web shim for `react-native-keyboard-controller`.
 *
 * On the web there is no floating keyboard to track — the browser viewport
 * resizes around the focused input. `useKeyboardHandler` is therefore a
 * no-op that never fires, which keeps the vendored component's shared
 * keyboard height at 0, exactly the value its styles are built around.
 */

export interface KeyboardEvent {
  height: number;
}

export interface KeyboardHandlerConfig {
  onMove?: (e: KeyboardEvent) => void;
  onShow?: (e: KeyboardEvent) => void;
  onHide?: (e: KeyboardEvent) => void;
  onInteractive?: (e: KeyboardEvent) => void;
}

export function useKeyboardHandler(..._config: KeyboardHandlerConfig[]): void {
  void _config;
  // No-op on web — the keyboard never overlaps the page.
}
