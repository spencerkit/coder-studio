# `@coder-studio/skill-manager`

Reusable Skill management domain and application services.

## Responsibilities

- Skill library, mount, and target JSON document schemas
- Legacy JSON normalization and repository mutations
- Catalog search and Skill information decoration
- Install and update validation
- Local Skill import orchestration
- Sync, unsync, uninstall, repair, target listing, and health scan orchestration

## Host responsibilities

The package does not choose a filesystem path, database, or storage engine. A host supplies
`SkillJsonStorage`, whose `read` and `write` methods can be backed by files, application storage,
or another JSON-capable mechanism.

The host also supplies the side-effecting adapters it needs: catalog access, download/install
jobs, Skill content import/removal, target discovery, mount execution, health checks, and event
publication.

For filesystem-origin Skills, the package asks `SkillContentHost.canRemove` before removing JSON
state. This lets a host distinguish an imported, host-managed Skill from a read-only Skill merely
discovered in an external directory.

Coder Studio's built-in Skill definitions and synchronization, workspace recommendations, and
custom Skill editor are host extensions and are intentionally not implemented by this package.

## Minimal setup

```ts
import {
  SkillLibraryRepository,
  SkillManager,
  SkillMountRepository,
} from "@coder-studio/skill-manager";

const library = new SkillLibraryRepository({ storage: hostJsonStorage });
const mounts = new SkillMountRepository(hostJsonStorage);
const skills = new SkillManager({ library, mounts, catalog, installJobs, mountHost, healthHost });
```
