import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import App from "./App";
import i18n from "./i18n";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");
createRoot(root).render(<I18nextProvider i18n={i18n}><App /></I18nextProvider>);