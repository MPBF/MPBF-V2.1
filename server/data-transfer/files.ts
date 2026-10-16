import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import type { TransferFile, TransferRow, TransferSchema } from "../../shared/data-transfer";
import { MAX_BYTES, MAX_ROWS, fail } from "./policy";
import { hash, stable } from "./schema";

const workerSource = `
const {parentPort,workerData}=require('node:worker_threads');
(async()=>{
 const bytes=Buffer.from(workerData.bytes); const ext=workerData.ext;
 let tables=[];
 if(ext==='csv'){
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\\uFEFF/,'');
  const papa=require('papaparse'); const parsed=papa.parse(text,{skipEmptyLines:'greedy'});
  if(parsed.errors.length) throw Error('Malformed CSV');
  const [headers,...data]=parsed.data;
  if(!headers?.length) throw Error('Empty file');
  // Our CSV format prefixes every non-null value with an apostrophe to prevent
  // spreadsheet coercion/formulas. Its marker makes unescaping unambiguous.
  let guarded=false;
  if(headers[0]==='MPBF_TEXT_V1'){guarded=true; headers.shift(); data.forEach(r=>r.shift());}
  const rows=data.map(r=>{
   if(r.length!==headers.length) throw Error('CSV column count mismatch');
   return Object.fromEntries(headers.map((h,i)=>[h,guarded?(r[i]==='\\\\N'?null:r[i].startsWith("'")?r[i].slice(1):(()=>{throw Error('Invalid guarded CSV')})()):r[i]]));
  });
  tables=[{name:'file',headers,rows}];
 }else if(ext==='xlsx'){
  // Reject archive bombs before any decompression.
  let offset=bytes.length-22; while(offset>=Math.max(0,bytes.length-65557)&&bytes.readUInt32LE(offset)!==0x06054b50) offset--;
  if(offset<0) throw Error('Invalid XLSX archive');
  const entries=bytes.readUInt16LE(offset+10); let pos=bytes.readUInt32LE(offset+16), expanded=0;
  if(entries>1000) throw Error('Too many archive entries');
  for(let i=0;i<entries;i++){
   if(pos+46>bytes.length||bytes.readUInt32LE(pos)!==0x02014b50) throw Error('Invalid archive directory');
   const size=bytes.readUInt32LE(pos+24); expanded+=size;
   if(size>30000000||expanded>30000000) throw Error('XLSX expanded size limit');
   pos+=46+bytes.readUInt16LE(pos+28)+bytes.readUInt16LE(pos+30)+bytes.readUInt16LE(pos+32);
  }
  const Excel=require('exceljs');const wb=new Excel.Workbook();await wb.xlsx.load(bytes);
  if(wb.worksheets.length>10) throw Error('Too many worksheets');
  const cellValue=c=>{
   if(c.type===Excel.ValueType.Formula||c.value&&typeof c.value==='object'&&('formula' in c.value||'hyperlink' in c.value))throw Error('Formula or hyperlink cells are not supported');
   if(c.value==null)return '';
   if(typeof c.value==='number'){if(!Number.isSafeInteger(c.value))throw Error('Decimal or unsafe numeric Excel cell: use text cells to preserve precision');return String(c.value);}
   if(typeof c.value==='boolean')return String(c.value);
   if(c.value instanceof Date) return c.value.toISOString();
   if(typeof c.value!=='string')throw Error('Unsupported Excel cell type');
   return c.value;
  };
  tables=wb.worksheets.filter(s=>s.name!=='_MPBF_manifest').map(s=>{
   if(s.rowCount>2001||s.columnCount>150)throw Error('Worksheet limit');
   const headers=[];s.getRow(1).eachCell({includeEmpty:true},c=>headers.push(cellValue(c)));
   const rows=[];for(let n=2;n<=s.rowCount;n++){const row={};headers.forEach((h,i)=>row[h]=cellValue(s.getRow(n).getCell(i+1)));rows.push(row);}
   return {name:s.name,headers,rows};
  });
 }else if(ext==='json'){
  const obj=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  parentPort.postMessage({json:obj});return;
 }else throw Error('Unsupported file; use CSV, XLSX or JSON');
 if(tables.reduce((n,t)=>n+t.rows.length,0)>2000)throw Error('Row limit');
 for(const t of tables){if(!t.headers.length||t.headers.length>150||t.headers.some(h=>typeof h!=='string'||!h||h.length>200)||new Set(t.headers).size!==t.headers.length)throw Error('Invalid or duplicate headers');}
 parentPort.postMessage({tables});
})().catch(e=>parentPort.postMessage({error:e.message}));
`;
export async function parseFile(bytes: Buffer, filename: string, verifyBundle: (obj: any) => Promise<TransferFile>): Promise<TransferFile> {
  if (!bytes.length || bytes.length > MAX_BYTES) fail("File size limit", 413);
  const ext = filename.split(".").pop()?.toLowerCase();
  if (!["csv", "xlsx", "json"].includes(ext ?? "")) fail("Unsupported file; use CSV, XLSX or JSON");
  const result: any = await new Promise((resolve, reject) => {
    const worker = new Worker(workerSource, { eval: true, workerData: { bytes, ext },
      resourceLimits: { maxOldGenerationSizeMb: 128 } });
    const timer = setTimeout(() => { void worker.terminate(); reject(new Error("File processing timeout")); }, 15000);
    worker.once("message", msg => { clearTimeout(timer); void worker.terminate(); resolve(msg); });
    worker.once("error", error => { clearTimeout(timer); reject(error); });
    worker.once("exit", code => { clearTimeout(timer); if (code !== 0) reject(new Error("File worker failed")); });
  });
  if (result.error) fail(result.error);
  if (result.json) return verifyBundle(result.json);
  return { tables: result.tables, source: "external" };
}
export function makeBundle(schema: TransferSchema, data: Record<string, TransferRow[]>, source: string) {
  const tables = Object.entries(data).map(([name, rows]) => {
    const table = schema.tables.find(t => t.name === name)!;
    return { name, columns: table.columns, relations: table.relations, count: rows.length, rows, checksum: hash(rows) };
  });
  const body = { format: "MPBF_TRANSFER_V1", id: randomUUID(), schemaVersion: schema.version, source,
    createdAt: new Date().toISOString(), tables };
  return { ...body, checksum: hash(body) };
}
export function verifyBundleShape(obj: any): void {
  if (!obj || obj.format !== "MPBF_TRANSFER_V1" || !Array.isArray(obj.tables) || obj.tables.length > 10) fail("Unsupported JSON package");
  const { checksum, ...body } = obj;
  if (hash(body) !== checksum) fail("Package checksum mismatch");
  let count = 0;
  for (const t of obj.tables) {
    if (!Array.isArray(t.columns) || !Array.isArray(t.rows) || t.count !== t.rows.length || t.checksum !== hash(t.rows)) fail("Table checksum mismatch");
    count += t.rows.length;
    const keys = t.columns.map((c: any) => c.name);
    if (new Set(keys).size !== keys.length) fail("Duplicate columns");
    for (const row of t.rows) {
      if (!row || typeof row !== "object" || Array.isArray(row) ||
        Object.keys(row).some(k => !keys.includes(k)) ||
        Object.values(row).some(v => v !== null && typeof v !== "string")) fail("Package values must be exact text or null");
    }
  }
  if (count > MAX_ROWS) fail("Row limit", 413);
}
export function csvExport(headers: string[], rows: TransferRow[]) {
  const quote = (s: string) => `"${s.replaceAll('"', '""')}"`;
  const line = (cells: string[]) => cells.map(quote).join(",");
  return "\uFEFF" + [line(["MPBF_TEXT_V1", ...headers]),
    ...rows.map(row => line(["", ...headers.map(h => row[h] === null ? "\\N" : `'${row[h] ?? ""}`)]))].join("\r\n");
}
export async function csvZipExport(data: Record<string,TransferRow[]>, schema:TransferSchema):Promise<Buffer> {
  const {default:JSZip}=await import("jszip");
  const zip=new JSZip();
  const tables=Object.entries(data).map(([name,rows])=>{
    const table=schema.tables.find(t=>t.name===name)!;
    const csv=csvExport(table.columns.map(c=>c.name),rows);
    zip.file(`${name}.csv`,csv);
    return {name,columns:table.columns,relations:table.relations,rows:rows.length,checksum:hash(csv)};
  });
  zip.file("_MPBF_manifest.json",stable({format:"MPBF_CSV_ZIP_V1",schemaVersion:schema.version,tables}));
  return zip.generateAsync({type:"nodebuffer",compression:"DEFLATE",compressionOptions:{level:6}});
}
export async function excelExport(data: Record<string, TransferRow[]>, schema: TransferSchema) {
  const {default:ExcelJS}=await import("exceljs");
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(data)) {
    const sheet = wb.addWorksheet(name.slice(0, 31));
    const headers = schema.tables.find(t => t.name === name)!.columns.map(c => c.name);
    sheet.addRow(headers);
    for (const row of rows) sheet.addRow(headers.map(h => row[h] ?? ""));
    sheet.columns.forEach(c => { c.numFmt = "@"; c.width = 24; });
  }
  const manifest = wb.addWorksheet("_MPBF_manifest");
  manifest.addRow(["Exact text export; blank XLSX cells omit values on import. Use JSON for explicit null.", schema.version]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
