const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "..", "assets/js/platform-diary-xlsx.js"), "utf8");
function load() { const window = {}; vm.runInNewContext(source, { window, TextEncoder, Uint8Array, Uint32Array, DataView, String, Math }); return window.IgPlatformDiaryXlsx; }
function entries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); const files = new Map(); let offset = 0;
  while (offset + 4 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 22, true); const nameLength = view.getUint16(offset + 26, true); const extra = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + nameLength)); const start = offset + 30 + nameLength + extra;
    files.set(name, new TextDecoder().decode(bytes.slice(start, start + size))); offset = start + size;
  }
  return files;
}

test("creates a genuine Open XML workbook with four named sheets and safe inline string cells", () => {
  const writer = load();
  const bytes = writer.createWorkbook({ worksheets: {
    issues: [{ "Référence": "BUG-0001", Titre: "=HYPERLINK(\"https://bad\") & <test>" }],
    tenants: [], comments: [], activity: [],
  } });
  assert.equal(new DataView(bytes.buffer).getUint32(0, true), 0x04034b50);
  const files = entries(bytes);
  assert.ok(files.has("[Content_Types].xml"));
  assert.ok(files.has("xl/worksheets/sheet1.xml"));
  const workbook = files.get("xl/workbook.xml");
  for (const name of ["Issues", "Affected Tenants", "Comments", "Activity History"]) assert.match(workbook, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const sheet = files.get("xl/worksheets/sheet1.xml");
  assert.match(sheet, /t="inlineStr"/);
  assert.match(sheet, /&lt;test&gt;/);
  assert.doesNotMatch(sheet, /<f>/, "user content is never emitted as a spreadsheet formula");
});

test("XML escaping removes invalid controls and safely escapes user text", () => {
  const bytes = load().createWorkbook({ worksheets: { issues: [{ Titre: "A\u0001&B<C>\"D" }] } });
  const sheet = entries(bytes).get("xl/worksheets/sheet1.xml");
  assert.match(sheet, /A&amp;B&lt;C&gt;&quot;D/);
  assert.doesNotMatch(sheet, /\u0001/);
});
