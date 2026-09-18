import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  countryFlagEmoji,
  countryToIso,
  isoToFlagEmoji,
} from "./country-flags.ts";

describe("isoToFlagEmoji", () => {
  it("converts 2-letter ISO codes to flag emojis", () => {
    assert.equal(isoToFlagEmoji("GB"), "🇬🇧");
    assert.equal(isoToFlagEmoji("US"), "🇺🇸");
    assert.equal(isoToFlagEmoji("AF"), "🇦🇫");
    assert.equal(isoToFlagEmoji("KE"), "🇰🇪");
    assert.equal(isoToFlagEmoji("za"), "🇿🇦");
  });

  it("returns null for invalid inputs", () => {
    assert.equal(isoToFlagEmoji(null), null);
    assert.equal(isoToFlagEmoji(""), null);
    assert.equal(isoToFlagEmoji("USA"), null);
    assert.equal(isoToFlagEmoji("12"), null);
  });
});

describe("countryFlagEmoji", () => {
  it("resolves the user requested country names accurately", () => {
    assert.equal(countryFlagEmoji("Afghanistan"), "🇦🇫");
    assert.equal(countryFlagEmoji("Angola"), "🇦🇴");
    assert.equal(countryFlagEmoji("Armenia"), "🇦🇲");
    assert.equal(countryFlagEmoji("Azerbaijan"), "🇦🇿");
    assert.equal(countryFlagEmoji("Bangladesh"), "🇧🇩");
    assert.equal(countryFlagEmoji("Bolivia"), "🇧🇴");
    assert.equal(countryFlagEmoji("Brazil"), "🇧🇷");
    assert.equal(countryFlagEmoji("Burma"), "🇲🇲");
    assert.equal(countryFlagEmoji("Cambodia"), "🇰🇭");
    assert.equal(countryFlagEmoji("Central African Republic"), "🇨🇫");
    assert.equal(countryFlagEmoji("Chad"), "🇹🇩");
    assert.equal(countryFlagEmoji("Colombia"), "🇨🇴");
    assert.equal(countryFlagEmoji("Congo (Democratic Republic)"), "🇨🇩");
    assert.equal(countryFlagEmoji("Ethiopia"), "🇪🇹");
    assert.equal(countryFlagEmoji("Georgia"), "🇬🇪");
    assert.equal(countryFlagEmoji("Ghana"), "🇬🇭");
    assert.equal(countryFlagEmoji("Guatemala"), "🇬🇹");
    assert.equal(countryFlagEmoji("Haiti"), "🇭🇹");
    assert.equal(countryFlagEmoji("Honduras"), "🇭🇳");
    assert.equal(countryFlagEmoji("India"), "🇮🇳");
    assert.equal(countryFlagEmoji("Indonesia"), "🇮🇩");
    assert.equal(countryFlagEmoji("Iraq"), "🇮🇶");
    assert.equal(countryFlagEmoji("Jordan"), "🇯🇴");
    assert.equal(countryFlagEmoji("Kenya"), "🇰🇪");
    assert.equal(countryFlagEmoji("Lebanon"), "🇱🇧");
    assert.equal(countryFlagEmoji("Liberia"), "🇱🇷");
    assert.equal(countryFlagEmoji("Malawi"), "🇲🇼");
    assert.equal(countryFlagEmoji("Mali"), "🇲🇱");
    assert.equal(countryFlagEmoji("Mexico"), "🇲🇽");
    assert.equal(countryFlagEmoji("Mozambique"), "🇲🇿");
    assert.equal(countryFlagEmoji("Nepal"), "🇳🇵");
    assert.equal(countryFlagEmoji("Nicaragua"), "🇳🇮");
    assert.equal(countryFlagEmoji("Niger"), "🇳🇪");
    assert.equal(countryFlagEmoji("Nigeria"), "🇳🇬");
    assert.equal(countryFlagEmoji("Occupied Palestinian Territories"), "🇵🇸");
    assert.equal(countryFlagEmoji("Pakistan"), "🇵🇰");
    assert.equal(countryFlagEmoji("Philippines"), "🇵🇭");
    assert.equal(countryFlagEmoji("Russia"), "🇷🇺");
    assert.equal(countryFlagEmoji("Rwanda"), "🇷🇼");
    assert.equal(countryFlagEmoji("Senegal"), "🇸🇳");
    assert.equal(countryFlagEmoji("Sierra Leone"), "🇸🇱");
    assert.equal(countryFlagEmoji("Somalia"), "🇸🇴");
    assert.equal(countryFlagEmoji("South Africa"), "🇿🇦");
    assert.equal(countryFlagEmoji("Sri Lanka"), "🇱🇰");
    assert.equal(countryFlagEmoji("Sudan"), "🇸🇩");
    assert.equal(countryFlagEmoji("Syria"), "🇸🇾");
    assert.equal(countryFlagEmoji("Tajikistan"), "🇹🇯");
    assert.equal(countryFlagEmoji("Tanzania"), "🇹🇿");
    assert.equal(countryFlagEmoji("Thailand"), "🇹🇭");
    assert.equal(countryFlagEmoji("Uganda"), "🇺🇬");
    assert.equal(countryFlagEmoji("Vanuatu"), "🇻🇺");
    assert.equal(countryFlagEmoji("Vietnam"), "🇻🇳");
    assert.equal(countryFlagEmoji("Yemen"), "🇾🇪");
    assert.equal(countryFlagEmoji("Zambia"), "🇿🇲");
  });

  it("handles case-insensitivity and whitespace", () => {
    assert.equal(countryFlagEmoji("  kenya  "), "🇰🇪");
    assert.equal(countryFlagEmoji("nigeria"), "🇳🇬");
    assert.equal(countryFlagEmoji("AFGHANISTAN"), "🇦🇫");
  });

  it("handles special subdivision flags", () => {
    assert.equal(countryFlagEmoji("Scotland"), "🏴󠁧󠁢󠁳󠁣󠁴󠁿");
    assert.equal(countryFlagEmoji("Wales"), "🏴󠁧󠁢󠁷󠁬󠁳󠁿");
    assert.equal(countryFlagEmoji("England"), "🏴󠁧󠁢󠁥󠁮󠁧󠁿");
  });

  it("returns null for unknown strings or empty", () => {
    assert.equal(countryFlagEmoji("Atlantis"), null);
    assert.equal(countryFlagEmoji(""), null);
    assert.equal(countryFlagEmoji(null), null);
  });
});

describe("countryToIso", () => {
  it("resolves country names to ISO codes", () => {
    assert.equal(countryToIso("Kenya"), "KE");
    assert.equal(countryToIso("Occupied Palestinian Territories"), "PS");
    assert.equal(countryToIso("Congo (Democratic Republic)"), "CD");
  });
});
