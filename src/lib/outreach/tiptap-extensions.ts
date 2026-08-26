/**
 * F117: local Tiptap extensions with no official `@tiptap/*` package.
 * Font size, color and font family already ship in `@tiptap/extension-text-style`;
 * indent has no first-party equivalent, so this follows Tiptap's own documented
 * "custom attribute" recipe rather than pulling in a third-party package.
 */

import { Extension } from "@tiptap/core";

export type IndentOptions = {
  types: string[];
  step: number;
  max: number;
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    indent: {
      increaseIndent: () => ReturnType;
      decreaseIndent: () => ReturnType;
    };
  }
}

/**
 * Adds a `marginLeft` attribute to paragraphs and list items so the toolbar's
 * indent buttons have something to change. Not text alignment (left/center/
 * right) — this is nesting depth, matching what was actually asked for.
 */
export const Indent = Extension.create<IndentOptions>({
  name: "indent",

  addOptions() {
    return { types: ["paragraph", "listItem"], step: 24, max: 192 };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element) => {
              const parsed = parseInt(element.style.marginLeft || "0", 10);
              return Number.isFinite(parsed) ? parsed : 0;
            },
            renderHTML: (attributes) => {
              const indent = (attributes.indent as number) || 0;
              if (indent <= 0) return {};
              return { style: `margin-left: ${indent}px` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    const step = this.options.step;
    const max = this.options.max;
    const changeIndent = (delta: number) => {
      return ({ tr, state, dispatch }: { tr: import("@tiptap/pm/state").Transaction; state: import("@tiptap/pm/state").EditorState; dispatch?: (tr: import("@tiptap/pm/state").Transaction) => void }) => {
        const { selection, doc } = state;
        let changed = false;
        doc.nodesBetween(selection.from, selection.to, (node, pos) => {
          if (!this.options.types.includes(node.type.name)) return;
          const current = (node.attrs.indent as number) || 0;
          const next = Math.min(max, Math.max(0, current + delta));
          if (next !== current) {
            tr.setNodeAttribute(pos, "indent", next);
            changed = true;
          }
        });
        if (changed && dispatch) dispatch(tr);
        return changed;
      };
    };

    return {
      increaseIndent:
        () =>
        (props) =>
          changeIndent(step)(props),
      decreaseIndent:
        () =>
        (props) =>
          changeIndent(-step)(props),
    };
  },
});
