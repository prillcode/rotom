# Rotom

*Named for the Pokémon that slips into a machine and makes it its own.* This
layout does the same to your Herdr window: every machine gets its own colour,
and a small plasma spark of that colour follows each agent back to the machine
it lives on.

A Herdr app layout: the default window with a live git graph in the right panel,
a deck of agent cards in the sidebar, Files and Changes one click away, and a
`needs login` link that runs the machine's login where you can see it.

> Fan homage, not affiliated with or endorsed by Nintendo, Game Freak or The
> Pokémon Company. The Rotom icon here is an original line drawing; no
> Pokémon artwork is included.

See [RECIPE.md](RECIPE.md) for exactly what it is and how another agent can
build it from scratch, and [preview.png](preview.png) for the window.

## Install

Herdr writes `AGENTS.md` into `~/.config/herdr-app`; the short version:

```sh
# from this folder
mkdir -p ~/.config/herdr-app/layouts
cp layouts/rotom.json ~/.config/herdr-app/layouts/
cp -r mods/git-graph mods/tabs-git mods/spaces-login mods/agents-cards mods/footer mods/pane-header mods/brand-rotom ~/.config/herdr-app/mods/
herdr-app check ~/.config/herdr-app/mods/git-graph
herdr-app check ~/.config/herdr-app/mods/pane-header
herdr-app check ~/.config/herdr-app/mods/brand-rotom
```

Then `ctrl+shift+l` (or the command palette) to switch to **rotom**. Nothing
shipped is overwritten: the layout is a clone of `main`, and the cloned mods
are separate folders.

The Git panel needs `git` on `PATH`. On another machine it runs `git` there.
