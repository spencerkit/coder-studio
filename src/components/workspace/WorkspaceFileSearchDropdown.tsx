import { createPortal } from "react-dom";
import type { Locale } from "../../i18n";

type SearchResult = {
  absolutePath: string;
  name: string;
  path: string;
};

type DropdownStyle = {
  left: number;
  width: number;
  maxHeight: number;
  placement: "above" | "below";
  top?: number;
  bottom?: number;
};

type WorkspaceFileSearchDropdownProps = {
  container: HTMLElement;
  locale: Locale;
  dropdownStyle: DropdownStyle;
  results: SearchResult[];
  activeIndex: number;
  onHover: (index: number) => void;
  onSelect: (node: SearchResult) => void;
  fileParentLabel: (path?: string) => string;
};

export const WorkspaceFileSearchDropdown = ({
  container,
  locale,
  dropdownStyle,
  results,
  activeIndex,
  onHover,
  onSelect,
  fileParentLabel
}: WorkspaceFileSearchDropdownProps) => createPortal(
  <div
    className={`workspace-search-dropdown floating ${dropdownStyle.placement}`}
    id="workspace-file-search-results"
    role="listbox"
    style={{
      left: dropdownStyle.left,
      width: dropdownStyle.width,
      maxHeight: dropdownStyle.maxHeight,
      top: dropdownStyle.top,
      bottom: dropdownStyle.bottom
    }}
  >
    {results.length === 0 ? (
      <div className="workspace-search-empty">{locale === "zh" ? "未找到匹配文件" : "No matching files"}</div>
    ) : (
      results.map((node, index) => (
        <button
          key={node.absolutePath}
          id={`workspace-file-search-option-${index}`}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          tabIndex={-1}
          className={`code-search-result ${index === activeIndex ? "active" : ""}`}
          onMouseEnter={() => onHover(index)}
          onMouseDown={(event) => {
            event.preventDefault();
            onSelect(node);
          }}
        >
          <span className="code-search-result-name">{node.name}</span>
          <span className="code-search-result-path">{fileParentLabel(node.path) || "."}</span>
        </button>
      ))
    )}
  </div>,
  container
);

export default WorkspaceFileSearchDropdown;
