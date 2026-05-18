import type { ReactNode } from "react";

export interface PanelHeaderProps {
  title: string;
  meta?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
}

export function PanelHeader({ title, meta, status, actions }: PanelHeaderProps) {
  return (
    <div className="panel-header">
      <div className="panel-header__leading">
        <div className="panel-header__copy">
          <div className="panel-header__title-row">
            {status ? <div className="panel-header__status">{status}</div> : null}
            <div className="panel-header__title">{title}</div>
          </div>
          {meta ? <div className="panel-header__meta">{meta}</div> : null}
        </div>
      </div>
      {actions ? <div className="panel-header__actions">{actions}</div> : null}
    </div>
  );
}
