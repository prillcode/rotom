# Rotom - Custom Herdr Layout

*Named for the Pokémon that slips into a machine and makes it its own.* This
layout does the same to your Herdr window: every machine gets its own color,
and a small plasma spark of that color follows each agent back to the machine
it lives on.

A Herdr app layout: the default window with a live git graph in the right panel,
a deck of agent cards in the sidebar, Files and Changes one click away, and a
`needs login` link that runs the machine's login where you can see it.
Right-click a file in the Files panel to **view it**, **edit it** (as a tab in
the middle pane, with Save) or **copy its path** relative to the repo root.

> Fan homage, not affiliated with or endorsed by Nintendo, Game Freak or The
> Pokémon Company. The Rotom icon here is an original line drawing; no
> Pokémon artwork is included.

See [RECIPE.md](RECIPE.md) for exactly what it is and how another agent can
build it from scratch, and [preview.png](preview.png) for the window.

## Highlights

- **Machine colors** — each machine gets its own color and Rotom spark; agents
  wear the color of the machine they live on.
- **Agents deck** — cards ordered by what needs you (Need you, Done, Working,
  Idle), with pins and foldable sections.
- **Live git graph** — the right panel runs `git log --graph` for the focused
  pane's repo, refreshing every 5 s (remote repos run git on their machine).
- **File explorer** — browse the focused folder; right-click a file to **view
  it**, **edit it** as a tab in the middle pane (editable, with Save), or
  **copy its path** relative to the repo root. Files, Git and Changes hold
  their folder while a file tab is focused instead of jumping around.
- **Needs login** — machines that need login get a clickable link that runs
  the login where you can type the password.
- **Rotom chrome** — custom brand bar, footer, pane headers (folder, branch,
  machine badge, state) and tab bar with the Git/Files/Changes panel buttons.

## Install

Herdr writes `AGENTS.md` into `~/.config/herdr-app`; the short version:

```sh
# from this folder
mkdir -p ~/.config/herdr-app/layouts
cp layouts/rotom.json ~/.config/herdr-app/layouts/
cp -r mods/git-graph mods/tabs-git mods/spaces-login mods/agents-cards mods/footer mods/pane-header mods/brand-rotom mods/files-open mods/file-menu mods/file-view mods/changes-open ~/.config/herdr-app/mods/
herdr-app check ~/.config/herdr-app/mods/git-graph
herdr-app check ~/.config/herdr-app/mods/pane-header
herdr-app check ~/.config/herdr-app/mods/brand-rotom
herdr-app check ~/.config/herdr-app/mods/file-view
```

Then `ctrl+shift+l` (or the command palette) to switch to **rotom**. Nothing
shipped is overwritten: the layout is a clone of `main`, and the cloned mods
are separate folders.

The Git panel needs `git` on `PATH`. On another machine it runs `git` there.
