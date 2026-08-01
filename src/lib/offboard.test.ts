import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  rpcFailureResponse,
  summariseHoldings,
  type OpenActionRow,
  type OwnedOrganisation,
} from "./offboard.ts";

const ORG_A: OwnedOrganisation = { id: "org-a", legal_name: "Alpha Trust" };
const ORG_B: OwnedOrganisation = { id: "org-b", legal_name: "Beta Foundation" };

function action(
  id: string,
  organisationId: string,
  clientName: string | null = "Somewhere Ltd",
): OpenActionRow {
  return {
    id,
    title: `Task ${id}`,
    organisation_id: organisationId,
    organisations: clientName === null ? null : { legal_name: clientName },
  };
}

describe("summariseHoldings", () => {
  it("counts open actions against the client they sit on", () => {
    const result = summariseHoldings(
      [ORG_A, ORG_B],
      [action("1", "org-a"), action("2", "org-a"), action("3", "org-b")],
    );

    assert.deepEqual(
      result.organisations,
      [
        { id: "org-a", legal_name: "Alpha Trust", open_actions: 2 },
        { id: "org-b", legal_name: "Beta Foundation", open_actions: 1 },
      ],
    );
  });

  it("does not list an action on an owned client as cross-client work", () => {
    const result = summariseHoldings([ORG_A], [action("1", "org-a")]);
    assert.deepEqual(result.crossOrgActions, []);
  });

  it("surfaces work on a client the CAM does not own, with the client named", () => {
    const result = summariseHoldings(
      [ORG_A],
      [action("1", "org-a"), action("9", "org-z", "Zeta Charity")],
    );

    assert.deepEqual(result.crossOrgActions, [
      { id: "9", title: "Task 9", organisation: "Zeta Charity" },
    ]);
  });

  it("falls back to a placeholder when the client name did not come back", () => {
    const result = summariseHoldings([], [action("9", "org-z", null)]);
    assert.equal(result.crossOrgActions[0].organisation, "Unknown client");
  });

  it("reports a client with no open work rather than omitting it", () => {
    // The client still has to move, so it has to be shown.
    const result = summariseHoldings([ORG_A], []);
    assert.deepEqual(result.organisations, [
      { id: "org-a", legal_name: "Alpha Trust", open_actions: 0 },
    ]);
  });

  it("returns empty holdings for a CAM with nothing", () => {
    assert.deepEqual(summariseHoldings([], []), {
      organisations: [],
      crossOrgActions: [],
    });
  });
});

describe("rpcFailureResponse", () => {
  it("passes through the RPC's own message for a fixable problem", () => {
    assert.deepEqual(
      rpcFailureResponse({
        code: "22023",
        message: "cannot reassign to a deactivated account",
      }),
      { status: 400, error: "cannot reassign to a deactivated account" },
    );
  });

  it("does not emit an empty message when the RPC sent none", () => {
    const result = rpcFailureResponse({ code: "22023", message: "   " });
    assert.equal(result.status, 500);
    assert.match(result.error, /\S/);
  });

  it("maps a permission failure to 403 without echoing the database", () => {
    const result = rpcFailureResponse({
      code: "42501",
      message: "permission denied for function reassign_ownership",
    });
    assert.equal(result.status, 403);
    assert.doesNotMatch(result.error, /permission denied for function/);
  });

  it("never leaks internals for an unexpected error", () => {
    const result = rpcFailureResponse({
      code: "23503",
      message:
        'insert or update on table "actions" violates foreign key constraint "actions_organisation_id_fkey"',
    });
    assert.equal(result.status, 500);
    assert.doesNotMatch(result.error, /actions|constraint|fkey|table/i);
  });

  it("handles an error object with no code at all", () => {
    const result = rpcFailureResponse({});
    assert.equal(result.status, 500);
    assert.match(result.error, /\S/);
  });
});
