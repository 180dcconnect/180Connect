/**
 * Re-identifying the orphan charities: rows imported by the retired API
 * discovery path that carry no `uk_charity` identifier and no linked raw
 * record, so neither the import annotators nor the profile backfill (which
 * both key on the charity number) can ever reach them.
 *
 * What they do carry is the regulator's own spelling of their name and
 * postcode — the same source the register file is built from — so an exact
 * name+postcode match against `data/register.sqlite` re-identifies them with
 * high confidence. Re-running is a no-op (the script skips organisations that
 * hold a `uk_charity` identifier by then), and two orphans claiming one
 * register row are both held back as ambiguous.
 *
 * ── Three passes, narrowest first ──
 *
 * 1. **Exact name + postcode.** The default, and the only one that needs no
 *    justification: both sides come from the same regulator field.
 * 2. **Older registration wins** (`tie-broken`). A name+postcode pair that hits
 *    several rows is usually not ambiguity in our data at all — it is one
 *    charity holding two registrations. Measured on staging (Sept 2026), 21 of
 *    the 21 such collisions were an established charity (registered 1964–2011,
 *    activities filed) beside a brand-new CIO registered in June–August 2026 at
 *    the same name and address: the unincorporated-association → CIO
 *    conversion, where the register still carries both rows. The rule is
 *    deliberately narrow — it only fires when exactly one candidate is *not* a
 *    CIO and every other one is, i.e. when the choice reads as "the charity we
 *    know versus the entity it became". Anything else stays ambiguous, and
 *    every bound choice carries every candidate it considered.
 * 3. **Unique name, postcode ignored.** Some records' postcodes have drifted —
 *    the retired API's value, since corrected on the register (4 live cases:
 *    a record at MK14 5BP against the register's NP23 4FB). This pass drops the
 *    postcode, but only when the normalised name identifies exactly one row in
 *    the whole 171,800-row file. A name that is duplicated anywhere cannot be
 *    resolved this way, so this pass can never touch a pass-1 or pass-2 case.
 *
 * Names compare with trailing parenthetical groups removed: the register writes
 * `WORD OF FIRE INTERNATIONAL MINISTRIES (WOFIM)` where the record has no
 * acronym, and only the bracketed suffix differs. Stripping can only ever widen
 * a match, and a widened match that is no longer unique falls to `ambiguous`
 * rather than to a wrong answer.
 *
 * Pure, no I/O: the script loads both sides and calls matchOrphans.
 */

export type OrphanRow = {
  id: string;
  legal_name: string;
  postcode: string | null;
};

export type RegisterRow = {
  organisation_number: number;
  registered_charity_number: number | null;
  charity_name: string;
  postcode: string | null;
  /** The register file's own marker. Absent on callers that do not select it. */
  is_cio?: number | boolean | null;
  /** ISO date the registration began. Absent on callers that do not select it. */
  date_of_registration?: string | null;
};

/** One register row a tie-break considered, kept so the choice is auditable. */
export type TieBreakCandidate = {
  organisationNumber: number;
  registeredCharityNumber: number | null;
  dateOfRegistration: string | null;
  isCio: boolean;
};

export type OrphanMatch =
  | {
      kind: "confident";
      orphanId: string;
      organisationNumber: number;
      registeredCharityNumber: number;
      /** Which of the three passes produced this. */
      via: "name-and-postcode" | "unique-name";
    }
  | {
      kind: "tie-broken";
      orphanId: string;
      organisationNumber: number;
      registeredCharityNumber: number;
      rule: "older-registration";
      /** Every candidate, oldest first — including the one not chosen. */
      candidates: TieBreakCandidate[];
    }
  | {
      kind: "ambiguous";
      orphanId: string;
      legalName: string;
      candidates: number;
    }
  | {
      kind: "unmatched";
      orphanId: string;
      legalName: string;
      reason: "no-postcode" | "no-postcode-rows" | "no-name-match" | "no-charity-number";
    };

function isCio(row: RegisterRow): boolean {
  return row.is_cio === true || row.is_cio === 1;
}

function toCandidate(row: RegisterRow): TieBreakCandidate {
  return {
    organisationNumber: row.organisation_number,
    registeredCharityNumber: row.registered_charity_number,
    dateOfRegistration: row.date_of_registration ?? null,
    isCio: isCio(row),
  };
}

/**
 * Uppercase, trailing parentheticals dropped, punctuation stripped, whitespace
 * collapsed. Apostrophes are removed rather than spaced ("HELEN'S" reads as
 * "HELENS", while "PRE-SCHOOL" still reads as two words) so either side's
 * punctuation habit matches.
 */
export function normalizeName(value: string): string {
  let text = value.toUpperCase();
  // Loop rather than one regex: a name can end in more than one group
  // ("FOO (BAR) (BAZ)"), and an anchored replace with /g still only fires once.
  for (;;) {
    const stripped = text.replace(/\s*\([^()]*\)\s*$/, "");
    if (stripped === text) break;
    text = stripped;
  }
  return text
    .replace(/[''ʼ`]/g, "")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Uppercase with all whitespace removed. Null when blank. */
export function normalizePostcode(value: string | null | undefined): string | null {
  const compact = value?.toUpperCase().replace(/\s+/g, "");
  return compact ? compact : null;
}

/** Register rows keyed by normalised postcode. */
export function indexRegisterByPostcode(rows: readonly RegisterRow[]): Map<string, RegisterRow[]> {
  const index = new Map<string, RegisterRow[]>();
  for (const row of rows) {
    const postcode = normalizePostcode(row.postcode);
    if (!postcode) continue;
    const bucket = index.get(postcode) ?? [];
    bucket.push(row);
    index.set(postcode, bucket);
  }
  return index;
}

/**
 * Register rows keyed by normalised name — the pass-3 index. A name that maps
 * to more than one row is kept (so the caller can see it is not unique); the
 * uniqueness test is applied per lookup, not here.
 */
export function indexRegisterByName(rows: readonly RegisterRow[]): Map<string, RegisterRow[]> {
  const index = new Map<string, RegisterRow[]>();
  for (const row of rows) {
    const name = normalizeName(row.charity_name);
    if (!name) continue;
    const bucket = index.get(name) ?? [];
    bucket.push(row);
    index.set(name, bucket);
  }
  return index;
}

/**
 * The older-registration tie-break: among several rows sharing a name and a
 * postcode, the single established charity rather than the CIO that superseded
 * it. Returns null — leaving the pair ambiguous — unless the choice is
 * structurally unambiguous: every candidate dated, exactly one candidate is not
 * a CIO, and all the others are, with at least two distinct registration dates.
 */
export function preferOlderRegistration(candidates: readonly RegisterRow[]): RegisterRow | null {
  const usable = candidates.filter((row) => row.registered_charity_number !== null);
  if (usable.length !== candidates.length || usable.length < 2) return null;
  if (usable.some((row) => !row.date_of_registration)) return null;

  const sorted = [...usable].sort((left, right) =>
    (left.date_of_registration as string).localeCompare(right.date_of_registration as string),
  );
  const oldest = sorted[0];
  const rest = sorted.slice(1);

  if (isCio(oldest)) return null;
  if (!rest.every(isCio)) return null;
  // A shared registration date means the file holds two spellings of one
  // charity rather than a predecessor and its successor; not our call to make.
  if (rest.some((row) => row.date_of_registration === oldest.date_of_registration)) return null;

  return oldest;
}

/**
 * Exact / tie-broken / unique-name matches, unique on both sides. A register row
 * claimed by more than one orphan is ambiguous rather than first-wins. A matched
 * row with no registered charity number cannot produce the `uk_charity`
 * identifier the backfills key on, so it is reported instead of half-applied.
 *
 * `byName` is optional: without it passes 1 and 2 still run and pass 3 is simply
 * inert, which is what the pure-form tests rely on.
 */
export function matchOrphans(
  orphans: readonly OrphanRow[],
  byPostcode: ReadonlyMap<string, RegisterRow[]>,
  byName?: ReadonlyMap<string, RegisterRow[]>,
): OrphanMatch[] {
  type Selection = {
    orphan: OrphanRow;
    row: RegisterRow;
    via: "name-and-postcode" | "unique-name";
    candidates: RegisterRow[];
  };

  const selections: Selection[] = [];
  const settled = new Map<string, OrphanMatch>();

  for (const orphan of orphans) {
    const wanted = normalizeName(orphan.legal_name);
    const postcode = normalizePostcode(orphan.postcode);
    const bucket = postcode ? (byPostcode.get(postcode) ?? []) : [];
    const hits = bucket.filter((row) => normalizeName(row.charity_name) === wanted);

    // Pass 1 and 2: the register's own postcode, and the register's own name.
    if (hits.length === 1) {
      selections.push({ orphan, row: hits[0], via: "name-and-postcode", candidates: hits });
      continue;
    }
    if (hits.length > 1) {
      const chosen = preferOlderRegistration(hits);
      if (chosen) {
        selections.push({
          orphan,
          row: chosen,
          via: "name-and-postcode",
          candidates: [...hits].sort((left, right) =>
            (left.date_of_registration ?? "").localeCompare(right.date_of_registration ?? ""),
          ),
        });
      } else {
        settled.set(orphan.id, {
          kind: "ambiguous",
          orphanId: orphan.id,
          legalName: orphan.legal_name,
          candidates: hits.length,
        });
      }
      continue;
    }

    // Pass 3: the postcode has drifted, so it is dropped — but only for a name
    // that identifies one row in the entire register file.
    const named = byName?.get(wanted) ?? [];
    if (named.length === 1) {
      selections.push({ orphan, row: named[0], via: "unique-name", candidates: named });
      continue;
    }
    if (named.length > 1) {
      settled.set(orphan.id, {
        kind: "ambiguous",
        orphanId: orphan.id,
        legalName: orphan.legal_name,
        candidates: named.length,
      });
      continue;
    }

    settled.set(orphan.id, {
      kind: "unmatched",
      orphanId: orphan.id,
      legalName: orphan.legal_name,
      reason: !postcode
        ? "no-postcode"
        : bucket.length === 0
          ? "no-postcode-rows"
          : "no-name-match",
    });
  }

  // Two orphans claiming one register row is still ambiguous, whichever pass
  // produced the claim.
  const claims = new Map<number, number>();
  for (const selection of selections) {
    claims.set(selection.row.organisation_number, (claims.get(selection.row.organisation_number) ?? 0) + 1);
  }

  const matched: OrphanMatch[] = selections.map((selection) => {
    const organisationNumber = selection.row.organisation_number;
    if ((claims.get(organisationNumber) ?? 0) > 1) {
      return {
        kind: "ambiguous",
        orphanId: selection.orphan.id,
        legalName: selection.orphan.legal_name,
        candidates: claims.get(organisationNumber) ?? 0,
      };
    }

    const registeredCharityNumber = selection.row.registered_charity_number;
    if (registeredCharityNumber === null) {
      return {
        kind: "unmatched",
        orphanId: selection.orphan.id,
        legalName: selection.orphan.legal_name,
        reason: "no-charity-number",
      };
    }

    // A pass-2 pick is reported as its own kind so the script can log what it
    // chose between; a unique candidate that never needed the rule stays a
    // plain confident match.
    const neededRule =
      selection.via === "name-and-postcode" && selection.candidates.length > 1;
    if (neededRule) {
      return {
        kind: "tie-broken",
        orphanId: selection.orphan.id,
        organisationNumber,
        registeredCharityNumber,
        rule: "older-registration",
        candidates: selection.candidates.map(toCandidate),
      };
    }

    return {
      kind: "confident",
      orphanId: selection.orphan.id,
      organisationNumber,
      registeredCharityNumber,
      via: selection.via,
    };
  });

  return matched.concat([...settled.values()]);
}
