import { Check, ChevronDown, CircleAlert, LoaderCircle, Monitor, Terminal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Popover, ProgressBar } from "../../../components/ui";
import { useTranslation } from "../../../lib/i18n";
import styles from "./environment-switcher.module.css";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function EnvironmentSwitcher() {
  const t = useTranslation();
  const api = window.coderStudioDesktop;
  const [open, setOpen] = useState(false);
  const [environments, setEnvironments] = useState<DesktopEnvironmentSummary[]>([]);
  const [active, setActive] = useState<DesktopEnvironmentSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [progress, setProgress] = useState<DesktopEnvironmentProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const [nextEnvironments, nextActive] = await Promise.all([
        api.listEnvironments(),
        api.getActiveEnvironment(),
      ]);
      setEnvironments(nextEnvironments);
      setActive(nextActive);
    } catch (refreshError) {
      setError(getErrorMessage(refreshError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!api || api.platform !== "win32") return;
    void refresh();
    return api.onEnvironmentProgress((nextProgress) => {
      setProgress(nextProgress);
      setOpeningId(nextProgress.environmentId);
    });
  }, [api]);

  const groups = useMemo(
    () => [
      {
        id: "local",
        label: t("desktop_environment.local"),
        items: environments.filter((environment) => environment.kind === "native"),
      },
      {
        id: "wsl",
        label: t("desktop_environment.wsl"),
        items: environments.filter((environment) => environment.kind === "wsl"),
      },
    ],
    [environments, t]
  );

  if (!api || api.platform !== "win32") return null;

  const openEnvironment = async (environment: DesktopEnvironmentSummary) => {
    if (environment.active || openingId) return;
    setOpeningId(environment.id);
    setProgress({
      environmentId: environment.id,
      phase: "checking",
      message: t("desktop_environment.checking"),
    });
    setError(null);
    try {
      await api.openEnvironment(environment.id);
      setOpeningId(null);
      setProgress(null);
      setOpen(false);
    } catch (openError) {
      setError(getErrorMessage(openError));
      setOpeningId(null);
      setProgress(null);
    }
  };

  return (
    <Popover
      title={t("desktop_environment.title")}
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) void refresh();
      }}
      placement="bottom-start"
      contentClassName={styles.popover}
      content={
        <div className={styles.menu}>
          <div className={styles.heading}>
            <span>{t("desktop_environment.select")}</span>
            {loading ? (
              <LoaderCircle aria-hidden="true" className={styles.spinner} size={14} />
            ) : null}
          </div>

          {groups.map((group) =>
            group.items.length > 0 ? (
              <section className={styles.group} key={group.id} aria-label={group.label}>
                <div className={styles.groupLabel}>{group.label}</div>
                {group.items.map((environment) => {
                  const unavailable =
                    environment.status === "unavailable" || environment.status === "error";
                  const pending = openingId === environment.id;
                  return (
                    <button
                      aria-current={environment.active ? "true" : undefined}
                      className={styles.item}
                      disabled={environment.active || unavailable || Boolean(openingId)}
                      key={environment.id}
                      onClick={() => void openEnvironment(environment)}
                      title={environment.message}
                      type="button"
                    >
                      <span className={styles.itemIcon} aria-hidden="true">
                        {environment.kind === "native" ? (
                          <Monitor size={15} />
                        ) : (
                          <Terminal size={15} />
                        )}
                      </span>
                      <span className={styles.itemText}>
                        <span className={styles.itemLabel}>{environment.label}</span>
                        <span className={styles.itemStatus}>
                          {pending
                            ? t("desktop_environment.preparing")
                            : environment.active
                              ? t("desktop_environment.current_window")
                              : t(`desktop_environment.status.${environment.status}`)}
                        </span>
                      </span>
                      {environment.active ? <Check aria-hidden="true" size={15} /> : null}
                      {unavailable ? <CircleAlert aria-hidden="true" size={15} /> : null}
                    </button>
                  );
                })}
              </section>
            ) : null
          )}

          {progress ? (
            <div className={styles.progress} aria-live="polite">
              <div className={styles.progressLabel}>{progress.message}</div>
              <ProgressBar
                aria-label={progress.message}
                indeterminate={progress.percent === undefined}
                max={100}
                tone="info"
                value={progress.percent ?? 0}
              />
            </div>
          ) : null}
          {error ? (
            <div className={styles.error} role="alert">
              <CircleAlert aria-hidden="true" size={14} />
              <span>{error}</span>
            </div>
          ) : null}
        </div>
      }
    >
      <button aria-label={t("desktop_environment.title")} className={styles.trigger} type="button">
        {active?.kind === "wsl" ? (
          <Terminal aria-hidden="true" size={14} />
        ) : (
          <Monitor aria-hidden="true" size={14} />
        )}
        <span className={styles.triggerLabel}>
          {active?.label ?? t("desktop_environment.local_windows")}
        </span>
        {openingId ? (
          <LoaderCircle aria-hidden="true" className={styles.spinner} size={13} />
        ) : (
          <ChevronDown aria-hidden="true" size={13} />
        )}
      </button>
    </Popover>
  );
}
