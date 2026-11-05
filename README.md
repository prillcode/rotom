# Rotom

A Herdr app layout: the default window with a live git graph in the right panel,
a deck of agent cards in the sidebar, Files and Changes one click away, and a
`needs login` link that runs the machine's login where you can see it.

See [RECIPE.md](RECIPE.md) for exactly what it is and how another agent can
build it from scratch, and [preview.png](preview.png) for the window.

## Install

Herdr writes `AGENTS.md` into `~/.config/herdr-app`; the short version:

```sh
# from this folder
mkdir -p ~/.config/herdr-app/layouts
cp layouts/rotom.json ~/.config/herdr-app/layouts/
cp -r mods/git-graph mods/tabs-git mods/spaces-login mods/agents-cards ~/.config/herdr-app/mods/
herdr-app check ~/.config/herdr-app/mods/git-graph
```

Then `ctrl+shift+l` (or the command palette) to switch to **rotom**. Nothing
shipped is overwritten: the layout is a clone of `main`, and the two cloned mods
are separate folders.

The Git panel needs `git` on `PATH`. On another machine it runs `git` there.
