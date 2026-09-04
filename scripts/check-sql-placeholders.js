import fs from 'node:fs';
import ts from 'typescript';

const filename = new URL('../backend/src/server.js', import.meta.url);
const sourceText = fs.readFileSync(filename, 'utf8');
const sourceFile = ts.createSourceFile(
  filename.pathname,
  sourceText,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);

const mismatches = [];
let checked = 0;

function literalSql(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return null;
}

function visit(node) {
  if (
    ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === 'query'
    && node.arguments.length >= 2
    && ts.isArrayLiteralExpression(node.arguments[1])
  ) {
    const sql = literalSql(node.arguments[0]);
    if (sql !== null) {
      checked += 1;
      const placeholders = (sql.match(/\?/g) || []).length;
      const parameters = node.arguments[1].elements.length;
      if (placeholders !== parameters) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        mismatches.push({ line: line + 1, placeholders, parameters, sql: sql.replace(/\s+/g, ' ').slice(0, 180) });
      }
    }
  }
  ts.forEachChild(node, visit);
}

visit(sourceFile);

if (mismatches.length) {
  console.error(`พบ SQL parameter mismatch ${mismatches.length} จุด`);
  for (const mismatch of mismatches) console.error(mismatch);
  process.exit(1);
}

console.log(`SQL placeholder check ผ่าน ${checked} query`);
