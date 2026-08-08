import { Check, ChevronDown, CircleAlert, LoaderCircle, Monitor, Terminal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Popover, ProgressBar } from "../../../components/ui";
import { useTranslation } from "../../../lib/i18n";
import styles from "./environment-switcher.module.css";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface EnvironmentLaunchFailure {
  environment: DesktopEnvironmentSummary;
  message: string;
}

export type EnvironmentSwitcherVariant = "topbar" | "welcome";

interface EnvironmentSwitcherProps {
  variant?: EnvironmentSwitcherVariant;
}

export function EnvironmentSwitcher({ variant = "topbar" }: EnvironmentSwitcherProps) {
  const t = useTranslation();
  const api = window.coderStudioDesktop;
  const [open, setOpen] = useState(false);
  const [environments, setEnvironments] = useState<DesktopEnvironmentSummary[]>([]);
  const [active, setActive] = useState<DesktopEnvironmentSummary | null>(null);
  const [loading, setLoading] = useState(api?.platform === "win32");
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [progress, setProgress] = useState<DesktopEnvironmentProgress | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [launchFailure, setLaunchFailure] = useState<EnvironmentLaunchFailure | null>(null);

  const refresh = async () => {
    if (!api) return;
    setLoading(true);
    setRefreshError(null);
    try {
      const [nextEnvironments, nextActive] = await Promise.all([
        api.listEnvironments(),
        api.getActiveEnvironment(),
      ]);
      setEnvironments(nextEnvironments);
      setActive(nextActive);
    } catch (refreshError) {
      setRefreshError(getErrorMessage(refreshError));
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
    setLaunchFailure(null);
    setOpeningId(environment.id);
    setProgress({
      environmentId: environment.id,
      phase: "checking",
      message: t("desktop_environment.checking"),
    });
    try {
      await api.openEnvironment(environment.id);
      setLaunchFailure(null);
      setOpeningId(null);
      setProgress(null);
      setOpen(false);
    } catch (openError) {
      setLaunchFailure({
        environment,
        message: getErrorMessage(openError),
      });
      setOpeningId(null);
      setProgress(null);
    }
  };

  const openingEnvironment = openingId
    ? (environments.find((environment) => environment.id === openingId) ?? null)
    : null;

  const menu = (
    <div className={styles.menu}>
      <div className={styles.heading}>
        <span>{t("desktop_environment.select")}</span>
        {loading ? <LoaderCircle aria-hidden="true" className={styles.spinner} size={14} /> : null}
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
                    {environment.kind === "native" ? <Monitor size={15} /> : <Terminal size={15} />}
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
                    {environment.runtimeVersion ? (
                      <span className={styles.runtimeVersion}>
                        Product Runtime v{environment.runtimeVersion}
                      </span>
                    ) : null}
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
      {launchFailure?.message || refreshError ? (
        <div className={styles.error} role="alert">
          <CircleAlert aria-hidden="true" size={14} />
          <span>{launchFailure?.message ?? refreshError}</span>
        </div>
      ) : null}
    </div>
  );

  const topbarTrigger = (
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
  );

  const welcomeLabel = openingEnvironment
    ? t("desktop_environment.opening_named", { environment: openingEnvironment.label })
    : launchFailure
      ? t("desktop_environment.open_failed_named", {
          environment: launchFailure.environment.label,
        })
      : (active?.label ?? t("desktop_environment.local_windows"));
  const checkingEnvironment = loading && active === null;
  const activeLabel = active?.label ?? t("desktop_environment.local_windows");

  const welcomeTrigger = (
    <button
      aria-label={t("desktop_environment.open_another_from", {
        environment: activeLabel,
      })}
      className={styles.welcomeTrigger}
      type="button"
    >
      <span className={styles.welcomeIcon} aria-hidden="true">
        {active?.kind === "wsl" ? <Terminal size={15} /> : <Monitor size={15} />}
      </span>
      <span className={styles.welcomeText}>
        <span className={styles.welcomeEyebrow}>
          {checkingEnvironment
            ? t("desktop_environment.checking")
            : openingEnvironment || launchFailure
              ? welcomeLabel
              : t("desktop_environment.current_window_environment")}
        </span>
        <span className={styles.welcomeEnvironment} title={activeLabel}>
          {activeLabel}
        </span>
      </span>
      {checkingEnvironment || openingEnvironment ? (
        <LoaderCircle aria-hidden="true" className={styles.spinner} size={14} />
      ) : (
        <span className={styles.welcomeAction}>{t("desktop_environment.select")}</span>
      )}
    </button>
  );

  const selector = (
    <Popover
      title={t("desktop_environment.title")}
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) void refresh();
      }}
      placement="bottom-start"
      contentClassName={styles.popover}
      content={menu}
    >
      {variant === "welcome" ? welcomeTrigger : topbarTrigger}
    </Popover>
  );

  if (variant === "topbar") return selector;

  return (
    <div
      className={styles.welcomeShell}
      data-testid="welcome-environment-context"
      aria-live="polite"
    >
      <div className={styles.welcomeSelector}>{selector}</div>
      {launchFailure ? (
        <button
          aria-label={t("desktop_environment.retry_named", {
            environment: launchFailure.environment.label,
          })}
          className={styles.retry}
          onClick={() => void openEnvironment(launchFailure.environment)}
          type="button"
        >
          {t("action.retry")}
        </button>
      ) : null}
    </div>
  );
}
