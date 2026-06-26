import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  clearHostCommandsForTest,
  getHostCommandDefinition,
  registerHostCommand,
} from "../host/command-registry.js";

describe("host command registry", () => {
  it("stores host command definitions by op", () => {
    clearHostCommandsForTest();
    registerHostCommand("host.test", z.object({ value: z.number() }), async (args) => ({
      doubled: args.value * 2,
    }));

    const definition = getHostCommandDefinition("host.test");
    expect(definition?.schema.parse({ value: 2 })).toEqual({ value: 2 });
  });
});
