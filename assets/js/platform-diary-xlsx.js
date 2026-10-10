(function installPlatformDiaryXlsx(global) {
  "use strict";
  const encoder = new TextEncoder();
  const worksheets = [
    { key: "issues", name: "Issues", columns: ["Référence", "Titre", "Description", "Première observation", "Catégorie", "Gravité", "Statut", "Composant", "Étapes de reproduction", "Comportement attendu", "Comportement constaté", "Correction", "Date de correction", "GitHub", "Version", "Déploiement", "Date de déploiement", "Vérifié le", "Créé le", "Mis à jour le"] },
    { key: "tenants", name: "Affected Tenants", columns: ["Référence", "Organisation", "Slug"] },
    { key: "comments", name: "Comments", columns: ["Référence", "Auteur", "Commentaire", "Date"] },
    { key: "activity", name: "Activity History", columns: ["Référence", "Action", "Auteur", "Champs", "Avant", "Après", "Date"] },
  ];
  function xml(value) {
    return String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }
  function columnName(index) {
    let value = index + 1; let name = "";
    while (value > 0) { const digit = (value - 1) % 26; name = String.fromCharCode(65 + digit) + name; value = Math.floor((value - 1) / 26); }
    return name;
  }
  function sheetXml(columns, rows) {
    const allRows = [columns, ...rows.map((row) => columns.map((column) => row && row[column] != null ? row[column] : ""))];
    const content = allRows.map((cells, rowIndex) => `<row r="${rowIndex + 1}">${cells.map((value, colIndex) => {
      const ref = `${columnName(colIndex)}${rowIndex + 1}`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
    }).join("")}</row>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${content}</sheetData></worksheet>`;
  }
  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
    return table;
  })();
  function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
  function zip(files) {
    const local = []; const central = []; let offset = 0;
    for (const [name, text] of files) {
      const filename = encoder.encode(name); const bytes = encoder.encode(text); const crc = crc32(bytes);
      const header = new Uint8Array(30 + filename.length); const view = new DataView(header.buffer);
      view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x0800, true);
      view.setUint16(8, 0, true); view.setUint32(14, crc, true); view.setUint32(18, bytes.length, true); view.setUint32(22, bytes.length, true);
      view.setUint16(26, filename.length, true); header.set(filename, 30);
      const directory = new Uint8Array(46 + filename.length); const directoryView = new DataView(directory.buffer);
      directoryView.setUint32(0, 0x02014b50, true); directoryView.setUint16(4, 20, true); directoryView.setUint16(6, 20, true);
      directoryView.setUint16(8, 0x0800, true); directoryView.setUint16(10, 0, true); directoryView.setUint32(16, crc, true);
      directoryView.setUint32(20, bytes.length, true); directoryView.setUint32(24, bytes.length, true);
      directoryView.setUint16(28, filename.length, true); directoryView.setUint32(42, offset, true); directory.set(filename, 46);
      local.push(header, bytes); central.push(directory); offset += header.length + bytes.length;
    }
    const centralSize = central.reduce((size, item) => size + item.length, 0);
    const end = new Uint8Array(22); const view = new DataView(end.buffer); view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, files.length, true); view.setUint16(10, files.length, true); view.setUint32(12, centralSize, true); view.setUint32(16, offset, true);
    const total = offset + centralSize + end.length; const output = new Uint8Array(total); let cursor = 0;
    for (const item of [...local, ...central, end]) { output.set(item, cursor); cursor += item.length; }
    return output;
  }
  function createWorkbook(payload) {
    const data = payload && payload.worksheets ? payload.worksheets : {};
    const files = [
      ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${worksheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`],
      ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
      ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${worksheets.map((sheet, i) => `<sheet name="${sheet.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`],
      ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${worksheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${worksheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
      ["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
    ];
    worksheets.forEach((sheet, index) => files.push([`xl/worksheets/sheet${index + 1}.xml`, sheetXml(sheet.columns, Array.isArray(data[sheet.key]) ? data[sheet.key] : [])]));
    return zip(files);
  }
  global.IgPlatformDiaryXlsx = Object.freeze({ createWorkbook, worksheets: worksheets.map(({ key, name }) => ({ key, name })) });
})(window);
