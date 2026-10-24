// UI metadata only: grants remain explicit and server-authorized.
export const finishedGoodsPermissionGroup = {
  label: "الاستلام والمخزون التام",
  description: "تسجيل الرولات والطباعة والقص يحتاج صلاحيات التشغيل. الاستلام ينقل الكمية الجاهزة إلى المخزون دون إنهاء التصنيع. صلاحيات المستودع والصالة القديمة لا تمنح هذه الإجراءات.",
  items: [
    ["view_finished_inventory", "عرض مخزون الإنتاج التام"],
    ["receive_production", "استلام الإنتاج التام"],
    ["manage_finished_warehouse", "إدارة مواقع الإنتاج التام"],
  ],
};

export const finishedGoodsPermissionDescriptions: Record<string, string> = {
  view_finished_inventory: "عرض المخزون وسندات الاستلام وحركاته فقط؛ دون تسجيل إنتاج أو استلام أو تعديل المواقع.",
  receive_production: "عرض الجاهز في صالة الإنتاج وتسجيل استلامه في موقع نشط، مع عرض المخزون والسندات؛ دون تسجيل إنتاج أو تعديل المواقع.",
  manage_finished_warehouse: "إنشاء وتعديل وتفعيل مواقع تخزين الإنتاج التام، مع عرض المخزون والسندات؛ لا تمنح الاستلام أو إدارة المواد الخام والمشتريات والتحويلات والتسليم.",
};
