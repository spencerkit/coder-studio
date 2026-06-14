import * as echarts from "echarts";
import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Button,
  ConfirmDialog,
  DateTimePicker,
  Notice,
  Popover,
  ProgressBar,
  Tooltip,
} from "../../components/ui";
import { useViewport } from "../../hooks/use-viewport";
import { useTranslation } from "../../lib/i18n";
import { MobilePageHeader } from "../shared/components/mobile-page-header";
import { PageHeader } from "../shared/components/page-header";
import { formatDuration, formatInteger, formatPercent, formatTokenMetric } from "./format";
import { WORK_ANALYSIS_PRESET_OPTIONS } from "./lib/time-range";
import { buildWorkAnalyticsPath, parseWorkAnalyticsSearch } from "./navigation";
import type {
  WorkAnalysisContributionRank,
  WorkAnalysisDashboardProjection,
  WorkAnalysisDashboardProviderStatus,
  WorkAnalysisDashboardScanState,
  WorkAnalysisHourHeatPoint,
  WorkAnalysisKpiKey,
  WorkAnalysisPresetRange,
  WorkAnalysisSkillBreakdown,
  WorkAnalysisStatus,
  WorkAnalysisTokenTrendPoint,
} from "./types";
import { useWorkAnalysisController } from "./use-work-analysis-controller";

const pageStyle: CSSProperties = {
  display: "grid",
  gap: 18,
  color: "var(--text-primary)",
};

const panelStyle: CSSProperties = {
  background: "var(--surface-panel)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-panel)",
  boxShadow: "var(--shadow-sm)",
};

const panelContentStyle: CSSProperties = {
  ...panelStyle,
  padding: 18,
};

const fixedPanelScrollStyle: CSSProperties = {
  minHeight: "0",
  overflowY: "auto",
};

const rankingPanelShellStyle: CSSProperties = {
  ...panelContentStyle,
  alignContent: "start",
  display: "grid",
  gap: 14,
  gridTemplateRows: "auto minmax(0, 1fr)",
  height: 340,
  overflow: "hidden",
};

const compactPanelShellStyle: CSSProperties = {
  ...panelContentStyle,
  alignContent: "start",
  display: "grid",
  gap: 12,
  gridTemplateRows: "auto minmax(0, 1fr)",
  height: 300,
  overflow: "hidden",
};

const mutedStyle: CSSProperties = {
  color: "var(--text-secondary)",
};

const labelStyle: CSSProperties = {
  color: "var(--text-tertiary)",
  fontSize: "var(--type-body-6-size)",
  fontWeight: "var(--font-medium)",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

type KpiKey = WorkAnalysisKpiKey | string;
type TrendGranularity = "hour" | "sixHour" | "day";
type TrendTimeRange = WorkAnalysisDashboardProjection["timeRange"];

interface TokenTrendDisplayPoint extends WorkAnalysisTokenTrendPoint {
  timestamp: number;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function formatDateTime(timestamp?: number) {
  if (!timestamp) {
    return "-";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function formatStatus(status: WorkAnalysisStatus) {
  if (status === "running") return "扫描中";
  if (status === "succeeded") return "已更新";
  if (status === "failed") return "失败";
  return "待机";
}

function formatKpiValue(key: KpiKey, value: number, displayValue?: string) {
  if (displayValue) {
    return displayValue;
  }

  if (key === "activeTime") {
    return formatDuration(value);
  }

  if (key === "topProjectShare") {
    return formatPercent(value);
  }

  if (key === "sessions") {
    return formatInteger(value);
  }

  return formatTokenMetric(value);
}

function getTrendTimestamp(point: WorkAnalysisTokenTrendPoint) {
  if (typeof point.hourStart === "number") {
    return point.hourStart;
  }

  if (!point.day) {
    return null;
  }

  const timestamp = Date.parse(`${point.day}T00:00:00.000Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function getTooltipTimestamp(params: unknown) {
  const firstParam = Array.isArray(params) ? params[0] : params;
  if (!firstParam || typeof firstParam !== "object") {
    return null;
  }

  const data = (firstParam as { data?: unknown }).data;
  if (!Array.isArray(data) || typeof data[0] !== "number") {
    return null;
  }

  return data[0];
}

function floorUtcDay(timestamp: number) {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function selectTrendGranularity(timeRange: TrendTimeRange): TrendGranularity {
  const durationMs = Math.max(0, timeRange.endAt - timeRange.startAt);
  if (durationMs <= 7 * DAY_MS) {
    return "hour";
  }

  if (durationMs <= 30 * DAY_MS) {
    return "sixHour";
  }

  return "day";
}

function formatTrendGranularity(granularity: TrendGranularity) {
  if (granularity === "hour") {
    return "小时";
  }

  if (granularity === "sixHour") {
    return "6小时";
  }

  return "日";
}

function getTrendStepMs(granularity: TrendGranularity) {
  if (granularity === "hour") {
    return HOUR_MS;
  }

  if (granularity === "sixHour") {
    return 6 * HOUR_MS;
  }

  return DAY_MS;
}

function buildTrendBucketTimestamps(timeRange: TrendTimeRange, granularity: TrendGranularity) {
  if (timeRange.endAt < timeRange.startAt) {
    return [];
  }

  if (granularity === "day") {
    const startDay = floorUtcDay(timeRange.startAt);
    const endDay = floorUtcDay(timeRange.endAt);
    const dayCount = Math.max(0, Math.floor((endDay - startDay) / DAY_MS));
    return Array.from({ length: dayCount + 1 }, (_, index) => {
      if (index === 0) {
        return timeRange.startAt;
      }

      if (index === dayCount) {
        return timeRange.endAt;
      }

      return timeRange.startAt + index * DAY_MS;
    });
  }

  const stepMs = getTrendStepMs(granularity);
  const timestamps: number[] = [];
  for (let timestamp = timeRange.startAt; timestamp <= timeRange.endAt; timestamp += stepMs) {
    timestamps.push(timestamp);
  }

  if (timestamps.at(-1) !== timeRange.endAt) {
    timestamps.push(timeRange.endAt);
  }

  return timestamps;
}

function getTrendBucketTimestamp({
  buckets,
  granularity,
  sourceTimestamp,
  timeRange,
}: {
  readonly buckets: number[];
  readonly granularity: TrendGranularity;
  readonly sourceTimestamp: number;
  readonly timeRange: TrendTimeRange;
}) {
  if (buckets.length === 0) {
    return null;
  }

  if (granularity === "day") {
    const dayIndex = Math.floor(
      (floorUtcDay(sourceTimestamp) - floorUtcDay(timeRange.startAt)) / DAY_MS
    );
    return dayIndex >= 0 && dayIndex < buckets.length ? (buckets[dayIndex] ?? null) : null;
  }

  const stepMs = getTrendStepMs(granularity);
  if (sourceTimestamp < timeRange.startAt - stepMs || sourceTimestamp > timeRange.endAt) {
    return null;
  }

  const clampedTimestamp = Math.max(sourceTimestamp, timeRange.startAt);
  const bucketIndex = Math.min(
    Math.floor((clampedTimestamp - timeRange.startAt) / stepMs),
    buckets.length - 1
  );
  return buckets[bucketIndex] ?? null;
}

function createEmptyTrendPoint(
  timestamp: number,
  granularity: TrendGranularity
): TokenTrendDisplayPoint {
  return {
    ...(granularity === "day"
      ? { day: new Date(timestamp).toISOString().slice(0, 10) }
      : { hourStart: timestamp }),
    activeDurationMs: 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    sessionCount: 0,
    timestamp,
    totalTokens: 0,
  };
}

function mergeTrendPoint(target: TokenTrendDisplayPoint, source: WorkAnalysisTokenTrendPoint) {
  target.activeDurationMs += source.activeDurationMs;
  target.cachedInputTokens += source.cachedInputTokens;
  target.cacheCreationInputTokens += source.cacheCreationInputTokens;
  target.cacheReadInputTokens += source.cacheReadInputTokens;
  target.inputTokens += source.inputTokens;
  target.outputTokens += source.outputTokens;
  target.reasoningOutputTokens += source.reasoningOutputTokens;
  target.sessionCount += source.sessionCount;
  target.totalTokens += source.totalTokens;
}

function buildTokenTrendDisplay({
  daily,
  hourly,
  timeRange,
}: {
  readonly daily: WorkAnalysisTokenTrendPoint[];
  readonly hourly: WorkAnalysisTokenTrendPoint[];
  readonly timeRange: TrendTimeRange;
}) {
  const granularity = selectTrendGranularity(timeRange);
  const buckets = buildTrendBucketTimestamps(timeRange, granularity);
  const pointsByTimestamp = new Map(
    buckets.map((timestamp) => [timestamp, createEmptyTrendPoint(timestamp, granularity)])
  );
  const sourcePoints =
    granularity === "day" && daily.length > 0 ? daily : hourly.length > 0 ? hourly : daily;

  for (const point of sourcePoints) {
    const sourceTimestamp = getTrendTimestamp(point);
    if (typeof sourceTimestamp !== "number") {
      continue;
    }

    const bucketTimestamp = getTrendBucketTimestamp({
      buckets,
      granularity,
      sourceTimestamp,
      timeRange,
    });
    if (bucketTimestamp === null) {
      continue;
    }

    const bucket = pointsByTimestamp.get(bucketTimestamp);
    if (bucket) {
      mergeTrendPoint(bucket, point);
    }
  }

  const points = [...pointsByTimestamp.values()].sort(
    (left, right) => left.timestamp - right.timestamp
  );
  const hasData = points.some((point) => point.totalTokens > 0 || point.sessionCount > 0);

  return {
    granularity,
    points: hasData ? points : [],
  };
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

function EmptyPanel({ children }: { readonly children: ReactNode }) {
  return (
    <div
      style={{
        alignItems: "center",
        background: "var(--surface-muted)",
        border: "1px dashed var(--border-subtle)",
        borderRadius: "var(--radius-control-lg)",
        color: "var(--text-secondary)",
        display: "flex",
        justifyContent: "center",
        minHeight: 120,
        padding: 16,
        textAlign: "center",
      }}
    >
      {children}
    </div>
  );
}

function SectionHeader({
  eyebrow,
  subtitle,
  title,
}: {
  readonly eyebrow?: string;
  readonly subtitle?: string;
  readonly title: string;
}) {
  return (
    <div style={{ display: "grid", gap: 4 }}>
      {eyebrow ? <span style={labelStyle}>{eyebrow}</span> : null}
      <h2 style={{ fontSize: 18, lineHeight: 1.2, margin: 0 }}>{title}</h2>
      {subtitle ? <p style={{ ...mutedStyle, fontSize: 13, margin: 0 }}>{subtitle}</p> : null}
    </div>
  );
}

function StatusBadge({
  children,
  tone = "neutral",
}: {
  readonly children: ReactNode;
  readonly tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const toneStyle: Record<typeof tone, CSSProperties> = {
    neutral: {
      background: "var(--tag-accent-bg)",
      borderColor: "var(--border-subtle)",
      color: "var(--tag-accent-fg)",
    },
    success: {
      background: "var(--tag-success-bg)",
      borderColor: "var(--status-success-border)",
      color: "var(--tag-success-fg)",
    },
    warning: {
      background: "var(--tag-warning-bg)",
      borderColor: "var(--status-warning-border)",
      color: "var(--tag-warning-fg)",
    },
    danger: {
      background: "var(--tag-danger-bg)",
      borderColor: "var(--status-danger-border)",
      color: "var(--tag-danger-fg)",
    },
  };

  return (
    <span
      style={{
        border: "1px solid",
        borderRadius: 999,
        display: "inline-flex",
        fontSize: "var(--type-body-5-size)",
        fontWeight: "var(--font-medium)",
        lineHeight: 1,
        padding: "8px 10px",
        ...toneStyle[tone],
      }}
    >
      {children}
    </span>
  );
}

function getStatusTone(status: WorkAnalysisStatus): "neutral" | "success" | "warning" | "danger" {
  if (status === "succeeded") return "success";
  if (status === "running") return "warning";
  if (status === "failed") return "danger";
  return "neutral";
}

function getProviderStatusTone(
  status: WorkAnalysisDashboardProviderStatus["status"]
): "neutral" | "success" | "warning" | "danger" {
  if (status === "supported") return "success";
  if (status === "partial") return "warning";
  return "neutral";
}

const providerDisplayNameById: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  gemini: "Gemini",
  opencode: "OpenCode",
};

function formatProviderDisplayName(providerId: string) {
  const normalizedProviderId = providerId.toLowerCase();
  return providerDisplayNameById[normalizedProviderId] ?? providerId;
}

function formatProviderStatusLabel(status: WorkAnalysisDashboardProviderStatus["status"]) {
  if (status === "supported") return "可解析";
  if (status === "no_logs") return "无记录";
  if (status === "missing_root") return "未安装";
  if (status === "partial") return "解析异常";
  return "不支持";
}

function formatProviderSourceLabel(provider: WorkAnalysisDashboardProviderStatus) {
  const providerName = formatProviderDisplayName(provider.providerId);

  if (provider.status === "supported") {
    return `${providerName} ${formatInteger(provider.sessionCount)}`;
  }

  if (provider.status === "partial") {
    return `${providerName} ${formatInteger(provider.sessionCount)} · 解析异常`;
  }

  return `${providerName} ${formatProviderStatusLabel(provider.status)}`;
}

function getProviderSourceTitle(provider: WorkAnalysisDashboardProviderStatus) {
  const details = [
    formatProviderDisplayName(provider.providerId),
    formatProviderStatusLabel(provider.status),
    `${formatInteger(provider.sessionCount)} 会话`,
    `${formatInteger(provider.parseErrorCount)} 解析错误`,
    `${formatInteger(provider.warningCount)} 警告`,
  ];

  if (provider.warnings && provider.warnings.length > 0) {
    details.push(
      ...provider.warnings.map((warning) =>
        [warning.code, warning.message, warning.sourceRef].filter(Boolean).join(": ")
      )
    );
  }

  return details.join(" · ");
}

function ProviderSourceSummary({
  providers,
}: {
  readonly providers: WorkAnalysisDashboardProviderStatus[];
}) {
  const providerChipStyle = (
    status: WorkAnalysisDashboardProviderStatus["status"]
  ): CSSProperties => {
    const tone = getProviderStatusTone(status);
    const toneStyle: Record<typeof tone, CSSProperties> = {
      neutral: {
        background: "var(--surface-muted)",
        borderColor: "var(--border-subtle)",
        color: "var(--text-secondary)",
      },
      success: {
        background: "var(--tag-success-bg)",
        borderColor: "var(--status-success-border)",
        color: "var(--tag-success-fg)",
      },
      warning: {
        background: "var(--tag-warning-bg)",
        borderColor: "var(--status-warning-border)",
        color: "var(--tag-warning-fg)",
      },
      danger: {
        background: "var(--tag-danger-bg)",
        borderColor: "var(--status-danger-border)",
        color: "var(--tag-danger-fg)",
      },
    };

    return {
      border: "1px solid",
      borderRadius: 999,
      display: "inline-flex",
      fontSize: 12,
      lineHeight: 1,
      padding: "5px 8px",
      whiteSpace: "nowrap",
      ...toneStyle[tone],
    };
  };

  return (
    <div
      data-testid="work-analysis-data-source"
      style={{
        alignItems: "center",
        color: "var(--text-secondary)",
        display: "flex",
        flexWrap: "wrap",
        gap: "8px 10px",
        fontSize: 13,
      }}
    >
      <span style={{ color: "var(--text-tertiary)" }}>数据来源：</span>
      {providers.length > 0 ? (
        providers.map((provider) => (
          <span
            key={provider.providerId}
            style={providerChipStyle(provider.status)}
            title={getProviderSourceTitle(provider)}
          >
            {formatProviderSourceLabel(provider)}
          </span>
        ))
      ) : (
        <span>暂无扫描来源</span>
      )}
    </div>
  );
}

function DashboardStatusStrip({
  filterControl,
  isRebuilding,
  isRefreshing,
  onRebuild,
  onRefresh,
  providers,
  scanState,
}: {
  readonly filterControl: ReactNode;
  readonly isRebuilding: boolean;
  readonly isRefreshing: boolean;
  readonly onRebuild: () => void;
  readonly onRefresh: () => void;
  readonly providers: WorkAnalysisDashboardProviderStatus[];
  readonly scanState?: WorkAnalysisDashboardScanState;
}) {
  const status = scanState?.status ?? "idle";
  const isBusy = isRefreshing || isRebuilding || status === "running";
  const visibleStatus: WorkAnalysisStatus = isBusy ? "running" : status;
  const isManualScan = isRefreshing || isRebuilding || scanState?.mode === "manual";
  const modeLabel = isManualScan ? "手动扫描" : "自动扫描";
  const activityAriaLabel = isRebuilding
    ? "正在重建工作分析索引"
    : isRefreshing
      ? "正在刷新工作分析索引"
      : status === "running"
        ? "正在自动补齐工作分析索引"
        : null;
  const activityTitle = isRebuilding
    ? "正在重建小时索引"
    : isRefreshing
      ? "正在补齐小时索引"
      : status === "running"
        ? "自动补齐索引中"
        : null;
  const activityDetail = isRebuilding
    ? "完成后会替换当前统计"
    : isRefreshing
      ? "页面数据保持可读"
      : status === "running"
        ? "服务会自动返回最新数据"
        : null;

  return (
    <section
      style={{
        ...panelContentStyle,
        alignItems: "center",
        display: "flex",
        flexWrap: "wrap",
        gap: 16,
        justifyContent: "space-between",
      }}
    >
      <div style={{ display: "grid", flex: "1 1 360px", gap: 10, minWidth: 0 }}>
        <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 8 }}>
          <h1 style={{ fontSize: 24, letterSpacing: "-0.02em", lineHeight: 1.15, margin: 0 }}>
            工作分析
          </h1>
          <StatusBadge tone={getStatusTone(visibleStatus)}>
            {formatStatus(visibleStatus)}
          </StatusBadge>
          <StatusBadge>{modeLabel}</StatusBadge>
        </div>
        <div
          style={{
            color: "var(--text-secondary)",
            display: "flex",
            flexWrap: "wrap",
            gap: "8px 18px",
            fontSize: 13,
          }}
        >
          <span>上次开始：{formatDateTime(scanState?.lastStartedAt)}</span>
          <span>上次完成：{formatDateTime(scanState?.lastCompletedAt)}</span>
          <span>下次自动扫描：{formatDateTime(scanState?.nextScheduledAt)}</span>
        </div>
        <ProviderSourceSummary providers={providers} />
        {activityAriaLabel && activityTitle && activityDetail ? (
          <DashboardRefreshActivity
            ariaLabel={activityAriaLabel}
            detail={activityDetail}
            title={activityTitle}
          />
        ) : null}
      </div>
      <div
        data-testid="work-analysis-header-actions"
        style={{
          alignItems: "center",
          display: "flex",
          flex: "0 1 auto",
          flexWrap: "wrap",
          gap: 8,
          justifyContent: "flex-end",
          minWidth: 0,
        }}
      >
        {filterControl}
        <Button
          disabled={isRebuilding}
          loading={isRefreshing}
          onClick={onRefresh}
          variant="primary"
        >
          {isRefreshing ? "刷新中" : "立即刷新"}
        </Button>
        <Button
          disabled={isRefreshing}
          loading={isRebuilding}
          onClick={onRebuild}
          variant="secondary"
        >
          {isRebuilding ? "重建中" : "强制刷新"}
        </Button>
        <RefreshActionTip />
      </div>
    </section>
  );
}

function DashboardRefreshActivity({
  ariaLabel,
  detail,
  title,
}: {
  readonly ariaLabel: string;
  readonly detail: string;
  readonly title: string;
}) {
  return (
    <div
      aria-label={ariaLabel}
      role="status"
      style={{
        background: "var(--field-bg)",
        border: "1px solid var(--border-default)",
        borderRadius: "var(--radius-control-sm)",
        display: "grid",
        gap: 8,
        maxWidth: 560,
        padding: "10px 12px",
      }}
    >
      <div
        style={{
          alignItems: "center",
          color: "var(--text-secondary)",
          display: "flex",
          flexWrap: "wrap",
          gap: "6px 10px",
          justifyContent: "space-between",
          minWidth: 0,
        }}
      >
        <span
          style={{
            alignItems: "center",
            display: "inline-flex",
            gap: 8,
            minWidth: 0,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              animation: "pulse 1.2s ease-in-out infinite",
              background: "var(--status-info-fg)",
              borderRadius: 999,
              boxShadow: "0 0 0 4px var(--status-info-bg)",
              flex: "0 0 auto",
              height: 7,
              width: 7,
            }}
          />
          <span style={{ fontSize: 13 }}>{title}</span>
        </span>
        <span style={{ color: "var(--text-tertiary)", fontSize: 12 }}>{detail}</span>
      </div>
      <ProgressBar
        aria-hidden="true"
        indeterminate
        max={100}
        tone="info"
        value={0}
        style={{ borderRadius: 999, height: 4 }}
      />
    </div>
  );
}

function RefreshActionTip() {
  return (
    <Tooltip
      content={
        <span style={{ display: "grid", gap: 6, maxWidth: 280 }}>
          <strong style={{ color: "var(--text-primary)" }}>刷新方式</strong>
          <span>立即刷新：只补齐未统计的小时索引，适合日常更新。</span>
          <span>强制刷新：清空小时索引后全量重扫历史日志，适合数据异常时重建。</span>
        </span>
      }
    >
      <button
        type="button"
        aria-label="刷新方式说明"
        style={{
          alignItems: "center",
          background: "var(--field-bg)",
          border: "1px solid var(--border-default)",
          borderRadius: "var(--radius-control-sm)",
          color: "var(--text-tertiary)",
          cursor: "help",
          display: "inline-flex",
          fontSize: 12,
          fontWeight: 700,
          height: 32,
          justifyContent: "center",
          lineHeight: 1,
          width: 32,
        }}
      >
        ?
      </button>
    </Tooltip>
  );
}

function formatDirectoryFilterSummary({
  hasCustomizedWorkspacePaths,
  selectedWorkspacePaths,
}: {
  readonly hasCustomizedWorkspacePaths: boolean;
  readonly selectedWorkspacePaths: string[];
}) {
  if (!hasCustomizedWorkspacePaths) {
    return "全部目录";
  }

  return `${selectedWorkspacePaths.length} 个目录`;
}

type WorkAnalysisFilterTriggerProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label" | "children"
> & {
  readonly ariaLabel: string;
  readonly label: string;
  readonly summary: string;
};

function WorkAnalysisFilterTrigger({
  ariaLabel,
  label,
  style,
  summary,
  ...buttonProps
}: WorkAnalysisFilterTriggerProps) {
  return (
    <Button
      {...buttonProps}
      aria-label={ariaLabel}
      variant="secondary"
      style={{ maxWidth: "min(100%, 220px)", ...style }}
    >
      <span
        style={{
          display: "grid",
          gap: 6,
          gridTemplateColumns: "auto minmax(0, 1fr)",
          maxWidth: 180,
          minWidth: 0,
        }}
      >
        <span>{label}</span>
        <span
          aria-hidden="true"
          style={{
            color: "var(--text-tertiary)",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {summary}
        </span>
      </span>
    </Button>
  );
}

function WorkAnalysisDirectoryMultiSelect({
  availableWorkspacePaths,
  hasCustomizedWorkspacePaths,
  selectedWorkspacePaths,
  setHasCustomizedWorkspacePaths,
  setSelectedWorkspacePaths,
  toggleWorkspacePath,
}: {
  readonly availableWorkspacePaths: string[];
  readonly hasCustomizedWorkspacePaths: boolean;
  readonly selectedWorkspacePaths: string[];
  readonly setHasCustomizedWorkspacePaths: (value: boolean) => void;
  readonly setSelectedWorkspacePaths: (paths: string[]) => void;
  readonly toggleWorkspacePath: (workspacePath: string) => void;
}) {
  if (availableWorkspacePaths.length === 0) {
    return <span style={{ ...mutedStyle, fontSize: 13 }}>暂无可筛选目录。</span>;
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div
        style={{
          alignItems: "center",
          display: "flex",
          gap: 8,
          justifyContent: "space-between",
        }}
      >
        <span id="work-analysis-directory-filter-label" style={labelStyle}>
          目录筛选
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setHasCustomizedWorkspacePaths(false);
            setSelectedWorkspacePaths(availableWorkspacePaths);
          }}
        >
          全部目录
        </Button>
      </div>
      <div
        role="group"
        aria-labelledby="work-analysis-directory-filter-label"
        style={{
          display: "grid",
          gap: 6,
          maxHeight: 220,
          minWidth: 0,
          overflow: "auto",
        }}
      >
        {availableWorkspacePaths.map((workspacePath) => {
          const checked =
            !hasCustomizedWorkspacePaths || selectedWorkspacePaths.includes(workspacePath);

          return (
            <button
              key={workspacePath}
              type="button"
              role="checkbox"
              aria-checked={checked}
              onClick={() => toggleWorkspacePath(workspacePath)}
              style={{
                alignItems: "center",
                background: checked ? "var(--state-selected-bg)" : "transparent",
                border: `1px solid ${
                  checked ? "var(--state-selected-border)" : "var(--border-subtle)"
                }`,
                borderRadius: "var(--radius-control-sm)",
                color: "var(--text-primary)",
                display: "grid",
                gap: 10,
                gridTemplateColumns: "18px minmax(0, 1fr)",
                minHeight: 40,
                minWidth: 0,
                padding: "8px 10px",
                textAlign: "left",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  alignItems: "center",
                  background: checked ? "var(--control-primary-bg)" : "var(--field-bg)",
                  border: `1px solid ${
                    checked ? "var(--control-primary-bg)" : "var(--field-border)"
                  }`,
                  borderRadius: 5,
                  color: "var(--control-primary-fg)",
                  display: "inline-flex",
                  fontSize: 12,
                  height: 16,
                  justifyContent: "center",
                  lineHeight: 1,
                  width: 16,
                }}
              >
                {checked ? "✓" : ""}
              </span>
              <span
                style={{
                  minWidth: 0,
                  overflowWrap: "anywhere",
                }}
              >
                {workspacePath}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AnalysisTimeFilterPopover({
  customRange,
  rangePreset,
  setCustomRange,
  setRangePreset,
}: {
  readonly customRange: { startAt: string; endAt: string };
  readonly rangePreset: WorkAnalysisPresetRange | "custom";
  readonly setCustomRange: (range: { startAt: string; endAt: string }) => void;
  readonly setRangePreset: (range: WorkAnalysisPresetRange | "custom") => void;
}) {
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const [activeCustomPicker, setActiveCustomPicker] = useState<"start" | "end" | null>(null);
  const rangeOptions = WORK_ANALYSIS_PRESET_OPTIONS.map((option) => ({
    value: option.value,
    label: t(option.labelKey),
  }));
  const rangeLabel =
    rangeOptions.find((option) => option.value === rangePreset)?.label ?? String(rangePreset);
  const selectRangePreset = (value: WorkAnalysisPresetRange | "custom") => {
    setRangePreset(value);
    if (value !== "custom") {
      setActiveCustomPicker(null);
      setOpen(false);
    }
  };
  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setActiveCustomPicker(null);
    }
  };

  const content = (
    <div
      style={{
        display: "grid",
        gap: 12,
        minWidth: "min(280px, calc(100vw - 64px))",
        width: "min(420px, calc(100vw - 48px))",
      }}
    >
      <div style={{ display: "grid", gap: 6 }}>
        <span id="work-analysis-range-label" style={labelStyle}>
          时间范围
        </span>
        <div
          role="radiogroup"
          aria-labelledby="work-analysis-range-label"
          style={{
            display: "grid",
            gap: 8,
            gridTemplateColumns: "repeat(auto-fit, minmax(128px, 1fr))",
          }}
        >
          {rangeOptions.map((option) => {
            const checked = option.value === rangePreset;

            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={checked}
                onClick={() => selectRangePreset(option.value)}
                style={{
                  alignItems: "center",
                  background: checked ? "var(--state-selected-bg)" : "var(--field-bg)",
                  border: `1px solid ${
                    checked ? "var(--state-selected-border)" : "var(--border-subtle)"
                  }`,
                  borderRadius: "var(--radius-control-sm)",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                  display: "grid",
                  fontWeight: checked ? "var(--font-semibold)" : "var(--font-medium)",
                  gap: 8,
                  gridTemplateColumns: "18px minmax(0, 1fr)",
                  minHeight: 44,
                  minWidth: 0,
                  padding: "10px 12px",
                  textAlign: "left",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    alignItems: "center",
                    background: checked ? "var(--control-primary-bg)" : "var(--field-bg)",
                    border: `1px solid ${
                      checked ? "var(--control-primary-bg)" : "var(--field-border)"
                    }`,
                    borderRadius: 999,
                    display: "inline-flex",
                    height: 16,
                    justifyContent: "center",
                    width: 16,
                  }}
                >
                  <span
                    style={{
                      background: "var(--control-primary-fg)",
                      borderRadius: 999,
                      display: checked ? "block" : "none",
                      height: 6,
                      width: 6,
                    }}
                  />
                </span>
                <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{option.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      {rangePreset === "custom" ? (
        <div
          style={{
            display: "grid",
            gap: 10,
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          }}
        >
          <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
            <span style={labelStyle}>开始时间</span>
            <DateTimePicker
              label="开始时间"
              open={activeCustomPicker === "start"}
              onOpenChange={(nextOpen) => setActiveCustomPicker(nextOpen ? "start" : null)}
              value={customRange.startAt}
              onValueChange={(value) => setCustomRange({ ...customRange, startAt: value })}
              forceMode="desktop"
            />
          </div>
          <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
            <span style={labelStyle}>结束时间</span>
            <DateTimePicker
              label="结束时间"
              open={activeCustomPicker === "end"}
              onOpenChange={(nextOpen) => setActiveCustomPicker(nextOpen ? "end" : null)}
              value={customRange.endAt}
              onValueChange={(value) => setCustomRange({ ...customRange, endAt: value })}
              forceMode="desktop"
            />
          </div>
        </div>
      ) : null}
    </div>
  );

  return (
    <Popover
      content={content}
      forceMode="desktop"
      open={open}
      onOpenChange={handleOpenChange}
      placement="bottom-end"
      title="筛选时间范围"
    >
      <WorkAnalysisFilterTrigger
        ariaLabel={`时间筛选：${rangeLabel}`}
        label="时间"
        summary={rangeLabel}
      />
    </Popover>
  );
}

function AnalysisDirectoryFilterPopover({
  availableWorkspacePaths,
  hasCustomizedWorkspacePaths,
  selectedWorkspacePaths,
  setHasCustomizedWorkspacePaths,
  setSelectedWorkspacePaths,
  toggleWorkspacePath,
}: {
  readonly availableWorkspacePaths: string[];
  readonly hasCustomizedWorkspacePaths: boolean;
  readonly selectedWorkspacePaths: string[];
  readonly setHasCustomizedWorkspacePaths: (value: boolean) => void;
  readonly setSelectedWorkspacePaths: (paths: string[]) => void;
  readonly toggleWorkspacePath: (workspacePath: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const directorySummary = formatDirectoryFilterSummary({
    hasCustomizedWorkspacePaths,
    selectedWorkspacePaths,
  });
  const content = (
    <div
      style={{
        display: "grid",
        gap: 16,
        minWidth: "min(280px, calc(100vw - 64px))",
        width: "min(420px, calc(100vw - 48px))",
      }}
    >
      <WorkAnalysisDirectoryMultiSelect
        availableWorkspacePaths={availableWorkspacePaths}
        hasCustomizedWorkspacePaths={hasCustomizedWorkspacePaths}
        selectedWorkspacePaths={selectedWorkspacePaths}
        setHasCustomizedWorkspacePaths={setHasCustomizedWorkspacePaths}
        setSelectedWorkspacePaths={setSelectedWorkspacePaths}
        toggleWorkspacePath={toggleWorkspacePath}
      />
    </div>
  );

  return (
    <Popover
      content={content}
      forceMode="desktop"
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      title="筛选目录"
    >
      <WorkAnalysisFilterTrigger
        ariaLabel={`目录筛选：${directorySummary}`}
        label="目录"
        summary={directorySummary}
      />
    </Popover>
  );
}

function KpiGrid({
  kpis,
}: {
  readonly kpis: Array<{
    key: KpiKey;
    label: string;
    value: number;
    displayValue?: string;
    helper?: string;
  }>;
}) {
  if (kpis.length === 0) {
    return null;
  }

  return (
    <section
      style={{
        display: "grid",
        gap: 12,
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
      }}
    >
      {kpis.map((kpi) => (
        <article key={kpi.key} style={{ ...panelContentStyle, minHeight: 116 }}>
          <div style={{ display: "grid", gap: 10 }}>
            <span style={labelStyle}>{kpi.label}</span>
            <strong style={{ fontSize: 25, letterSpacing: "-0.03em", lineHeight: 1.05 }}>
              {formatKpiValue(kpi.key, kpi.value, kpi.displayValue)}
            </strong>
            {kpi.helper ? (
              <span style={{ ...mutedStyle, fontSize: 12, overflowWrap: "anywhere" }}>
                {kpi.helper}
              </span>
            ) : null}
          </div>
        </article>
      ))}
    </section>
  );
}

function TrendSummary({ points }: { readonly points: WorkAnalysisTokenTrendPoint[] }) {
  const totals = points.reduce(
    (acc, point) => ({
      activeDurationMs: acc.activeDurationMs + point.activeDurationMs,
      cachedInputTokens: acc.cachedInputTokens + point.cachedInputTokens,
      inputTokens: acc.inputTokens + point.inputTokens,
      outputTokens: acc.outputTokens + point.outputTokens,
      sessionCount: acc.sessionCount + point.sessionCount,
      totalTokens: acc.totalTokens + point.totalTokens,
    }),
    {
      activeDurationMs: 0,
      cachedInputTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      sessionCount: 0,
      totalTokens: 0,
    }
  );

  const items = [
    { label: "输入 token", value: formatTokenMetric(totals.inputTokens) },
    { label: "输出 token", value: formatTokenMetric(totals.outputTokens) },
    { label: "缓存输入", value: formatTokenMetric(totals.cachedInputTokens) },
    { label: "会话数", value: formatInteger(totals.sessionCount) },
    { label: "活跃时间", value: formatDuration(totals.activeDurationMs) },
  ];

  return (
    <div
      style={{
        display: "grid",
        gap: 10,
        gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
      }}
    >
      {items.map((item) => (
        <div
          key={item.label}
          style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 10 }}
        >
          <div style={{ ...mutedStyle, fontSize: 12 }}>{item.label}</div>
          <strong style={{ fontSize: 16 }}>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

function TokenTrendChart({
  daily,
  hourly,
  timeRange,
}: {
  readonly daily: WorkAnalysisTokenTrendPoint[];
  readonly hourly: WorkAnalysisTokenTrendPoint[];
  readonly timeRange: TrendTimeRange;
}) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const trendDisplay = useMemo(
    () => buildTokenTrendDisplay({ daily, hourly, timeRange }),
    [daily, hourly, timeRange]
  );
  const trendPoints = trendDisplay.points;
  const chartData = useMemo(
    () =>
      trendPoints.map((point) => ({
        activeDurationMs: point.activeDurationMs,
        sessionCount: point.sessionCount,
        timestamp: point.timestamp,
        totalTokens: point.totalTokens,
      })),
    [trendPoints]
  );

  useEffect(() => {
    const container = chartRef.current;
    if (!container || chartData.length === 0) {
      return;
    }

    const style = getComputedStyle(container);
    const textColor = style.getPropertyValue("--text-secondary").trim() || "#6b7280";
    const primaryTextColor = style.getPropertyValue("--text-primary").trim() || "#111827";
    const gridColor = style.getPropertyValue("--border-subtle").trim() || "#d1d5db";
    const accentColor = style.getPropertyValue("--status-info-fg").trim() || "#0f766e";
    const panelColor = style.getPropertyValue("--surface-panel").trim() || "#ffffff";
    const chart = echarts.init(container);

    chart.setOption({
      animationDuration: 600,
      grid: {
        bottom: 42,
        containLabel: true,
        left: 12,
        right: 18,
        top: 18,
      },
      series: [
        {
          areaStyle: {
            color: `${accentColor}24`,
          },
          data: chartData.map((point) => [point.timestamp, point.totalTokens]),
          emphasis: {
            focus: "series",
          },
          lineStyle: {
            color: accentColor,
            width: 3,
          },
          name: "Token",
          showSymbol: chartData.length <= 24,
          smooth: true,
          symbolSize: 7,
          type: "line",
        },
      ],
      tooltip: {
        backgroundColor: panelColor,
        borderColor: gridColor,
        borderWidth: 1,
        confine: true,
        textStyle: {
          color: primaryTextColor,
        },
        trigger: "axis",
        formatter: (params: unknown) => {
          const timestamp = getTooltipTimestamp(params);
          const point = chartData.find((item) => item.timestamp === timestamp);
          if (!point) {
            return "";
          }

          return [
            `<strong>${formatDateTime(point.timestamp)}</strong>`,
            `Token：${formatTokenMetric(point.totalTokens)}`,
            `会话数：${formatInteger(point.sessionCount)}`,
            `活跃时间：${formatDuration(point.activeDurationMs)}`,
          ].join("<br />");
        },
      },
      xAxis: {
        axisLabel: {
          color: textColor,
          hideOverlap: true,
        },
        axisLine: {
          lineStyle: {
            color: gridColor,
          },
        },
        axisTick: {
          lineStyle: {
            color: gridColor,
          },
        },
        name: "时间",
        nameGap: 24,
        nameLocation: "middle",
        nameTextStyle: {
          color: textColor,
        },
        max: timeRange.endAt,
        min: timeRange.startAt,
        splitLine: {
          show: false,
        },
        type: "time",
      },
      yAxis: {
        axisLabel: {
          color: textColor,
          formatter: (value: number) => formatTokenMetric(value),
        },
        name: "Token",
        nameTextStyle: {
          color: textColor,
        },
        splitLine: {
          lineStyle: {
            color: gridColor,
            type: "dashed",
          },
        },
        type: "value",
      },
    });

    const resizeChart = () => chart.resize();
    window.addEventListener("resize", resizeChart);

    return () => {
      window.removeEventListener("resize", resizeChart);
      chart.dispose();
    };
  }, [chartData, timeRange.endAt, timeRange.startAt]);

  return (
    <section
      data-testid="token-trend-row"
      style={{ ...panelContentStyle, display: "grid", gap: 18 }}
    >
      <SectionHeader
        eyebrow="Adaptive range"
        title="Token 趋势"
        subtitle="横轴完整覆盖当前筛选范围，并按范围长度自动切换小时、6 小时或日粒度。"
      />
      {chartData.length > 0 ? (
        <>
          <div
            aria-label="Token 趋势图，横轴时间，纵轴 Token"
            data-testid="token-trend-chart"
            ref={chartRef}
            style={{
              height: 280,
              minWidth: 0,
              width: "100%",
            }}
          />
          <div
            style={{
              ...mutedStyle,
              display: "flex",
              flexWrap: "wrap",
              fontSize: 12,
              gap: "6px 14px",
            }}
          >
            <span>横轴：时间</span>
            <span>纵轴：Token</span>
            <span>粒度：{formatTrendGranularity(trendDisplay.granularity)}</span>
            <span>
              峰值：{formatTokenMetric(Math.max(...chartData.map((point) => point.totalTokens)))}
            </span>
          </div>
          <TrendSummary points={trendPoints} />
        </>
      ) : (
        <EmptyPanel>当前时间范围暂无 token 趋势数据。点击立即刷新后会生成小时级索引。</EmptyPanel>
      )}
    </section>
  );
}

function RankingPanel({
  emptyText,
  items,
  title,
}: {
  readonly emptyText: string;
  readonly items: WorkAnalysisContributionRank[];
  readonly title: string;
}) {
  const topTokens = Math.max(...items.map((item) => item.totalTokens), 1);

  return (
    <article data-ranking-column="true" style={rankingPanelShellStyle}>
      <SectionHeader title={title} />
      <div data-ranking-scroll="true" style={fixedPanelScrollStyle}>
        {items.length > 0 ? (
          <div data-ranking-list="true" style={{ alignContent: "start", display: "grid", gap: 12 }}>
            {items.slice(0, 8).map((item, index) => {
              const width = clampPercent((item.totalTokens / topTokens) * 100);
              return (
                <div key={item.key} style={{ display: "grid", gap: 6 }}>
                  <div
                    style={{
                      alignItems: "baseline",
                      display: "grid",
                      gap: 8,
                      gridTemplateColumns: "auto minmax(0, 1fr) auto",
                    }}
                  >
                    <span
                      style={{ ...mutedStyle, fontSize: 12, fontVariantNumeric: "tabular-nums" }}
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <strong
                      style={{
                        fontSize: 13,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={item.label}
                    >
                      {item.label}
                    </strong>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>
                      {formatTokenMetric(item.totalTokens)}
                    </span>
                  </div>
                  <div
                    style={{
                      background: "var(--surface-hover)",
                      borderRadius: 999,
                      height: 8,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        background: "var(--status-info-fg)",
                        borderRadius: 999,
                        height: "100%",
                        width: `${Math.max(2, width)}%`,
                      }}
                    />
                  </div>
                  <div
                    style={{
                      ...mutedStyle,
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "4px 10px",
                      fontSize: 12,
                    }}
                  >
                    <span>{formatPercent(item.shareOfTokens)}</span>
                    <span>{formatInteger(item.sessionCount)} 会话</span>
                    {item.activeDurationMs > 0 ? (
                      <span>{formatDuration(item.activeDurationMs)}</span>
                    ) : null}
                    {item.subtitle ? <span>{item.subtitle}</span> : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyPanel>{emptyText}</EmptyPanel>
        )}
      </div>
    </article>
  );
}

function ContributionRow({
  agents,
  models,
  projects,
}: {
  readonly agents: WorkAnalysisContributionRank[];
  readonly models: WorkAnalysisContributionRank[];
  readonly projects: WorkAnalysisContributionRank[];
}) {
  return (
    <section
      data-testid="token-contribution-row"
      style={{
        display: "grid",
        gap: 12,
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
      }}
    >
      <RankingPanel
        emptyText="暂无项目 token 贡献数据。"
        items={projects}
        title="项目 token 贡献排行"
      />
      <RankingPanel
        emptyText="暂无模型 token 贡献数据。"
        items={models}
        title="模型 token 贡献排行"
      />
      <RankingPanel
        emptyText="暂无 Agent token 贡献数据。"
        items={agents}
        title="Agent token 贡献排行"
      />
    </section>
  );
}

function CompactRanking({
  items,
  title,
}: {
  readonly items: WorkAnalysisContributionRank[];
  readonly title: string;
}) {
  return (
    <article data-compact-ranking-panel="true" style={compactPanelShellStyle}>
      <SectionHeader title={title} />
      <div data-compact-ranking-scroll="true" style={fixedPanelScrollStyle}>
        {items.length > 0 ? (
          <div style={{ display: "grid", gap: 10 }}>
            {items.slice(0, 6).map((item) => (
              <div
                key={item.key}
                style={{
                  alignItems: "baseline",
                  borderBottom: "1px solid var(--border-subtle)",
                  display: "grid",
                  gap: 10,
                  gridTemplateColumns: "minmax(0, 1fr) auto",
                  paddingBottom: 10,
                }}
              >
                <span
                  style={{
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {item.label}
                </span>
                <strong>{formatTokenMetric(item.totalTokens)}</strong>
              </div>
            ))}
          </div>
        ) : (
          <EmptyPanel>暂无数据。</EmptyPanel>
        )}
      </div>
    </article>
  );
}

function getSkillProviderIds(item: WorkAnalysisSkillBreakdown) {
  const legacyProviderId = (item as WorkAnalysisSkillBreakdown & { providerId?: unknown })
    .providerId;
  const providerIds = Array.isArray(item.providerIds) ? item.providerIds : [];
  return [
    ...new Set([
      ...providerIds,
      ...(typeof legacyProviderId === "string" && legacyProviderId.trim().length > 0
        ? [legacyProviderId]
        : []),
    ]),
  ].sort((left, right) => left.localeCompare(right));
}

function formatSkillProviderSource(item: WorkAnalysisSkillBreakdown) {
  const providerIds = getSkillProviderIds(item);
  if (providerIds.length === 0) {
    return "来源: 未知";
  }

  return `来源: ${providerIds.map(formatProviderDisplayName).join(", ")}`;
}

function SkillAttributionPanel({ items }: { readonly items: WorkAnalysisSkillBreakdown[] }) {
  const maxCalls = Math.max(...items.map((item) => item.callCount), 1);

  return (
    <article data-skill-attribution-panel="true" style={compactPanelShellStyle}>
      <SectionHeader
        title="Skill 调用归因"
        subtitle="目前仅统计 Claude 日志中可识别的 Skill 调用次数。"
      />
      <div data-skill-attribution-scroll="true" style={fixedPanelScrollStyle}>
        {items.length > 0 ? (
          <div style={{ display: "grid", gap: 12 }}>
            {items.slice(0, 8).map((item) => {
              const width = clampPercent((item.callCount / maxCalls) * 100);
              return (
                <div key={item.key} style={{ display: "grid", gap: 6 }}>
                  <div
                    style={{
                      alignItems: "baseline",
                      display: "grid",
                      gap: 10,
                      gridTemplateColumns: "minmax(0, 1fr) auto",
                    }}
                  >
                    <strong
                      style={{
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={item.label}
                    >
                      {item.label}
                    </strong>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>
                      {formatInteger(item.callCount)} 次
                    </span>
                  </div>
                  <div
                    style={{
                      background: "var(--surface-hover)",
                      borderRadius: 999,
                      height: 8,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        background: "var(--status-info-fg)",
                        borderRadius: 999,
                        height: "100%",
                        width: `${item.callCount > 0 ? Math.max(2, width) : 0}%`,
                      }}
                    />
                  </div>
                  <div
                    style={{
                      ...mutedStyle,
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "4px 10px",
                      fontSize: 12,
                    }}
                  >
                    <span>{formatPercent(item.shareOfCalls)}</span>
                    <span>{formatInteger(item.sessionCount)} 会话</span>
                    <span>{formatSkillProviderSource(item)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyPanel>暂无 Skill 调用数据。</EmptyPanel>
        )}
      </div>
    </article>
  );
}

function formatHourLabel(hour: number) {
  return `${hour.toString().padStart(2, "0")}:00`;
}

function formatHourRange(hour: number) {
  return `${formatHourLabel(hour)}-${hour.toString().padStart(2, "0")}:59`;
}

function formatHourShare(value: number) {
  return `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  }).format(value * 100)}%`;
}

function getLocalHour(timestamp: number, timeZone?: string) {
  const options: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    hourCycle: "h23",
    ...(timeZone ? { timeZone } : {}),
  };
  const hourPart = new Intl.DateTimeFormat("en-US", options)
    .formatToParts(timestamp)
    .find((part) => part.type === "hour")?.value;
  const hour = Number(hourPart);

  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : new Date(timestamp).getHours();
}

export function buildLocalHourHeatmapPoints({
  fallbackPoints = [],
  hourly,
  timeZone,
}: {
  readonly fallbackPoints?: WorkAnalysisHourHeatPoint[];
  readonly hourly: WorkAnalysisTokenTrendPoint[];
  readonly timeZone?: string;
}): WorkAnalysisHourHeatPoint[] {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    totalTokens: 0,
    sessionCount: 0,
  }));
  const sourcePoints = hourly.filter((point) => typeof point.hourStart === "number");

  if (sourcePoints.length === 0) {
    const byHour = new Map(fallbackPoints.map((point) => [point.hour, point]));
    return buckets.map((bucket) => ({
      hour: bucket.hour,
      intensity: byHour.get(bucket.hour)?.intensity ?? 0,
      sessionCount: byHour.get(bucket.hour)?.sessionCount ?? 0,
      totalTokens: byHour.get(bucket.hour)?.totalTokens ?? 0,
    }));
  }

  for (const point of sourcePoints) {
    const hourStart = point.hourStart;
    if (typeof hourStart !== "number") {
      continue;
    }

    const hour = getLocalHour(hourStart, timeZone);
    buckets[hour]!.totalTokens += point.totalTokens;
    buckets[hour]!.sessionCount += point.sessionCount;
  }

  const maxTokens = Math.max(...buckets.map((bucket) => bucket.totalTokens), 1);
  return buckets.map((bucket) => ({
    ...bucket,
    intensity: bucket.totalTokens / maxTokens,
  }));
}

function HourHeatmap({
  fallbackPoints,
  hourly,
}: {
  readonly fallbackPoints: WorkAnalysisHourHeatPoint[];
  readonly hourly: WorkAnalysisTokenTrendPoint[];
}) {
  const hourlyPoints = useMemo(
    () => buildLocalHourHeatmapPoints({ fallbackPoints, hourly }),
    [fallbackPoints, hourly]
  );
  const totalTokens = hourlyPoints.reduce((sum, point) => sum + point.totalTokens, 0);
  const peakPoint = hourlyPoints.reduce((peak, point) =>
    point.totalTokens > peak.totalTokens ? point : peak
  );
  const hasData = totalTokens > 0;

  return (
    <article style={{ ...panelContentStyle, display: "grid", gap: 14 }}>
      <SectionHeader
        title="24 小时消耗分布"
        subtitle="按浏览器本地时区聚合当前筛选范围内所有日期，不表示某一天的连续 24 小时。"
      />
      {hasData ? (
        <>
          <div
            style={{
              background: "var(--surface-muted)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-control-lg)",
              color: "var(--text-secondary)",
              display: "grid",
              gap: 6,
              fontSize: 12,
              lineHeight: 1.5,
              padding: 12,
            }}
          >
            <strong style={{ color: "var(--text-primary)", fontSize: 13 }}>
              峰值时段：{formatHourLabel(peakPoint.hour)}，
              {formatTokenMetric(peakPoint.totalTokens)} tokens，占{" "}
              {formatHourShare(peakPoint.totalTokens / totalTokens)}。
            </strong>
            <span>
              数据口径：每个格子表示当前筛选范围内所有日期的同一小时段汇总；例如 03:00
              表示按本地时区落在 03:00-03:59 的 token 总量。
            </span>
            <span>
              占比口径：该小时段 token / 24 小时总 token；颜色越深表示在 24 个小时段中消耗越高。
            </span>
          </div>
          <div
            aria-label="24 小时 token 消耗分布"
            style={{
              display: "grid",
              gap: 8,
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            }}
          >
            {hourlyPoints.map((point) => {
              const intensity = clampPercent(point.intensity * 100);
              const share = totalTokens > 0 ? point.totalTokens / totalTokens : 0;
              return (
                <div
                  key={point.hour}
                  title={`${formatHourRange(point.hour)} · ${formatTokenMetric(
                    point.totalTokens
                  )} tokens · ${formatHourShare(share)} · ${formatInteger(
                    point.sessionCount
                  )} sessions`}
                  style={{
                    background: "var(--surface-muted)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 10,
                    color: intensity > 55 ? "var(--text-primary)" : "var(--text-secondary)",
                    display: "grid",
                    gap: 4,
                    isolation: "isolate",
                    minHeight: 74,
                    overflow: "hidden",
                    padding: "10px 8px",
                    position: "relative",
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      background: "var(--status-info-fg)",
                      inset: 0,
                      opacity: 0.06 + intensity / 120,
                      position: "absolute",
                      zIndex: -1,
                    }}
                  />
                  <span style={{ fontSize: 10, fontWeight: 700, lineHeight: 1.15 }}>
                    {formatHourRange(point.hour)}
                  </span>
                  <strong style={{ color: "var(--text-primary)", fontSize: 13, lineHeight: 1.1 }}>
                    {formatTokenMetric(point.totalTokens)}
                  </strong>
                  <span style={{ fontSize: 11, lineHeight: 1 }}>{formatHourShare(share)}</span>
                </div>
              );
            })}
          </div>
          <div
            style={{
              alignItems: "center",
              color: "var(--text-tertiary)",
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              fontSize: 12,
            }}
          >
            <span>低消耗</span>
            <span
              aria-hidden="true"
              style={{
                background:
                  "linear-gradient(90deg, color-mix(in srgb, var(--status-info-fg) 10%, transparent), var(--status-info-fg))",
                border: "1px solid var(--border-subtle)",
                borderRadius: 999,
                display: "inline-block",
                height: 8,
                width: 120,
              }}
            />
            <span>高消耗</span>
            <span style={{ color: "var(--text-secondary)" }}>
              共 {formatTokenMetric(totalTokens)} tokens，按小时段占比拆分。
            </span>
          </div>
        </>
      ) : (
        <EmptyPanel>
          暂无小时热力数据。立即刷新后会按当前筛选范围汇总 0-23 点的 token 消耗分布。
        </EmptyPanel>
      )}
    </article>
  );
}

function WorkAnalyticsContent({ syncRoute = true }: { syncRoute?: boolean } = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [rebuildConfirmOpen, setRebuildConfirmOpen] = useState(false);
  const routeState = useMemo(() => parseWorkAnalyticsSearch(location.search), [location.search]);
  const {
    availableWorkspacePaths,
    customRange,
    dashboard,
    dashboardLoading,
    dashboardRecord,
    hasCustomizedWorkspacePaths,
    isRefreshingDashboard,
    isRebuildingDashboard,
    rangePreset,
    rebuildDashboardIndex,
    refreshDashboard,
    selectedWorkspacePaths,
    setCustomRange,
    setHasCustomizedWorkspacePaths,
    setRangePreset,
    setSelectedWorkspacePaths,
    toggleWorkspacePath,
  } = useWorkAnalysisController({
    initialCustomRange:
      routeState.rangePreset === "custom" && routeState.customStartAt && routeState.customEndAt
        ? {
            startAt: routeState.customStartAt,
            endAt: routeState.customEndAt,
          }
        : undefined,
    initialRangePreset: routeState.rangePreset,
    initialWorkspacePaths: routeState.workspacePaths,
  });

  useEffect(() => {
    if (!syncRoute) {
      return;
    }

    const nextPath = buildWorkAnalyticsPath({
      customEndAt: customRange.endAt,
      customStartAt: customRange.startAt,
      rangePreset,
      workspacePaths: hasCustomizedWorkspacePaths ? selectedWorkspacePaths : [],
    });

    if (`${location.pathname}${location.search}` !== nextPath) {
      navigate(nextPath, { replace: true });
    }
  }, [
    customRange.endAt,
    customRange.startAt,
    hasCustomizedWorkspacePaths,
    location.pathname,
    location.search,
    navigate,
    rangePreset,
    selectedWorkspacePaths,
    syncRoute,
  ]);

  const scanState = dashboardRecord?.scanState;
  const displayedScanState: WorkAnalysisDashboardScanState | undefined =
    scanState ??
    (dashboardLoading
      ? {
          mode: "auto",
          status: "running",
          providerStatuses: [],
        }
      : undefined);
  const providerStatuses = scanState?.providerStatuses ?? dashboard?.quality.providers ?? [];
  const warningMessages = [
    ...(scanState?.errorMessage ? [scanState.errorMessage] : []),
    ...(dashboard?.quality.warnings ?? []),
  ];
  const handleConfirmRebuildDashboardIndex = () => {
    setRebuildConfirmOpen(false);
    void rebuildDashboardIndex();
  };

  return (
    <div data-testid="work-analysis-root" style={pageStyle}>
      <DashboardStatusStrip
        filterControl={
          <>
            <AnalysisTimeFilterPopover
              customRange={customRange}
              rangePreset={rangePreset}
              setCustomRange={setCustomRange}
              setRangePreset={setRangePreset}
            />
            <AnalysisDirectoryFilterPopover
              availableWorkspacePaths={availableWorkspacePaths}
              hasCustomizedWorkspacePaths={hasCustomizedWorkspacePaths}
              selectedWorkspacePaths={selectedWorkspacePaths}
              setHasCustomizedWorkspacePaths={setHasCustomizedWorkspacePaths}
              setSelectedWorkspacePaths={setSelectedWorkspacePaths}
              toggleWorkspacePath={toggleWorkspacePath}
            />
          </>
        }
        isRebuilding={isRebuildingDashboard}
        isRefreshing={isRefreshingDashboard}
        providers={providerStatuses}
        scanState={displayedScanState}
        onRebuild={() => setRebuildConfirmOpen(true)}
        onRefresh={refreshDashboard}
      />

      <ConfirmDialog
        cancelText="取消"
        confirmDisabled={isRebuildingDashboard}
        confirmText={isRebuildingDashboard ? "强制刷新中..." : "确认强制刷新"}
        description={
          <>
            <p>将清空工作分析小时索引并重新扫描历史日志。</p>
            <p>这不会删除原始日志，但强制刷新期间统计数据会短暂刷新。</p>
          </>
        }
        onConfirm={handleConfirmRebuildDashboardIndex}
        onOpenChange={setRebuildConfirmOpen}
        open={rebuildConfirmOpen}
        title="强制刷新工作分析索引？"
        tone="danger"
      />

      {warningMessages.length > 0 ? (
        <Notice
          tone={scanState?.status === "failed" ? "error" : "warning"}
          title={scanState?.status === "failed" ? "索引刷新失败" : "数据质量提示"}
          message={warningMessages.join("；")}
        />
      ) : null}

      {dashboardLoading && !dashboard ? (
        <Notice
          tone="info"
          title="正在读取或补齐索引"
          message="如果索引缺失或落后，服务会自动补齐后返回最新数据。"
        />
      ) : null}

      {dashboard ? (
        <>
          <KpiGrid kpis={dashboard.kpis} />
          <TokenTrendChart
            hourly={dashboard.trends.tokenHourly}
            daily={dashboard.trends.tokenDaily}
            timeRange={dashboard.timeRange}
          />
          <ContributionRow
            agents={dashboard.rankings.agents}
            models={dashboard.rankings.models}
            projects={dashboard.rankings.projects}
          />
          <section
            style={{
              display: "grid",
              gap: 12,
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
            }}
          >
            <CompactRanking items={dashboard.breakdowns.tasks} title="任务类型 Token 分布" />
            <CompactRanking items={dashboard.breakdowns.tools} title="工具调用 Token 归因" />
            <SkillAttributionPanel items={dashboard.breakdowns.skills ?? []} />
          </section>
          <section
            style={{
              display: "grid",
              gap: 12,
            }}
          >
            <HourHeatmap
              fallbackPoints={dashboard.trends.hourHeatmap}
              hourly={dashboard.trends.tokenHourly}
            />
          </section>
        </>
      ) : (
        <section style={{ ...panelContentStyle, display: "grid", gap: 14 }}>
          <SectionHeader
            title="暂无工作分析索引"
            subtitle="服务会在进入页面时自动补齐缺失或落后的小时索引，也可以手动立即刷新。"
          />
          <div>
            <Button loading={isRefreshingDashboard} onClick={refreshDashboard} variant="primary">
              立即刷新
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

export function WorkAnalyticsSettingsSection({ embedded = true }: { embedded?: boolean } = {}) {
  return (
    <div className="settings-section" style={{ display: "grid", gap: 16 }}>
      <WorkAnalyticsContent syncRoute={!embedded} />
    </div>
  );
}

export function WorkAnalyticsPage() {
  const isMobile = useViewport() === "mobile";
  const t = useTranslation();

  return (
    <div
      className={`work-analytics-page ${isMobile ? "work-analytics-page--mobile" : ""}`}
      data-testid="work-analytics-page"
    >
      <header className="work-analytics-page__header">
        {isMobile ? (
          <MobilePageHeader
            title={t("settings.analysis.title")}
            titleAs="div"
            onBack={() => window.history.back()}
            backLabel={t("action.back")}
          />
        ) : (
          <PageHeader
            title={t("settings.analysis.title")}
            titleAs="div"
            level="secondary"
            onBack={() => window.history.back()}
            backLabel={t("action.back")}
          />
        )}
      </header>
      <main className="work-analytics-page__content">
        <WorkAnalyticsContent />
      </main>
    </div>
  );
}
