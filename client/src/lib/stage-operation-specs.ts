import { kgHundredths, kgString, type ProductSnapshot, type ProductionOrderRecord, type ProductionRollRecord } from "../../../shared/production";
import { filmOperationSpecs, filmSearchTerm, safeFilmName } from "./film-operation-specs";
import { formatNumber, formatWholeNumber } from "./format-number";

export type RollOperationStage = "printing" | "cutting";
export type StageRollMember = { order: ProductionOrderRecord; rolls: ProductionRollRecord[] };
export type StageRollGroup = {
  orderId: number; orderNumber: string; customerName: string; members: StageRollMember[];
};

/** Receives the existing eligible, machine-priority-sorted queue; never broadens it. */
export function groupStageRolls(
  orders: ProductionOrderRecord[], rolls: ProductionRollRecord[], language: string,
  search: string, unrecorded: string,
): StageRollGroup[] {
  const parents = new Map(orders.map(order => [order.id, order]));
  const groups = new Map<number, StageRollGroup>();
  const members = new Map<number, StageRollMember>();
  for (const roll of rolls) {
    const order = parents.get(roll.production_order_id);
    // A missing parent is not executable work (the caller uses the same guard).
    if (!order) continue;
    let group = groups.get(order.order_id);
    if (!group) {
      const product = roll.product ?? order.product;
      group = {
        orderId: order.order_id, orderNumber: order.order_number,
        customerName: safeFilmName(language === "en" ? product?.customer_name
          : product?.customer_name_ar || product?.customer_name, language, unrecorded),
        members: [],
      };
      groups.set(order.order_id, group);
    }
    let member = members.get(order.id);
    if (!member) {
      member = { order, rolls: [] };
      members.set(order.id, member);
      group.members.push(member);
    }
    member.rolls.push(roll);
  }
  const term = filmSearchTerm(search);
  return [...groups.values()].map(group => {
    if (!term || filmSearchTerm(`${group.customerName} ${group.orderNumber}`).includes(term)) return group;
    return {
      ...group,
      members: group.members.map(member => ({
        ...member,
        rolls: filmSearchTerm(member.order.production_order_number).includes(term) ? member.rolls
          : member.rolls.filter(roll => filmSearchTerm(roll.roll_number).includes(term)),
      })).filter(member => member.rolls.length > 0),
    };
  }).filter(group => group.members.length > 0);
}

/** Available work only, not cumulative stage production or planned remaining. */
export function stageRollWeight(rolls: Pick<ProductionRollRecord, "weight_kg">[]): string | null {
  try {
    return kgString(rolls.reduce((sum, roll) => sum + kgHundredths(roll.weight_kg), 0n));
  } catch {
    return null;
  }
}

const inkNames: Record<string, [string, string]> = {
  red: ["أحمر", "Red"], blue: ["أزرق", "Blue"], green: ["أخضر", "Green"],
  yellow: ["أصفر", "Yellow"], black: ["أسود", "Black"], white: ["أبيض", "White"],
  orange: ["برتقالي", "Orange"], purple: ["بنفسجي", "Purple"], pink: ["وردي", "Pink"],
  brown: ["بني", "Brown"], gray: ["رمادي", "Gray"], grey: ["رمادي", "Gray"],
  gold: ["ذهبي", "Gold"], silver: ["فضي", "Silver"],
};
const punchingNames: Record<string, [string, string]> = {
  banana: ["بنانة", "Banana"], hook: ["علاقي", "Hook"], "t-shirt": ["تيشيرت", "T-shirt"],
  none: ["بدون", "None"], plain: ["سادة", "Plain"],
};
function localizedValue(value: string | null | undefined, language: string, missing: string, names: Record<string, [string, string]>) {
  const clean = value?.trim() ?? "";
  const known = names[clean.toLowerCase()] ?? Object.values(names).find(pair => pair.includes(clean));
  return known ? known[language === "en" ? 1 : 0] : safeFilmName(clean, language, missing);
}
function printColors(values: string[] | null | undefined, language: string, missing: string) {
  return values?.filter(value => value.trim()).map(value => localizedValue(value, language, missing, inkNames)).join(" / ") ?? "";
}
function physicalMeasure(value: string | number | null | undefined, unit: string, missing: string) {
  if (value == null || String(value).trim() === "" || !Number.isFinite(Number(value)) || Number(value) <= 0) return missing;
  // Machine settings retain meaningful decimals; only weight summaries mirror film's integer presentation.
  return `${formatNumber(value)} ${unit}`;
}
function cylinderMeasure(value: string | null | undefined, language: string, missing: string) {
  const clean = filmSearchTerm(value ?? "");
  if (clean === "بدون طباعة") return language === "en" ? "No printing" : "بدون طباعة";
  const numeric = clean.replace(/(?:["″”]|in(?:ch(?:es)?)?|بوصة)\s*$/i, "").trim().replace("٫", ".");
  if (!numeric || !Number.isFinite(Number(numeric)) || Number(numeric) <= 0) return missing;
  return formatNumber(numeric);
}

export function stageOperationSpecs(stage: RollOperationStage, product: ProductSnapshot | null, language: string, unrecorded: string) {
  const english = language === "en";
  const common = filmOperationSpecs(product, language, formatWholeNumber, unrecorded);
  const size = { key: "size", label: english ? "Size" : "المقاس", value: common.size };
  return stage === "printing" ? [
    { key: "cylinder", label: english ? "Cylinder" : "السلندر",
      value: cylinderMeasure(product?.printing_cylinder, language, unrecorded) },
    size,
    { key: "plateDrawer", label: english ? "Plate drawer" : "درج الكليشة",
      value: safeFilmName(product?.plate_drawer_code?.trim() ?? "", language, unrecorded) },
    { key: "frontColors", label: english ? "Front colors" : "ألوان الوجه",
      value: printColors(product?.front_print_colors, language, unrecorded) },
    { key: "backColors", label: english ? "Back colors" : "ألوان الظهر",
      value: printColors(product?.back_print_colors, language, unrecorded) },
  ].filter(spec => spec.value !== "") : [
    size,
    { key: "cutLength", label: english ? "Cutting length" : "طول القص",
      value: physicalMeasure(product?.cutting_length_cm, english ? "cm" : "سم", unrecorded) },
    { key: "punching", label: english ? "Punching" : "التخريم",
      value: localizedValue(product?.punching, language, unrecorded, punchingNames) },
    { key: "material", label: english ? "Raw material" : "الخامة", value: common.material },
  ];
}
