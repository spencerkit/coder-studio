import type { RefObject } from "react";
import type { Locale } from "../../i18n";
import type { CommandPaletteAction } from "../../types/app";
import { SearchIcon } from "../icons";

type CommandPaletteProps = {
  locale: Locale;
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  activeIndex: number;
  actions: CommandPaletteAction[];
  activeAction?: CommandPaletteAction;
  onClose: () => void;
  onQueryChange: (value: string) => void;
  onActivateIndex: (index: number | ((current: number) => number)) => void;
  onRunAction: (action: CommandPaletteAction | undefined) => void;
};

export const CommandPalette = ({
  locale,
  inputRef,
  query,
  activeIndex,
  actions,
  activeAction,
  onClose,
  onQueryChange,
  onActivateIndex,
  onRunAction
}: CommandPaletteProps) => (
  <div
    className="command-palette-overlay"
    onMouseDown={(event) => {
      if (event.target === event.currentTarget) {
        onClose();
      }
    }}
  >
    <div
      className="command-palette"
      data-testid="command-palette-shell"
      role="dialog"
      aria-modal="true"
      aria-label={locale === "zh" ? "快速操作面板" : "Quick actions palette"}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="command-palette-header">
        <span className="section-kicker">{locale === "zh" ? "命令面板" : "Command Palette"}</span>
        <span className="command-palette-meta">
          {locale === "zh" ? `${actions.length} 项` : `${actions.length} items`}
        </span>
      </div>
      <div className="command-palette-search-row">
        <SearchIcon />
        <input
          ref={inputRef}
          className="command-palette-search-input"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={locale === "zh" ? "搜索操作、面板或工作区…" : "Search actions, panels, or workspaces..."}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              onActivateIndex((index) => {
                if (!actions.length) return 0;
                return Math.min(index + 1, actions.length - 1);
              });
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              onActivateIndex((index) => Math.max(index - 1, 0));
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              onRunAction(activeAction);
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
        />
      </div>
      <div className="command-palette-results">
        {actions.length === 0 ? (
          <div className="command-palette-empty">
            {locale === "zh" ? "未找到匹配操作" : "No matching actions"}
          </div>
        ) : (
          actions.map((action, index) => (
            <button
              key={action.id}
              type="button"
              className={`command-palette-item ${index === activeIndex ? "active" : ""}`}
              onMouseEnter={() => onActivateIndex(index)}
              onClick={() => onRunAction(action)}
            >
              <span className="command-palette-item-copy">
                <span className="command-palette-item-label">{action.label}</span>
                <span className="command-palette-item-description">{action.description}</span>
              </span>
              {action.shortcut && <span className="command-palette-shortcut">{action.shortcut}</span>}
            </button>
          ))
        )}
      </div>
    </div>
  </div>
);

export default CommandPalette;
