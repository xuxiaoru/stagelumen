// Minimal RFC 4180 CSV reader. No dependencies — Pages runs no install step.
// Handles quoted fields, escaped quotes (""), embedded commas and newlines,
// and a leading UTF-8 BOM.

export function parseCsv(text) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  if (!src.trim()) return [];

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\r') {
      i++;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += ch;
    i++;
  }

  row.push(field);
  if (row.length > 1 || row[0] !== '') rows.push(row);

  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

// Turns the first row into keys and the rest into objects. Keys are
// normalised (lowercase, strip spaces/underscores) so "Model Name",
// "model_name" and "modelName" all land on the same column.
export function csvToObjects(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];

  const header = rows[0].map((h) => String(h).trim().toLowerCase().replace(/[\s_-]/g, ''));
  const out = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row.length) continue;
    const obj = {};
    for (let c = 0; c < header.length; c++) {
      obj[header[c]] = String(row[c] == null ? '' : row[c]).trim();
    }
    out.push(obj);
  }
  return out;
}
