import { KEYBOARD_SHORTCUTS } from "@/lib/keyboard-shortcuts";

/** The shortcut list, shared by the `?` dialog and the Accessibility page. */
export function ShortcutList() {
  const groups = [...new Set(KEYBOARD_SHORTCUTS.map((shortcut) => shortcut.group))];

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group}>
          <h3 className="text-[13px] font-semibold text-ink">{group}</h3>
          <dl className="mt-1">
            {KEYBOARD_SHORTCUTS.filter((shortcut) => shortcut.group === group).map(
              (shortcut) => (
                <div
                  key={shortcut.action}
                  className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-rule-soft py-2.5 first:border-t-0"
                >
                  <dt className="text-[13.5px] text-ink">{shortcut.action}</dt>
                  <dd className="flex flex-wrap items-center gap-1.5">
                    {shortcut.keys.map((combo, index) => (
                      <span key={combo.join("+")} className="flex items-center gap-1">
                        {index > 0 && <span className="px-0.5 text-[12px] text-faint">or</span>}
                        {combo.map((key) => (
                          <kbd
                            key={key}
                            className="min-w-6 rounded-inset border border-rule bg-paper px-1.5 py-0.5 text-center font-mono text-[11.5px] text-ink"
                          >
                            {key}
                          </kbd>
                        ))}
                      </span>
                    ))}
                  </dd>
                </div>
              ),
            )}
          </dl>
        </div>
      ))}
    </div>
  );
}
