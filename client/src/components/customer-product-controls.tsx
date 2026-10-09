import { translate } from "../i18n";
import { ChevronDown, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

type Customer = Record<string, any>;
type CustomerPickerProps = {
  customers: Customer[];
  value: string;
  onChange: (id: string) => void;
  labelFor: (customer: Customer) => string;
};

/** Search belongs to the dropdown, not to a second standalone form field. */
export function CustomerPicker({ customers, value, onChange, labelFor }: CustomerPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selected = customers.find((customer) => String(customer.id) === value);
  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return search ? customers.filter((customer) =>
      [customer.id, customer.name, customer.name_ar, customer.display_name, customer.display_name_ar]
        .some((part) => String(part ?? "").toLocaleLowerCase().includes(search))) : customers;
  }, [customers, query]);
  const index = Math.min(active, Math.max(0, filtered.length - 1));
  const optionId = (id: unknown) => `cp-customer-option-${encodeURIComponent(String(id))}`;
  const label = selected ? labelFor(selected) : value ? translate("العميل الحالي ({{value}}) — اختر عميلاً صالحاً", { value }) : translate("اختر العميل");

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [open, index, query]);

  const choose = (customer: Customer) => {
    onChange(String(customer.id));
    setOpen(false);
    setQuery("");
    triggerRef.current?.focus();
  };
  const openList = () => {
    setQuery("");
    setActive(Math.max(0, customers.findIndex((customer) => String(customer.id) === value)));
    setOpen(true);
  };
  const handleKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive(filtered.length ? (index + (event.key === "ArrowDown" ? 1 : -1) + filtered.length) % filtered.length : 0);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (filtered[index]) choose(filtered[index]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  return <div className="cp-customer-picker" ref={rootRef} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <button id="cp-customer" ref={triggerRef} className="cp-customer-trigger" type="button"
      aria-label={translate("اختر العميل")} aria-haspopup="listbox" aria-expanded={open} aria-controls="cp-customer-options"
      onClick={() => open ? setOpen(false) : openList()}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); openList(); }
      }}>
      <span title={label}>{translate(label)}</span><ChevronDown size={15} />
    </button>
    {open && <div className="cp-customer-menu">
      <div className="cp-searchbox">
        <Search className="cp-search-icon" size={15} />
        <input ref={inputRef} role="combobox" aria-label={translate("ابحث عن العميل بالاسم أو الرقم")}
          aria-expanded="true" aria-autocomplete="list" aria-required="true" aria-controls="cp-customer-options"
          aria-activedescendant={filtered[index] ? optionId(filtered[index].id) : undefined}
          value={query} autoComplete="off" placeholder={translate("ابحث بالاسم أو الرقم")}
          onChange={(event) => { setQuery(event.target.value); setActive(0); }} onKeyDown={handleKey} />
      </div>
      <span className="cp-result-count" role="status">{filtered.length}{" "}{translate("عميل مطابق")}</span>
      <div id="cp-customer-options" className="cp-customer-options" role="listbox" aria-label={translate("العملاء")} ref={listRef}>
        {filtered.map((customer, i) => <button key={customer.id} id={optionId(customer.id)}
          type="button" role="option" tabIndex={-1} aria-selected={String(customer.id) === value}
          data-active={i === index} className="cp-customer-option"
          onMouseDown={(event) => event.preventDefault()} onClick={() => choose(customer)}>
          {labelFor(customer)}
        </button>)}
        {!filtered.length && <div className="cp-customer-empty">{translate("لا يوجد عملاء مطابقون للبحث.")}</div>}
      </div>
    </div>}
  </div>;
}

const integerOptions = (min: number, max: number) => Array.from({ length: max - min + 1 }, (_, i) => String(min + i));
export const PRODUCT_SELECT_VALUES = {
  facing: integerOptions(0, 50),
  width: integerOptions(10, 100),
  thickness: integerOptions(1, 60),
  density: ["0.95", "1", "1.15"],
  cuttingLength: integerOptions(0, 300),
  cuttingUnit: ["كيلو", "رول", "باكت", "كيس", "كرتون"],
  unitWeightKg: Array.from({ length: 59 }, (_, index) => String((100 + index * 50) / 1000)),
  packageQuantity: integerOptions(1, 25),
};

export function unitWeightLabel(value: string): string {
  const kilos = Number(value);
  return Number.isFinite(kilos) ? `${Math.round(kilos * 1000)} جرام` : value;
}

export function ProductValueSelect({ id, label, value, values, onChange, disabled = false, zeroMeansUnset = false, hint, labelForValue }: {
  id: string; label: string; value: unknown; values: string[]; onChange: (value: string) => void;
  disabled?: boolean; zeroMeansUnset?: boolean; hint?: string;
  labelForValue?: (value: string) => string;
}) {
  const text = value == null ? "" : String(value);
  const selected = text === "" ? (zeroMeansUnset ? "0" : "") : values.find((option) => Number(option) === Number(text)) ?? text;
  return <div className="cp-field">
    <label htmlFor={id}>{translate(label)}</label>
    <select id={id} value={selected} disabled={disabled}
      onChange={(event) => onChange(zeroMeansUnset && event.target.value === "0" ? "" : event.target.value)}>
      {!zeroMeansUnset && <option value="">{translate("غير محدد")}</option>}
      {values.map((option) => <option key={option} value={option}>{zeroMeansUnset && option === "0" ? translate("0 — غير محدد") : labelForValue ? labelForValue(option) : option}</option>)}
      {selected && !values.includes(selected) && <option value={selected}>{translate("القيمة الحالية:")}{" "}{labelForValue ? labelForValue(text) : text}</option>}
    </select>
    {hint && <span className="cp-hint">{hint}</span>}
  </div>;
}