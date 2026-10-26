import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { cloudEnabled } from "./cloud/api";
import CloudRoot from "./cloud/CloudRoot";
import "./styles.css";

// With VITE_API_URL set, accounts and shared jobs come from the server; otherwise run the local demo.
createRoot(document.getElementById("root")!).render(<StrictMode>{cloudEnabled ? <CloudRoot /> : <App />}</StrictMode>);
