# Skills

Reusable agent skills shipped with this project. Drop one into your agent's
skills directory and it becomes available (auto-triggered by its description, or
invoked explicitly).

## compressing-images

Drives the `ptiny` CLI to compress images to a target file size and/or pixel
dimensions with minimal quality loss.

### Install (Claude Code)

Copy or symlink the skill folder into your skills directory:

```bash
# personal, available in all projects:
cp -r skills/compressing-images ~/.claude/skills/

# …or symlink to stay in sync with this repo:
ln -s "$(pwd)/skills/compressing-images" ~/.claude/skills/compressing-images
```

Project-only instead of global? Copy it into that project's
`.claude/skills/` directory.

### Requirement

The skill calls the `ptiny` command. Install it from this repo first:

```bash
bun install          # in the picture-tiny-cli repo
bun link             # registers the global `ptiny` command (optional)
# or invoke directly: bun /path/to/picture-tiny-cli/bin/ptiny <args>
```

Verify with `ptiny --version`. See the skill's own *Setup* section for details.
