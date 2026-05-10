import path from "path";
import { defineProject } from "vitest/config";

export default defineProject({
  root: path.resolve(__dirname, ".."),
  test: {
    globals: true,
    environment: "node",
    include: ["scripts/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
  },
});
