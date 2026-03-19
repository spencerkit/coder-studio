import type { TreeNode } from "../../state/workbench";
import type { Locale } from "../../i18n";

export const flattenTree = (nodes: TreeNode[] = []): TreeNode[] => {
  const items: TreeNode[] = [];
  nodes.forEach((node) => {
    if (node.kind === "file") {
      items.push(node);
    }
    if (node.children?.length) {
      items.push(...flattenTree(node.children));
    }
  });
  return items;
};

export const sortTreeNodes = (nodes: TreeNode[], locale: Locale): TreeNode[] => {
  const collator = new Intl.Collator(locale === "zh" ? "zh-CN" : "en", {
    numeric: true,
    sensitivity: "base"
  });

  return [...nodes]
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "dir" ? -1 : 1;
      }
      return collator.compare(left.name, right.name);
    })
    .map((node) => ({
      ...node,
      children: node.children?.length ? sortTreeNodes(node.children, locale) : node.children
    }));
};
