// Rotom's status bar: the shipped workspace-status, plus the number of open
// OpenSpec changes in the active space's repo.
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, focused, agents, theme, run, window, keys, exec, openOverlay, checking, home } from "herdr";
import * as fs from "fs/promises";

const REFRESH_MS = 10000;

const slash = (path) => String(path).replace(/\\/g, "/").replace(/\/+$/, "") || "/";

function parent(dir) {
  if (dir === "/" || /^[A-Za-z]:$/.test(dir)) return null;
  const at = dir.lastIndexOf("/");
  return at <= 0 ? null : dir.slice(0, at);
}

async function kind(path) {
  let found = false;
  try {
    found = await fs.exists(path);
  } catch {
    return null;
  }
  if (!found) return null;
  try {
    await fs.readdir(path);
    return "dir";
  } catch {
    return "file";
  }
}

// OpenSpec marks a root with openspec/config.yaml, openspec/specs or
// openspec/changes. Walk up from the space's folder, as the openspec CLI does.
async function localRoot(cwd) {
  const stop = slash(home());
  for (let dir = slash(cwd); ;) {
    const root = dir === "/" ? "" : dir;
    if (await kind(`${root}/openspec`) === "dir"
      && ((await kind(`${root}/openspec/config.yaml`)) === "file"
        || (await kind(`${root}/openspec/changes`)) === "dir"
        || (await kind(`${root}/openspec/specs`)) === "dir")) return dir;
    if (dir === stop) return null;
    const up = parent(dir);
    if (!up) return null;
    dir = up;
  }
}

// Every child of openspec/changes except archive is an open change.
async function localNames(root) {
  const dir = `${root === "/" ? "" : root}/openspec/changes`;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const names = [];
  for (const entry of entries) {
    if (entry.name === "archive") continue;
    const type = entry.isDirectory() ? "dir" : await kind(`${dir}/${entry.name}`);
    if (type === "dir") names.push(entry.name);
  }
  return names.sort();
}

// A remote space's files are not directly readable here, so ask OpenSpec there.
async function remoteNames(cwd, on) {
  const result = await exec("openspec", ["list", "--json"], { cwd, on });
  const data = JSON.parse(result.stdout);
  if (!data?.root) return null;
  return {
    root: data.root.path ?? cwd,
    names: (data.changes ?? []).map((change) => change?.name).filter(Boolean).sort(),
  };
}

async function scan(cwd, on) {
  if (on) return remoteNames(cwd, on);
  const root = await localRoot(cwd);
  return root ? { root, names: await localNames(root) } : null;
}

// Follow the focused pane's folder, as the Git panel does. A file tab takes
// the focus without a folder; hold the last real one for that space.
let held = null;

function context() {
  const space = spaces().find((s) => s.active);
  const focus = focused();
  const pane = focus?.pane ? panes().find((p) => p.pane === focus.pane) : null;
  let cwd = pane?.cwd || focus?.cwd || "";
  const on = focus?.pane === null ? (focus.terminal?.includes("/") ? focus.terminal.split("/")[0] : null) : space?.machine ?? null;
  if (!cwd && held && held.space === space?.id) cwd = held.cwd;
  if (!cwd) {
    const inTab = focus?.tab ? panes().find((p) => p.tab === focus.tab && p.cwd)?.cwd : "";
    cwd = inTab || space?.folder || "";
  }
  if (cwd) held = { space: space?.id ?? null, cwd, on };
  return { key: JSON.stringify([cwd, on]), cwd, on };
}

export default class StatusRotom extends View {
  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("commands") instead of lying.
  hint(t) {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  init(_props, cx) {
    this.state = { key: null, at: 0, root: null, names: [] };
    this.pending = null;
    this.sig = null;
    if (checking()) return;
    this.refresh(cx);
    cx.timer.every(REFRESH_MS, (cx) => this.refresh(cx));
  }

  refresh(cx) {
    if (checking()) return;
    const now = context();
    if (this.state.key === now.key && Date.now() - this.state.at < REFRESH_MS) return;
    if (!now.cwd || this.pending === now.key) return;
    this.pending = now.key;
    cx.spawn(async (cx) => {
      let found = null;
      try {
        found = await scan(now.cwd, now.on);
      } catch {}
      if (this.pending === now.key) this.pending = null;
      if (context().key !== now.key) return;
      const names = found?.names ?? [];
      const sig = JSON.stringify([now.key, Boolean(found?.root), names]);
      this.state = { key: now.key, at: Date.now(), root: found?.root ?? null, names };
      if (sig !== this.sig) {
        this.sig = sig;
        cx.notify();
      }
    });
  }

  openSpec(t) {
    const { names } = this.state;
    return h_flex().id("status-openspec").gap(6).items_center()
      .when(names.length > 0, (el) => el.tooltip(names.join("\n")))
      .cursor_pointer().hover((s) => s.text_color(t.foreground))
      .on_click(() => {
        const now = context();
        openOverlay({
          mod: "openspec-changes",
          kind: "dialog",
          frame: "none",
          width: 640,
          height: 440,
          props: { cwd: now.cwd, on: now.on },
        });
      })
      .child(svg("mods/workspace-chrome/file-text.svg").size(13).flex_none())
      .child(div().whitespace_nowrap().child("OpenSpec Changes"))
      .child(div().px(5).py(1).rounded(4).bg(t.raised).text_size(10.5).text_color(t.foreground).child(String(names.length)));
  }

  render(cx) {
    if (context().key !== this.state.key) this.refresh(cx);
    const t = theme();
    const space = spaces().find((s) => s.active);
    const list = agents();
    const needs = list.filter((a) => a.status === "blocked").length;
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), (el) => el.child(label("branch", space.branch)))
      .when(Boolean(this.state.root), (el) => el.child(this.openSpec(t)))
      .child(h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(t.dim)).child(`${list.length} ${list.length === 1 ? "agent" : "agents"}`)
        .when(needs > 0, (el) => el.child(div().text_color(t.blocked).child(`· ${needs} ${needs === 1 ? "needs" : "need"} you`))))
      .child(div().flex_1())
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint(t)));
  }
}
