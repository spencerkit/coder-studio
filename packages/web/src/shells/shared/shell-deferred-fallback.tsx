import type { CSSProperties } from "react";
import { EmptyState, Spinner } from "../../components/ui";
import { useTranslation } from "../../lib/i18n";

const deferredEmptyStateStyle = {
  minHeight: "auto",
  padding: "var(--sp-6)",
  gap: 0,
} satisfies CSSProperties;

const visuallyHiddenTitleStyle = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
} satisfies CSSProperties;

export function ShellDeferredFallback() {
  const t = useTranslation();

  return (
    <div className="app-loading-shell">
      <div className="app-loading-card">
        <EmptyState
          icon={<Spinner label={t("common.loading")} size="md" />}
          style={deferredEmptyStateStyle}
          title={<span style={visuallyHiddenTitleStyle}>{t("common.loading")}</span>}
        />
      </div>
    </div>
  );
}
