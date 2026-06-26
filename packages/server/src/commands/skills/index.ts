import { registerBuiltinSkillCommands } from "./builtin.js";
import { registerCustomSkillCommands } from "./custom.js";
import { registerSkillFileCommands } from "./files.js";
import { registerSkillHealthCommands } from "./health.js";
import { registerSkillInstallCommands } from "./install.js";
import { registerSkillLibraryCommands } from "./library.js";
import { registerSkillMountCommands } from "./mount.js";
import { registerSkillQueryCommands } from "./query.js";

let registered = false;

export function registerSkillsCommands(): void {
  if (registered) {
    return;
  }

  registered = true;
  registerSkillQueryCommands();
  registerCustomSkillCommands();
  registerSkillFileCommands();
  registerSkillLibraryCommands();
  registerSkillInstallCommands();
  registerSkillMountCommands();
  registerSkillHealthCommands();
  registerBuiltinSkillCommands();
}
