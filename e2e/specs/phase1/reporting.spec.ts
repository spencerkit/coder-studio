import { expect, test } from "@playwright/test";
import { phase1Checklist } from "../../fixtures/phase1-checklist";

test("@phase1 maps all acceptance IDs", async () => {
  expect(phase1Checklist.functionalIds).toContain("F1-01");
  expect(phase1Checklist.functionalIds).toContain("F1-40");
  expect(phase1Checklist.visualIds).toContain("V1-01");
  expect(phase1Checklist.visualIds).toContain("V1-17");
});
