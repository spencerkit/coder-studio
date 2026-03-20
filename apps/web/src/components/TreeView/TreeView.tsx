import type { TreeNode } from "../../state/workbench";
import type { Locale } from "../../i18n";
import { ChevronDownIcon, ChevronRightIcon, getFileIcon } from "../icons";
import { normalizeComparablePath, resolvePath } from "../../shared/utils/path";
import { sortTreeNodes } from "../../shared/utils/tree";

export type TreeViewProps = {
  nodes: TreeNode[];
  depth?: number;
  onSelect?: (node: TreeNode) => void;
  collapsedPaths?: Set<string>;
  onToggleCollapse?: (path: string) => void;
  locale?: Locale;
  selectedPath?: string;
  rootPath?: string;
};

export const TreeView = ({
  nodes,
  depth = 0,
  onSelect,
  collapsedPaths,
  onToggleCollapse,
  locale = "en",
  selectedPath,
  rootPath
}: TreeViewProps) => {
  if (!nodes?.length) return null;
  const sortedNodes = sortTreeNodes(nodes, locale);
  return (
    <div className="tree tree-list">
      {sortedNodes.map((node) => {
        const isDirectory = node.kind === "dir";
        const isExpanded = isDirectory ? collapsedPaths?.has(node.path) ?? false : false;
        const comparableSelectedPath = selectedPath ? normalizeComparablePath(selectedPath) : "";
        const isSelected = !isDirectory
          && Boolean(selectedPath)
          && normalizeComparablePath(rootPath ? resolvePath(rootPath, node.path) : node.path) === comparableSelectedPath;
        return (
          <div key={node.path} className="tree-node">
            <div
              className={`tree-line ${node.kind === "file" ? "file" : "dir"} ${node.status ? "changed" : ""} ${isSelected ? "selected" : ""}`}
              style={{ paddingLeft: `${depth * 16 + 8}px` }}
              onClick={() => {
                if (isDirectory) {
                  onToggleCollapse?.(node.path);
                  return;
                }
                onSelect?.(node);
              }}
            >
              <span className="tree-disclosure">
                {isDirectory ? (isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />) : null}
              </span>
              <span className="tree-icon">
                {getFileIcon(node.name, isDirectory, isExpanded)}
              </span>
              <span className="tree-label">{node.name}</span>
              {node.status && <span className="status">{node.status}</span>}
            </div>
            {node.children?.length && isExpanded ? (
              <div className="tree-children">
                <TreeView
                  nodes={node.children}
                  depth={depth + 1}
                  onSelect={onSelect}
                  collapsedPaths={collapsedPaths}
                  onToggleCollapse={onToggleCollapse}
                  locale={locale}
                  selectedPath={selectedPath}
                  rootPath={rootPath}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};
