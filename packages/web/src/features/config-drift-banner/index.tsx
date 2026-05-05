/**
 * Config Drift Banner
 *
 * Surfaces any interference detected in `~/.codex/config.toml` (top-level
 * `notify = [...]`, `[features] codex_hooks = true`) so the user can clean
 * it up with one click. The server never modifies these files without
 * consent — this banner is the consent UI.
 *
 * The banner is polled via `settings.get`:
 *   - once on mount (after WS connects)
 *   - again after a successful cleanup, so it can disappear
 *
 * Findings are stable (same id ↔ same issue), so React keying by `id` is
 * safe even while the user toggles checkboxes.
 */

import { useAtomValue } from "jotai";
import { AlertTriangle, ChevronDown, ChevronUp, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { connectionStatusAtom, dispatchCommandAtom } from "../../atoms/connection";
import { useViewport } from "../../hooks/use-viewport";
import { useTranslation } from "../../lib/i18n";

type FindingId = "toml_notify" | "toml_codex_hooks";

interface Finding {
  id: FindingId;
  type: FindingId;
  severity: "warn" | "info";
  startLine: number;
  endLine: number;
  snippet: string;
  message: string;
}

interface CodexAudit {
  configPath: string;
  exists: boolean;
  findings: Finding[];
}

interface SettingsPayload {
  externalConfigAudit?: { codex?: CodexAudit } | null;
}

interface CleanupResult {
  removed: FindingId[];
  backupPath: string | null;
  noop: boolean;
  audit?: { codex?: CodexAudit } | null;
}

interface ConfigDriftBannerProps {
  variant?: "global" | "embedded";
  showLoadError?: boolean;
}

export function ConfigDriftBanner({
  variant = "global",
  showLoadError = true,
}: ConfigDriftBannerProps) {
  const t = useTranslation();
  const navigate = useNavigate();
  const isMobile = useViewport() === "mobile";
  const auditLoadFailedUnknown = t("codex_audit.load_failed_unknown");
  const dispatch = useAtomValue(dispatchCommandAtom);
  const connectionStatus = useAtomValue(connectionStatusAtom);

  const [audit, setAudit] = useState<CodexAudit | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<Set<FindingId>>(new Set());
  const [dismissed, setDismissed] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Load once WS is up. Re-run if the connection drops and comes back
  // (reconnect → user may have edited their config in the meantime).
  useEffect(() => {
    if (connectionStatus !== "connected") return;

    let cancelled = false;
    const run = async () => {
      const result = await dispatch<SettingsPayload>("settings.get", {});
      if (cancelled) return;
      if (!result.ok || !result.data) {
        setAudit(null);
        setSelected(new Set());
        setLoadError(result.error?.message ?? auditLoadFailedUnknown);
        return;
      }
      const codex = result.data.externalConfigAudit?.codex ?? null;
      setLoadError(null);
      setAudit(codex);
      // Default: all findings selected for cleanup, so the primary button
      // does the obvious thing for users who just want the warning gone.
      setSelected(new Set((codex?.findings ?? []).map((f) => f.id)));
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [auditLoadFailedUnknown, connectionStatus, dispatch, refreshKey]);

  const hasFindings = !!audit && audit.findings.length > 0;
  const isCompactMobileGlobal = isMobile && variant === "global";
  const rootClassName = [
    "config-drift-banner",
    variant === "embedded" ? "config-drift-banner--embedded" : "",
    isCompactMobileGlobal ? "config-drift-banner--mobile-compact" : "",
    loadError ? "config-drift-banner--error" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const toggleSelected = useCallback((id: FindingId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const runCleanup = useCallback(async () => {
    if (selected.size === 0 || !audit) return;
    setCleaning(true);
    setNotice(null);
    try {
      const result = await dispatch<CleanupResult>("settings.cleanupCodexConfig", {
        removeIds: Array.from(selected),
      });
      if (!result.ok || !result.data) {
        setNotice(
          t("codex_audit.cleanup_failed") +
            (result.error?.message ? `: ${result.error.message}` : "")
        );
        return;
      }
      const nextAudit = result.data.audit?.codex ?? null;
      setAudit(nextAudit);
      setSelected(new Set((nextAudit?.findings ?? []).map((f) => f.id)));
      if (result.data.backupPath) {
        setNotice(
          t("codex_audit.cleanup_done_with_backup", {
            path: result.data.backupPath,
          })
        );
      } else if (result.data.noop) {
        setNotice(t("codex_audit.cleanup_noop"));
      } else {
        setNotice(t("codex_audit.cleanup_done"));
      }
    } finally {
      setCleaning(false);
    }
  }, [audit, dispatch, selected, t]);

  const primaryLabel = useMemo(() => {
    if (cleaning) return t("codex_audit.cleaning");
    if (selected.size === 0) return t("codex_audit.cleanup_select");
    return t("codex_audit.cleanup_action", { count: String(selected.size) });
  }, [cleaning, selected.size, t]);

  if (dismissed) return null;
  if (loadError && showLoadError && isCompactMobileGlobal) {
    return (
      <div className={rootClassName} role="alert">
        <div className="config-drift-banner__row config-drift-banner__row--compact">
          <AlertTriangle size={16} className="config-drift-banner__icon" aria-hidden />
          <span className="config-drift-banner__title">{t("codex_audit.load_failed_title")}</span>
          <div className="config-drift-banner__spacer" />
          <button
            type="button"
            className="config-drift-banner__summary-action"
            onClick={() => setRefreshKey((value) => value + 1)}
          >
            {t("action.refresh")}
          </button>
          <button
            type="button"
            className="config-drift-banner__dismiss"
            onClick={() => setDismissed(true)}
            aria-label={t("action.close")}
          >
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }
  if (loadError && showLoadError) {
    return (
      <div className={rootClassName} role="alert">
        <div className="config-drift-banner__row">
          <AlertTriangle size={16} className="config-drift-banner__icon" aria-hidden />
          <span className="config-drift-banner__title">{t("codex_audit.load_failed_title")}</span>
          <span className="config-drift-banner__message">{loadError}</span>
          <div className="config-drift-banner__spacer" />
          <button
            type="button"
            className="config-drift-banner__toggle"
            onClick={() => setRefreshKey((value) => value + 1)}
          >
            <span>{t("action.refresh")}</span>
          </button>
          <button
            type="button"
            className="config-drift-banner__dismiss"
            onClick={() => setDismissed(true)}
            aria-label={t("action.close")}
          >
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }
  if (loadError) return null;
  if (!hasFindings) return null;

  if (isCompactMobileGlobal) {
    return (
      <div className={rootClassName} role="alert">
        <div className="config-drift-banner__row config-drift-banner__row--compact">
          <AlertTriangle size={16} className="config-drift-banner__icon" aria-hidden />
          <span className="config-drift-banner__title">
            {t("codex_audit.title", {
              count: String(audit!.findings.length),
            })}
          </span>
          <div className="config-drift-banner__spacer" />
          <button
            type="button"
            className="config-drift-banner__summary-action"
            onClick={() => navigate("/settings")}
          >
            {t("settings.title")}
          </button>
          <button
            type="button"
            className="config-drift-banner__dismiss"
            onClick={() => setDismissed(true)}
            aria-label={t("action.close")}
          >
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={rootClassName} role="alert">
      <div className="config-drift-banner__row">
        <AlertTriangle size={16} className="config-drift-banner__icon" aria-hidden />
        <span className="config-drift-banner__title">
          {t("codex_audit.title", {
            count: String(audit!.findings.length),
          })}
        </span>
        <span className="config-drift-banner__path" title={audit!.configPath}>
          {audit!.configPath}
        </span>
        <div className="config-drift-banner__spacer" />
        <button
          type="button"
          className="config-drift-banner__toggle"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? (
            <>
              <span>{t("codex_audit.collapse")}</span>
              <ChevronUp size={14} />
            </>
          ) : (
            <>
              <span>{t("codex_audit.show_details")}</span>
              <ChevronDown size={14} />
            </>
          )}
        </button>
        <button
          type="button"
          className="config-drift-banner__primary"
          onClick={runCleanup}
          disabled={cleaning || selected.size === 0}
        >
          {primaryLabel}
        </button>
        <button
          type="button"
          className="config-drift-banner__dismiss"
          onClick={() => setDismissed(true)}
          aria-label={t("action.close")}
        >
          <X size={14} />
        </button>
      </div>

      {expanded && (
        <ul className="config-drift-banner__list">
          {audit!.findings.map((finding) => (
            <li key={finding.id} className="config-drift-banner__item">
              <label className="config-drift-banner__checkbox">
                <input
                  type="checkbox"
                  checked={selected.has(finding.id)}
                  onChange={() => toggleSelected(finding.id)}
                />
                <span className="config-drift-banner__item-title">
                  {t(`codex_audit.finding.${finding.type}`)}
                  <span className="config-drift-banner__item-line">
                    :{finding.startLine}
                    {finding.endLine !== finding.startLine ? `-${finding.endLine}` : ""}
                  </span>
                </span>
              </label>
              <p className="config-drift-banner__item-message">{finding.message}</p>
              <pre className="config-drift-banner__snippet">{finding.snippet}</pre>
            </li>
          ))}
        </ul>
      )}

      {notice && <div className="config-drift-banner__notice">{notice}</div>}
    </div>
  );
}
