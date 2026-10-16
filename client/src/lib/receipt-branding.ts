import { useEffect, useState } from "react";
import type { ReceiptBranding } from "../../../shared/receipt-presentation";

export async function fetchReceiptBranding(): Promise<ReceiptBranding> {
  const response = await fetch("/api/production/receipt-branding", { credentials: "include" });
  if (!response.ok) throw new Error("Receipt factory details could not be loaded.");
  const data = await response.json();
  if (!data || typeof data !== "object" || !["companyNameAr", "companyNameEn", "logoSrc", "address", "phone", "email", "taxNumber"]
    .every(key => typeof data[key] === "string")) throw new Error("Invalid receipt factory details.");
  return data;
}

export function useReceiptBranding() {
  const [branding, setBranding] = useState<ReceiptBranding | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    fetchReceiptBranding().then(value => { if (active) setBranding(value); })
      .catch(() => { if (active) setError("Receipt factory details could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  return { branding, loading, error };
}
