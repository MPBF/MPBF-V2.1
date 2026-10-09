import { Component, Suspense, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { translate } from "../i18n";

class ContentErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      // Reload also clears React.lazy's cached rejection after a failed chunk request.
      return <div className="panel" role="alert" style={{ padding: 20 }}>
        <p>{translate("تعذر تحميل البيانات")}</p>
        <button className="btn btn-muted" onClick={() => window.location.reload()}>{translate("إعادة المحاولة")}</button>
      </div>;
    }
    return this.props.children;
  }
}

export default function DeferredContent({ children }: { children: ReactNode }) {
  useTranslation();
  return <ContentErrorBoundary><Suspense fallback={
    <div className="panel" role="status" aria-busy="true" style={{ padding: 20 }}>{translate("جارٍ التحميل…")}</div>
  }>{children}</Suspense></ContentErrorBoundary>;
}
