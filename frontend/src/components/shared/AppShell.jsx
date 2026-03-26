import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FiLogOut, FiShield, FiX } from "react-icons/fi";
import { useAuth } from "../../context/AuthContext.jsx";
import Navbar from "./Navbar.jsx";

const AppShell = ({ sectionLabel, navItems, basePath, children }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const currentPath = location.pathname.replace(`${basePath}/`, "").split("/")[0];

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-[var(--app-bg)] text-[var(--app-text)] relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-90" style={{ background: "var(--app-gradient)" }} />

      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close menu overlay"
          className="fixed inset-0 z-40 bg-black/35 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className="relative z-10 flex min-h-screen">
        <aside
          className={`fixed inset-y-0 left-0 z-50 w-72 border-r px-5 py-5 transition-transform duration-300 lg:static lg:translate-x-0 ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
          style={{
            background: "var(--shell-sidebar)",
            borderColor: "var(--app-border)",
            boxShadow: "var(--panel-shadow)",
            backdropFilter: "blur(20px)",
          }}
        >
          <div className="mb-8 flex items-center justify-between lg:justify-start">
            <button
              type="button"
              onClick={() => navigate(basePath)}
              className="flex items-center gap-3 text-left"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--accent-strong)] text-white shadow-lg shadow-sky-500/20">
                <FiShield className="text-lg" />
              </div>
              <div>
                <p className="text-sm font-semibold tracking-[0.18em] uppercase text-[var(--app-muted)]">
                  AIProctor
                </p>
              </div>
            </button>

            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border text-[var(--app-muted)] lg:hidden"
              style={{ borderColor: "var(--app-border)", background: "var(--panel-soft)" }}
              onClick={() => setSidebarOpen(false)}
            >
              <FiX />
            </button>
          </div>

          <div
            className="mb-6 rounded-[28px] border p-4"
            style={{
              background: "var(--panel-soft)",
              borderColor: "var(--app-border)",
            }}
          >
            <p className="text-xs uppercase tracking-[0.22em] text-[var(--app-subtle)]">Signed in as</p>
            <div className="mt-3 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--accent-soft)] font-semibold text-[var(--accent-strong)]">
                {user?.name?.charAt(0)?.toUpperCase() || "U"}
              </div>
              <div className="min-w-0">
                <p className="truncate font-medium text-[var(--app-text)]">{user?.name}</p>
              </div>
            </div>
          </div>

          <nav className="space-y-2">
            {navItems.map(({ path, label, icon: Icon, caption }) => {
              const isActive = currentPath === path || (currentPath === basePath.replace("/", "") && path === navItems[0]?.path);

              return (
                <button
                  key={path}
                  type="button"
                  onClick={() => {
                    navigate(`${basePath}/${path}`);
                    setSidebarOpen(false);
                  }}
                  className="group flex w-full items-center gap-3 rounded-[22px] border px-4 py-3 text-left transition-all duration-200"
                  style={{
                    background: isActive ? "var(--nav-active-bg)" : "var(--panel-soft)",
                    borderColor: isActive ? "var(--nav-active-border)" : "transparent",
                    color: isActive ? "var(--app-text)" : "var(--app-muted)",
                  }}
                >
                  <div
                    className="flex h-11 w-11 items-center justify-center rounded-2xl transition-colors"
                    style={{
                      background: isActive ? "var(--accent-soft)" : "var(--nav-icon-bg)",
                      color: isActive ? "var(--accent-strong)" : "var(--app-muted)",
                    }}
                  >
                    <Icon className="text-lg" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{label}</p>
                    <p className="truncate text-xs text-[var(--app-subtle)]">{caption}</p>
                  </div>
                </button>
              );
            })}
          </nav>

          <button
            type="button"
            onClick={handleLogout}
            className="mt-6 flex w-full items-center gap-3 rounded-[22px] border px-4 py-3 text-left transition-colors hover:bg-red-500/10 hover:text-red-400"
            style={{
              borderColor: "var(--app-border)",
              background: "var(--panel-soft)",
              color: "var(--app-muted)",
            }}
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-red-500/10 text-red-400">
              <FiLogOut className="text-lg" />
            </div>
            <div>
              <p className="font-medium">Sign Out</p>
              <p className="text-xs text-[var(--app-subtle)]">End this session</p>
            </div>
          </button>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <Navbar showMenuButton onMenuClick={() => setSidebarOpen(true)} />
          <main className="flex-1 px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
            <div
              className="min-h-[calc(100vh-7rem)] rounded-[32px] border px-4 py-5 sm:px-6 lg:px-8"
              style={{
                background: "var(--shell-main)",
                borderColor: "var(--app-border)",
                boxShadow: "var(--panel-shadow)",
                backdropFilter: "blur(20px)",
              }}
            >
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
};

export default AppShell;
