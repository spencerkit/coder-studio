import type { ReactNode } from "react";

export interface PanelHeaderProps {
  title: string;
  meta?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  metaPlacement?: "stacked" | "inline";
  className?: string;
}

export function PanelHeader({
  title,
  meta,
  status,
  actions,
  metaPlacement = "stacked",
  className,
}: PanelHeaderProps) {
  const metaNode = meta ? (
    <div
      className={`panel-header__meta${metaPlacement === "inline" ? " panel-header__meta--inline" : ""}`}
    >
      {meta}
    </div>
  ) : null;

  return (
    <div
      className={`panel-header${metaPlacement === "inline" ? " panel-header--inline-meta" : ""}${className ? ` ${className}` : ""}`}
    >
      <div className="panel-header__leading">
        <div className="panel-header__copy">
          <div className="panel-header__title-row">
            {status ? <div className="panel-header__status">{status}</div> : null}
            <div className="panel-header__title">{title}</div>
            {metaPlacement === "inline" ? metaNode : null}
          </div>
          {metaPlacement === "stacked" ? metaNode : null}
        </div>
      </div>
      {actions ? <div className="panel-header__actions">{actions}</div> : null}
    </div>
  );
}
