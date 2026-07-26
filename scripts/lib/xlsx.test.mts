import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { describe, it } from "node:test";

import { columnIndex, decodeXmlText, readWorkbook } from "./xlsx.mts";

describe("columnIndex", () => {
  it("maps single letters", () => {
    assert.equal(columnIndex("A1"), 0);
    assert.equal(columnIndex("H9"), 7);
  });

  it("maps double letters", () => {
    assert.equal(columnIndex("AA1"), 26);
    assert.equal(columnIndex("AB10"), 27);
  });
});

describe("decodeXmlText", () => {
  it("resolves named entities", () => {
    assert.equal(decodeXmlText("a &amp; b &lt;c&gt;"), "a & b <c>");
  });

  it("resolves numeric and hex character references", () => {
    assert.equal(decodeXmlText("&#65;&#x42;"), "AB");
  });
});

/** Builds a minimal but real .xlsx in memory, so the reader is tested end to end. */
function buildXlsx(sharedStrings: string[], sheetRows: string): Buffer {
  const files: Record<string, string> = {
    "xl/workbook.xml":
      '<?xml version="1.0"?><workbook xmlns:r="r">' +
      '<sheets><sheet name="Sheet One" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels":
      '<?xml version="1.0"?><Relationships>' +
      '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/sharedStrings.xml":
      '<?xml version="1.0"?><sst>' +
      sharedStrings.map((value) => `<si><t>${value}</t></si>`).join("") +
      "</sst>",
    "xl/worksheets/sheet1.xml":
      `<?xml version="1.0"?><worksheet><sheetData>${sheetRows}</sheetData></worksheet>`,
  };

  // Assemble a real zip (stored entries) so the reader's zip layer runs for real.
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name);
    const data = deflateRawSync(Buffer.from(content));
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(Buffer.byteLength(content), 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(Buffer.byteLength(content), 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...chunks, centralBuf, eocd]);
}

describe("readWorkbook", () => {
  it("reads sheet names and shared-string cells", () => {
    const xlsx = buildXlsx(
      ["Field", "Type"],
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>',
    );
    const [sheet] = readWorkbook(xlsx);
    assert.equal(sheet.name, "Sheet One");
    assert.deepEqual(sheet.rows[0], ["Field", "Type"]);
  });

  it("keeps a gap from an empty self-closing cell in the right column", () => {
    // This is the regression that shipped once: `<c .../>` for an empty cell must
    // not swallow the following cell. Column C is empty; D must stay in column D.
    const xlsx = buildXlsx(
      ["id", "No", "Primary key"],
      '<row r="1">' +
        '<c r="A1" t="s"><v>0</v></c>' +
        '<c r="C1" s="21"/>' +
        '<c r="D1" t="s"><v>1</v></c>' +
        '<c r="E1" t="s"><v>2</v></c>' +
        "</row>",
    );
    const [sheet] = readWorkbook(xlsx);
    assert.deepEqual(sheet.rows[0], ["id", "", "", "No", "Primary key"]);
  });

  it("reads inline numbers as their stored text", () => {
    const xlsx = buildXlsx(
      [],
      '<row r="1"><c r="A1"><v>93</v></c></row>',
    );
    const [sheet] = readWorkbook(xlsx);
    assert.deepEqual(sheet.rows[0], ["93"]);
  });

  it("rejects a file that is not a zip", () => {
    assert.throws(() => readWorkbook(Buffer.from("not a zip")), /no end-of-central/);
  });
});
