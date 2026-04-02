import { Link, useLocation, useNavigate } from "react-router-dom";
import { FiLogOut, FiMenu, FiMoon, FiSun } from "react-icons/fi";
import { useAuth } from "../../context/AuthContext.jsx";
import { useTheme } from "../../context/ThemeContext.jsx";

const Navbar = ({
  showMenuButton = false,
  onMenuClick,
  contextLabel,
  contextCaption,
  showBrand = true,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const isAuthPage =
    location.pathname === "/login" ||
    location.pathname === "/register" ||
    location.pathname === "/register/admin";

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const leftEyebrow = showBrand
    ? "Secure exam platform"
    : user?.role === "admin"
    ? "Admin workspace"
    : "Student workspace";

  const leftTitle = showBrand
    ? "AIProctor"
    : contextLabel || (user?.role === "admin" ? "Admin workspace" : "Student workspace");

  const leftCaption = showBrand
    ? (user ? `${user.role === "admin" ? "Admin" : "Student"} workspace` : "Focused online assessment")
    : contextCaption || "Workspace";

  return (
    <header className="sticky top-0 z-30 px-3 pt-3 sm:px-5 lg:px-5">
      <nav
        className="mx-auto flex items-center justify-between gap-3 rounded-[24px] border px-4 py-2.5 sm:px-5"
        style={{
          background: "var(--shell-topbar)",
          borderColor: "var(--app-border)",
          boxShadow: "var(--panel-shadow)",
          backdropFilter: "blur(24px)",
        }}
      >
        <div className="flex min-w-0 items-center gap-3">
          {showMenuButton && (
            <button
              type="button"
              onClick={onMenuClick}
              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border lg:hidden"
              style={{ borderColor: "var(--app-border)", background: "var(--panel-soft)", color: "var(--app-text)" }}
            >
              <FiMenu className="text-base" />
            </button>
          )}

          <button
            type="button"
            onClick={() => navigate(user ? (user.role === "admin" ? "/admin" : "/student") : "/")}
            className="min-w-0 text-left"
          >
            <p className="truncate text-[10px] font-medium uppercase tracking-[0.24em] text-[var(--app-subtle)]">
              {leftEyebrow}
            </p>
            <p className="truncate text-[1.02rem] font-semibold text-[var(--app-text)]">
              {leftTitle}
            </p>
            <p className="truncate text-xs text-[var(--app-muted)]">
              {leftCaption}
            </p>
          </button>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {isAuthPage && !user && (
            <div className="hidden items-center gap-2 sm:flex">
              <Link
                to="/login"
                className="rounded-2xl px-4 py-2 text-sm font-medium transition-colors"
                style={{
                  background: location.pathname === "/login" ? "var(--panel-soft)" : "transparent",
                  color: "var(--app-text)",
                }}
              >
                Login
              </Link>
              <Link
                to="/register"
                className="rounded-2xl px-4 py-2 text-sm font-medium"
                style={{
                  background: location.pathname === "/register" ? "var(--accent-soft)" : "transparent",
                  color: location.pathname === "/register" ? "var(--accent-strong)" : "var(--app-text)",
                }}
              >
                Student Signup
              </Link>
              <Link
                to="/register/admin"
                className="rounded-2xl px-4 py-2 text-sm font-medium"
                style={{
                  background: location.pathname === "/register/admin" ? "var(--accent-soft)" : "transparent",
                  color: location.pathname === "/register/admin" ? "var(--accent-strong)" : "var(--app-text)",
                }}
              >
                Admin Signup
              </Link>
            </div>
          )}

          <button
            type="button"
            onClick={toggleTheme}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border transition-transform hover:scale-[1.02]"
            style={{ borderColor: "var(--app-border)", background: "var(--panel-soft)", color: "var(--app-text)" }}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            {theme === "dark" ? <FiSun className="text-base" /> : <FiMoon className="text-base" />}
          </button>

          {user && (
            <>
              <div
                className="hidden items-center gap-3 rounded-2xl border px-3 py-2 sm:flex"
                style={{ borderColor: "var(--app-border)", background: "var(--panel-soft)" }}
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-sm font-semibold text-[var(--accent-strong)]">
                  {user.name?.charAt(0)?.toUpperCase() || "U"}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--app-text)]">{user.name}</p>
                  <p className="truncate text-xs text-[var(--app-muted)]">{user.email}</p>
                </div>
              </div>

              {showBrand && (
                <button
                  type="button"
                  onClick={handleLogout}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border transition-colors hover:bg-red-500/10 hover:text-red-400 sm:h-auto sm:w-auto sm:gap-2 sm:px-4"
                  style={{ borderColor: "var(--app-border)", background: "var(--panel-soft)", color: "var(--app-muted)" }}
                >
                  <FiLogOut className="text-base" />
                  <span className="hidden text-sm font-medium sm:inline">Sign Out</span>
                </button>
              )}
            </>
          )}
        </div>
      </nav>
    </header>
  );
};

export default Navbar;
