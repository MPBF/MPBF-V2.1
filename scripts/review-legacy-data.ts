/**
 * Read-only preflight. Does not use the transfer service, persist previews,
 * import rows, or change the uploaded files.
 *
 * npx tsx scripts/review-legacy-data.ts --read-only \
 *   --out generated-artifacts/legacy-import-review.xlsx \
 *   users=attached_assets/users.xlsx customers=attached_assets/customers.xlsx \
 *   customer_products=attached_assets/customer_products.xlsx
 */
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { pool } from "../server/db";
import { discover, readRows, type Snapshot } from "../server/data-transfer/schema";
import { parseFile } from "../server/data-transfer/files";
import { makePreview, valueFor } from "../server/data-transfer/validation";
import { protectedColumn } from "../server/data-transfer/policy";
import type { TransferFile, TransferMapping, TransferSchema, TransferTable } from "../shared/data-transfer";

type Input = { table: string; filename: string; file: TransferFile };
const label: Record<string, string> = {
  users: "المستخدمون", customers: "العملاء", customer_products: "منتجات العملاء",
  width: "العرض", left_facing: "الجنب الأيسر", right_facing: "الجنب الأيمن",
  thickness: "السماكة", cutting_length_cm: "طول القص",
};
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
function display(value: string | null | undefined): string {
  if (value == null) return "(فارغ)";
  if (value.startsWith("data:image/") || value.length > 3000)
    return `[محتوى طويل: ${value.length} حرفًا؛ SHA256: ${digest(value)}]`;
  return value;
}
function sheet(book: ExcelJS.Workbook, name: string, headings: string[], rows: unknown[][]) {
  const ws = book.addWorksheet(name, { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
  ws.addRow(headings);
  for (const row of rows) ws.addRow(row);
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
  ws.getRow(1).height = 30;
  ws.columns.forEach((column, index) => {
    column.width = index === 0 ? 20 : 30;
    column.numFmt = "@";
    column.alignment = { vertical: "top", horizontal: "right", wrapText: true };
  });
  ws.eachRow((row, index) => {
    if (index > 1 && index % 2 === 0)
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0FDFA" } };
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, ws.rowCount), column: headings.length } };
  return ws;
}
function mappingFor(table: TransferTable, file: TransferFile): TransferMapping {
  const source = file.tables[0];
  return {
    table: table.name, fileTable: source.name, matchKey: ["id"], nullColumns: [],
    columns: Object.fromEntries(source.headers.map(header =>
      [header, table.columns.some(column => column.name === header && column.writable) ? header : ""])),
  };
}
async function graphFor(schema: TransferSchema, names: string[], db: Parameters<typeof discover>[0]) {
  const pending = [...names], graph: Snapshot = {};
  while (pending.length) {
    const name = pending.shift()!;
    if (graph[name]) continue;
    const table = schema.tables.find(table => table.name === name && table.exportable);
    if (!table) throw Error(`Required business table is not available: ${name}`);
    graph[name] = await readRows(db, table, "public");
    for (const relation of table.relations) if (!graph[relation.table]) pending.push(relation.table);
  }
  return graph;
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes("--read-only")) throw Error("Explicit --read-only flag is required");
  const outIndex = args.indexOf("--out"), output = args[outIndex + 1];
  const root = path.resolve("generated-artifacts") + path.sep;
  if (outIndex < 0 || !output || !path.resolve(output).startsWith(root) || !output.endsWith(".xlsx"))
    throw Error("Output must be an XLSX file under generated-artifacts/");
  const inputArgs = args.filter((arg, index) => arg !== "--read-only" && index !== outIndex && index !== outIndex + 1);
  if (!inputArgs.length || inputArgs.length > 3) throw Error("Provide one to three table=filename inputs");
  const inputs: Input[] = [];
  for (const arg of inputArgs) {
    const match = /^(users|customers|customer_products)=(.+\.xlsx)$/.exec(arg);
    if (!match || inputs.some(input => input.table === match[1])) throw Error("Invalid or duplicate source table");
    const file = await parseFile(await readFile(match[2]), match[2], async () => { throw Error("Only XLSX is accepted"); });
    if (file.tables.length !== 1) throw Error("Each source must contain exactly one data worksheet");
    inputs.push({ table: match[1], filename: match[2], file });
  }
  const db = await pool.connect();
  try {
    await db.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const schema = await discover(db);
    const graph = await graphFor(schema, [...inputs.map(input => input.table), "roles", "sections"], db);
    const mappings = inputs.map(input => mappingFor(schema.tables.find(table => table.name === input.table)!, input.file));
    const combined: TransferFile = { source: "external", tables: inputs.flatMap(input => input.file.tables) };
    // Diagnostic matching only: local numeric IDs are NOT approved for actual import.
    const preview = makePreview(schema, combined, mappings, graph, true);
    const book = new ExcelJS.Workbook();
    book.creator = "Modplast — read-only import review";
    const summary: unknown[][] = [], issues: unknown[][] = [], dimensions: unknown[][] = [];
    const accounts: unknown[][] = [], names: unknown[][] = [], images: unknown[][] = [];
    const excluded: unknown[][] = [], changes: unknown[][] = [], corrections: unknown[][] = [];
    const identity: unknown[][] = [];
    for (const input of inputs) {
      const source = input.file.tables[0], table = schema.tables.find(table => table.name === input.table)!;
      const mapping = mappings.find(mapping => mapping.table === input.table)!;
      const rows = preview.filter(row => row.table === input.table);
      const current = new Map(graph[input.table].map(row => [row.id, row]));
      summary.push([label[input.table], source.rows.length, rows.filter(row => row.old).length,
        rows.filter(row => !row.old).length, rows.filter(row => row.errors.length).length,
        rows.filter(row => row.changes.length).length]);
      for (const header of source.headers.filter(header => !mapping.columns[header])) {
        excluded.push([label[input.table], header, protectedColumn.test(header)
          ? "حقل أمني: لا ينقل عبر أداة الجداول" : "حقل محسوب أو غير قابل للكتابة: يحتفظ به الملف الأصلي فقط"]);
      }
      for (let index = 0; index < source.rows.length; index++) {
        const raw = source.rows[index], row = rows[index], live = current.get(raw.id ?? ""), excelRow = index + 2;
        for (const column of table.columns.filter(column => column.type === "date" || column.type.startsWith("timestamp"))) {
          const before = raw[column.name];
          if (!before || !mapping.columns[column.name]) continue;
          try {
            const after = valueFor(column, before);
            if (after !== before) corrections.push([label[input.table], excelRow, raw.id, column.name, before, after,
              "فك تغليف JSON فقط؛ لا تغيير للوقت أو المنطقة الزمنية. الأصل لم يعدّل."]);
          } catch { /* Listed by the shared preview below. */ }
        }
        for (const error of row.errors) {
          const reason = error.message === "Invalid user status" ? "حالة المستخدم deleted غير مقبولة حاليًا"
            : error.message === "English name is required" || error.message === "Required field missing for new row"
              ? "حقل مطلوب مفقود؛ لا توجد قيمة بديلة مؤكدة"
              : error.message === "Product dimensions must be valid whole numbers"
                ? "راجع ورقة المقاسات: كسور تاريخية أو مقاس يساوي صفرًا"
                : error.message === "Value must be bounded text without null bytes" && error.column.startsWith("cliche_")
                  ? "صورة تصميم مضمنة أكبر من حد نص الاستيراد الحالي"
                  : error.message;
          issues.push([label[input.table], excelRow, raw.id, error.column || "(السجل)", reason, error.message,
            live ? "موجود في القاعدة" : "غير موجود في القاعدة", "بانتظار القرار", ""]);
        }
        if (input.table === "users") {
          if (raw.status === "deleted" || !raw.username?.trim()) {
            const role = graph.roles?.find(role => role.id === raw.role_id);
            accounts.push([excelRow, raw.id, display(raw.username), raw.status, raw.role_id, role?.name ?? role?.name_ar ?? "",
              live ? "موجود" : "جديد", !raw.username?.trim() ? "اسم المستخدم مفقود أيضًا؛ لا نخترع حسابًا" : "",
              "يحتاج قرارًا: إبقاء الحساب المحذوف خارج الاستيراد أو حفظه غير نشط بعد استكمال بياناته", ""]);
          }
          if (live && raw.username && raw.username !== live.username)
            identity.push([label[input.table], excelRow, raw.id, "username", display(live.username), raw.username,
              "تطابق المعرّف وحده لا يثبت أنه الشخص نفسه؛ يلزم التحقق قبل أي تحديث"]);
        }
        if (input.table === "customers" && !raw.name?.trim())
          names.push([excelRow, raw.id, display(raw.name), display(raw.name_ar), display(live?.name),
            live ? "موجود" : "جديد", "لا يوجد اسم مؤكد في الملف؛ أدخل الاسم الصحيح", ""]);
        if (input.table === "customer_products") {
          for (const field of ["width", "left_facing", "right_facing", "thickness", "cutting_length_cm"]) {
            const value = raw[field];
            if (value == null || value === "") continue;
            const number = Number(value), zeroInvalid = ["width", "thickness", "cutting_length_cm"].includes(field) && number === 0;
            if (!Number.isSafeInteger(number) || number < 0 || zeroInvalid)
              dimensions.push([excelRow, raw.id, field, label[field], value, display(live?.[field]),
                zeroInvalid ? "صفر غير صالح" : "كسر تاريخي",
                zeroInvalid ? "يحتاج المقاس الصحيح؛ لا تعوّض الصفر بقيمة تخمينية"
                  : "المقاس موجب وله كسر: يوصى بالحفاظ عليه كما هو دون تقريب، بعد اعتماد توافق الاستيراد", ""]);
          }
          for (const field of ["cliche_front_design", "cliche_back_design"]) {
            const value = raw[field];
            if (!value || value.length <= 10000) continue;
            const mime = /^data:([^;,]+);base64,/.exec(value)?.[1] ?? "(غير معروف)";
            images.push([excelRow, raw.id, field, value.length, mime, digest(value),
              live?.[field] === value ? "الصورة مطابقة للمحفوظة" : "تختلف عن المحفوظة أو غير موجودة",
              "احتفظ بالأصل؛ يلزم مسار آمن لنقل الصورة دون قصها أو إسقاطها", ""]);
          }
        }
        for (const change of row.changes) {
          if (protectedColumn.test(change.column)) continue;
          changes.push([label[input.table], excelRow, raw.id, change.column, display(change.old), display(change.new),
            "لم يُعتمد ولم يُطبّق"]);
        }
      }
    }
    sheet(book, "تعليمات", ["البند", "التوضيح"], [
      ["النطاق", "مراجعة جميع الملفات أولًا بناءً على طلب المستخدم؛ ليس هذا الملف سند تنفيذ استيراد."],
      ["قاعدة البيانات", "لقطة قراءة فقط من قاعدة التطوير الحالية؛ لا تمثل القاعدة المنشورة."],
      ["عدم التغيير", "لم تُعدّل الملفات الأصلية أو السجلات، ولم تُحفظ معاينة أو نسخة في جداول الأداة."],
      ["المعرفات", "المطابقة الرقمية للتشخيص فقط. يجب التحقق من هويات المستخدمين وربط الأدوار والأقسام قبل الاستيراد."],
      ["التواريخ", "أصلح كود الاستيراد فك الاقتباس الزائد. ورقة التواريخ توثق القيم قبل التصحيح وبعده دون تعديل الأصل."],
      ["التصحيحات اليدوية", "استخدم العمود الأخير في أوراق المشكلات لكتابة القيمة أو القرار الصحيح. لا تخمّن الاسم أو المقاس."],
      ["صور التصاميم", "لا تضاف الصور الطويلة إلى هذا التقرير؛ تعرض بصمتها وطولها فقط. الصور الأصلية باقية في ملفات المصدر."],
      ["الفروقات", "قد تشمل الفروقات اختلاف تمثيل التاريخ أو العدد، لا اختلاف المعنى؛ لا توافق عليها بالجملة."],
      ["حدود التقرير", "التقرير يفحص التحقق والعلاقات الحالية؛ يلزم تكرار المعاينة والتحقق من القيود عند اعتماد التصحيحات."],
      ["الأمان", "الحقول الأمنية والمحسوبة غير قابلة للاستيراد؛ لا تُنقل كلمات مرور أو ربط تسجيل الدخول."],
    ]);
    sheet(book, "ملخص", ["الجدول", "صفوف الملف", "معرفات موجودة", "معرفات غير موجودة", "سجلات مرفوضة حاليًا", "سجلات لها فروقات"], summary);
    sheet(book, "مشكلات التحقق", ["الجدول", "سطر Excel", "المعرف", "الحقل", "المشكلة", "السبب الفني", "وجود السجل", "المتابعة", "التصحيح المعتمد"], issues);
    sheet(book, "المستخدمون المحذوفون", ["سطر Excel", "المعرف", "اسم المستخدم", "حالة المصدر", "معرف الدور", "اسم الدور في التطوير", "وجود السجل", "ملاحظة", "التوصية", "القرار المعتمد"], accounts);
    sheet(book, "أسماء العملاء الناقصة", ["سطر Excel", "المعرف", "اسم المصدر", "الاسم العربي", "الاسم الحالي", "وجود السجل", "التوصية", "الاسم الصحيح"], names);
    sheet(book, "مقاسات تحتاج مراجعة", ["سطر Excel", "معرف المنتج", "الحقل", "الاسم", "قيمة المصدر", "قيمة التطوير", "التصنيف", "التوصية", "القرار أو المقاس الصحيح"], dimensions);
    sheet(book, "صور التصاميم", ["سطر Excel", "معرف المنتج", "الحقل", "عدد الحروف", "نوع الصورة", "SHA256", "المقارنة", "التوصية", "القرار المعتمد"], images);
    sheet(book, "تطابق هويات المستخدمين", ["الجدول", "سطر Excel", "المعرف", "الحقل", "قيمة التطوير", "قيمة المصدر", "التحذير"], identity);
    sheet(book, "الحقول المستثناة", ["الجدول", "الحقل", "السبب"], excluded);
    sheet(book, "تصحيح التواريخ الآمن", ["الجدول", "سطر Excel", "المعرف", "الحقل", "قبل", "بعد", "الإجراء"], corrections);
    sheet(book, "فروقات للمراجعة فقط", ["الجدول", "سطر Excel", "المعرف", "الحقل", "قيمة التطوير", "قيمة الملف", "الموافقة"], changes);
    await db.query("ROLLBACK");
    await mkdir(path.dirname(path.resolve(output)), { recursive: true });
    await book.xlsx.writeFile(output);
    // Verify the artifact, not just whether the writer returned successfully.
    const verify = new ExcelJS.Workbook();
    await verify.xlsx.readFile(output);
    if (verify.getWorksheet("ملخص")?.rowCount !== inputs.length + 1 ||
      verify.getWorksheet("مشكلات التحقق")?.rowCount !== issues.length + 1 ||
      verify.getWorksheet("تصحيح التواريخ الآمن")?.rowCount !== corrections.length + 1)
      throw Error("Report row-count verification failed");
    console.log(JSON.stringify({ output, readOnly: true, tables: summary, issueEntries: issues.length,
      affectedAccounts: accounts.length, missingCustomerNames: names.length,
      dimensionEntries: dimensions.length, designImages: images.length,
      identityConflicts: identity.length, temporalCorrections: corrections.length,
      differences: changes.length, verified: true }));
  } finally {
    await db.query("ROLLBACK").catch(() => undefined);
    db.release();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
