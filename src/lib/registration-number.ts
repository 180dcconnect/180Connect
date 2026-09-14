/**
 * The registers a UK client can be registered with, and the shape each one's
 * numbers take.
 *
 * ── Why the register is a choice and not a text box ──
 *
 * `manual_entry_records.registry_name` was free text, so the same register
 * arrived as "Charity Commission", "CCEW", "charity commision" and "Charity
 * Commission for England and Wales" — four strings nothing downstream can match
 * against each other or against a register file. A closed list of the four UK
 * registers, plus a way out for anything else, stores the register's own name
 * every time.
 *
 * ── What "valid" means here ──
 *
 * Shape only. A number that passes is one the register *could* have issued;
 * whether it did is a separate question, answered against the register files
 * this deployment holds (see `field-check-actions.ts`). Kept pure so both the
 * form and the server can ask it.
 */

export type RegisterId = "ccew" | "companies_house" | "oscr" | "ccni" | "other";

export type RegisterOption = {
  id: RegisterId;
  /** Stored in `registry_name`. Empty for "other", whose name is typed. */
  name: string;
  /** What the picker shows. */
  label: string;
  /** A number in the register's own format, for the placeholder. */
  example: string | null;
};

export const REGISTER_OPTIONS: readonly RegisterOption[] = [
  {
    id: "ccew",
    name: "Charity Commission for England and Wales",
    label: "Charity Commission (England and Wales)",
    example: "1012345",
  },
  { id: "companies_house", name: "Companies House", label: "Companies House", example: "01234567" },
  { id: "oscr", name: "Scottish Charity Regulator", label: "OSCR (Scotland)", example: "SC012345" },
  {
    id: "ccni",
    name: "Charity Commission for Northern Ireland",
    label: "Charity Commission for Northern Ireland",
    example: "NIC100002",
  },
  { id: "other", name: "", label: "Another register", example: null },
];

/**
 * Which option a stored or prefilled register name is.
 *
 * Tolerant of the spellings already in drafts, because a draft saved before the
 * list existed must open on the right option rather than on "other" with its
 * name in a box. Null for nothing at all.
 */
export function registerIdForName(name: string | null | undefined): RegisterId | null {
  const text = name?.trim().toLowerCase();
  if (!text) return null;

  const exact = REGISTER_OPTIONS.find((option) => option.name && option.name.toLowerCase() === text);
  if (exact) return exact.id;

  if (text === "oscr" || text.includes("scottish charity regulator")) return "oscr";
  if (text.includes("companies house")) return "companies_house";
  if (text.includes("charity commission") && text.includes("northern ireland")) return "ccni";
  if (text === "ccew" || text.startsWith("charity commission")) return "ccew";
  return "other";
}

export type NumberCheck = { ok: true; value: string } | { ok: false; message: string };

/**
 * The number in the register's canonical form, or why it cannot be one.
 *
 * Spaces and hyphens are dropped and letters upper-cased first, because that is
 * how people paste numbers. Companies House numbers are zero-padded to eight
 * digits — the register prints `01234567`, people type `1234567`.
 */
export function normaliseRegistrationNumber(register: RegisterId, raw: string): NumberCheck {
  const compact = raw.replace(/[\s-]/g, "").toUpperCase();
  if (!compact) return { ok: false, message: "Enter the number." };

  switch (register) {
    case "ccew":
      return /^\d{6,7}$/.test(compact)
        ? { ok: true, value: compact }
        : { ok: false, message: "A Charity Commission number is 6 or 7 digits, like 1012345." };
    case "companies_house": {
      const padded = /^\d{1,8}$/.test(compact) ? compact.padStart(8, "0") : compact;
      return /^(\d{8}|[A-Z]{2}\d{6})$/.test(padded)
        ? { ok: true, value: padded }
        : {
            ok: false,
            message:
              "A Companies House number is 8 digits like 01234567, or 2 letters and 6 digits like SC123456.",
          };
    }
    case "oscr":
      return /^SC\d{6}$/.test(compact)
        ? { ok: true, value: compact }
        : { ok: false, message: "An OSCR number is SC and 6 digits, like SC012345." };
    case "ccni": {
      const digits = compact.replace(/^NIC/, "");
      return /^\d{6}$/.test(digits)
        ? { ok: true, value: `NIC${digits}` }
        : { ok: false, message: "A Northern Ireland charity number is NIC and 6 digits, like NIC100002." };
    }
    case "other":
      return { ok: true, value: raw.trim() };
  }
}
