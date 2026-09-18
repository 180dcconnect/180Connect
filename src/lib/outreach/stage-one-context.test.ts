import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toStageOneContext, type StageOneExtras, type StageOneOrganisationRow } from "./stage-one-context.ts";

const ORGANISATION: StageOneOrganisationRow = {
  legal_name: "Sheffield Wellbeing Trust",
  trading_name: null,
  organisation_type: "charity",
  website: null,
  city: "Sheffield",
  country_code: "GB",
  geographic_reach: "local",
  sector: null,
  sub_sector: null,
  charity_activities: null,
  cic_community_statement: null,
};

const EMPTY_EXTRAS: StageOneExtras = {
  contact: null,
  enrichment: null,
  incomeBand: null,
  booklet: null,
  attachmentText: null,
};

describe("toStageOneContext", () => {
  it("prefers the filed charity purpose over an enrichment mission", () => {
    const context = toStageOneContext({
      organisation: { ...ORGANISATION, charity_activities: "Runs a community kitchen." },
      extras: { ...EMPTY_EXTRAS, enrichment: { mission_statement: "Guessed mission.", mission_keywords: null, sector: null, sub_sector: null, news_hooks: null } },
      senderName: "Bashir",
      attachFlyer: false,
    });
    assert.equal(context.missionStatement, "Runs a community kitchen.");
  });

  it("falls back to the enrichment mission when no register purpose is filed", () => {
    const context = toStageOneContext({
      organisation: ORGANISATION,
      extras: { ...EMPTY_EXTRAS, enrichment: { mission_statement: "Supports carers.", mission_keywords: null, sector: null, sub_sector: null, news_hooks: null } },
      senderName: null,
      attachFlyer: false,
    });
    assert.equal(context.missionStatement, "Supports carers.");
  });

  it("prefers the organisation's own sector over the enriched one, and falls back to it", () => {
    const enrichment = { mission_statement: null, mission_keywords: null, sector: "Guessed sector", sub_sector: "Guessed sub", news_hooks: null };
    const canonical = toStageOneContext({
      organisation: { ...ORGANISATION, sector: "Health", sub_sector: "Mental health" },
      extras: { ...EMPTY_EXTRAS, enrichment },
      senderName: null,
      attachFlyer: false,
    });
    assert.equal(canonical.sector, "Health");
    assert.equal(canonical.subSector, "Mental health");

    const enriched = toStageOneContext({
      organisation: ORGANISATION,
      extras: { ...EMPTY_EXTRAS, enrichment },
      senderName: null,
      attachFlyer: false,
    });
    assert.equal(enriched.sector, "Guessed sector");
    assert.equal(enriched.subSector, "Guessed sub");
  });

  it("treats a blank sector column as absent rather than as an empty sector", () => {
    const context = toStageOneContext({
      organisation: { ...ORGANISATION, sector: "   " },
      extras: EMPTY_EXTRAS,
      senderName: null,
      attachFlyer: false,
    });
    assert.equal(context.sector, null);
  });

  it("joins the contact's name and leaves it null when there is no contact", () => {
    const named = toStageOneContext({
      organisation: ORGANISATION,
      extras: { ...EMPTY_EXTRAS, contact: { id: "c1", first_name: "Aisha", last_name: "Khan", job_title: "Director", email: null } },
      senderName: null,
      attachFlyer: false,
    });
    assert.equal(named.contactName, "Aisha Khan");
    assert.equal(named.contactJobTitle, "Director");

    assert.equal(
      toStageOneContext({ organisation: ORGANISATION, extras: EMPTY_EXTRAS, senderName: null, attachFlyer: false }).contactName,
      null,
    );
  });

  it("leaves the contact name null when the contact row carries no name at all", () => {
    const context = toStageOneContext({
      organisation: ORGANISATION,
      extras: { ...EMPTY_EXTRAS, contact: { id: "c1", first_name: null, last_name: null, job_title: null, email: "hi@example.org" } },
      senderName: null,
      attachFlyer: false,
    });
    // Not "" — signOffRule/greetingRule read an empty string as a present name.
    assert.equal(context.contactName, null);
  });

  it("carries the sender, flyer choice, booklet and attachment text through unchanged", () => {
    const context = toStageOneContext({
      organisation: ORGANISATION,
      extras: { ...EMPTY_EXTRAS, booklet: "Booklet text", attachmentText: "File: a.pdf\nSome text", incomeBand: "10k_100k" },
      senderName: "Bashir Bobboi",
      attachFlyer: true,
    });
    assert.equal(context.senderName, "Bashir Bobboi");
    assert.equal(context.attachFlyer, true);
    assert.equal(context.booklet, "Booklet text");
    assert.equal(context.attachmentText, "File: a.pdf\nSome text");
    assert.equal(context.incomeBand, "10k_100k");
  });
});
