import fs from 'node:fs';
import ts from 'typescript';

function readStoredZipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const entries = new Map();
  let offset = 0;

  while (offset + 4 <= bytes.length) {
    const signature = view.getUint32(offset, true);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    if (signature !== 0x04034b50) throw new Error(`Invalid ZIP local header at ${offset}`);

    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const fileNameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    if (method !== 0) throw new Error('XLSX smoke test expects stored ZIP entries');

    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLength + extraLength;
    const name = decoder.decode(bytes.slice(nameStart, nameStart + fileNameLength));
    const data = bytes.slice(dataStart, dataStart + compressedSize);
    entries.set(name, decoder.decode(data));
    offset = dataStart + compressedSize;
  }

  return entries;
}

const source = fs.readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`;
const { buildXlsxBytes } = await import(moduleUrl);

const bytes = buildXlsxBytes(
  'ทะเบียนทรัพย์สิน',
  [
    { key: 'assetId', header: 'รหัสทรัพย์สิน', type: 'text', width: 18 },
    { key: 'name', header: 'ชื่อทรัพย์สิน', type: 'text', width: 30 },
    { key: 'price', header: 'ราคาซื้อ', type: 'currency', width: 15 },
    { key: 'purchaseDate', header: 'วันที่ซื้อ', type: 'date', width: 15 }
  ],
  [{ assetId: 'NB0001', name: 'Notebook & Monitor', price: 35000, purchaseDate: '2026-08-07' }],
  new Date('2026-08-13T07:00:00.000Z')
);

if (!(bytes instanceof Uint8Array) || bytes.length < 1000) throw new Error('XLSX output is unexpectedly small');
const entries = readStoredZipEntries(bytes);
const required = [
  '[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels',
  'xl/styles.xml', 'xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml'
];
for (const name of required) {
  if (!entries.has(name)) throw new Error(`Missing XLSX entry: ${name}`);
}

const contentTypes = entries.get('[Content_Types].xml');
const rels = entries.get('xl/_rels/workbook.xml.rels');
const worksheet = entries.get('xl/worksheets/sheet1.xml');
const sharedStrings = entries.get('xl/sharedStrings.xml');
const styles = entries.get('xl/styles.xml');

if (!contentTypes.includes('/xl/sharedStrings.xml')) throw new Error('sharedStrings content type missing');
if (!rels.includes('relationships/sharedStrings')) throw new Error('sharedStrings relationship missing');
if (!worksheet.includes('<sheetData>') || !worksheet.includes('<autoFilter ref="A4:D5"/>')) throw new Error('Worksheet data/filter structure invalid');
if (!worksheet.includes('t="s"><v>')) throw new Error('Worksheet does not reference shared strings');
if (!sharedStrings.includes('NB0001') || !sharedStrings.includes('Notebook &amp; Monitor')) throw new Error('Shared string data missing or unescaped');
if (!styles.includes('numFmtId="201" formatCode="#,##0.00"')) throw new Error('Expected numeric format missing');
if (worksheet.includes('<mergeCells')) throw new Error('Compatibility export should not create merged cells');

console.log(`XLSX export check ผ่าน: ${entries.size} package parts, ${bytes.length} bytes`);
