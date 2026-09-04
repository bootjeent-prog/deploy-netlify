const TOKEN_KEY = 'factory_asset_token';

export function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
export function setToken(token: string) { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY); }

async function authorizedFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try { message = (await response.json()).error || message; } catch { /* ignore */ }
    if (response.status === 401 && path !== '/api/auth/login') {
      setToken('');
      window.dispatchEvent(new Event('auth-expired'));
    }
    throw new Error(message);
  }
  return response;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await authorizedFetch(path, options);
  if (response.status === 204) return undefined as T;
  return response.json();
}

export async function apiBlob(path: string, options: RequestInit = {}): Promise<Blob> {
  const response = await authorizedFetch(path, options);
  return response.blob();
}

export async function openProtectedResource(path: string): Promise<void> {
  const popup = window.open('about:blank', '_blank');
  if (popup) popup.opener = null;

  try {
    const blob = await apiBlob(path);
    const objectUrl = URL.createObjectURL(blob);

    if (popup) {
      popup.location.replace(objectUrl);
    } else {
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.target = '_blank';
      anchor.rel = 'noreferrer';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    }

    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 5 * 60 * 1000);
  } catch (error) {
    popup?.close();
    throw error;
  }
}

export function post<T>(path: string, body: unknown) { return api<T>(path, { method: 'POST', body: JSON.stringify(body) }); }
export function put<T>(path: string, body: unknown) { return api<T>(path, { method: 'PUT', body: JSON.stringify(body) }); }
export function del<T = void>(path: string) { return api<T>(path, { method: 'DELETE' }); }

export type ExcelColumn = {
  key: string;
  header: string;
  width?: number;
  type?: 'text' | 'number' | 'integer' | 'currency' | 'date' | 'datetime';
  value?: (row: any) => unknown;
};

function xmlEscape(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function columnName(index: number) {
  let name = '';
  let current = index + 1;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
}

function excelDateSerial(value: unknown) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return null;
  const [, year, month, day, hour = '0', minute = '0', second = '0'] = match;
  const milliseconds = Date.UTC(
    Number(year), Number(month) - 1, Number(day),
    Number(hour), Number(minute), Number(second)
  );
  return milliseconds / 86400000 + 25569;
}

function safeSheetName(value: string) {
  const cleaned = String(value || 'Report').replace(/[\\/?*\[\]:]/g, ' ').trim() || 'Report';
  return cleaned.slice(0, 31);
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function uint16(value: number) {
  const buffer = new Uint8Array(2);
  new DataView(buffer.buffer).setUint16(0, value, true);
  return buffer;
}

function uint32(value: number) {
  const buffer = new Uint8Array(4);
  new DataView(buffer.buffer).setUint32(0, value >>> 0, true);
  return buffer;
}

function dosTimestamp(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = (date.getDate() & 31);
  const month = ((date.getMonth() + 1) & 15) << 5;
  const dosDate = ((year - 1980) << 9) | month | day;
  return { time, date: dosDate };
}

function createZip(files: Array<{ name: string; data: string | Uint8Array }>) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  const timestamp = dosTimestamp();

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = typeof file.data === 'string' ? encoder.encode(file.data) : file.data;
    const checksum = crc32(data);
    const localHeader = concatBytes([
      uint32(0x04034b50), uint16(20), uint16(0x0800), uint16(0),
      uint16(timestamp.time), uint16(timestamp.date), uint32(checksum),
      uint32(data.length), uint32(data.length), uint16(name.length), uint16(0), name
    ]);
    localParts.push(localHeader, data);

    const centralHeader = concatBytes([
      uint32(0x02014b50), uint16(20), uint16(20), uint16(0x0800), uint16(0),
      uint16(timestamp.time), uint16(timestamp.date), uint32(checksum),
      uint32(data.length), uint32(data.length), uint16(name.length),
      uint16(0), uint16(0), uint16(0), uint16(0), uint32(0), uint32(offset), name
    ]);
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const centralDirectory = concatBytes(centralParts);
  const localDirectory = concatBytes(localParts);
  const end = concatBytes([
    uint32(0x06054b50), uint16(0), uint16(0), uint16(files.length), uint16(files.length),
    uint32(centralDirectory.length), uint32(localDirectory.length), uint16(0)
  ]);
  return concatBytes([localDirectory, centralDirectory, end]);
}

function xlsxStyleForType(type: ExcelColumn['type'], alternate = false) {
  const base = type === 'currency' ? 5
    : type === 'integer' ? 3
    : type === 'number' ? 4
    : type === 'date' ? 6
    : type === 'datetime' ? 7
    : 2;
  return alternate ? base + 8 : base;
}

function xmlSafe(value: unknown) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');
}

type SharedStringStore = {
  values: string[];
  indexes: Map<string, number>;
  total: number;
};

function sharedStringIndex(store: SharedStringStore, value: unknown) {
  const text = xmlSafe(value);
  store.total += 1;
  const existing = store.indexes.get(text);
  if (existing !== undefined) return existing;
  const index = store.values.length;
  store.values.push(text);
  store.indexes.set(text, index);
  return index;
}

function xlsxCell(
  reference: string,
  value: unknown,
  type: ExcelColumn['type'],
  sharedStrings: SharedStringStore,
  styleOverride?: number,
  alternate = false
) {
  const style = styleOverride ?? xlsxStyleForType(type, alternate);
  if (value === null || value === undefined || value === '') {
    return `<c r="${reference}" s="${style}"/>`;
  }
  if (type === 'date' || type === 'datetime') {
    const serial = excelDateSerial(value);
    if (serial !== null) {
      return `<c r="${reference}" s="${style}" t="n"><v>${serial}</v></c>`;
    }
  }
  if (type === 'number' || type === 'integer' || type === 'currency') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return `<c r="${reference}" s="${style}" t="n"><v>${numeric}</v></c>`;
    }
  }
  const stringIndex = sharedStringIndex(sharedStrings, value);
  return `<c r="${reference}" s="${style}" t="s"><v>${stringIndex}</v></c>`;
}

export function buildXlsxBytes(
  sheetName: string,
  columns: ExcelColumn[],
  rows: any[],
  generatedAt = new Date()
) {
  if (!rows.length) throw new Error('ไม่มีข้อมูลสำหรับ Export');
  if (!columns.length) throw new Error('ไม่พบคอลัมน์สำหรับ Export');

  const safeName = safeSheetName(sheetName);
  const lastColumn = columnName(columns.length - 1);
  const lastRow = rows.length + 4;
  const generatedText = `Export เมื่อ ${generatedAt.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })} · ${rows.length.toLocaleString('th-TH')} รายการ`;
  const sharedStrings: SharedStringStore = { values: [], indexes: new Map(), total: 0 };
  const rowXml: string[] = [];

  rowXml.push(`<row r="1" ht="30" customHeight="1">${xlsxCell('A1', sheetName, 'text', sharedStrings, 8)}</row>`);
  rowXml.push(`<row r="2" ht="20" customHeight="1">${xlsxCell('A2', generatedText, 'text', sharedStrings, 9)}</row>`);
  rowXml.push('<row r="3" ht="8" customHeight="1"/>');
  rowXml.push(
    `<row r="4" ht="30" customHeight="1">${columns.map((column, index) =>
      xlsxCell(`${columnName(index)}4`, column.header, 'text', sharedStrings, 1)
    ).join('')}</row>`
  );

  rows.forEach((row, rowIndex) => {
    const excelRow = rowIndex + 5;
    const alternate = rowIndex % 2 === 1;
    const cells = columns.map((column, columnIndex) => {
      const value = column.value ? column.value(row) : row?.[column.key];
      return xlsxCell(`${columnName(columnIndex)}${excelRow}`, value, column.type || 'text', sharedStrings, undefined, alternate);
    }).join('');
    rowXml.push(`<row r="${excelRow}" ht="24" customHeight="1">${cells}</row>`);
  });

  const columnXml = columns.map((column, index) => {
    const width = Math.min(48, Math.max(11, Number(column.width || 20)));
    return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`;
  }).join('');

  // Keep the worksheet structure intentionally conservative and close to files
  // produced by Excel/Open XML libraries. In particular, AutoFilter is placed
  // before page settings and text is stored in sharedStrings.xml instead of
  // inline strings. This avoids Excel's "We found a problem with some content"
  // repair dialog seen with the previous hand-built workbook.
  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
  <dimension ref="A1:${lastColumn}${lastRow}"/>
  <sheetViews>
    <sheetView workbookViewId="0" zoomScale="90" zoomScaleNormal="90" showGridLines="0">
      <pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/>
      <selection pane="bottomLeft" activeCell="A5" sqref="A5"/>
    </sheetView>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="22"/>
  <cols>${columnXml}</cols>
  <sheetData>${rowXml.join('')}</sheetData>
  <autoFilter ref="A4:${lastColumn}${lastRow}"/>
  <pageMargins left="0.25" right="0.25" top="0.45" bottom="0.45" header="0.2" footer="0.2"/>
  <pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0" paperSize="9"/>
</worksheet>`;

  // Custom number formats use IDs >= 200 to stay well clear of built-in IDs.
  // The style table is deliberately small and contains no theme dependency.
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="4">
    <numFmt numFmtId="200" formatCode="0.00"/>
    <numFmt numFmtId="201" formatCode="#,##0.00"/>
    <numFmt numFmtId="202" formatCode="dd/mm/yyyy"/>
    <numFmt numFmtId="203" formatCode="dd/mm/yyyy hh:mm"/>
  </numFmts>
  <fonts count="4">
    <font><sz val="11"/><color rgb="FF1F2937"/><name val="Aptos"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font>
    <font><b/><sz val="16"/><color rgb="FF0F172A"/><name val="Aptos Display"/></font>
    <font><sz val="10"/><color rgb="FF64748B"/><name val="Aptos"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E3A8A"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEFF6FF"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border/>
    <border>
      <left style="thin"><color rgb="FFE2E8F0"/></left>
      <right style="thin"><color rgb="FFE2E8F0"/></right>
      <top style="thin"><color rgb="FFE2E8F0"/></top>
      <bottom style="thin"><color rgb="FFE2E8F0"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="16">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="1" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="200" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="201" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="202" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="203" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="1" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="200" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="201" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="202" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="203" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.total}" uniqueCount="${sharedStrings.values.length}">
${sharedStrings.values.map((value) => `<si><t xml:space="preserve">${xmlEscape(value)}</t></si>`).join('')}
</sst>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="12000"/></bookViews>
  <sheets><sheet name="${xmlEscape(safeName)}" sheetId="1" r:id="rId1"/></sheets>
  <calcPr calcId="191029"/>
</workbook>`;

  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>` },
    { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${xmlEscape(xmlSafe(sheetName))}</dc:title>
  <dc:creator>Company Asset</dc:creator>
  <cp:lastModifiedBy>Company Asset</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${generatedAt.toISOString()}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${generatedAt.toISOString()}</dcterms:modified>
</cp:coreProperties>` },
    { name: 'docProps/app.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>Microsoft Excel</Application>
</Properties>` },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>` },
    { name: 'xl/styles.xml', data: styles },
    { name: 'xl/sharedStrings.xml', data: sharedStringsXml },
    { name: 'xl/worksheets/sheet1.xml', data: worksheet }
  ];

  return createZip(files);
}

export function downloadXlsx(
  filename: string,
  sheetName: string,
  columns: ExcelColumn[],
  rows: any[]
) {
  const bytes = buildXlsxBytes(sheetName, columns, rows);
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.toLowerCase().endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsv(filename: string, rows: any[]) {
  if (!rows.length) throw new Error('ไม่มีข้อมูลสำหรับ Export');
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row).filter((k) => typeof row[k] !== 'object'))));
  const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const csv = '\uFEFF' + [columns.map(quote).join(','), ...rows.map((row) => columns.map((c) => quote(row[c])).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}
