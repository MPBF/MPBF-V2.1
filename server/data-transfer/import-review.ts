import type { TransferPreviewRow } from "../../shared/data-transfer";
import type { Snapshot } from "./schema";

export const validImportRows = (rows: TransferPreviewRow[]) =>
  rows.filter(row => row.status === "new" && !row.errors.length && !row.old);

export const rejectedImportRows = (rows: TransferPreviewRow[]) =>
  rows.filter(row => row.status === "invalid" || row.status === "conflict" || row.errors.length);

// Match the customer form's role policy; a valid user ID alone is not a rep.
export function isSalesRepresentative(id: string, graph: Snapshot): boolean {
  const user = graph.users?.find(row => row.id === id);
  const role = graph.roles?.find(row => row.id === user?.role_id);
  const english = role?.name?.replace(/[_-]+/g, " ").trim().toLowerCase();
  return !!user && (["sales representative", "sales rep"].includes(english ?? "") ||
    ["مندوب مبيعات", "مندوب"].includes(role?.name_ar ?? ""));
}

export async function rejectedWorkbook(rows: TransferPreviewRow[]): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("السجلات غير المستوردة");
  const fields = [...new Set(rows.flatMap(row => Object.keys(row.sourceValues ?? row.values)))].sort();
  sheet.columns = [
    { header: "الجدول", key: "__table", width: 25 },
    { header: "رقم السجل في الملف", key: "__row", width: 20 },
    { header: "الحالة", key: "__status", width: 18 },
    { header: "أسباب عدم الاستيراد", key: "__errors", width: 70 },
    ...fields.map((field, index) => ({ header: field, key: `value_${index}`, width: 25 })),
  ];
  for (const row of rows) {
    const source = row.sourceValues ?? row.values;
    // ExcelJS receives strings, never formula objects; keep exact decimals/IDs.
    sheet.addRow({
      __table: row.table, __row: row.index + 1,
      __status: row.status === "conflict" ? "تعارض" : "غير صالح",
      __errors: row.errors.map(error => `${error.column ? `${error.column}: ` : ""}${error.message}`).join("\n"),
      ...Object.fromEntries(fields.map((field, index) => [`value_${index}`, source[field] ?? ""])),
    });
  }
  sheet.views = [{ rightToLeft: true, state: "frozen", ySplit: 1 }];
  sheet.getRow(1).font = { bold: true };
  sheet.getColumn("__errors").alignment = { wrapText: true, vertical: "top" };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
