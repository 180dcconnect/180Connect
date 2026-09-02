import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decideEditRpcFailure,
  fieldWarnings,
  inputTypeFor,
  isLongFormField,
  isUnchanged,
  maxLengthFor,
  normalisationNote,
  normaliseFieldValue,
  summariseBatch,
  validateReason,
  REASON_MAX_LENGTH,
  describePendingSuggestion,
  isSensitiveOrgField,
  pendingSuggestionNotice,
  restrictedFieldLabel,
  restrictedFieldRpcFailure,
  validateDeactivateRestrictedFieldInput,
  SENSITIVE_FIELD_LABELS,
  SENSITIVE_ORG_FIELDS,
  suggestEditAvailability,
  suggestEditRpcFailure,
  suggestionDecisionNotice,
  validateRestrictedFieldInput,
  validateSuggestEdit,
} from "./edit-suggestions.ts";

describe("SENSITIVE_ORG_FIELDS", () => {
  it("is exactly the signed-off six-field allowlist", () => {
    assert.deepEqual([...SENSITIVE_ORG_FIELDS], [
      "legal_name",
      "website",
      "contact_email",
      "address_line_1",
      "city",
      "postcode",
    ]);
  });

  it("labels every field it allows", () => {
    for (const field of SENSITIVE_ORG_FIELDS) {
      assert.ok(SENSITIVE_FIELD_LABELS[field].length > 0);
    }
  });
});

describe("isSensitiveOrgField", () => {
  it("accepts allowlisted fields and rejects everything else", () => {
    assert.equal(isSensitiveOrgField("legal_name"), true);
    assert.equal(isSensitiveOrgField("postcode"), true);
    assert.equal(isSensitiveOrgField("trading_name"), false);
    assert.equal(isSensitiveOrgField("owner_id"), false);
    assert.equal(isSensitiveOrgField(""), false);
  });
});

describe("validateSuggestEdit", () => {
  const base = {
    organisationId: "0b8f6c1e-1111-4222-8333-444455556666",
    fieldName: "city",
    fieldValue: "Manchester",
  };

  it("accepts a valid submission and trims the value", () => {
    const result = validateSuggestEdit({ ...base, fieldValue: "  Manchester  " });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.fieldValue, "Manchester");
      assert.equal(result.data.fieldName, "city");
    }
  });

  it("rejects a malformed organisation id", () => {
    const result = validateSuggestEdit({ ...base, organisationId: "not-a-uuid" });
    assert.equal(result.success, false);
    if (!result.success) assert.match(result.message, /client could not be identified/);
  });

  it("rejects a field outside the allowlist", () => {
    const result = validateSuggestEdit({ ...base, fieldName: "owner_id" });
    assert.equal(result.success, false);
    if (!result.success) assert.match(result.message, /Choose a field/);
  });

  it("rejects a blank value", () => {
    const result = validateSuggestEdit({ ...base, fieldValue: "   " });
    assert.equal(result.success, false);
    if (!result.success) assert.match(result.message, /Enter the corrected/);
  });

  it("rejects a value over the field's max length", () => {
    const result = validateSuggestEdit({ ...base, fieldValue: "x".repeat(201) });
    assert.equal(result.success, false);
  });

  it("rejects non-string input without throwing", () => {
    const result = validateSuggestEdit({
      organisationId: null,
      fieldName: 42,
      fieldValue: undefined,
    });
    assert.equal(result.success, false);
  });
});

describe("suggestEditRpcFailure", () => {
  it("maps deliberate refusal codes to their messages", () => {
    assert.deepEqual(suggestEditRpcFailure({ code: "42501", message: "only a CAM" }), {
      status: 403,
      error: "only a CAM",
    });
    assert.deepEqual(suggestEditRpcFailure({ code: "23514", message: "enter the value" }), {
      status: 400,
      error: "enter the value",
    });
    assert.deepEqual(
      suggestEditRpcFailure({ code: "23505", message: "another member pending" }),
      { status: 409, error: "another member pending" },
    );
    assert.deepEqual(suggestEditRpcFailure({ code: "55000", message: "already the value" }), {
      status: 409,
      error: "already the value",
    });
    assert.deepEqual(suggestEditRpcFailure({ code: "P0002", message: "not found" }), {
      status: 404,
      error: "not found",
    });
  });

  it("gives unexpected failures the generic message only", () => {
    const failure = suggestEditRpcFailure({ code: "XX000", message: "relation missing" });
    assert.equal(failure.status, 500);
    assert.doesNotMatch(failure.error, /relation|missing/);
  });

  it("handles an empty error safely", () => {
    assert.equal(suggestEditRpcFailure({}).status, 500);
  });
});

describe("suggestEditAvailability", () => {
  const pendingFromOther = {
    id: "a",
    field_name: "website",
    current_value: null,
    proposed_value: "https://example.org",
    requested_by: "cam-two",
  };
  const pendingFromSelf = { ...pendingFromOther, requested_by: "cam-one" };

  it("offers the form to a CAM with no pending suggestion on the field", () => {
    const result = suggestEditAvailability({
      actorRole: "cam",
      actorId: "cam-one",
      fieldName: "website",
      pendingSuggestions: [],
    });
    assert.deepEqual(result, { available: true });
  });

  it("keeps the form open when the pending suggestion is the caller's own", () => {
    const result = suggestEditAvailability({
      actorRole: "cam",
      actorId: "cam-one",
      fieldName: "website",
      pendingSuggestions: [pendingFromSelf],
    });
    assert.deepEqual(result, { available: true });
  });

  it("blocks the field when another CAM's suggestion is pending", () => {
    const result = suggestEditAvailability({
      actorRole: "cam",
      actorId: "cam-one",
      fieldName: "website",
      pendingSuggestions: [pendingFromOther],
    });
    assert.deepEqual(result, { available: false, reason: "field_blocked" });
  });

  it("never offers the form to admins or viewers", () => {
    for (const role of ["admin", "viewer"] as const) {
      const result = suggestEditAvailability({
        actorRole: role,
        actorId: "someone",
        fieldName: "city",
        pendingSuggestions: [],
      });
      assert.deepEqual(result, { available: false, reason: "not_cam" });
    }
  });
});

describe("pendingSuggestionNotice", () => {
  it("names the field and says nothing has changed yet", () => {
    const notice = pendingSuggestionNotice("contact_email");
    assert.match(notice, /Email/);
    assert.match(notice, /awaiting admin review/);
    assert.match(notice, /still the live one/);
  });
});

describe("decideEditRpcFailure (#80/#81)", () => {
  it("maps deliberate refusal codes to their messages", () => {
    assert.deepEqual(decideEditRpcFailure({ code: "42501", message: "only an admin" }), {
      status: 403,
      error: "only an admin",
    });
    assert.deepEqual(
      decideEditRpcFailure({ code: "55000", message: "already decided" }),
      { status: 409, error: "already decided" },
    );
    assert.deepEqual(
      decideEditRpcFailure({
        code: "55000",
        message: "the live value changed since this was suggested",
      }),
      { status: 409, error: "the live value changed since this was suggested" },
    );
    assert.deepEqual(decideEditRpcFailure({ code: "P0002", message: "not found" }), {
      status: 404,
      error: "not found",
    });
  });

  it("gives unexpected failures the generic message only", () => {
    const failure = decideEditRpcFailure({ code: "XX000", message: "column missing" });
    assert.equal(failure.status, 500);
    assert.doesNotMatch(failure.error, /column|missing/);
  });
});

describe("suggestionDecisionNotice (#80 AC3)", () => {
  it("tells the CAM an approval landed on the record", () => {
    const notice = suggestionDecisionNotice("approved", "Town or city");
    assert.match(notice, /approved your correction to Town or city/);
    assert.match(notice, /live record now carries it/);
  });

  it("tells the CAM a rejection changed nothing, with the reason", () => {
    const notice = suggestionDecisionNotice(
      "rejected",
      "Website",
      "Registry shows a different URL",
    );
    assert.match(notice, /declined your correction to Website/);
    assert.match(notice, /record is unchanged/);
    assert.match(notice, /Reason: Registry shows a different URL/);
  });

  it("handles a missing rejection reason without a dangling label", () => {
    const notice = suggestionDecisionNotice("rejected", "Website", null);
    assert.doesNotMatch(notice, /Reason:/);
  });
});

describe("describePendingSuggestion (#80 AC1)", () => {
  it("shows current → proposed, naming an empty current explicitly", () => {
    assert.equal(
      describePendingSuggestion("Town or city", null, "Leeds"),
      'Town or city: "Not provided" → "Leeds"',
    );
    assert.equal(
      describePendingSuggestion("Town or city", "Manchester", "Leeds"),
      'Town or city: "Manchester" → "Leeds"',
    );
  });
});

// ---------------------------------------------------------------------------
// F020 (#23): config-driven restricted editing
// ---------------------------------------------------------------------------

describe("restrictedFieldLabel (F020)", () => {
  it("uses the curated label for the seeded six", () => {
    assert.equal(restrictedFieldLabel("legal_name"), "Name");
    assert.equal(restrictedFieldLabel("city"), "Town or city");
  });

  it("derives a readable label for an admin-added field", () => {
    assert.equal(restrictedFieldLabel("trading_name"), "trading name");
  });
});

describe("validateSuggestEdit with a live allowlist (F020)", () => {
  const base = {
    organisationId: "0b8f6c1e-1111-4222-8333-444455556666",
    fieldName: "trading_name",
    fieldValue: "Acme Trading",
  };

  it("accepts a field that is only in the live config list", () => {
    const result = validateSuggestEdit({ ...base, allowedFields: ["trading_name"] });
    assert.equal(result.success, true);
    if (result.success) assert.equal(result.data.fieldName, "trading_name");
  });

  it("rejects a seeded field once the live list no longer carries it", () => {
    const result = validateSuggestEdit({
      ...base,
      fieldName: "city",
      allowedFields: ["trading_name"],
    });
    assert.equal(result.success, false);
    if (!result.success) assert.match(result.message, /Choose a field/);
  });

  it("defaults to the seeded six so pure-form callers stay correct", () => {
    const result = validateSuggestEdit({
      ...base,
      fieldName: "postcode",
      fieldValue: "M1 1AE",
    });
    assert.equal(result.success, true);
  });

  it("bounds an admin-added field with the default max length", () => {
    const result = validateSuggestEdit({
      ...base,
      fieldValue: "x".repeat(501),
      allowedFields: ["trading_name"],
    });
    assert.equal(result.success, false);
  });
});

describe("validateRestrictedFieldInput (F020)", () => {
  it("accepts a column-shaped name with a reason and trims both", () => {
    const result = validateRestrictedFieldInput({
      fieldName: " trading_name ",
      reason: "  Feeds dedup.  ",
    });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.fieldName, "trading_name");
      assert.equal(result.data.reason, "Feeds dedup.");
    }
  });

  it("refuses anything that is not a plausible Postgres column name", () => {
    for (const bad of ["", "1abc", "has space", "drop table", "CamelCase!", null, 42]) {
      const result = validateRestrictedFieldInput({ fieldName: bad, reason: "why" });
      assert.equal(result.success, false, `expected refusal for ${String(bad)}`);
    }
  });

  it("requires a reason — the panel shows why a field is locked", () => {
    const result = validateRestrictedFieldInput({ fieldName: "trading_name", reason: "   " });
    assert.equal(result.success, false);
    if (!result.success) assert.match(result.message, /why/);
  });

  it("caps the reason length", () => {
    const result = validateRestrictedFieldInput({
      fieldName: "trading_name",
      reason: "x".repeat(501),
    });
    assert.equal(result.success, false);
  });
});

describe("validateDeactivateRestrictedFieldInput (F020)", () => {
  it("accepts and trims a field name", () => {
    const result = validateDeactivateRestrictedFieldInput({ fieldName: " trading_name " });
    assert.equal(result.success, true);
    if (result.success) assert.equal(result.data.fieldName, "trading_name");
  });

  it("refuses blank or non-string names", () => {
    for (const bad of ["   ", "", null, 42]) {
      const result = validateDeactivateRestrictedFieldInput({ fieldName: bad });
      assert.equal(result.success, false, `expected refusal for ${String(bad)}`);
    }
  });
});

describe("restrictedFieldRpcFailure (F020)", () => {
  it("maps deliberate refusal codes to their messages", () => {
    assert.deepEqual(
      restrictedFieldRpcFailure({ code: "42501", message: "only an admin may change restricted editing" }),
      { status: 403, error: "only an admin may change restricted editing" },
    );
    assert.deepEqual(
      restrictedFieldRpcFailure({ code: "23514", message: "not a restrictable client field" }),
      { status: 400, error: "not a restrictable client field" },
    );
    assert.deepEqual(
      restrictedFieldRpcFailure({ code: "P0002", message: "no active restriction found" }),
      { status: 404, error: "no active restriction found" },
    );
  });

  it("gives unexpected failures the generic message only", () => {
    const failure = restrictedFieldRpcFailure({ code: "XX000", message: "relation missing" });
    assert.equal(failure.status, 500);
    assert.doesNotMatch(failure.error, /relation|missing/);
  });

  it("handles an empty error safely", () => {
    assert.equal(restrictedFieldRpcFailure({}).status, 500);
  });
});

describe("normaliseFieldValue", () => {
  it("collapses whitespace without changing what a value says", () => {
    assert.equal(normaliseFieldValue("legal_name", "  St   Mary's  Trust "), "St Mary's Trust");
  });

  it("gives a bare domain a scheme and drops a trailing slash", () => {
    assert.equal(normaliseFieldValue("website", "example.org/"), "https://example.org");
    assert.equal(normaliseFieldValue("website", "http://example.org"), "http://example.org");
  });

  it("strips mailto: and lowercases an address", () => {
    assert.equal(normaliseFieldValue("contact_email", "MailTo:Info@Example.ORG"), "info@example.org");
  });

  it("puts a UK postcode into canonical form", () => {
    assert.equal(normaliseFieldValue("postcode", "sw1a1aa"), "SW1A 1AA");
    assert.equal(normaliseFieldValue("postcode", " ec1a 1bb "), "EC1A 1BB");
  });

  it("leaves a non-UK postcode alone beyond casing", () => {
    assert.equal(normaliseFieldValue("postcode", "75008"), "75008");
  });

  it("returns empty for a blank value", () => {
    assert.equal(normaliseFieldValue("city", "   "), "");
  });
});

describe("normalisationNote", () => {
  it("says nothing when the value is already canonical", () => {
    assert.equal(normalisationNote("website", "https://example.org"), null);
  });

  it("reports the rewrite when there is one", () => {
    assert.equal(
      normalisationNote("website", "example.org"),
      "Will be saved as https://example.org",
    );
  });
});

describe("fieldWarnings", () => {
  it("warns on a value that cannot be an email, without refusing it", () => {
    assert.equal(fieldWarnings("contact_email", "info@example.org").length, 0);
    assert.equal(fieldWarnings("contact_email", "info-at-example").length, 1);
  });

  it("warns on a web address with no dot in the host", () => {
    assert.equal(fieldWarnings("website", "example.org/about").length, 0);
    assert.equal(fieldWarnings("website", "localhost").length, 1);
  });

  it("warns on a postcode that is not recognisably UK", () => {
    assert.equal(fieldWarnings("postcode", "SW1A 1AA").length, 0);
    assert.equal(fieldWarnings("postcode", "75008").length, 1);
  });

  it("flags an all-capitals legal name", () => {
    assert.equal(fieldWarnings("legal_name", "ST MARYS TRUST").length, 1);
    assert.equal(fieldWarnings("legal_name", "St Marys Trust").length, 0);
  });

  it("says nothing about an empty value — that is the input's job", () => {
    assert.deepEqual(fieldWarnings("contact_email", "  "), []);
  });
});

describe("isUnchanged", () => {
  it("compares normalised against stored, so a scheme is not a change", () => {
    assert.equal(isUnchanged("website", "example.org", "https://example.org"), true);
    assert.equal(isUnchanged("website", "example.com", "https://example.org"), false);
  });

  it("treats a null current value as empty", () => {
    assert.equal(isUnchanged("city", "Leeds", null), false);
  });
});

describe("field shape helpers", () => {
  it("caps each seeded field where the column does", () => {
    assert.equal(maxLengthFor("postcode"), 32);
    assert.equal(maxLengthFor("legal_name"), 200);
    assert.equal(maxLengthFor("something_an_admin_added"), 500);
  });

  it("treats prose fields as long-form and identifiers as not", () => {
    assert.equal(isLongFormField("mission_statement"), true);
    assert.equal(isLongFormField("postcode"), false);
  });

  it("picks the input type that gets the right keyboard", () => {
    assert.equal(inputTypeFor("contact_email"), "email");
    assert.equal(inputTypeFor("website"), "url");
    assert.equal(inputTypeFor("city"), "text");
  });
});

describe("validateReason", () => {
  it("accepts absent, null and blank as no note", () => {
    assert.deepEqual(validateReason(undefined), { ok: true, value: null });
    assert.deepEqual(validateReason(null), { ok: true, value: null });
    assert.deepEqual(validateReason("   "), { ok: true, value: null });
  });

  it("trims a real note", () => {
    assert.deepEqual(validateReason("  checked today "), { ok: true, value: "checked today" });
  });

  it("refuses one past the column's cap", () => {
    const result = validateReason("x".repeat(REASON_MAX_LENGTH + 1));
    assert.equal(result.ok, false);
  });
});

describe("summariseBatch", () => {
  const ok = (fieldName: string) => ({ fieldName, ok: true, message: "" });
  const bad = (fieldName: string, message: string) => ({ fieldName, ok: false, message });

  it("reports a clean run as success", () => {
    const state = summariseBatch([ok("city"), ok("postcode")], "proposed");
    assert.equal(state.kind, "success");
    assert.match(state.message, /2 changes proposed/);
  });

  it("uses the single failure's own message when nothing landed", () => {
    const state = summariseBatch([bad("city", "another team member has one pending")], "proposed");
    assert.equal(state.kind, "error");
    assert.equal(state.message, "another team member has one pending");
  });

  it("keeps the successes visible when only some fail", () => {
    const state = summariseBatch([ok("city"), bad("postcode", "too long")], "saved");
    assert.equal(state.kind, "partial");
    assert.match(state.message, /1 saved, 1 could not be/);
  });
});
