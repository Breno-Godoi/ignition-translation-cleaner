// src/App.tsx
import { Suspense, lazy, useEffect, useState } from "react";
import "bootstrap/dist/css/bootstrap.min.css";
import "./App.css";

const SyncTranslation = lazy(() => import("./components/SyncTranslation"));
const SyncUdtDefinitions = lazy(() => import("./components/SyncUdtDefinitions"));
const TranslationCleaner = lazy(() => import("./components/TranslationCleaner"));

type TabKey = "sync" | "cleaner" | "udt";

function App() {
  const [activeTab, setActiveTab] = useState<TabKey>("sync");
  const [loadedTabs, setLoadedTabs] = useState<Record<TabKey, boolean>>({
    sync: true,
    cleaner: false,
    udt: false,
  });
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  const handleTabChange = (tab: TabKey) => {
    setActiveTab(tab);
    setLoadedTabs((prev) =>
      prev[tab] ? prev : { ...prev, [tab]: true },
    );
  };

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
                onClick={() => handleTabChange("sync")}
              >
                Sync Translation
              </button>
            </li>
            <li className="nav-item">
              <button
                className={`nav-link ${
                  activeTab === "cleaner" ? "active" : ""
                }`}
                onClick={() => handleTabChange("cleaner")}
              >
                Translation Cleaner
              </button>
            </li>
            <li className="nav-item">
              <button
                className={`nav-link ${activeTab === "udt" ? "active" : ""}`}
                onClick={() => handleTabChange("udt")}
              >
                Sync UDT Definitons
              </button>
            </li>
          </ul>

          <Suspense
            fallback={
              <div className="alert alert-secondary py-2">
                Loading tab...
              </div>
            }
          >
            {loadedTabs.sync && (
              <div
                className={activeTab === "sync" ? "" : "d-none"}
                aria-hidden={activeTab !== "sync"}
              >
                <SyncTranslation />
              </div>
            )}

            {loadedTabs.udt && (
              <div
                className={activeTab === "udt" ? "" : "d-none"}
                aria-hidden={activeTab !== "udt"}
              >
                <SyncUdtDefinitions />
              </div>
            )}

            {loadedTabs.cleaner && (
              <div
                className={activeTab === "cleaner" ? "" : "d-none"}
                aria-hidden={activeTab !== "cleaner"}
              >
                <TranslationCleaner />
              </div>
            )}
          </Suspense>
        </div>
      </div>
    </div>
  );
}

export default App;
