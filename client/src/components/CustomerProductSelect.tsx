import i18n, { translate } from "../i18n";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import { groupProductsByRootCategory, type CatalogRow } from "../lib/product-category-groups";
import "./CustomerProductSelect.css";

type Props = {
  id: string;
  products: CatalogRow[];
  categories: CatalogRow[];
  selectedId: string;
  onSelect: (id: string) => void;
  labelFor: (product: CatalogRow) => string;
  disabled: boolean;
};

export default function CustomerProductSelect({ id, products, categories, selectedId, onSelect, labelFor, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => groupProductsByRootCategory(products, categories), [products, categories, i18n.language]);
  const selectedGroup = groups.find((group) => group.products.some((product) => String(product.id) === selectedId));
  const selected = selectedGroup?.products.find((product) => String(product.id) === selectedId);
  const search = query.trim().toLocaleLowerCase();
  const visibleGroups = groups.map((group) => ({
    ...group,
    products: group.products.filter((product) => `${group.label} ${labelFor(product)} ${product.id}`.toLocaleLowerCase().includes(search)),
  })).filter((group) => group.products.length);
  const options = visibleGroups.flatMap((group) => group.products);
  const safeIndex = Math.min(activeIndex, Math.max(0, options.length - 1));
  const optionId = (product: CatalogRow) => `${id}-option-${encodeURIComponent(String(product.id))}`;

  useEffect(() => {
    inputRef.current?.setCustomValidity(disabled || selected ? "" : translate("اختر منتجًا من القائمة."));
  }, [disabled, selected]);

  useEffect(() => {
    if (disabled) { setOpen(false); setQuery(""); }
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const active = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    if (active && listRef.current) {
      const list = listRef.current;
      const top = active.offsetTop;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (top + active.offsetHeight > list.scrollTop + list.clientHeight) {
        list.scrollTop = top + active.offsetHeight - list.clientHeight;
      }
    }
  }, [open, safeIndex, search]);

  const choose = (product: CatalogRow) => {
    onSelect(String(product.id));
    inputRef.current?.setCustomValidity("");
    inputRef.current?.focus();
    setQuery("");
    setOpen(false);
  };
  const openList = () => {
    if (disabled) return;
    setQuery("");
    setActiveIndex(Math.max(0, groups.flatMap((group) => group.products).findIndex((product) => String(product.id) === selectedId)));
    setOpen(true);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) openList();
      else setActiveIndex(options.length ? (safeIndex + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length : 0);
    } else if (open && (event.key === "Home" || event.key === "End")) {
      event.preventDefault();
      setActiveIndex(event.key === "Home" ? 0 : Math.max(0, options.length - 1));
    } else if (open && event.key === "Enter") {
      event.preventDefault();
      if (options[safeIndex]) choose(options[safeIndex]);
    } else if (open && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setQuery("");
    }
  };
  let index = -1;

  return (
    <div className="order-product-picker" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        setOpen(false);
        setQuery("");
      }
    }}>
      <div className="order-product-picker-input">
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && !disabled}
          aria-controls={`${id}-options`}
          aria-activedescendant={open && !disabled && options[safeIndex] ? optionId(options[safeIndex]) : undefined}
          aria-required="true"
          value={open ? query : selected ? labelFor(selected) : ""}
          style={{ color: open ? undefined : selectedGroup?.color }}
          onFocus={openList}
          onClick={() => { if (!open) openList(); }}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setOpen(true);
            if (selectedId) onSelect("");
          }}
          onKeyDown={handleKeyDown}
          onInvalid={openList}
          autoComplete="off"
          placeholder={open ? translate("ابحث عن المنتج أو التصنيف…") : translate("اختر منتج")}
          disabled={disabled}
          required={!selected}
        />
        <ChevronDown size={17} aria-hidden="true" />
      </div>
      {open && !disabled && (
        <div ref={listRef} id={`${id}-options`} role="listbox" aria-label={translate("منتجات العميل حسب التصنيف الرئيسي")} className="order-product-picker-options">
          {visibleGroups.length ? visibleGroups.map((group, groupIndex) => (
            <div role="group" aria-labelledby={`${id}-group-${groupIndex}`} className="order-product-picker-group" key={group.id}>
              <div className="order-product-picker-heading" id={`${id}-group-${groupIndex}`} style={{ color: group.color }}>
                <span>{translate(group.label)}</span><small>{group.products.length}</small>
              </div>
              {group.products.map((product) => {
                const currentIndex = ++index;
                const isActive = currentIndex === safeIndex;
                const isSelected = String(product.id) === selectedId;
                return <button
                  type="button"
                  role="option"
                  tabIndex={-1}
                  id={optionId(product)}
                  key={product.id}
                  aria-selected={isSelected}
                  data-active={isActive}
                  className={`order-product-picker-option${isActive ? " is-active" : ""}`}
                  style={{ color: group.color }}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(product)}
                >
                  <span>{labelFor(product)}</span>{isSelected && <Check size={16} aria-hidden="true" />}
                </button>;
              })}
            </div>
          )) : <div className="order-product-picker-empty" role="status">{products.length ? translate("لا توجد منتجات مطابقة للبحث.") : translate("لا توجد منتجات مسجلة لهذا العميل.")}</div>}
        </div>
      )}
    </div>
  );
}