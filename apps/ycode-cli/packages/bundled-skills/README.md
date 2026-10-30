# bundled-skills

Skills that ship with the YCode CLI as a built-in capability, outside the plugin system.

A skill lives here when a product feature depends on it: the feature's tools are registered
by the runtime, so the skill that teaches the model how to use them must be just as
unremovable. Unlike an official plugin, this pack is never listed in the plugin store, has no
enable/disable switch, cannot be uninstalled, and does not appear in the Settings skill list
or the composer's `$` skill picker. The runtime discovers its `skills/` directory as a
`source: "bundled"`, `scope: "system"` skill root on every start.

| Skill               | Feature                                           |
| ------------------- | ------------------------------------------------- |
| `dynamic-workflows` | dynamic workflows (`/workflow`, `CreateWorkflow`) |

## How it reaches users

- **Development and Electron desktop**: the directory is resolved on disk next to the CLI entry
  (`packages/bundled-skills` relative to the entry, the same candidate walk official plugins
  use) and read in place; nothing is copied. Electron packaging stages it into
  `resources/glm/packages/bundled-skills` (`packages/desktop/scripts/prepare-agent-node-bundle.mjs`).
- **SEA binaries**: `scripts/sea-bundled-skill-assets.mjs` embeds `skills/**` under the
  `ycode-bundled-skills/` asset prefix. On start the CLI extracts them once into
  `~/.ycode/cli/bundled-skills/<content-hash>/` and reads from there.
- **Remote hosts**: `scripts/prepare-prebuilds.mjs` stages the directory next to the remote
  `ycode.cjs`, like the official plugin packages.

The resolver is `apps/ycode-cli/packages/bootstrap/src/app/bundled-skills.ts`. Every file
under `skills/dynamic-workflows/` is a required asset: a stage or seed that loses one refuses
the whole pack and logs a warning instead of shipping a skill with a missing reference file.
