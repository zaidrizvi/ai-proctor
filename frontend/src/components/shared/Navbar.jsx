import { Link, useLocation, useNavigate } from "react-router-dom";
import { FiLogOut, FiMenu, FiMoon, FiShield, FiSun } from "react-icons/fi";
import { useAuth } from "../../context/AuthContext.jsx";
import { useTheme } from "../../context/ThemeContext.jsx";

const Navbar = ({ showMenuButton = false, onMenuClick }) => {
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

  return (
    <header className="sticky top-0 z-30 px-4 pt-4 sm:px-6 lg:px-8">
      <nav
        className="mx-auto flex items-center justify-between gap-3 rounded-[30px] border px-4 py-3 sm:px-5"
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
              className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border lg:hidden"
              style={{ borderColor: "var(--app-border)", background: "var(--panel-soft)", color: "var(--app-text)" }}
            >
              <FiMenu className="text-lg" />
            </button>
          )}

          <button
            type="button"
            onClick={() => navigate(user ? (user.role === "admin" ? "/admin" : "/student") : "/")}
            className="flex min-w-0 items-center gap-3 text-left"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--accent-strong)] text-white shadow-lg shadow-sky-500/20">
              <FiShield className="text-lg" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-[0.18em] uppercase text-[var(--app-muted)]">
                AIProctor
              </p>
              <p className="truncate text-sm text-[var(--app-subtle)]">
                {user ? `${user.role === "admin" ? "Admin" : "Student"} workspace` : "Secure exam platform"}
              </p>
            </div>
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
            className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border transition-transform hover:scale-[1.02]"
            style={{ borderColor: "var(--app-border)", background: "var(--panel-soft)", color: "var(--app-text)" }}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            {theme === "dark" ? <FiSun className="text-lg" /> : <FiMoon className="text-lg" />}
          </button>

          {user && (
            <>
              <div className="hidden min-w-0 text-right sm:block">
                <p className="truncate text-sm font-medium text-[var(--app-text)]">{user.name}</p>
                <p className="truncate text-xs text-[var(--app-muted)]">{user.email}</p>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border transition-colors hover:bg-red-500/10 hover:text-red-400 sm:h-auto sm:w-auto sm:gap-2 sm:px-4"
                style={{ borderColor: "var(--app-border)", background: "var(--panel-soft)", color: "var(--app-muted)" }}
              >
                <FiLogOut className="text-base" />
                <span className="hidden text-sm font-medium sm:inline">Sign Out</span>
              </button>
            </>
          )}
        </div>
      </nav>
    </header>
  );
};

export default Navbar;
