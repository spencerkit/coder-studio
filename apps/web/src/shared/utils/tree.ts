import type { TreeNode } from "../../state/workbench";
import type { Locale } from "../../i18n";

const treeSortCache = new WeakMap<TreeNode[], Map<Locale, TreeNode[]>>();
const collatorCache = new Map<Locale, Intl.Collator>();

const resolveTreeCollator = (locale: Locale) => {
  const cached = collatorCache.get(locale);
  if (cached) {
    return cached;
  }

  const collator = new Intl.Collator(locale === "zh" ? "zh-CN" : "en", {
    numeric: true,
    sensitivity: "base"
  });
  collatorCache.set(locale, collator);
  return collator;
};

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
  const cachedByLocale = treeSortCache.get(nodes);
  const cached = cachedByLocale?.get(locale);
  if (cached) {
    return cached;
  }

  const collator = resolveTreeCollator(locale);
  const sorted = [...nodes]
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "dir" ? -1 : 1;
      }
      return collator.compare(left.name, right.name);
    })
    .map((node) => {
      const children = node.children?.length ? sortTreeNodes(node.children, locale) : node.children;
      return children === node.children
        ? node
        : {
            ...node,
            children,
          };
    });

  if (cachedByLocale) {
    cachedByLocale.set(locale, sorted);
  } else {
    treeSortCache.set(nodes, new Map([[locale, sorted]]));
  }

  return sorted;
};
