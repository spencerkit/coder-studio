import type { AgentSkillTargetEntry, SkillMountRelation } from "@coder-studio/core";
import { ChevronDown, ChevronRight } from "lucide-react";
import { type FC, type ReactNode, useEffect, useMemo } from "react";
import { Button, IconButton, Notice, Tag, ThemedIcon, Tooltip } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import type { SkillLibraryListItem, SkillSearchResultItem } from "../../actions/use-skills-panel";
import { useSkillsPanel } from "../../actions/use-skills-panel";

interface SkillsPanelProps {
  workspaceId: string;
  refreshToken?: number;
}

type Translate = (key: string, params?: Record<string, string | number>) => string;
type SkillTargetSummaryState = "mounted" | "unmounted" | "unconfigured";

interface SkillTargetSummary {
  providerId: string;
  displayName: string;
  abbreviation: string;
  summaryState: SkillTargetSummaryState;
  summaryLabel: string;
  reasonLabel: string;
  targetPathLabel: string;
  configured: boolean;
  enabled: boolean;
  mounted: boolean;
  needsRepair: boolean;
}

const BUILT_IN_PROVIDER_ABBREVIATIONS: Record<string, string> = {
  claude: "CC",
  codex: "CX",
  gemini: "GM",
};

function colorForSummaryState(
  state: SkillTargetSummaryState
): "green" | "amber" | "pink" | "neutral" {
  switch (state) {
    case "mounted":
      return "green";
    case "unmounted":
      return "amber";
    case "unconfigured":
      return "pink";
    default:
      return "neutral";
  }
}

function compareSkillLike(
  left: Pick<SkillLibraryListItem, "displayName" | "slug">,
  right: Pick<SkillLibraryListItem, "displayName" | "slug">
) {
  return (
    left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" }) ||
    left.slug.localeCompare(right.slug, undefined, { sensitivity: "base" })
  );
}

function sortLibraryItems(items: SkillLibraryListItem[]) {
  return [...items].sort(compareSkillLike);
}

function sortSearchItems(items: SkillSearchResultItem[]) {
  return [...items].sort((left, right) => {
    if (left.installed !== right.installed) {
      return left.installed ? -1 : 1;
    }

    return compareSkillLike(left, right);
  });
}

function providerAbbreviation(target: Pick<AgentSkillTargetEntry, "providerId" | "displayName">) {
  const builtIn = BUILT_IN_PROVIDER_ABBREVIATIONS[target.providerId];
  if (builtIn) {
    return builtIn;
  }

  const initials = target.displayName
    .split(/\s+/)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2);

  return initials || target.providerId.slice(0, 2).toUpperCase();
}

function summaryStateForTarget(
  target: Pick<AgentSkillTargetEntry, "skillDir" | "lastHealthState">,
  relation?: Pick<SkillMountRelation, "enabled" | "status">
): SkillTargetSummaryState {
  if (!target.skillDir || target.lastHealthState === "unconfigured") {
    return "unconfigured";
  }

  if (relation?.enabled && relation.status === "mounted") {
    return "mounted";
  }

  return "unmounted";
}

function summaryStateLabel(t: Translate, state: SkillTargetSummaryState) {
  return t(`skills.summary_state.${state}`);
}

function summaryReasonLabel(
  t: Translate,
  target: Pick<AgentSkillTargetEntry, "skillDir" | "lastHealthError" | "lastHealthState">,
  relation?: Pick<SkillMountRelation, "enabled" | "lastError" | "status" | "targetPath">
) {
  if (target.lastHealthError) {
    return target.lastHealthError;
  }

  if (relation?.lastError) {
    return relation.lastError;
  }

  const state = summaryStateForTarget(target, relation);
  if (state === "mounted") {
    return t("skills.summary_reason.mounted_path", {
      path: relation?.targetPath ?? target.skillDir ?? "",
    });
  }

  if (state === "unconfigured") {
    return t("skills.summary_reason.unconfigured");
  }

  switch (relation?.status) {
    case "stale":
      return t("skills.summary_reason.relation_stale");
    case "missing_source":
      return t("skills.summary_reason.relation_missing_source");
    case "missing_target":
      return t("skills.summary_reason.relation_missing_target");
    case "failed":
      return t("skills.summary_reason.relation_failed");
    default:
      return t("skills.summary_reason.unmounted_generic");
  }
}

function buildTargetSummaries(
  t: Translate,
  targets: Array<AgentSkillTargetEntry & { mountedSkillCount: number }>,
  mounts: SkillMountRelation[]
): SkillTargetSummary[] {
  return targets.map((target) => {
    const relation = mounts.find((item) => item.providerId === target.providerId);
    const summaryState = summaryStateForTarget(target, relation);

    return {
      providerId: target.providerId,
      displayName: target.displayName,
      abbreviation: providerAbbreviation(target),
      summaryState,
      summaryLabel: summaryStateLabel(t, summaryState),
      reasonLabel: summaryReasonLabel(t, target, relation),
      targetPathLabel: relation?.targetPath ?? target.skillDir ?? t("skills.targets.unconfigured"),
      configured: Boolean(target.skillDir),
      enabled: Boolean(relation?.enabled),
      mounted: Boolean(relation?.enabled && relation.status === "mounted"),
      needsRepair: Boolean(relation?.enabled && relation.status !== "mounted"),
    };
  });
}

interface SkillsSectionHeaderProps {
  actions?: ReactNode;
  count?: number;
  isExpanded: boolean;
  panelId: string;
  title: string;
  toggleLabel: string;
  onToggleExpanded: () => void;
}

function SkillsSectionHeader({
  actions,
  count,
  isExpanded,
  panelId,
  title,
  toggleLabel,
  onToggleExpanded,
}: SkillsSectionHeaderProps) {
  return (
    <div className="workspace-sidebar-section__header">
      <div className="workspace-sidebar-section__header-main">
        <Tooltip content={toggleLabel}>
          <IconButton
            aria-controls={panelId}
            aria-expanded={isExpanded}
            aria-label={toggleLabel}
            className="workspace-sidebar-section__chevron"
            icon={isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            onClick={onToggleExpanded}
            size="sm"
          />
        </Tooltip>
        <h2 className="workspace-sidebar-section__title">{title}</h2>
        {count === undefined ? null : (
          <span className="workspace-sidebar-section__count">{count}</span>
        )}
      </div>
      {actions ? (
        <div className="workspace-sidebar-panel__actions workspace-sidebar-section__actions">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

export const SkillsPanel: FC<SkillsPanelProps> = ({ workspaceId, refreshToken }) => {
  const t = useTranslation();
  const {
    errorMessage,
    installSkill,
    installingSkillSlugs,
    library,
    loadingLibrary,
    loadingSearch,
    mountSkill,
    mountsBySkillSlug,
    panelState,
    refreshHealth,
    repairSkill,
    runSearch,
    searchResults,
    setPanelState,
    targets,
    uninstallSkill,
    unmountSkill,
  } = useSkillsPanel(workspaceId);
  const sortedLibrary = useMemo(() => sortLibraryItems(library), [library]);
  const sortedSearchResults = useMemo(() => sortSearchItems(searchResults), [searchResults]);
  const libraryPanelId = `skills-library-${workspaceId}`;
  const discoverPanelId = `skills-discover-${workspaceId}`;
  const libraryToggleLabel = panelState.libraryCollapsed
    ? t("skills.library_expand_label")
    : t("skills.library_collapse_label");
  const discoverToggleLabel = panelState.discoverCollapsed
    ? t("skills.discover_expand_label")
    : t("skills.discover_collapse_label");
  const discoverCount =
    panelState.resolvedQuery && !loadingSearch ? sortedSearchResults.length : undefined;
  const libraryCount = loadingLibrary ? undefined : sortedLibrary.length;

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void runSearch(panelState.query);
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [panelState.query, runSearch]);

  useEffect(() => {
    void refreshHealth();
  }, [refreshHealth, refreshToken]);

  return (
    <>
      <div className="workspace-sidebar-view skills-panel">
        <div className="workspace-sidebar-panel__body workspace-sidebar-panel__body--stacked skills-panel__body">
          <section className="workspace-sidebar-section workspace-sidebar-section--fill">
            <SkillsSectionHeader
              actions={
                <button
                  type="button"
                  className="workspace-sidebar-section__action"
                  onClick={() => void refreshHealth()}
                >
                  {t("skills.scan")}
                </button>
              }
              count={libraryCount}
              isExpanded={!panelState.libraryCollapsed}
              panelId={libraryPanelId}
              title={t("skills.library_title")}
              toggleLabel={libraryToggleLabel}
              onToggleExpanded={() =>
                setPanelState((current) => ({
                  ...current,
                  libraryCollapsed: !current.libraryCollapsed,
                }))
              }
            />

            {!panelState.libraryCollapsed ? (
              loadingLibrary ? (
                <p className="workspace-search-panel__state" id={libraryPanelId}>
                  {t("common.loading")}
                </p>
              ) : sortedLibrary.length === 0 ? (
                <div className="skills-panel__empty" id={libraryPanelId}>
                  <p className="workspace-search-panel__state">{t("skills.empty_library")}</p>
                </div>
              ) : (
                <div className="skills-panel__library-list" id={libraryPanelId}>
                  {sortedLibrary.map((skill) => {
                    const mounts = mountsBySkillSlug[skill.slug] ?? [];
                    const sourceLabel =
                      skill.source === "builtin" ? t("workspace.skills.source.builtin") : null;
                    const expanded = panelState.expandedSkillSlugs.includes(skill.slug);
                    const toggleLabel = expanded
                      ? t("skills.skill_row_collapse_label", { name: skill.displayName })
                      : t("skills.skill_row_expand_label", { name: skill.displayName });
                    const targetSummaries = buildTargetSummaries(t, targets, mounts);
                    return (
                      <article
                        key={skill.slug}
                        className="skills-panel__list-item workspace-sidebar-row"
                      >
                        <div className="skills-panel__row-head">
                          <div className="skills-panel__card-copy">
                            <div className="skills-panel__card-head">
                              <h3 className="skills-panel__card-title">{skill.displayName}</h3>
                            </div>
                            {sourceLabel ? (
                              <p className="skills-panel__card-slug">
                                {skill.slug} · {sourceLabel}
                              </p>
                            ) : null}
                            {skill.description ? (
                              <Tooltip content={skill.description}>
                                <p className="skills-panel__card-description skills-panel__card-description--truncated">
                                  {skill.description}
                                </p>
                              </Tooltip>
                            ) : null}
                          </div>

                          <div className="skills-panel__inline-actions">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void uninstallSkill(skill.slug, false)}
                            >
                              {t("skills.uninstall")}
                            </Button>
                          </div>
                        </div>

                        <button
                          type="button"
                          className="skills-panel__summary-row"
                          aria-expanded={expanded}
                          aria-label={toggleLabel}
                          onClick={() =>
                            setPanelState((current) => ({
                              ...current,
                              expandedSkillSlugs: current.expandedSkillSlugs.includes(skill.slug)
                                ? current.expandedSkillSlugs.filter((slug) => slug !== skill.slug)
                                : [...current.expandedSkillSlugs, skill.slug],
                            }))
                          }
                        >
                          <span className="skills-panel__summary-toggle-icon" aria-hidden="true">
                            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </span>
                          <span className="skills-panel__summary-tokens">
                            {targetSummaries.map((summary) => (
                              <Tooltip
                                key={`${skill.slug}:${summary.providerId}`}
                                content={
                                  <div className="skills-panel__summary-tooltip">
                                    <p className="skills-panel__summary-tooltip-title">
                                      {summary.displayName}
                                    </p>
                                    <p className="skills-panel__summary-tooltip-line">
                                      {summary.summaryLabel}
                                    </p>
                                    <p className="skills-panel__summary-tooltip-line">
                                      {summary.reasonLabel}
                                    </p>
                                  </div>
                                }
                              >
                                <span
                                  className={`skills-panel__summary-token skills-panel__summary-token--${summary.summaryState}`}
                                  onMouseDown={(event) => event.stopPropagation()}
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  {summary.abbreviation}
                                </span>
                              </Tooltip>
                            ))}
                          </span>
                        </button>

                        {expanded ? (
                          <div className="skills-panel__target-details">
                            {targetSummaries.map((summary) => {
                              return (
                                <div
                                  key={`${skill.slug}:${summary.providerId}`}
                                  className="skills-panel__target-row"
                                >
                                  <div className="skills-panel__target-copy">
                                    <div className="skills-panel__target-head">
                                      <span className="skills-panel__target-name">
                                        {summary.displayName}
                                      </span>
                                      <Tag
                                        color={colorForSummaryState(summary.summaryState)}
                                        caps={false}
                                      >
                                        {summary.summaryLabel}
                                      </Tag>
                                    </div>
                                    <p className="skills-panel__target-path">
                                      {summary.mounted
                                        ? summary.targetPathLabel
                                        : summary.reasonLabel}
                                    </p>
                                  </div>

                                  <div className="skills-panel__target-actions">
                                    {summary.summaryState ===
                                    "unconfigured" ? null : summary.enabled ? (
                                      <>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() =>
                                            void unmountSkill(summary.providerId, skill.slug)
                                          }
                                        >
                                          {t("skills.unmount")}
                                        </Button>
                                        {summary.needsRepair ? (
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() =>
                                              void repairSkill(summary.providerId, skill.slug)
                                            }
                                          >
                                            {t("skills.repair")}
                                          </Button>
                                        ) : null}
                                      </>
                                    ) : (
                                      <Button
                                        size="sm"
                                        onClick={() =>
                                          void mountSkill(summary.providerId, skill.slug)
                                        }
                                      >
                                        {t("skills.mount")}
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              )
            ) : null}
          </section>

          <section className="workspace-sidebar-section skills-panel__discover">
            <SkillsSectionHeader
              count={discoverCount}
              isExpanded={!panelState.discoverCollapsed}
              panelId={discoverPanelId}
              title={t("skills.discover_title")}
              toggleLabel={discoverToggleLabel}
              onToggleExpanded={() =>
                setPanelState((current) => ({
                  ...current,
                  discoverCollapsed: !current.discoverCollapsed,
                }))
              }
            />

            {!panelState.discoverCollapsed ? (
              <div className="skills-panel__discover-body" id={discoverPanelId}>
                {errorMessage ? (
                  <div className="skills-panel__notice">
                    <Notice tone="error" message={errorMessage} />
                  </div>
                ) : null}

                <div className="skills-panel__search">
                  <label
                    className="skills-panel__search-control workspace-sidebar-control"
                    htmlFor={`skills-search-${workspaceId}`}
                  >
                    <ThemedIcon semantic="nav.search" size={14} aria-hidden="true" />
                    <input
                      id={`skills-search-${workspaceId}`}
                      type="search"
                      className="workspace-search-panel__input skills-panel__search-input"
                      aria-label={t("skills.search")}
                      placeholder={t("skills.search_placeholder")}
                      value={panelState.query}
                      onChange={(event) =>
                        setPanelState((current) => ({
                          ...current,
                          query: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <div className="skills-panel__search-results">
                    {panelState.resolvedQuery ? (
                      loadingSearch ? (
                        <p className="workspace-search-panel__state">{t("common.loading")}</p>
                      ) : sortedSearchResults.length === 0 ? (
                        <p className="workspace-search-panel__state">
                          {t("skills.no_search_results")}
                        </p>
                      ) : (
                        sortedSearchResults.map((item) => (
                          <article
                            key={item.slug}
                            className="skills-panel__list-item skills-panel__list-item--search workspace-sidebar-row"
                          >
                            <div className="skills-panel__row-head">
                              <div className="skills-panel__card-copy">
                                <div className="skills-panel__card-head">
                                  <h3 className="skills-panel__card-title">{item.displayName}</h3>
                                  <Tag color={item.installed ? "green" : "neutral"} caps={false}>
                                    {item.installed ? t("skills.installed") : t("skills.available")}
                                  </Tag>
                                </div>
                                <p className="skills-panel__card-slug">{item.slug}</p>
                                {item.description ? (
                                  <p className="skills-panel__card-description">
                                    {item.description}
                                  </p>
                                ) : null}
                              </div>

                              <div className="skills-panel__inline-actions">
                                <Button
                                  size="sm"
                                  loading={installingSkillSlugs.has(item.slug)}
                                  disabled={item.installed}
                                  onClick={() => void installSkill(item.slug)}
                                >
                                  {item.installed ? t("skills.installed") : t("skills.install")}
                                </Button>
                              </div>
                            </div>
                          </article>
                        ))
                      )
                    ) : (
                      <p className="workspace-search-panel__state">{t("skills.search_hint")}</p>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </>
  );
};
