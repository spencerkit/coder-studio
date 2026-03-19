import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { createTranslator, type Locale } from "../i18n";
import {
  AuthRequestError,
  clearLastAuthReason,
  fetchAuthStatus,
  getAuthStatusSnapshot,
  getLastAuthReason,
  loginWithPassword,
  subscribeAuthStatus,
  subscribeUnauthorized,
} from "../services/http/auth.service";
import { displayPathName } from "../shared/utils/path";
import type { AuthStatus } from "../types/app";

type AuthGateProps = {
  locale: Locale;
  onSelectLocale: (locale: Locale) => void;
  children: ReactNode;
};

type AuthViewMode =
  | "sign-in"
  | "not-configured"
  | "transport-required"
  | "blocked"
  | "unavailable";

const AUTH_SUCCESS_TRANSITION_MS = 180;

const formatBlockedUntil = (value: string | undefined, locale: Locale) => {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
};

export default function AuthGate({ locale, onSelectLocale, children }: AuthGateProps) {
  const t = useMemo(() => createTranslator(locale), [locale]);
  const [status, setStatus] = useState<AuthStatus>(() => getAuthStatusSnapshot());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(() => getLastAuthReason());
  const [blockedUntil, setBlockedUntil] = useState<string>();

  const applyAuthFailure = (error: unknown) => {
    setStatus((current) => ({
      ...current,
      public_mode: true,
      authenticated: false,
    }));
    if (error instanceof AuthRequestError) {
      setErrorCode(error.code);
      setBlockedUntil(error.blockedUntil);
      return;
    }
    setErrorCode("auth_unavailable");
  };

  const refreshAuthStatus = async () => {
    setRefreshing(true);
    try {
      const next = await fetchAuthStatus();
      setStatus(next);
      setErrorCode(null);
      setBlockedUntil(undefined);
      return next;
    } catch (error) {
      applyAuthFailure(error);
      return null;
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => subscribeAuthStatus((next) => setStatus(next)), []);

  useEffect(
    () =>
      subscribeUnauthorized((reason) => {
        setErrorCode(reason);
        setSubmitting(false);
        setUnlocking(false);
      }),
    [],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchAuthStatus()
      .then((next) => {
        if (!active) return;
        setStatus(next);
        setErrorCode(null);
        setBlockedUntil(undefined);
      })
      .catch((error) => {
        if (!active) return;
        applyAuthFailure(error);
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!unlocking) return;
    const timer = window.setTimeout(() => {
      setUnlocking(false);
    }, AUTH_SUCCESS_TRANSITION_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [unlocking]);

  useEffect(() => {
    if (!status.authenticated) {
      setUnlocking(false);
    }
  }, [status.authenticated]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || !password.trim()) return;
    clearLastAuthReason();
    setSubmitting(true);
    setErrorCode(null);
    setBlockedUntil(undefined);
    if (!status.password_configured) {
      setErrorCode("auth_not_configured");
      setSubmitting(false);
      return;
    }
    try {
      const next = await loginWithPassword(password.trim());
      setStatus(next);
      setPassword("");
      setPasswordVisible(false);
      if (next.authenticated) {
        setUnlocking(true);
      }
    } catch (error) {
      if (error instanceof AuthRequestError) {
        setErrorCode(error.code);
        setBlockedUntil(error.blockedUntil);
      } else {
        setErrorCode("auth_unavailable");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const localeSwitch = (
    <div className="settings-pill-select auth-locale-switch" aria-label={t("languageLabel")}>
      <button
        type="button"
        className={`settings-pill-option ${locale === "zh" ? "active" : ""}`}
        onClick={() => onSelectLocale("zh")}
      >
        中文
      </button>
      <button
        type="button"
        className={`settings-pill-option ${locale === "en" ? "active" : ""}`}
        onClick={() => onSelectLocale("en")}
      >
        English
      </button>
    </div>
  );

  const previewShell = (
    <div className="auth-preview-shell" aria-hidden="true">
      <header className="topbar auth-preview-topbar">
        <div className="topbar-left">
          <div className="app-title auth-preview-brand">
            <span className="auth-preview-dot" />
            <span>CODER STUDIO</span>
          </div>
        </div>
        <div className="topbar-center">
          <div className="topbar-session-strip topbar-workspace-strip auth-preview-tabs">
            <span className="session-top-tab workspace-top-tab active">
              <span className="session-top-dot active" />
              <span className="session-top-label">checkout-api</span>
            </span>
            <span className="session-top-tab workspace-top-tab">
              <span className="session-top-dot idle" />
              <span className="session-top-label">release-note</span>
            </span>
            <span className="session-top-tab workspace-top-tab running-glow">
              <span className="session-top-dot active pulse" />
              <span className="session-top-label">deploy-guard</span>
            </span>
          </div>
        </div>
        <div className="topbar-actions">
          <span className="topbar-tool topbar-tool-wide auth-preview-tool">
            <span>{locale === "zh" ? "操作" : "Actions"}</span>
          </span>
          <span className="topbar-tool auth-preview-tool-square" />
        </div>
      </header>

      <div className="workspace-layout auth-preview-layout">
        <aside className="panel left-panel auth-preview-panel">
          <div className="sidebar-header">
            <span className="sidebar-title">{locale === "zh" ? "会话" : "Sessions"}</span>
          </div>
          <div className="sidebar-content auth-preview-panel-body">
            <span className="auth-preview-label" />
            <span className="auth-preview-line wide" />
            <span className="auth-preview-line" />
            <div className="auth-preview-stack">
              <span className="auth-preview-block" />
              <span className="auth-preview-block" />
              <span className="auth-preview-block" />
            </div>
          </div>
        </aside>

        <div className="v-resizer" data-resize="left" />

        <main className="workspace-main auth-preview-main">
          <div className="auth-preview-main-bar">
            <span className="auth-preview-chip wide" />
            <span className="auth-preview-chip" />
            <span className="auth-preview-chip short" />
          </div>
          <div className="auth-preview-main-grid">
            <span className="auth-preview-surface large" />
            <span className="auth-preview-surface" />
            <span className="auth-preview-surface" />
          </div>
        </main>

        <div className="v-resizer" data-resize="right" />

        <aside className="panel right-panel auth-preview-panel auth-preview-panel-right">
          <div className="panel-header">
            <span className="panel-title">{locale === "zh" ? "终端" : "Terminal"}</span>
          </div>
          <div className="panel-body auth-preview-panel-body">
            <span className="auth-preview-line" />
            <span className="auth-preview-line short" />
            <div className="auth-preview-stack compact">
              <span className="auth-preview-card" />
              <span className="auth-preview-card" />
              <span className="auth-preview-card" />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="app auth-gate-screen" data-theme="dark">
        {previewShell}
        <div className="auth-veil" />
        <div className="auth-stage">
          <section className="panel auth-card auth-card-loading" role="status" aria-live="polite">
            <div className="auth-card-inner">
              <div className="auth-card-bar">
                <div className="auth-badge-stack">
                  <span className="section-kicker">{t("authPublicModeBadge")}</span>
                </div>
                {localeSwitch}
              </div>
              <div className="auth-header">
                <h1>{t("authLoadingTitle")}</h1>
                <p>{t("authLoadingDescription")}</p>
              </div>
              <div className="auth-loading-stack">
                <span className="auth-loading-line wide" />
                <span className="auth-loading-line" />
                <span className="auth-loading-line short" />
              </div>
            </div>
          </section>
        </div>
      </div>
    );
  }

  if (!status.public_mode) {
    return <>{children}</>;
  }

  if (status.authenticated && !unlocking) {
    return <>{children}</>;
  }

  const blockedLabel = formatBlockedUntil(blockedUntil, locale);
  const securityBlocked = status.secure_transport_required && !status.secure_transport_ok;
  const viewMode: AuthViewMode = !status.password_configured || errorCode === "auth_not_configured"
    ? "not-configured"
    : securityBlocked
      ? "transport-required"
      : errorCode === "ip_blocked"
        ? "blocked"
        : errorCode === "auth_unavailable"
          ? "unavailable"
          : "sign-in";

  const inlineMessage =
    errorCode === "invalid_credentials"
      ? t("authInvalidCredentials")
      : errorCode === "session_expired" || errorCode === "session_missing"
        ? t("authSessionExpired")
        : "";

  const helperText = viewMode === "sign-in"
    ? t("authAllowedRootsHint")
    : viewMode === "transport-required"
      ? t("authSecureTransportRequired")
      : viewMode === "blocked"
        ? t("authBlockedUntil", { time: blockedLabel || "—" })
        : viewMode === "unavailable"
          ? t("authUnavailable")
          : t("authSetupHint");
  const passwordDisabled = submitting || refreshing || viewMode !== "sign-in";
  const showStatusPanel = viewMode !== "sign-in";
  const roots = status.allowed_roots.map((root) => ({
    path: root,
    label: displayPathName(root) || root,
  }));

  let statusTitle = "";
  let statusDescription = "";
  let statusTone = "neutral";
  let showRetry = false;

  if (viewMode === "not-configured") {
    statusTitle = t("authNotConfiguredTitle");
    statusDescription = t("authNotConfiguredDescription");
    statusTone = "warning";
    showRetry = true;
  } else if (viewMode === "transport-required") {
    statusTitle = t("authTransportRequiredTitle");
    statusDescription = t("authTransportRequiredDescription");
    statusTone = "warning";
    showRetry = true;
  } else if (viewMode === "blocked") {
    statusTitle = t("authBlockedTitle");
    statusDescription = t("authBlockedDescription", { time: blockedLabel || "—" });
    statusTone = "danger";
  } else if (viewMode === "unavailable") {
    statusTitle = t("authUnavailableTitle");
    statusDescription = t("authUnavailableDescription");
    statusTone = "danger";
    showRetry = true;
  }

  if (status.authenticated && unlocking) {
    return (
      <div className="app auth-gate-screen" data-theme="dark">
        {previewShell}
        <div className="auth-veil" />
        <div className="auth-stage">
          <section className="panel auth-card auth-card-transition" role="status" aria-live="polite">
            <div className="auth-card-inner">
              <div className="auth-card-bar">
                <div className="auth-badge-stack">
                  <span className="section-kicker">{t("authPublicModeBadge")}</span>
                  <span className="auth-state-pill success">{t("authUnlockingBadge")}</span>
                </div>
                {localeSwitch}
              </div>
              <div className="auth-header">
                <h1>{t("authUnlockingTitle")}</h1>
                <p>{t("authUnlockingDescription")}</p>
              </div>
              <div className="surface-progress loading auth-transition-progress" aria-hidden="true">
                <span className="surface-progress-bar" style={{ width: "82%" }} />
              </div>
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="app auth-gate-screen" data-theme="dark">
      {previewShell}
      <div className="auth-veil" />

      <div className="auth-stage">
        <section
          className="panel auth-card auth-card-form"
          role="dialog"
          aria-modal="true"
          aria-labelledby="auth-title"
          aria-describedby="auth-description"
        >
          <div className="auth-card-inner">
            <div className="auth-card-bar">
              <div className="auth-badge-stack">
                <span className="section-kicker">{t("authPublicModeBadge")}</span>
                {viewMode === "transport-required" ? <span className="auth-state-pill warning">HTTPS</span> : null}
                {viewMode === "not-configured" ? <span className="auth-state-pill warning">auth.json</span> : null}
                {viewMode === "blocked" ? <span className="auth-state-pill danger">IP</span> : null}
              </div>
              {localeSwitch}
            </div>

            <div className="auth-header">
              <h1 id="auth-title">{t("authTitle")}</h1>
              <p id="auth-description">{t("authDescription")}</p>
            </div>

            <div className="auth-summary" aria-label={t("authPublicModeBadge")}>
              <div className="auth-summary-item">
                <span>{t("authAllowedRoots")}</span>
                <strong>{status.allowed_roots.length}</strong>
              </div>
              <div className="auth-summary-item">
                <span>{t("authIdleWindow")}</span>
                <strong>{status.session_idle_minutes}m</strong>
              </div>
              <div className="auth-summary-item">
                <span>{t("authSessionWindow")}</span>
                <strong>{status.session_max_hours}h</strong>
              </div>
            </div>

            {showStatusPanel ? (
              <div className={`auth-state-panel ${statusTone}`} role="status" aria-live="polite">
                <div className="auth-state-copy">
                  <div className="section-kicker">{t("authPublicModeBadge")}</div>
                  <h2>{statusTitle}</h2>
                  <p>{statusDescription}</p>
                </div>
                {showRetry ? (
                  <button
                    type="button"
                    className="btn auth-secondary-action"
                    onClick={() => {
                      void refreshAuthStatus();
                    }}
                    disabled={refreshing}
                  >
                    {refreshing ? t("authRefreshing") : t("authRetry")}
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="auth-block">
              <div className="auth-block-header">
                <div>
                  <div className="section-kicker">{t("authAllowedRoots")}</div>
                  <p>{t("authAllowedRootsHint")}</p>
                </div>
              </div>
              <div className="auth-roots-list" role="list" aria-label={t("authAllowedRoots")}>
                {roots.length > 0 ? (
                  roots.map((root) => (
                    <div key={root.path} className="auth-root-item" role="listitem" title={root.path}>
                      <strong>{root.label}</strong>
                      <span>{root.path}</span>
                    </div>
                  ))
                ) : (
                  <p className="auth-root-empty">{t("authAllowedRootsEmpty")}</p>
                )}
              </div>
            </div>

            {viewMode === "sign-in" ? (
              <form className="auth-form" onSubmit={onSubmit}>
                <label className="auth-field">
                  <div className="auth-field-row">
                    <span>{t("authPasswordLabel")}</span>
                    <button
                      type="button"
                      className="auth-visibility-toggle"
                      onClick={() => setPasswordVisible((current) => !current)}
                      disabled={passwordDisabled}
                      aria-label={passwordVisible ? t("authHidePassword") : t("authShowPassword")}
                      aria-pressed={passwordVisible}
                    >
                      {passwordVisible ? t("authHidePassword") : t("authShowPassword")}
                    </button>
                  </div>

                  <div className="auth-input-shell">
                    <input
                      autoFocus
                      autoComplete="current-password"
                      className="auth-input"
                      type={passwordVisible ? "text" : "password"}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder={t("authPasswordPlaceholder")}
                      disabled={passwordDisabled}
                      aria-invalid={errorCode === "invalid_credentials"}
                    />
                  </div>
                </label>

                <div className={`auth-message-slot ${inlineMessage ? "has-message" : ""}`} aria-live="polite">
                  {inlineMessage ? (
                    <div className="auth-message error" role="alert">
                      {inlineMessage}
                    </div>
                  ) : null}
                </div>

                <div className="auth-form-footer">
                  <p className="auth-support-copy">{helperText}</p>
                  <button
                    className="btn primary btn-lg auth-submit"
                    type="submit"
                    disabled={submitting || !password.trim()}
                  >
                    {submitting ? t("authLoggingIn") : t("authLogin")}
                  </button>
                </div>
              </form>
            ) : (
              <div className="auth-form-footer auth-form-footer-static">
                <p className="auth-support-copy">{helperText}</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
