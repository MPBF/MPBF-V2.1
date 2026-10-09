import { translate } from "../i18n";
import { AlertTriangle, LoaderCircle, Printer, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { BrandingSnapshot } from "../lib/branding";
import { fetchOrderPrintDetails, fetchPublicOrderPrintDetails, type OrderDetailsError } from "../lib/order-details";
import type { OrderPrintDetails } from "../../../shared/order-details";
import OrderPrintSheet from "./OrderPrintSheet";
import "./OrderPrintPage.css";

type Props = { id: string; branding: BrandingSnapshot; publicAccess?: boolean; publicKey?: string };
type State = { status: "loading" } | { status: "error"; message: string; notFound: boolean } | { status: "ready"; data: OrderPrintDetails };

export default function OrderPrintPage({ id, branding, publicAccess = false, publicKey = "" }: Props) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const printLock = useRef(false);
  const alive = useRef(true);
  const orderNumber = state.status === "ready" ? state.data.order.order_number : null;

  useEffect(() => {
    const previous = document.title;
    const previousRobots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const previousRobotsContent = previousRobots?.content;
    const robots = publicAccess ? previousRobots ?? document.createElement("meta") : null;
    if (publicAccess && robots) {
      robots.name = "robots";
      robots.content = "noindex, nofollow, noarchive";
      if (!previousRobots) document.head.appendChild(robots);
    }
    document.title = orderNumber
      ? translate("أمر تشغيل إنتاج #{{number}}", { number: orderNumber })
      : publicAccess ? translate("نسخة الطباعة العامة للطلب") : translate("معاينة طباعة الطلب");
    return () => {
      document.title = previous;
      if (publicAccess && robots) {
        if (previousRobots) robots.content = previousRobotsContent ?? "";
        else robots.remove();
      }
    };
  }, [orderNumber, publicAccess]);

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    setState({ status: "loading" });
    const request = publicAccess
      ? fetchPublicOrderPrintDetails(id, publicKey, controller.signal)
      : fetchOrderPrintDetails(id, controller.signal);
    request.then((data) => {
      if (!controller.signal.aborted && alive.current) setState({ status: "ready", data });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      const typed = error as Partial<OrderDetailsError>;
      if (alive.current) setState({
        status: "error",
        message: error instanceof Error ? error.message : "تعذر تحميل تفاصيل أمر الإنتاج.",
        notFound: typed.status === 404,
      });
    });
    return () => {
      alive.current = false;
      controller.abort();
    };
  }, [id, attempt, publicAccess, publicKey]);

  useEffect(() => {
    const unlock = () => {
      printLock.current = false;
      if (alive.current) setPrinting(false);
    };
    window.addEventListener("afterprint", unlock);
    return () => window.removeEventListener("afterprint", unlock);
  }, []);

  const handlePrint = useCallback(async () => {
    if (state.status !== "ready" || printLock.current) return;
    printLock.current = true;
    setPrinting(true);
    setPrintError(null);
    try {
      await Promise.race([document.fonts?.ready, new Promise((resolve) => window.setTimeout(resolve, 5000))]);
      const images = Array.from(document.querySelectorAll<HTMLImageElement>(".opp-sheet img"));
      await Promise.all(images.map((image) => {
        if (image.complete) {
          if (!image.naturalWidth) throw new Error("Logo unavailable");
          return Promise.resolve();
        }
        return new Promise<void>((resolve, reject) => {
          const finish = (error?: Error) => {
            window.clearTimeout(timer);
            image.removeEventListener("load", loaded);
            image.removeEventListener("error", failed);
            if (error) reject(error); else resolve();
          };
          const loaded = () => finish();
          const failed = () => finish(new Error("Logo unavailable"));
          const timer = window.setTimeout(() => finish(new Error("Logo load timed out")), 5000);
          image.addEventListener("load", loaded, { once: true });
          image.addEventListener("error", failed, { once: true });
        });
      }));
      if (!alive.current) return;
      window.print();
      window.setTimeout(() => {
        if (printLock.current) {
          printLock.current = false;
          if (alive.current) setPrinting(false);
        }
      }, 1200);
    } catch {
      printLock.current = false;
      if (alive.current) {
        setPrinting(false);
        setPrintError(translate("تعذر تجهيز الطباعة. تأكد من تحميل شعار المصنع ثم أعد المحاولة، أو استخدم الطباعة من قائمة المتصفح."));
      }
    }
  }, [state.status]);

  return <main className="opp-page" dir={document.documentElement.dir}>
    <div className="opp-toolbar">
      <div className="opp-toolbar-copy"><span>{translate("معاينة مستند الإنتاج")}</span><strong>{translate("ورق A4 · أفقي")}</strong>{!publicAccess && <small style={{ maxWidth: 320, color: "#6a8178", fontSize: 10 }}>{translate("رمز QR الجديد يتطلب إعادة طباعة النسخ السابقة.")}</small>}</div>
      {state.status === "ready" && <button type="button" className="opp-print-action" onClick={handlePrint} disabled={printing}>
        {printing ? <LoaderCircle size={17} className="opp-spin" /> : <Printer size={17} />}
        {printing ? translate("جارٍ تجهيز الطباعة…") : translate("طباعة المستند")}
      </button>}
    </div>
    {printError && <p className="opp-print-error" role="alert">{printError}</p>}
    {state.status === "loading" && <div className="opp-page-state" role="status">
      <div className="opp-loader-sheet"><div /><div /><div /><div /></div>
      <strong>{translate("جارٍ تجهيز المعاينة")}</strong><span>{translate("نحمّل بيانات الطلب ومواصفات الإنتاج…")}</span>
    </div>}
    {state.status === "error" && <div className="opp-page-state opp-page-error" role="alert">
      <AlertTriangle size={27} />
      <strong>{state.notFound
        ? publicAccess ? translate("رابط الطباعة غير صالح أو غير متاح") : translate("الطلب غير موجود")
        : translate("تعذر فتح معاينة الطباعة")}</strong>
      <span>{state.message}</span>
      {!state.notFound && <button type="button" onClick={() => setAttempt((value) => value + 1)}><RefreshCw size={15} />{" "}{translate("إعادة المحاولة")}</button>}
    </div>}
    {state.status === "ready" && <div className="opp-preview-scroll" aria-label={translate("معاينة ورقة A4 أفقية")}>
      <OrderPrintSheet data={state.data} branding={branding} />
    </div>}
  </main>;
}