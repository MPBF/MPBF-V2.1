import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { ChevronDown, X, type LucideIcon } from "lucide-react";
import { translate } from "../i18n";
import "./MobileNavigation.css";

export type MobileNavItem = readonly [href: string, label: string, Icon: LucideIcon, permissions: readonly string[]];

type Props = {
  visibleNav: readonly MobileNavItem[];
  location: string;
  isActive: (href: string, location: string) => boolean;
  authorizationKey: string;
};

export default function MobileNavigation({ visibleNav, location, isActive, authorizationKey }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const navSignature = visibleNav.map(([href]) => href).join("|");
  const compact = visibleNav.length > 5;
  const currentModule = compact
    ? visibleNav.find(([href]) => ["/production", "/planning", "/warehouse"].includes(href) && isActive(href, location))
    : undefined;
  const firstQuickLinks = visibleNav.slice(0, 4);
  const quickLinks = compact
    ? currentModule && !firstQuickLinks.some(([href]) => href === currentModule[0])
      ? [...visibleNav.slice(0, 3), currentModule]
      : firstQuickLinks
    : visibleNav;
  const activeIsHidden = compact && !quickLinks.some(([href]) => isActive(href, location));

  useEffect(() => {
    setOpen(false);
  }, [location, authorizationKey, navSignature]);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > 700) setOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = rootRef.current;
    if (!root) return;

    const background = Array.from(document.querySelectorAll<HTMLElement>(
      ".shell > :not(.main), .main > :not(.mobile-navigation-root), .mobile-navigation-bar",
    ));
    const original = background.map((element) => ({
      element,
      inert: element.inert,
      ariaHidden: element.getAttribute("aria-hidden"),
    }));
    background.forEach((element) => {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    });
    document.body.classList.add("mobile-navigation-open");
    const focusTimer = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>("[data-mobile-nav-close]")?.focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? []).filter((element) => element.offsetParent !== null);
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusTimer);
      document.removeEventListener("keydown", onKeyDown);
      original.forEach(({ element, inert, ariaHidden }) => {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      });
      document.body.classList.remove("mobile-navigation-open");
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
    };
  }, [open]);

  return <nav ref={rootRef} className="mobile-navigation-root" aria-label={translate("التنقل الرئيسي")}>
    <div className="mobile-navigation-bar">
      {quickLinks.map(([href, label, Icon]) => {
        const active = isActive(href, location);
        return <Link key={href} href={href} className={`mobile-navigation-link${active ? " is-active" : ""}`}
          aria-label={translate(label)} aria-current={active ? "page" : undefined} data-mobile-nav-link={href}>
          <Icon aria-hidden="true" />
          <span>{translate(label)}</span>
        </Link>;
      })}
      {compact && <button ref={moreRef} type="button"
        className={`mobile-navigation-link mobile-navigation-more${activeIsHidden ? " is-active" : ""}`}
        aria-label={translate("المزيد")} aria-haspopup="dialog" aria-expanded={open}
        aria-current={activeIsHidden ? "page" : undefined}
        onClick={() => setOpen(true)}>
        <ChevronDown aria-hidden="true" />
        <span>{translate("المزيد")}</span>
      </button>}
    </div>
    {open && <div className="mobile-navigation-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setOpen(false);
    }}>
      <div ref={dialogRef} className="mobile-navigation-sheet" role="dialog" aria-modal="true"
        aria-labelledby="mobile-navigation-title" data-testid="mobile-navigation-dialog">
        <div className="mobile-navigation-sheet-head">
          <h2 id="mobile-navigation-title">{translate("التنقل الرئيسي")}</h2>
          <button type="button" className="mobile-navigation-close" data-mobile-nav-close
            aria-label={translate("إغلاق")} onClick={() => setOpen(false)}><X aria-hidden="true" /></button>
        </div>
        <nav className="mobile-navigation-list" aria-label={translate("جميع الصفحات")}>
          {visibleNav.map(([href, label, Icon]) => {
            const active = isActive(href, location);
            return <Link key={href} href={href} className={`mobile-navigation-sheet-link${active ? " is-active" : ""}`}
              aria-label={translate(label)} aria-current={active ? "page" : undefined}
              data-mobile-nav-page={href} onClick={() => setOpen(false)}>
              <Icon aria-hidden="true" />
              <span>{translate(label)}</span>
              {active && <span className="mobile-navigation-current">{translate("الصفحة الحالية")}</span>}
            </Link>;
          })}
        </nav>
      </div>
    </div>}
  </nav>;
}
