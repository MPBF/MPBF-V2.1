import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useTranslation } from "react-i18next";
import i18n, { translate } from "../i18n";
import saFlag from "./flags/sa.svg";
import gbFlag from "./flags/gb.svg";
import "./FlagLanguageSelector.css";

export interface FlagLanguageSelectorProps {
  value: "ar" | "en" | "";
  effectiveLanguage: "ar" | "en";
  onChange: (value: "ar" | "en" | "") => void;
  disabled?: boolean;
  allowDefault?: boolean;
}

function FactorySettingsIcon() {
  return (
    <svg
      aria-hidden="true"
      className="flag-language-selector__factory-icon"
      viewBox="0 0 24 24"
      fill="none"
    >
      <path
        d="M3.5 20V9.7l5.1 2.8V9.7l5.1 2.8V6.9h6.8V20H3.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M14.2 6.8V4.1h3.1v2.7M7.2 16.3h1.5m3.2 0h1.5m3.2 0h1.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="18.2" cy="9.8" r="1.25" fill="currentColor" />
    </svg>
  );
}

export function FlagLanguageSelector({
  value,
  effectiveLanguage,
  onChange,
  disabled = false,
  allowDefault = false,
}: FlagLanguageSelectorProps) {
  useTranslation();

  const activeLanguage = effectiveLanguage === "en" ? "en" : "ar";
  const currentLanguageName = translate(activeLanguage === "ar" ? "العربية" : "English");
  const languageLabel = `${translate("اللغة")}: ${currentLanguageName}`;
  const selectionValue = value || "__factory_default__";

  return (
    <div className="flag-language-selector" dir={i18n.language === "en" ? "ltr" : "rtl"}>
      <DropdownMenu.Root dir={i18n.language === "en" ? "ltr" : "rtl"}>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className="flag-language-selector__trigger"
            aria-label={languageLabel}
            title={languageLabel}
            disabled={disabled}
          >
            <img
              className="flag-language-selector__flag"
              src={activeLanguage === "ar" ? saFlag : gbFlag}
              alt=""
              aria-hidden="true"
            />
            <svg aria-hidden="true" className="flag-language-selector__chevron" viewBox="0 0 16 16" fill="none">
              <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="flag-language-selector__menu"
            align="end"
            sideOffset={6}
            collisionPadding={8}
            avoidCollisions
            loop
          >
            <DropdownMenu.RadioGroup
              value={selectionValue}
              onValueChange={(nextValue) => {
                if (nextValue === "__factory_default__") onChange("");
                else if (nextValue === "ar" || nextValue === "en") onChange(nextValue);
              }}
            >
              <DropdownMenu.RadioItem
                className="flag-language-selector__item"
                value="ar"
                data-language="ar"
                textValue={translate("العربية")}
                aria-label={translate("العربية")}
                title={translate("العربية")}
              >
                <img className="flag-language-selector__flag" src={saFlag} alt="" aria-hidden="true" />
                <DropdownMenu.ItemIndicator className="flag-language-selector__selected" aria-hidden="true">
                  <span />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
              <DropdownMenu.RadioItem
                className="flag-language-selector__item"
                value="en"
                data-language="en"
                textValue={translate("English")}
                aria-label={translate("English")}
                title={translate("English")}
              >
                <img className="flag-language-selector__flag" src={gbFlag} alt="" aria-hidden="true" />
                <DropdownMenu.ItemIndicator className="flag-language-selector__selected" aria-hidden="true">
                  <span />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
              {allowDefault && (
                <>
                  <DropdownMenu.Separator className="flag-language-selector__separator" />
                  <DropdownMenu.RadioItem
                    className="flag-language-selector__item flag-language-selector__item--default"
                    value="__factory_default__"
                    data-language="default"
                    aria-label={translate("استخدم لغة الشركة")}
                    title={translate("استخدم لغة الشركة")}
                  >
                    <FactorySettingsIcon />
                    <span className="flag-language-selector__default-label">
                      {translate("استخدم لغة الشركة")}
                    </span>
                    <DropdownMenu.ItemIndicator className="flag-language-selector__selected" aria-hidden="true">
                      <span />
                    </DropdownMenu.ItemIndicator>
                  </DropdownMenu.RadioItem>
                </>
              )}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

export default FlagLanguageSelector;