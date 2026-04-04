import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FiLogOut, FiX } from "react-icons/fi";
import { useAuth } from "../../context/AuthContext.jsx";
import Navbar from "./Navbar.jsx";

const AppShell = ({ sectionLabel, navItems, basePath, children }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const currentPath = location.pathname.replace(`${basePath}/`, "").split("/")[0];
  const activeNavItem = navItems.find(({ path }) => currentPath === path) || navItems[0];

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const sidebarContent = (
    <>
      <div className="mb-6 flex items-center justify-between lg:justify-start">
        <button
          type="button"
          onClick={() => {
            navigate(basePath);
            setSidebarOpen(false);
          }}
          className="text-left"
        >
          <p className="text-[0.92rem] font-semibold uppercase tracking-[0.26em] text-[var(--app-text)]">
            AIProctor
          </p>
          <p className="mt-1 text-xs text-[var(--app-subtle)]">{sectionLabel}</p>
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
        className="mb-5 rounded-[24px] border px-4 py-3.5"
        style={{
          background: "var(--panel-soft)",
          borderColor: "var(--app-border)",
        }}
      >
        <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--app-subtle)]">Signed in as</p>
        <div className="mt-2.5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-sm font-semibold text-[var(--accent-strong)]">
            {user?.name?.charAt(0)?.toUpperCase() || "U"}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-[var(--app-text)]">{user?.name}</p>
            <p className="truncate text-xs text-[var(--app-subtle)]">
              {user?.role === "admin" ? "Admin workspace" : "Student workspace"}
            </p>
          </div>
        </div>
      </div>

      <nav className="space-y-1.5 pointer-events-auto">
        {navItems.map(({ path, label, icon: Icon, caption }) => {
          const isActive =
            currentPath === path ||
            (currentPath === basePath.replace("/", "") && path === navItems[0]?.path);

          return (
            <button
              key={path}
              type="button"
              onClick={() => {
                navigate(`${basePath}/${path}`);
                setSidebarOpen(false);
              }}
              className="group flex w-full touch-manipulation items-center gap-3 rounded-[20px] border px-3.5 py-3 text-left transition-all duration-200"
              style={{
                background: isActive ? "var(--nav-active-bg)" : "var(--panel-soft)",
                borderColor: isActive ? "var(--nav-active-border)" : "transparent",
                color: isActive ? "var(--app-text)" : "var(--app-muted)",
              }}
            >
              <div
                className="flex h-10 w-10 items-center justify-center rounded-2xl transition-colors"
                style={{
                  background: isActive ? "var(--accent-soft)" : "var(--nav-icon-bg)",
                  color: isActive ? "var(--accent-strong)" : "var(--app-muted)",
                }}
              >
                <Icon className="text-[1.05rem]" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{label}</p>
                <p className="truncate text-[11px] text-[var(--app-subtle)]">{caption}</p>
              </div>
            </button>
          );
        })}
      </nav>

      <button
        type="button"
        onClick={handleLogout}
        className="mt-auto flex w-full items-center gap-3 rounded-[20px] border px-3.5 py-3 text-left transition-colors hover:bg-red-500/10 hover:text-red-400"
        style={{
          borderColor: "var(--app-border)",
          background: "var(--panel-soft)",
          color: "var(--app-muted)",
        }}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-red-500/10 text-red-400">
          <FiLogOut className="text-[1.05rem]" />
        </div>
        <div>
          <p className="text-sm font-medium">Sign Out</p>
          <p className="text-[11px] text-[var(--app-subtle)]">End this session</p>
        </div>
      </button>
    </>
  );

  return (
    <div className="relative min-h-screen overflow-hidden bg-[var(--app-bg)] text-[var(--app-text)]">
      <div className="pointer-events-none absolute inset-0 opacity-90" style={{ background: "var(--app-gradient)" }} />

      {sidebarOpen && (
        <div className="fixed inset-0 z-[80] lg:hidden">
          <button
            type="button"
            aria-label="Close menu overlay"
            className="absolute inset-0 bg-slate-950/55"
            onClick={() => setSidebarOpen(false)}
          />
          <aside
            className="absolute inset-y-0 left-0 flex w-[18rem] max-w-[85vw] touch-manipulation flex-col border-r px-4 py-4 pointer-events-auto"
            style={{
              background: "var(--panel-bg)",
              borderColor: "var(--app-border)",
              boxShadow: "0 24px 70px rgba(2, 6, 23, 0.55)",
              backdropFilter: "blur(18px)",
            }}
          >
            {sidebarContent}
          </aside>
        </div>
      )}

      <div className="relative z-10 flex min-h-screen">
        <aside
          className="hidden w-[17rem] flex-col border-r px-4 py-4 lg:flex"
          style={{
            background: "var(--shell-sidebar)",
            borderColor: "var(--app-border)",
            boxShadow: "var(--panel-shadow)",
          }}
        >
          {sidebarContent}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <Navbar
            showMenuButton
            onMenuClick={() => setSidebarOpen(true)}
            contextLabel={activeNavItem?.label || sectionLabel}
            contextCaption={activeNavItem?.caption || sectionLabel}
            showBrand={false}
          />
          <main className="flex-1 px-3 py-3 sm:px-4 sm:py-4 lg:px-5">
            <div
              className="min-h-[calc(100vh-6.5rem)] rounded-[30px] border px-3 py-3 sm:px-4 lg:px-5"
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
