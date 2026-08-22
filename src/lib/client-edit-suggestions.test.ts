import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  clientEditSuggestionRpcFailure,
  formatClientEditSuggestions,
  pendingSuggestionFields,
  SUGGESTIBLE_FIELDS,
  type ClientEditSuggestionRow,
} from "./client-edit-suggestions.ts";

function row(overrides: Partial<ClientEditSuggestionRow> = {}): ClientEditSuggestionRow {
  return {
    id: "suggestion-1",
    field_name: "legal_name",
    current_value: "Old Name Ltd",
    proposed_value: "New Name Ltd",
    status: "pending",
    note: null,
    created_at: "2026-08-01T10:00:00Z",
    suggested_by_user: { full_name: "Alex CAM" },
    ...overrides,
  };
}

describe("formatClientEditSuggestions", () => {
  it("labels the field and carries current/proposed values through (AC2)", () => {
    const [suggestion] = formatClientEditSuggestions([row()]);
    assert.equal(suggestion?.fieldLabel, "Legal name");
    assert.equal(suggestion?.currentValue, "Old Name Ltd");
    assert.equal(suggestion?.proposedValue, "New Name Ltd");
    assert.equal(suggestion?.suggestedByName, "Alex CAM");
  });

  it("shows null current_value as-is, for a field that was missing", () => {
    const [suggestion] = formatClientEditSuggestions([
      row({ current_value: null, proposed_value: "SW1A 1AA" }),
    ]);
    assert.equal(suggestion?.currentValue, null);
  });

  it("falls back when the suggesting CAM can no longer be identified", () => {
    const [suggestion] = formatClientEditSuggestions([row({ suggested_by_user: null })]);
    assert.equal(suggestion?.suggestedByName, "A former team member");
  });

  it("drops a row for a field outside the current allowlist rather than showing a raw column name", () => {
    assert.deepEqual(formatClientEditSuggestions([row({ field_name: "owner_id" })]), []);
  });

  it("orders newest first", () => {
    const suggestions = formatClientEditSuggestions([
      row({ id: "older", created_at: "2026-08-01T10:00:00Z" }),
      row({ id: "newer", created_at: "2026-08-05T10:00:00Z" }),
    ]);
    assert.deepEqual(suggestions.map((s) => s.id), ["newer", "older"]);
  });
});

describe("pendingSuggestionFields", () => {
  it("collects only pending fields, ignoring decided ones", () => {
    const suggestions = formatClientEditSuggestions([
      row({ id: "a", field_name: "legal_name", status: "pending" }),
      row({ id: "b", field_name: "city", status: "approved" }),
    ]);
    assert.deepEqual([...pendingSuggestionFields(suggestions)], ["legal_name"]);
  });
});

describe("SUGGESTIBLE_FIELDS", () => {
  it("lists exactly the six canonical fields, matching field-sources.ts", () => {
    assert.deepEqual(
      SUGGESTIBLE_FIELDS.map((f) => f.fieldName),
      ["legal_name", "website", "contact_email", "address_line_1", "city", "postcode"],
    );
  });
});

describe("clientEditSuggestionRpcFailure", () => {
  it("passes through a deliberate permission refusal", () => {
    assert.deepEqual(
      clientEditSuggestionRpcFailure({ code: "42501", message: "only a CAM or admin can suggest a client edit" }),
      { status: 403, error: "only a CAM or admin can suggest a client edit" },
    );
  });

  it("maps an unknown field or a blank proposal to 400", () => {
    assert.equal(clientEditSuggestionRpcFailure({ code: "22023", message: "unknown field" }).status, 400);
    assert.equal(clientEditSuggestionRpcFailure({ code: "23514", message: "required" }).status, 400);
  });

  it("maps a duplicate pending suggestion or a no-op proposal to 409", () => {
    assert.equal(clientEditSuggestionRpcFailure({ code: "23505", message: "already pending" }).status, 409);
    assert.equal(clientEditSuggestionRpcFailure({ code: "55000", message: "same as current" }).status, 409);
  });

  it("maps a missing organisation to 404", () => {
    assert.equal(clientEditSuggestionRpcFailure({ code: "P0002", message: "not found" }).status, 404);
  });

  it("hides an unexpected error behind a generic message", () => {
    const failure = clientEditSuggestionRpcFailure({
      code: "42P01",
      message: 'relation "public.client_edit_suggestions" does not exist',
    });
    assert.equal(failure.status, 500);
    assert.ok(!failure.error.includes("relation"));
  });

  it("hides a message-less error too", () => {
    assert.equal(clientEditSuggestionRpcFailure({ code: "42501", message: "  " }).status, 500);
  });
});
