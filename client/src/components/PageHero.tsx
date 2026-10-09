import { translate } from "../i18n";
import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import "./page-hero.css";

type PageHeroProps = {
  kicker: string;
  title: string;
  description: string;
  onRefresh: () => void;
  refreshing?: boolean;
  actions?: ReactNode;
};

export default function PageHero({ kicker, title, description, onRefresh, refreshing = false, actions }: PageHeroProps) {
  return (
    <div className="page-hero" dir={document.documentElement.dir}>
      <div className="page-hero-copy">
        <span>{translate(kicker)}</span>
        <h2>{translate(title)}</h2>
        <p>{translate(description)}</p>
      </div>
      <div className="page-hero-actions">
        {actions}
        <button className="page-hero-refresh" type="button" onClick={onRefresh} disabled={refreshing} aria-label={translate("تحديث بيانات {{title}}", { title: translate(title) })}>
          <RefreshCw size={17} />{" "}{translate("تحديث")}</button>
      </div>
    </div>
  );
}