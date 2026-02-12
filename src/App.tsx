// src/App.tsx
import { useState, useEffect } from "react";
import SyncTranslation from "./components/SyncTranslation";
import SyncUdtDefinitions from "./components/SyncUdtDefinitions";
import TranslationCleaner from "./components/TranslationCleaner";
import "bootstrap/dist/css/bootstrap.min.css";
import "./App.css";

function App() {
  const [activeTab, setActiveTab] = useState<"sync" | "cleaner" | "udt">(
    "sync",
  );
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  useEffect(() => {
    document.body.setAttribute("data-bs-theme", theme);
  }, [theme]);

  return (
    <div className="container py-5">
      <div className="row justify-content-center">
        <div className="col-lg-10 col-md-12">

          <div className="position-relative mb-4">
            <h2 className="m-0 w-100 text-center">Ignition Syncing Tool</h2>
            <div className="form-check form-switch position-absolute top-0 end-0">

              <input
                className="form-check-input"
                type="checkbox"
                id="themeSwitch"
                checked={theme === "dark"}
                onChange={() => setTheme(theme === "dark" ? "light" : "dark")}
              />
              <label className="form-check-label" htmlFor="themeSwitch">
                {theme === "dark" ? "Dark" : "Light"} Mode
              </label>
            </div>
          </div>

          <ul className="nav nav-tabs mb-4 d-flex flex-row justify-content-center">
            <li className="nav-item">
              <button
                className={`nav-link ${activeTab === "sync" ? "active" : ""}`}
                onClick={() => setActiveTab("sync")}
              >
                Sync Translation
              </button>
            </li>
            <li className="nav-item">
              <button
                className={`nav-link ${
                  activeTab === "cleaner" ? "active" : ""
                }`}
                onClick={() => setActiveTab("cleaner")}
              >
                Translation Cleaner
              </button>
            </li>
            <li className="nav-item">
              <button
                className={`nav-link ${activeTab === "udt" ? "active" : ""}`}
                onClick={() => setActiveTab("udt")}
              >
                Sync UDT Definitons
              </button>
            </li>
          </ul>

          <div
            className={activeTab === "sync" ? "" : "d-none"}
            aria-hidden={activeTab !== "sync"}
          >
            <SyncTranslation />
          </div>

          <div
            className={activeTab === "udt" ? "" : "d-none"}
            aria-hidden={activeTab !== "udt"}
          >
            <SyncUdtDefinitions />
          </div>

          <div
            className={activeTab === "cleaner" ? "" : "d-none"}
            aria-hidden={activeTab !== "cleaner"}
          >
            <TranslationCleaner />
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
