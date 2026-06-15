import type {
  AgentSkillTargetEntry,
  SkillMountRelation,
  SkillRecommendationEntry,
  SkillVersionCheckEntry,
} from "@coder-studio/core";
import { ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";
import { type FC, type KeyboardEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import {
  Button,
  ConfirmDialog,
  IconButton,
  Notice,
  Switch,
  Tag,
  ThemedIcon,
  Tooltip,
} from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import type {
  SkillInfoItem,
  SkillLibraryListItem,
  SkillSearchResultItem,
} from "../../actions/use-skills-panel";
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
}

interface SkillDetailItem {
  slug: string;
  displayName: string;
  description?: string;
  version?: string;
  source?: SkillLibraryListItem["source"];
  libraryPath?: string;
  installed: boolean;
}

const BUILT_IN_PROVIDER_ABBREVIATIONS: Record<string, string> = {
  claude: "CC",
  codex: "CX",
  cursor: "CA",
  gemini: "GM",
  opencode: "O",
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

function shouldShowSkillVersion(skill: Pick<SkillDetailItem, "source" | "version">) {
  return skill.source !== "builtin" && Boolean(skill.version?.trim());
}

function detailHeaderMeta(skill: SkillDetailItem, t: Translate) {
  if (skill.version?.trim()) {
    return (
      <Tag color="neutral" caps={false}>
        {formatSkillVersion(skill.version)}
      </Tag>
    );
  }

  if (skill.source === "builtin") {
    return (
      <Tag color="blue" caps={false}>
        {t("workspace.skills.source.builtin")}
      </Tag>
    );
  }

  return null;
}

function formatSkillVersion(version: string | undefined) {
  const trimmed = version?.trim() ?? "";
  if (!trimmed) {
    return "";
  }
  return /^v/i.test(trimmed) || trimmed === "local" ? trimmed : `v${trimmed}`;
}

function versionCheckTag(
  t: Translate,
  check: SkillVersionCheckEntry | undefined
): { color: "green" | "amber" | "pink" | "neutral"; label: string } | undefined {
  if (!check) {
    return undefined;
  }

  switch (check.status) {
    case "update_available":
      return {
        color: "amber",
        label: check.latestVersion
          ? t("skills.version_update_available", {
              version: formatSkillVersion(check.latestVersion),
            })
          : t("skills.version_update_available_unknown"),
      };
    case "up_to_date":
      return { color: "green", label: t("skills.version_up_to_date") };
    case "error":
      return { color: "pink", label: t("skills.version_check_failed") };
    default:
      return { color: "neutral", label: t("skills.version_unknown") };
  }
}

function skillMountToggleTooltip(t: Translate, checked: boolean, canToggle: boolean) {
  if (!canToggle) {
    return t("skills.enable_skill_unavailable_tooltip");
  }

  return checked ? t("skills.disable_skill_tooltip") : t("skills.enable_skill_tooltip");
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

function isBuiltinSkill(skill: SkillLibraryListItem) {
  return skill.source === "builtin";
}

function sourceForSkillInfo(info: SkillInfoItem): SkillDetailItem["source"] {
  return info.libraryEntry?.source ?? "skillhub";
}

function detailFromLibraryItem(skill: SkillLibraryListItem): SkillDetailItem {
  return {
    slug: skill.slug,
    displayName: skill.displayName,
    description: skill.description,
    version: skill.version,
    source: skill.source,
    libraryPath: skill.libraryPath,
    installed: skill.installState === "installed",
  };
}

function detailFromSkillInfo(info: SkillInfoItem): SkillDetailItem {
  return {
    slug: info.slug,
    displayName: info.displayName,
    description: info.description,
    version: info.version,
    source: sourceForSkillInfo(info),
    libraryPath: info.libraryEntry?.libraryPath,
    installed: info.installed,
  };
}

function detailFromSearchResult(item: SkillSearchResultItem): SkillDetailItem {
  return {
    slug: item.slug,
    displayName: item.displayName,
    description: item.description,
    version: item.installedVersion ?? item.version,
    source: "skillhub",
    installed: item.installed,
  };
}

function detailFromRecommendation(item: SkillRecommendationEntry): SkillDetailItem {
  return {
    slug: item.slug,
    displayName: item.displayName,
    description: item.description,
    source: "skillhub",
    installed: item.installed,
  };
}

function skillDetailMatches(left: SkillDetailItem, right: SkillDetailItem) {
  return (
    left.slug === right.slug &&
    left.displayName === right.displayName &&
    left.description === right.description &&
    left.version === right.version &&
    left.source === right.source &&
    left.libraryPath === right.libraryPath &&
    left.installed === right.installed
  );
}

function groupLibraryItems(items: SkillLibraryListItem[]) {
  const installed: SkillLibraryListItem[] = [];
  const builtin: SkillLibraryListItem[] = [];

  for (const item of items) {
    if (isBuiltinSkill(item)) {
      builtin.push(item);
    } else {
      installed.push(item);
    }
  }

  return { builtin, installed };
}

function sortSearchItems(items: SkillSearchResultItem[]) {
  return [...items].sort((left, right) => {
    if (left.installed !== right.installed) {
      return left.installed ? -1 : 1;
    }

    return compareSkillLike(left, right);
  });
}

function sortRecommendationItems(items: SkillRecommendationEntry[]) {
  return [...items].sort((left, right) => {
    return (
      right.score - left.score ||
      left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" }) ||
      left.slug.localeCompare(right.slug, undefined, { sensitivity: "base" })
    );
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

interface SkillTargetRowsProps {
  skillSlug: string;
  targetSummaries: SkillTargetSummary[];
}

function SkillTargetRows({ skillSlug, targetSummaries }: SkillTargetRowsProps) {
  return (
    <>
      {targetSummaries.map((summary) => {
        return (
          <div key={`${skillSlug}:${summary.providerId}`} className="skills-panel__target-row">
            <div className="skills-panel__target-copy">
              <div className="skills-panel__target-head">
                <span className="skills-panel__target-name">{summary.displayName}</span>
                <Tag color={colorForSummaryState(summary.summaryState)} caps={false}>
                  {summary.summaryLabel}
                </Tag>
              </div>
              <p className="skills-panel__target-path">
                {summary.mounted ? summary.targetPathLabel : summary.reasonLabel}
              </p>
            </div>
          </div>
        );
      })}
    </>
  );
}

interface SkillTargetSummaryTokensProps {
  skillSlug: string;
  targetSummaries: SkillTargetSummary[];
}

function SkillTargetSummaryTokens({ skillSlug, targetSummaries }: SkillTargetSummaryTokensProps) {
  if (targetSummaries.length === 0) {
    return null;
  }

  return (
    <div className="skills-panel__summary-row">
      <span className="skills-panel__summary-tokens">
        {targetSummaries.map((summary) => (
          <Tooltip
            key={`${skillSlug}:${summary.providerId}`}
            content={
              <div className="skills-panel__summary-tooltip">
                <p className="skills-panel__summary-tooltip-title">{summary.displayName}</p>
                <p className="skills-panel__summary-tooltip-line">{summary.summaryLabel}</p>
                <p className="skills-panel__summary-tooltip-line">{summary.reasonLabel}</p>
              </div>
            }
          >
            <span
              aria-label={`${summary.displayName}: ${summary.summaryLabel}`}
              className={`skills-panel__summary-token skills-panel__summary-token--${summary.summaryState}`}
            >
              {summary.abbreviation}
            </span>
          </Tooltip>
        ))}
      </span>
    </div>
  );
}

interface SkillDetailViewProps {
  t: Translate;
  skill: SkillDetailItem;
  mounts: SkillMountRelation[];
  targets: Array<AgentSkillTargetEntry & { mountedSkillCount: number }>;
  installSkill: ReturnType<typeof useSkillsPanel>["installSkill"];
  installingSkillSlugs: ReturnType<typeof useSkillsPanel>["installingSkillSlugs"];
  onBack: () => void;
}

function SkillDetailView({
  t,
  skill,
  mounts,
  targets,
  installSkill,
  installingSkillSlugs,
  onBack,
}: SkillDetailViewProps) {
  const targetSummaries = buildTargetSummaries(t, targets, mounts);
  const headerMeta = detailHeaderMeta(skill, t);

  return (
    <div className="workspace-sidebar-view skills-panel skills-panel--detail">
      <div className="workspace-sidebar-panel__body workspace-sidebar-panel__body--stacked skills-panel__body">
        <section className="workspace-sidebar-section skills-panel__detail">
          <div className="skills-panel__detail-header">
            <button
              type="button"
              className="skills-panel__detail-back"
              aria-label={t("skills.detail_back")}
              onClick={onBack}
            >
              <ArrowLeft size={14} aria-hidden="true" />
              <span>{t("skills.detail_back")}</span>
            </button>
            <div className="skills-panel__detail-title-row">
              <h2 className="skills-panel__detail-title">{skill.displayName}</h2>
              <div className="skills-panel__card-head-actions skills-panel__detail-head-actions">
                {headerMeta ? <div className="skills-panel__card-badges">{headerMeta}</div> : null}
                {!skill.installed ? (
                  <div className="skills-panel__inline-actions">
                    <Button
                      size="sm"
                      loading={installingSkillSlugs.has(skill.slug)}
                      onClick={() => void installSkill(skill.slug)}
                    >
                      {t("skills.install")}
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
            <p className="skills-panel__card-slug skills-panel__card-slug--truncated">
              {skill.slug}
            </p>
          </div>

          {skill.description ? (
            <p className="skills-panel__detail-description">{skill.description}</p>
          ) : null}

          <dl className="skills-panel__detail-fields">
            <div className="skills-panel__detail-field">
              <dt>{t("skills.detail_source")}</dt>
              <dd>
                {skill.source
                  ? t(`workspace.skills.source.${skill.source}`)
                  : t("skills.available")}
              </dd>
            </div>
            {skill.libraryPath ? (
              <div className="skills-panel__detail-field">
                <dt>{t("skills.detail_library_path")}</dt>
                <dd>{skill.libraryPath}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        {skill.installed ? (
          <section className="workspace-sidebar-section skills-panel__detail-targets">
            <div className="workspace-sidebar-section__header">
              <div className="workspace-sidebar-section__header-main">
                <h3 className="workspace-sidebar-section__title">{t("skills.detail_targets")}</h3>
                <span className="workspace-sidebar-section__count">{targetSummaries.length}</span>
              </div>
            </div>
            <div className="skills-panel__target-details skills-panel__target-details--detail">
              <SkillTargetRows skillSlug={skill.slug} targetSummaries={targetSummaries} />
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

interface SkillsLibrarySectionProps {
  t: Translate;
  items: SkillLibraryListItem[];
  count?: number;
  panelId: string;
  title: string;
  emptyLabel: string;
  actions?: ReactNode;
  allowUninstall: boolean;
  isExpanded: boolean;
  toggleLabel: string;
  mountsBySkillSlug: Record<string, SkillMountRelation[]>;
  targets: Array<AgentSkillTargetEntry & { mountedSkillCount: number }>;
  panelState: ReturnType<typeof useSkillsPanel>["panelState"];
  uninstallSkill: ReturnType<typeof useSkillsPanel>["uninstallSkill"];
  updateSkill: ReturnType<typeof useSkillsPanel>["updateSkill"];
  setSkillMountEnabled: ReturnType<typeof useSkillsPanel>["setSkillMountEnabled"];
  setBuiltinMountEnabled: ReturnType<typeof useSkillsPanel>["setBuiltinMountEnabled"];
  versionChecksBySlug: ReturnType<typeof useSkillsPanel>["versionChecksBySlug"];
  onOpenSkill: (detail: SkillDetailItem) => void;
  onToggleExpanded: () => void;
}

function SkillCardDescription({ children }: { children: string }) {
  return (
    <Tooltip content={children}>
      <p className="skills-panel__card-description skills-panel__card-description--truncated">
        {children}
      </p>
    </Tooltip>
  );
}

interface SkillCardOpenProps {
  t: Translate;
  detail: SkillDetailItem;
  actions?: ReactNode;
  badges?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  onOpenSkill: (detail: SkillDetailItem) => void;
}

function SkillCardOpen({
  t,
  detail,
  actions,
  badges,
  children,
  footer,
  onOpenSkill,
}: SkillCardOpenProps) {
  const open = () => onOpenSkill(detail);
  const openKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    }
  };

  return (
    <div className="skills-panel__card-copy">
      <div className="skills-panel__card-head">
        <div
          className="skills-panel__card-open"
          role="button"
          tabIndex={0}
          aria-label={t("skills.detail_open", { name: detail.displayName })}
          onClick={open}
          onKeyDown={openKeyDown}
        >
          <Tooltip content={detail.displayName}>
            <span className="skills-panel__card-title skills-panel__card-title--truncated">
              {detail.displayName}
            </span>
          </Tooltip>
        </div>
        {badges || actions ? (
          <div className="skills-panel__card-head-actions">
            {badges ? <div className="skills-panel__card-badges">{badges}</div> : null}
            {actions ? <div className="skills-panel__inline-actions">{actions}</div> : null}
          </div>
        ) : null}
      </div>
      <div className="skills-panel__card-body" onClick={open}>
        <Tooltip content={detail.slug}>
          <p className="skills-panel__card-slug skills-panel__card-slug--truncated">
            {detail.slug}
          </p>
        </Tooltip>
        {children}
      </div>
      {footer}
    </div>
  );
}

function SkillsLibrarySection({
  t,
  items,
  count,
  panelId,
  title,
  emptyLabel,
  actions,
  allowUninstall,
  isExpanded,
  toggleLabel,
  mountsBySkillSlug,
  targets,
  panelState,
  uninstallSkill,
  updateSkill,
  setSkillMountEnabled,
  setBuiltinMountEnabled,
  versionChecksBySlug,
  onOpenSkill,
  onToggleExpanded,
}: SkillsLibrarySectionProps) {
  const hasItems = items.length > 0;
  const [pendingUninstall, setPendingUninstall] = useState<{
    mountCount: number;
    skill: SkillLibraryListItem;
  } | null>(null);

  const closeUninstallConfirm = () => setPendingUninstall(null);

  const requestUninstallSkill = (skill: SkillLibraryListItem, mounts: SkillMountRelation[]) => {
    const mountedProviderIds = new Set<string>(skill.mountedProviderIds);
    for (const mount of mounts) {
      if (mount.enabled) {
        mountedProviderIds.add(mount.providerId);
      }
    }

    if (mountedProviderIds.size > 0) {
      setPendingUninstall({ mountCount: mountedProviderIds.size, skill });
      return;
    }

    void uninstallSkill(skill.slug, false);
  };

  return (
    <>
      <section className="workspace-sidebar-section skills-panel__library-section">
        <SkillsSectionHeader
          actions={actions}
          count={count}
          isExpanded={isExpanded}
          panelId={panelId}
          title={title}
          toggleLabel={toggleLabel}
          onToggleExpanded={onToggleExpanded}
        />

        {isExpanded ? (
          !hasItems ? (
            <div className="skills-panel__empty" id={panelId}>
              <p className="workspace-search-panel__state">{emptyLabel}</p>
            </div>
          ) : (
            <div className="skills-panel__library-list" id={panelId}>
              {items.map((skill) => {
                const mounts = mountsBySkillSlug[skill.slug] ?? [];
                const targetSummaries = buildTargetSummaries(t, targets, mounts);
                const versionCheck = versionChecksBySlug[skill.slug];
                const versionStatus = versionCheckTag(t, versionCheck);
                const canUpdate = versionCheck?.status === "update_available";
                const configuredProviderIds = targetSummaries
                  .filter((summary) => summary.configured)
                  .map((summary) => summary.providerId);
                const activeProviderIds = new Set([
                  ...skill.mountedProviderIds,
                  ...mounts.filter((mount) => mount.enabled).map((mount) => mount.providerId),
                ]);
                const mountedProviderIds = new Set([
                  ...(skill.mountStatus === "error" ? [] : skill.mountedProviderIds),
                  ...mounts
                    .filter((mount) => mount.enabled && mount.status === "mounted")
                    .map((mount) => mount.providerId),
                ]);
                const disabledProviderIds = Array.from(
                  new Set([...configuredProviderIds, ...activeProviderIds])
                );
                const enableProviderIds = targetSummaries
                  .filter((summary) => summary.configured && !summary.mounted)
                  .map((summary) => summary.providerId);
                const installedSkillEnabled =
                  configuredProviderIds.length > 0
                    ? configuredProviderIds.every((providerId) =>
                        mountedProviderIds.has(providerId)
                      )
                    : activeProviderIds.size > 0;
                const canToggleInstalledSkill = installedSkillEnabled
                  ? disabledProviderIds.length > 0
                  : enableProviderIds.length > 0;
                const builtinProviderIds = (checked: boolean) =>
                  checked ? configuredProviderIds : disabledProviderIds;
                const canToggleBuiltinSkill =
                  isBuiltinSkill(skill) &&
                  (configuredProviderIds.length > 0 || activeProviderIds.size > 0);
                const builtinEnableChecked =
                  configuredProviderIds.length > 0
                    ? configuredProviderIds.every((providerId) =>
                        mountedProviderIds.has(providerId)
                      )
                    : activeProviderIds.size > 0;
                const builtinEnablePartial =
                  canToggleBuiltinSkill && !builtinEnableChecked && activeProviderIds.size > 0;
                const builtinSwitchLabel = builtinEnablePartial
                  ? t("skills.builtin_enable_partial_skill", {
                      name: skill.displayName,
                    })
                  : t("skills.builtin_enable_skill", {
                      name: skill.displayName,
                    });

                return (
                  <article
                    key={skill.slug}
                    className="skills-panel__list-item workspace-sidebar-row"
                  >
                    <div className="skills-panel__row-head">
                      <SkillCardOpen
                        detail={detailFromLibraryItem(skill)}
                        t={t}
                        footer={
                          <SkillTargetSummaryTokens
                            skillSlug={skill.slug}
                            targetSummaries={targetSummaries}
                          />
                        }
                        actions={
                          <>
                            {isBuiltinSkill(skill) ? (
                              <Tooltip
                                content={skillMountToggleTooltip(
                                  t,
                                  builtinEnableChecked,
                                  canToggleBuiltinSkill
                                )}
                              >
                                <Switch
                                  aria-label={builtinSwitchLabel}
                                  checked={builtinEnableChecked}
                                  disabled={!canToggleBuiltinSkill}
                                  onCheckedChange={(checked) =>
                                    void setBuiltinMountEnabled(
                                      skill.slug,
                                      builtinProviderIds(checked),
                                      checked
                                    )
                                  }
                                  size="sm"
                                />
                              </Tooltip>
                            ) : null}
                            {canUpdate ? (
                              <Button
                                size="sm"
                                loading={panelState.installJobIdBySlug[skill.slug] !== undefined}
                                onClick={() => void updateSkill(skill.slug)}
                              >
                                {t("skills.update")}
                              </Button>
                            ) : null}
                            {allowUninstall ? (
                              <>
                                <Tooltip
                                  content={skillMountToggleTooltip(
                                    t,
                                    installedSkillEnabled,
                                    canToggleInstalledSkill
                                  )}
                                >
                                  <Switch
                                    aria-label={t("skills.enable_skill", {
                                      name: skill.displayName,
                                    })}
                                    checked={installedSkillEnabled}
                                    disabled={!canToggleInstalledSkill}
                                    onCheckedChange={(checked) =>
                                      void setSkillMountEnabled(
                                        skill.slug,
                                        checked ? enableProviderIds : disabledProviderIds,
                                        checked
                                      )
                                    }
                                    size="sm"
                                  />
                                </Tooltip>
                                <Tooltip content={t("skills.uninstall_tooltip")}>
                                  <Button
                                    size="sm"
                                    onClick={() => requestUninstallSkill(skill, mounts)}
                                  >
                                    {t("skills.uninstall")}
                                  </Button>
                                </Tooltip>
                              </>
                            ) : null}
                          </>
                        }
                        onOpenSkill={onOpenSkill}
                        badges={
                          <>
                            {shouldShowSkillVersion(skill) ? (
                              <Tag color="neutral" caps={false}>
                                {formatSkillVersion(skill.version)}
                              </Tag>
                            ) : null}
                            {versionStatus ? (
                              <Tag color={versionStatus.color} caps={false}>
                                {versionStatus.label}
                              </Tag>
                            ) : null}
                          </>
                        }
                      >
                        {skill.description ? (
                          <SkillCardDescription>{skill.description}</SkillCardDescription>
                        ) : null}
                      </SkillCardOpen>
                    </div>
                  </article>
                );
              })}
            </div>
          )
        ) : null}
      </section>

      <ConfirmDialog
        cancelText={t("common.cancel")}
        confirmText={t("skills.uninstall_confirm_confirm")}
        description={
          pendingUninstall
            ? t("skills.uninstall_confirm_description", {
                count: pendingUninstall.mountCount,
              })
            : null
        }
        onConfirm={() => {
          const current = pendingUninstall;
          if (!current) {
            return;
          }
          setPendingUninstall(null);
          void uninstallSkill(current.skill.slug, true);
        }}
        onOpenChange={(open) => {
          if (!open) {
            closeUninstallConfirm();
          }
        }}
        open={Boolean(pendingUninstall)}
        title={
          pendingUninstall
            ? t("skills.uninstall_confirm_title", { name: pendingUninstall.skill.displayName })
            : ""
        }
        tone="danger"
      />
    </>
  );
}

export const SkillsPanel: FC<SkillsPanelProps> = ({ workspaceId, refreshToken }) => {
  const t = useTranslation();
  const {
    checkSkillVersions,
    checkingVersions,
    errorMessage,
    installSkill,
    installingSkillSlugs,
    library,
    loadSkillInfo,
    loadingLibrary,
    loadingRecommendations,
    loadingSearch,
    mountsBySkillSlug,
    panelState,
    refreshHealth,
    refreshRecommendations,
    recommendations,
    runSearch,
    searchResults,
    setBuiltinMountEnabled,
    setSkillMountEnabled,
    setPanelState,
    skillInfoBySlug,
    targets,
    uninstallSkill,
    updateSkill,
    versionChecksBySlug,
  } = useSkillsPanel(workspaceId);
  const sortedLibrary = useMemo(() => sortLibraryItems(library), [library]);
  const { builtin: builtinLibrary, installed: installedLibrary } = useMemo(
    () => groupLibraryItems(sortedLibrary),
    [sortedLibrary]
  );
  const sortedSearchResults = useMemo(() => sortSearchItems(searchResults), [searchResults]);
  const sortedRecommendations = useMemo(
    () => sortRecommendationItems(recommendations),
    [recommendations]
  );
  const [selectedSkillDetail, setSelectedSkillDetail] = useState<SkillDetailItem | null>(null);
  const installedPanelId = `skills-installed-${workspaceId}`;
  const builtinPanelId = `skills-builtin-${workspaceId}`;
  const recommendationsPanelId = `skills-recommendations-${workspaceId}`;
  const discoverPanelId = `skills-discover-${workspaceId}`;
  const installedToggleLabel = panelState.installedCollapsed
    ? t("skills.installed_expand_label")
    : t("skills.installed_collapse_label");
  const builtinToggleLabel = panelState.builtinCollapsed
    ? t("skills.builtin_expand_label")
    : t("skills.builtin_collapse_label");
  const discoverToggleLabel = panelState.discoverCollapsed
    ? t("skills.discover_expand_label")
    : t("skills.discover_collapse_label");
  const recommendationsToggleLabel = panelState.recommendationsCollapsed
    ? t("skills.recommendations_expand_label")
    : t("skills.recommendations_collapse_label");
  const discoverCount =
    panelState.resolvedQuery && !loadingSearch ? sortedSearchResults.length : undefined;
  const installedCount = loadingLibrary ? undefined : installedLibrary.length;
  const builtinCount = loadingLibrary ? undefined : builtinLibrary.length;
  const recommendationsCount = loadingRecommendations ? undefined : sortedRecommendations.length;
  const openSkillDetail = (detail: SkillDetailItem) => {
    const libraryEntry = sortedLibrary.find((skill) => skill.slug === detail.slug);
    if (libraryEntry) {
      setSelectedSkillDetail(detailFromLibraryItem(libraryEntry));
      return;
    }

    const cached = skillInfoBySlug[detail.slug];
    setSelectedSkillDetail(cached ? detailFromSkillInfo(cached) : detail);
    void loadSkillInfo(detail.slug).then((info) => {
      if (info) {
        setSelectedSkillDetail((current) =>
          current?.slug === info.slug ? detailFromSkillInfo(info) : current
        );
      }
    });
  };

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void runSearch(panelState.query);
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [panelState.query, runSearch]);

  useEffect(() => {
    void refreshHealth();
    void refreshRecommendations();
  }, [refreshHealth, refreshRecommendations, refreshToken]);

  useEffect(() => {
    if (!selectedSkillDetail) {
      return;
    }

    const libraryEntry = sortedLibrary.find((skill) => skill.slug === selectedSkillDetail.slug);
    if (libraryEntry) {
      const nextDetail = detailFromLibraryItem(libraryEntry);
      if (!skillDetailMatches(nextDetail, selectedSkillDetail)) {
        setSelectedSkillDetail(nextDetail);
      }
      return;
    }

    const cached = skillInfoBySlug[selectedSkillDetail.slug];
    if (cached) {
      const nextDetail = detailFromSkillInfo(cached);
      if (!skillDetailMatches(nextDetail, selectedSkillDetail)) {
        setSelectedSkillDetail(nextDetail);
      }
    }
  }, [selectedSkillDetail, skillInfoBySlug, sortedLibrary]);

  if (selectedSkillDetail) {
    return (
      <SkillDetailView
        installSkill={installSkill}
        installingSkillSlugs={installingSkillSlugs}
        mounts={
          mountsBySkillSlug[selectedSkillDetail.slug] ??
          skillInfoBySlug[selectedSkillDetail.slug]?.mounts ??
          []
        }
        onBack={() => setSelectedSkillDetail(null)}
        skill={selectedSkillDetail}
        t={t}
        targets={targets}
      />
    );
  }

  return (
    <>
      <div className="workspace-sidebar-view skills-panel">
        <div className="workspace-sidebar-panel__body workspace-sidebar-panel__body--stacked skills-panel__body">
          <SkillsLibrarySection
            actions={
              <>
                <button
                  type="button"
                  className="workspace-sidebar-section__action"
                  disabled={checkingVersions}
                  onClick={() => {
                    void checkSkillVersions();
                  }}
                >
                  {checkingVersions ? t("skills.checking_versions") : t("skills.check_versions")}
                </button>
                <button
                  type="button"
                  className="workspace-sidebar-section__action"
                  onClick={() => {
                    void refreshHealth();
                    void refreshRecommendations();
                  }}
                >
                  {t("skills.scan")}
                </button>
              </>
            }
            allowUninstall={true}
            emptyLabel={loadingLibrary ? t("common.loading") : t("skills.empty_installed")}
            count={installedCount}
            isExpanded={!panelState.installedCollapsed}
            items={loadingLibrary ? [] : installedLibrary}
            mountsBySkillSlug={mountsBySkillSlug}
            panelId={installedPanelId}
            panelState={panelState}
            setBuiltinMountEnabled={setBuiltinMountEnabled}
            setSkillMountEnabled={setSkillMountEnabled}
            t={t}
            targets={targets}
            title={t("skills.installed_title")}
            toggleLabel={installedToggleLabel}
            uninstallSkill={uninstallSkill}
            updateSkill={updateSkill}
            versionChecksBySlug={versionChecksBySlug}
            onOpenSkill={openSkillDetail}
            onToggleExpanded={() =>
              setPanelState((current) => ({
                ...current,
                installedCollapsed: !current.installedCollapsed,
              }))
            }
          />

          <SkillsLibrarySection
            allowUninstall={false}
            emptyLabel={loadingLibrary ? t("common.loading") : t("skills.empty_builtin")}
            count={builtinCount}
            isExpanded={!panelState.builtinCollapsed}
            items={loadingLibrary ? [] : builtinLibrary}
            mountsBySkillSlug={mountsBySkillSlug}
            panelId={builtinPanelId}
            panelState={panelState}
            setBuiltinMountEnabled={setBuiltinMountEnabled}
            setSkillMountEnabled={setSkillMountEnabled}
            t={t}
            targets={targets}
            title={t("skills.builtin_title")}
            toggleLabel={builtinToggleLabel}
            uninstallSkill={uninstallSkill}
            updateSkill={updateSkill}
            versionChecksBySlug={versionChecksBySlug}
            onOpenSkill={openSkillDetail}
            onToggleExpanded={() =>
              setPanelState((current) => ({
                ...current,
                builtinCollapsed: !current.builtinCollapsed,
              }))
            }
          />

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
                              <SkillCardOpen
                                detail={detailFromSearchResult(item)}
                                t={t}
                                onOpenSkill={openSkillDetail}
                                badges={
                                  <>
                                    {(item.installedVersion ?? item.version) ? (
                                      <Tag color="neutral" caps={false}>
                                        {formatSkillVersion(item.installedVersion ?? item.version!)}
                                      </Tag>
                                    ) : null}
                                    <Tag color={item.installed ? "green" : "neutral"} caps={false}>
                                      {item.installed
                                        ? t("skills.installed")
                                        : t("skills.available")}
                                    </Tag>
                                  </>
                                }
                                actions={
                                  <Button
                                    size="sm"
                                    loading={installingSkillSlugs.has(item.slug)}
                                    disabled={item.installed}
                                    onClick={() => void installSkill(item.slug)}
                                  >
                                    {item.installed ? t("skills.installed") : t("skills.install")}
                                  </Button>
                                }
                              >
                                {item.description ? (
                                  <SkillCardDescription>{item.description}</SkillCardDescription>
                                ) : null}
                              </SkillCardOpen>
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

          <section className="workspace-sidebar-section skills-panel__recommendations">
            <SkillsSectionHeader
              count={recommendationsCount}
              isExpanded={!panelState.recommendationsCollapsed}
              panelId={recommendationsPanelId}
              title={t("skills.recommendations_title")}
              toggleLabel={recommendationsToggleLabel}
              onToggleExpanded={() =>
                setPanelState((current) => ({
                  ...current,
                  recommendationsCollapsed: !current.recommendationsCollapsed,
                }))
              }
            />

            {!panelState.recommendationsCollapsed ? (
              <div className="skills-panel__recommendations-list" id={recommendationsPanelId}>
                {loadingRecommendations ? (
                  <p className="workspace-search-panel__state">{t("common.loading")}</p>
                ) : sortedRecommendations.length === 0 ? (
                  <p className="workspace-search-panel__state">{t("skills.no_recommendations")}</p>
                ) : (
                  sortedRecommendations.map((item) => (
                    <article
                      key={item.slug}
                      className="skills-panel__list-item skills-panel__list-item--recommendation workspace-sidebar-row"
                    >
                      <div className="skills-panel__row-head">
                        <SkillCardOpen
                          detail={detailFromRecommendation(item)}
                          t={t}
                          onOpenSkill={openSkillDetail}
                          badges={
                            <Tag color="neutral" caps={false}>
                              {item.installed ? t("skills.installed") : t("skills.available")}
                            </Tag>
                          }
                          actions={
                            <Button
                              size="sm"
                              loading={installingSkillSlugs.has(item.slug)}
                              disabled={item.installed}
                              onClick={() => void installSkill(item.slug)}
                            >
                              {item.installed ? t("skills.installed") : t("skills.install")}
                            </Button>
                          }
                        >
                          <SkillCardDescription>{item.reason}</SkillCardDescription>
                        </SkillCardOpen>
                      </div>
                    </article>
                  ))
                )}
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </>
  );
};
