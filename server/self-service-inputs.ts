import { z } from "zod";

export function isCalendarDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= "0001-01-01"
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

const calendarDate = z.string().refine(isCalendarDate, "تاريخ الإجازة غير صالح");

export const requestInput = z.object({
  type: z.enum(["leave", "permission", "other"]),
  title: z.string().trim().min(1, "عنوان الطلب مطلوب").max(200),
  details: z.string().trim().min(1, "تفاصيل الطلب مطلوبة").max(10000),
  leave_start_date: calendarDate.nullable().optional(),
  leave_end_date: calendarDate.nullable().optional(),
}).strict().superRefine((input, context) => {
  if (input.type === "leave") {
    if (!input.leave_start_date || !input.leave_end_date) {
      context.addIssue({ code: "custom", path: ["leave_start_date"], message: "تاريخ بداية ونهاية الإجازة مطلوبان" });
    } else if (input.leave_start_date > input.leave_end_date) {
      context.addIssue({ code: "custom", path: ["leave_end_date"], message: "نهاية الإجازة يجب ألا تسبق بدايتها" });
    }
  } else if (input.leave_start_date != null || input.leave_end_date != null) {
    context.addIssue({ code: "custom", message: "تواريخ الإجازة متاحة لطلبات الإجازة فقط" });
  }
});

export const reviewInput = z.object({
  status: z.enum(["approved", "rejected"]).optional(),
  response: z.string().trim().max(4000).optional(),
  leave_start_date: calendarDate.optional(),
  leave_end_date: calendarDate.optional(),
}).strict().superRefine((input, context) => {
  if (!input.status && !input.leave_start_date) {
    context.addIssue({ code: "custom", message: "حدد قرار الطلب أو فترة الإجازة" });
  }
  if (Boolean(input.leave_start_date) !== Boolean(input.leave_end_date)) {
    context.addIssue({ code: "custom", message: "تاريخ بداية ونهاية الإجازة مطلوبان" });
  }
  if (input.leave_start_date && input.leave_end_date && input.leave_start_date > input.leave_end_date) {
    context.addIssue({ code: "custom", message: "نهاية الإجازة يجب ألا تسبق بدايتها" });
  }
  if (!input.status && input.response !== undefined) {
    context.addIssue({ code: "custom", message: "تعديل الرد يتطلب تحديد قرار الطلب" });
  }
});
