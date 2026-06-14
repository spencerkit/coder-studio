// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("memory panel styles", () => {
  it("keeps memory panel typography on design type tokens", () => {
    const css = readFileSync(`${process.cwd()}/src/styles/components.css`, "utf8");
    const memoryCss = css
      .split("\n\n")
      .filter((block) => block.includes(".memory-panel"))
      .join("\n");

    expect(memoryCss).toMatch(/var\(--type-(body|heading)-/u);
    expect(memoryCss).not.toMatch(/font-size:\s*(1[89]|[2-9]\d)px/u);
  });

  it("keeps delete actions visually nested inside each memory row", () => {
    const css = readFileSync(`${process.cwd()}/src/styles/components.css`, "utf8");
    const rowBlock = css.match(/\.memory-panel__list-row\s*\{[^}]+\}/u)?.[0] ?? "";
    const cardBlock = css.match(/\.memory-panel__card\s*\{[^}]+\}/u)?.[0] ?? "";
    const actionBlock = css.match(/\.memory-panel__item-action\s*\{[^}]+\}/u)?.[0] ?? "";
    const footerBlock = css.match(/\.memory-panel__item-meta\s*\{[^}]+\}/u)?.[0] ?? "";
    const footerActionsBlock =
      css.match(/\.memory-panel__item-meta-actions\s*\{[^}]+\}/u)?.[0] ?? "";

    expect(rowBlock).toContain("display: block");
    expect(rowBlock).not.toContain("grid-template-columns");
    expect(cardBlock).toContain("margin: 0 8px");
    expect(actionBlock).toContain("position: relative");
    expect(actionBlock).toContain("min-width: 24px");
    expect(actionBlock).toContain("box-sizing: border-box");
    expect(footerBlock).toContain("justify-content: space-between");
    expect(footerBlock).toContain("min-width: 0");
    expect(footerBlock).toContain("gap: 8px");
    expect(footerActionsBlock).toContain("max-width: 100%");
    expect(footerActionsBlock).toContain("gap: 0");
    expect(footerActionsBlock).not.toContain("margin-right: -");
    expect(footerActionsBlock).not.toContain("padding-right:");
  });

  it("uses only the new memory badge variants", () => {
    const css = readFileSync(`${process.cwd()}/src/styles/components.css`, "utf8");
    const badgeVariants = Array.from(
      css.matchAll(/\.memory-panel__badge--[a-z_]+\s*\{[^}]+\}/gu),
      (match) => match[0]
    ).join("\n");

    expect(badgeVariants).toContain(".memory-panel__badge--feature");
    expect(badgeVariants).toContain(".memory-panel__badge--todo");
    expect(badgeVariants).toContain(".memory-panel__badge--bugfix");
    expect(badgeVariants).toContain(".memory-panel__badge--project");
    expect(badgeVariants).toContain(".memory-panel__badge--note");
    expect(badgeVariants).not.toContain("workflow");
    expect(badgeVariants).not.toContain("decision");
    expect(badgeVariants).not.toContain("project_fact");
    expect(badgeVariants).not.toContain("task_context");
    expect(badgeVariants).not.toContain("preference");
  });
});
