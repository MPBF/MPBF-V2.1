import type { ReceiptBranding } from "../../../../shared/receipt-presentation";
import { safeReceiptLogo } from "../../../../shared/receipt-presentation";
import type { ReceiptVoucherCopy } from "./receipt-voucher-copy";

type Props = {
  branding: ReceiptBranding | null;
  loading: boolean;
  error: string;
  language: string;
  copy: ReceiptVoucherCopy;
};

export function ReceiptFactoryHeader({ branding, loading, error, language, copy }: Props) {
  const english = language === "en";
  const entries = branding ? [
    [copy.address, branding.address],
    [copy.phone, branding.phone],
    [copy.email, branding.email],
    [copy.taxNumber, branding.taxNumber],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]?.trim())) : [];

  return (
    <section className="receipt-factory-header" aria-label={english ? "Factory identity" : "بيانات المصنع"} data-receipt-factory-header>
      {branding?.logoSrc && safeReceiptLogo(branding.logoSrc) && (
        <img className="receipt-factory-logo" src={safeReceiptLogo(branding.logoSrc)} alt="" />
      )}
      <div className="receipt-factory-names">
        {branding ? (
          <>
            {branding.companyNameAr.trim() && <strong lang="ar" dir="rtl">{branding.companyNameAr}</strong>}
            {branding.companyNameEn.trim() && <span lang="en" dir="ltr">{branding.companyNameEn}</span>}
          </>
        ) : !loading && !error ? (
          <span>{english ? "Factory identity unavailable" : "بيانات المصنع غير متاحة"}</span>
        ) : null}
      </div>
      {entries.length > 0 && <div className="receipt-factory-contact">
        {entries.map(([label, value]) => <span key={label}><b>{label}:</b> {value}</span>)}
      </div>}
      {loading && <p className="receipt-branding-state" role="status" data-receipt-branding-state="loading">{copy.brandingLoading}</p>}
      {error && <p className="receipt-branding-state" role="alert" data-receipt-branding-state="error">{copy.brandingError}</p>}
    </section>
  );
}
