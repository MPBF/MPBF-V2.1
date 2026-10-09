import { localizedName, translate } from "../i18n";

export type CatalogRow = Record<string, any>;

export interface ProductCategoryGroup {
  id: string;
  label: string;
  color: string;
  products: CatalogRow[];
}

const UNCATEGORIZED_ID = "uncategorized";
const UNCATEGORIZED_LABEL = "غير مصنف";
const UNKNOWN_CATEGORY_COLOR = "#4B5563";

const ROOT_COLORS = [
  "#1D4ED8",
  "#047857",
  "#B45309",
  "#7E22CE",
  "#BE123C",
  "#0F766E",
  "#4338CA",
  "#854D0E",
  "#0369A1",
  "#6D28D9",
  "#9D174D",
  "#3F6212",
  "#C2410C",
  "#155E75",
  "#5B21B6",
  "#166534",
];

const naturalCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

function compareIds(left: string, right: string): number {
  return naturalCollator.compare(left, right) || (left < right ? -1 : left > right ? 1 : 0);
}

function toId(value: unknown): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return String(value);
}

function firstLabel(...values: unknown[]): string | null {
  for (const value of values) {
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      return String(value);
    }
  }
  return null;
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const normalizedHue = ((hue % 360) + 360) % 360;
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const hueSection = normalizedHue / 60;
  const secondary = chroma * (1 - Math.abs((hueSection % 2) - 1));
  let red = 0;
  let green = 0;
  let blue = 0;

  if (hueSection < 1) [red, green, blue] = [chroma, secondary, 0];
  else if (hueSection < 2) [red, green, blue] = [secondary, chroma, 0];
  else if (hueSection < 3) [red, green, blue] = [0, chroma, secondary];
  else if (hueSection < 4) [red, green, blue] = [0, secondary, chroma];
  else if (hueSection < 5) [red, green, blue] = [secondary, 0, chroma];
  else [red, green, blue] = [chroma, 0, secondary];

  const match = l - chroma / 2;
  const toHex = (channel: number) =>
    Math.round((channel + match) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`.toUpperCase();
}

function buildRootColors(rootIds: string[]): Map<string, string> {
  const colors = new Map<string, string>();
  const usedColors = new Set<string>();
  let extensionIndex = 0;

  rootIds.forEach((rootId, index) => {
    let color: string;
    if (index < ROOT_COLORS.length) {
      color = ROOT_COLORS[index];
    } else {
      do {
        const hue = (extensionIndex * 137.507764 + 19) % 360;
        const saturation = 68 + (Math.floor(extensionIndex / 360) % 3) * 8;
        const lightness = 28 + (Math.floor(extensionIndex / 1080) % 3);
        color = hslToHex(hue, saturation, lightness);
        extensionIndex += 1;
      } while (usedColors.has(color));
    }
    colors.set(rootId, color);
    usedColors.add(color);
  });

  return colors;
}

/**
 * Groups products under their top-level category. Root colors are derived from
 * the complete category catalog so a filtered product list retains its colors.
 */
export function groupProductsByRootCategory(
  products: CatalogRow[],
  categories: CatalogRow[],
): ProductCategoryGroup[] {
  const categoriesById = new Map<string, CatalogRow>();
  for (const category of categories) {
    const id = toId(category.id);
    if (id !== null && !categoriesById.has(id)) {
      categoriesById.set(id, category);
    }
  }

  const rootByCategoryId = new Map<string, string>();

  const resolveRoot = (categoryId: string): string => {
    const cachedRoot = rootByCategoryId.get(categoryId);
    if (cachedRoot !== undefined) {
      return cachedRoot;
    }

    const path: string[] = [];
    const pathIndexes = new Map<string, number>();
    let currentId = categoryId;
    let rootId: string;

    while (true) {
      const knownRoot = rootByCategoryId.get(currentId);
      if (knownRoot !== undefined) {
        rootId = knownRoot;
        break;
      }

      const cycleStart = pathIndexes.get(currentId);
      if (cycleStart !== undefined) {
        rootId = path.slice(cycleStart).sort(compareIds)[0];
        break;
      }

      pathIndexes.set(currentId, path.length);
      path.push(currentId);

      const category = categoriesById.get(currentId);
      const parentId = category ? toId(category.parent_id) : null;
      if (!category || parentId === null || !categoriesById.has(parentId)) {
        // A category whose parent is absent is the best available root.
        rootId = currentId;
        break;
      }
      currentId = parentId;
    }

    for (const id of path) {
      rootByCategoryId.set(id, rootId);
    }
    return rootId;
  };

  for (const categoryId of categoriesById.keys()) {
    resolveRoot(categoryId);
  }

  const rootIds = [...new Set(rootByCategoryId.values())].sort(compareIds);
  const rootColors = buildRootColors(rootIds);
  const groupsByKey = new Map<string, ProductCategoryGroup>();

  for (const product of products) {
    const categoryId = toId(product.category_id);
    let groupKey: string;
    let id: string;
    let label: string;
    let color: string;

    if (categoryId === null) {
      groupKey = `uncategorized:${UNCATEGORIZED_ID}`;
      id = UNCATEGORIZED_ID;
      label = translate(UNCATEGORIZED_LABEL);
      color = UNKNOWN_CATEGORY_COLOR;
    } else {
      const category = categoriesById.get(categoryId);
      if (category) {
        const rootId = resolveRoot(categoryId);
        const rootCategory = categoriesById.get(rootId);
        groupKey = `category:${rootId}`;
        id = rootId;
        label = localizedName(rootCategory?.name_ar, rootCategory?.name, rootCategory?.id ?? rootId);
        color = rootColors.get(rootId) ?? UNKNOWN_CATEGORY_COLOR;
      } else {
        groupKey = `unknown:${categoryId}`;
        id = categoryId;
        label = localizedName(product.category_name_ar, product.category_name, categoryId);
        color = UNKNOWN_CATEGORY_COLOR;
      }
    }

    let group = groupsByKey.get(groupKey);
    if (!group) {
      group = { id, label, color, products: [] };
      groupsByKey.set(groupKey, group);
    }
    group.products.push(product);
  }

  return [...groupsByKey.entries()]
    .sort(([leftKey, left], [rightKey, right]) => {
      const leftIsUncategorized = leftKey.startsWith("uncategorized:");
      const rightIsUncategorized = rightKey.startsWith("uncategorized:");
      if (leftIsUncategorized !== rightIsUncategorized) {
        return leftIsUncategorized ? 1 : -1;
      }
      return compareIds(left.id, right.id);
    })
    .map(([, group]) => group);
}