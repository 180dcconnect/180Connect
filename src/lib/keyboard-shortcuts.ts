/**
 * The keyboard shortcuts 180Connect actually has.
 *
 * Only what exists in code — a shortcut list that promises keys nobody wired
 * up is worse than none. Shown by the `?` dialog and on the Accessibility page.
 * When you add a shortcut, add it here.
 */

export type KeyboardShortcut = {
  group: string;
  action: string;
  /** Alternatives; each is a combination pressed together. */
  keys: readonly (readonly string[])[];
};

export const KEYBOARD_SHORTCUTS: readonly KeyboardShortcut[] = [
  { group: "Anywhere", action: "Show keyboard shortcuts", keys: [["?"]] },
  {
    group: "Anywhere",
    action: "Skip past the menu to the page content (first press on a page)",
    keys: [["Tab"]],
  },
  {
    group: "Anywhere",
    action: "Move to the next or previous control",
    keys: [["Tab"], ["Shift", "Tab"]],
  },
  { group: "Anywhere", action: "Close the open dialog, menu or panel", keys: [["Esc"]] },
  { group: "Option groups", action: "Change the selected option", keys: [["←"], ["→"]] },
  {
    group: "Suggestions and @mentions",
    action: "Move through the list",
    keys: [["↑"], ["↓"]],
  },
  {
    group: "Suggestions and @mentions",
    action: "Choose the highlighted item",
    keys: [["Enter"], ["Tab"]],
  },
  {
    group: "Inbox notes",
    action: "Save the note you are writing",
    keys: [["Ctrl", "Enter"], ["⌘", "Enter"]],
  },
];
