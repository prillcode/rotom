// A read-only TUI for OpenSpec: Changes (active and archived) and Specs.
// Opened from the status bar's OpenSpec Changes count.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { props, closeOverlay, exec, readTextFile, theme, settings, home, run } from "herdr";
import * as fs from "fs/promises";

const TABS = ["changes", "specs"];

const slash = (path) => String(path).replace(/\\/g, "/").replace(/\/+$/, "") || "/";

function parent(dir) {
  if (dir === "/" || /^[A-Za-z]:$/.test(dir)) return null;
  const at = dir.lastIndexOf("/");
  return at <= 0 ? null : dir.slice(0, at);
}

function base(path) {
  return slash(path).split("/").filter(Boolean).pop() ?? "";
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

async function directories(path) {
  try {
    return (await fs.readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

// OpenSpec marks a root with openspec/config.yaml, openspec/specs or
// openspec/changes. Walk up from the folder, as the openspec CLI does.
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

async function localChanges(root) {
  const dir = `${root === "/" ? "" : root}/openspec/changes`;
  const active = (await directories(dir)).filter((name) => name !== "archive").sort((a, b) => a.localeCompare(b));
  const archived = (await directories(`${dir}/archive`)).sort((a, b) => b.localeCompare(a));
  return [
    ...active.map((name) => ({ name, archived: false })),
    ...archived.map((name) => ({ name, archived: true })),
  ];
}

async function localSpecs(root) {
  const dir = `${root === "/" ? "" : root}/openspec/specs`;
  const ids = (await directories(dir)).sort((a, b) => a.localeCompare(b));
  const specs = await Promise.all(ids.map(async (id) => {
    const text = await readTextFile(`${dir}/${id}/spec.md`).catch(() => null);
    if (text === null) return null;
    return { id, requirements: (text.match(/^###\s+Requirement:/gm) ?? []).length };
  }));
  return specs.filter(Boolean);
}

function sortedChanges(list) {
  const active = [], archived = [];
  for (const change of list) {
    if (!change?.name) continue;
    (change.archived ? archived : active).push({ name: change.name, archived: Boolean(change.archived) });
  }
  active.sort((a, b) => a.name.localeCompare(b.name));
  archived.sort((a, b) => b.name.localeCompare(a.name));
  return [...active, ...archived];
}

async function remoteScan(cwd, on, knownRoot) {
  const [changesResult, specsResult] = await Promise.all([
    exec("openspec", ["list", "--all", "--json"], { cwd, on }),
    exec("openspec", ["list", "--specs", "--json"], { cwd, on }),
  ]);
  let changesData, specsData;
  try {
    changesData = JSON.parse(changesResult.stdout);
    specsData = JSON.parse(specsResult.stdout);
  } catch {
    throw new Error(`OpenSpec did not return JSON on ${on}.`);
  }
  if (!changesData?.root) throw new Error(`No OpenSpec root found on ${on}.`);
  const specs = (specsData.specs ?? [])
    .filter((spec) => spec?.id)
    .map((spec) => ({ id: spec.id, requirements: Number(spec.requirementCount) || 0 }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    root: knownRoot ?? changesData.root.path ?? cwd,
    changes: sortedChanges(changesData.changes ?? []),
    specs,
  };
}

async function scan(cwd, on, knownRoot) {
  if (on) return remoteScan(cwd, on, knownRoot);
  const root = knownRoot || await localRoot(cwd);
  if (!root) throw new Error("No OpenSpec root found.");
  const [changes, specs] = await Promise.all([localChanges(root), localSpecs(root)]);
  return { root, changes, specs };
}

export default class OpenSpecChanges extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.cwd = p.cwd ?? "";
    this.on = p.on ?? null;
    this.knownRoot = p.root ?? null;
    this.tab = "changes";
    this.at = { changes: 0, specs: 0 };
    this.data = null;
    this.loading = Boolean(this.cwd);
    this.error = this.cwd ? null : "No folder to read.";
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.scroll = ScrollHandle.new();
    if (this.cwd) this.load(cx);
  }

  load(cx) {
    const { cwd, on, knownRoot } = this;
    cx.spawn(async (cx) => {
      try {
        this.data = await scan(cwd, on, knownRoot);
        this.at = { changes: 0, specs: 0 };
        this.error = null;
      } catch (error) {
        this.error = String(error?.message ?? error);
      } finally {
        this.loading = false;
        cx.notify();
      }
    });
  }

  rows() {
    return this.data ? this.data[this.tab] : [];
  }

  switchTab(tab, cx) {
    if (this.tab === tab) return;
    this.tab = tab;
    if (this.rows().length) this.scroll.scroll_to_item(this.at[tab] ?? 0);
    cx.notify();
  }

  select(index, cx) {
    this.at[this.tab] = index;
    this.scroll.scroll_to_item(index);
    cx.notify();
  }

  open(index) {
    const item = this.rows()[index];
    if (!item || !this.data?.root) return;
    this.at[this.tab] = index;
    const root = String(this.data.root).replace(/\\/g, "/").replace(/\/+$/, "");
    const file = this.tab === "changes"
      ? `${root}/openspec/changes/${item.archived ? "archive/" : ""}${item.name}/proposal.md`
      : `${root}/openspec/specs/${item.id}/spec.md`;
    closeOverlay(props()?.overlay);
    run("tab.new", {
      name: this.tab === "changes" ? item.name : item.id,
      mod: "file-view",
      props: { file, on: this.on, editable: false },
    });
  }

  move(by, cx) {
    const count = this.rows().length;
    if (!count) return;
    this.at[this.tab] = (this.at[this.tab] + by + count) % count;
    this.scroll.scroll_to_item(this.at[this.tab]);
    cx.notify();
  }

  key(event, cx) {
    const key = event.key;
    if (key === "left" || key === "right") {
      const at = TABS.indexOf(this.tab);
      this.switchTab(TABS[(at + (key === "right" ? 1 : TABS.length - 1)) % TABS.length], cx);
    } else if (key === "tab") {
      this.switchTab(this.tab === "changes" ? "specs" : "changes", cx);
    } else if (key === "up") {
      this.move(-1, cx);
    } else if (key === "down") {
      this.move(1, cx);
    } else if (key === "home") {
      if (this.rows().length) this.select(0, cx);
    } else if (key === "end") {
      if (this.rows().length) this.select(this.rows().length - 1, cx);
    } else if (key === "enter") {
      if (!this.rows().length) return;
      this.open(this.at[this.tab]);
    } else if (key === "q") {
      this.close();
    } else {
      return;
    }
    cx.stop_propagation();
  }

  close() {
    closeOverlay(props()?.overlay);
  }

  tabButton(t, label, tab, count) {
    const on = this.tab === tab;
    const text = count === null ? label : `${label} ${count}`;
    return h_flex()
      .id(`os-tab-${tab}`)
      .h_full()
      .items_center()
      .cursor_pointer()
      .on_click((_event, cx) => this.switchTab(tab, cx))
      .child(div().text_color(on ? t.accent : t.dim).child(on ? `[ ${text} ]` : `  ${text}  `));
  }

  row(t, index, name, right, tooltip) {
    const on = index === this.at[this.tab];
    return h_flex()
      .id(`os-${this.tab}-${index}`)
      .h(24)
      .flex_none()
      .px(10)
      .gap(8)
      .items_center()
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .cursor_pointer()
      .on_click(() => this.open(index))
      .child(div().w(10).flex_none().text_color(on ? t.accent : t.dim).child(on ? ">" : " "))
      .child(div().flex_1().min_w(0).truncate().tooltip(tooltip ?? name).child(name))
      .child(right);
  }

  notice(t, text, color) {
    return div().px(12).py(10).text_color(color).child(text);
  }

  header(t, repo) {
    return h_flex().h(28).flex_none().px(10).gap(8).items_center().border_b(1).border_color(t.border)
      .child(div().text_color(t.accent).child("OpenSpec"))
      .child(div().text_color(t.dim).child("::"))
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(repo))
      .when(Boolean(this.on), (el) => el.child(div().text_color(t.dim).child(`@${this.on}`)))
      .child(div().id("os-close").px(5).cursor_pointer().text_color(t.dim).hover((s) => s.text_color(t.foreground)).on_click(() => this.close()).child("[x]"));
  }

  render() {
    const t = theme();
    const mono = settings().font_family ?? "JetBrains Mono";
    const data = this.data;
    const changes = data?.changes ?? [];
    const specs = data?.specs ?? [];
    const rows = this.rows();
    const repo = base(data?.root ?? this.knownRoot ?? this.cwd) || "no repository";
    const active = changes.filter((change) => !change.archived).length;
    const archived = changes.length - active;
    const summary = this.tab === "changes" ? `${active} active · ${archived} archived` : `${specs.length} specs`;
    const count = (list) => (this.loading || this.error ? null : list.length);
    const right = (text, color, width) => div().w(width).flex_none().text_right().text_size(10.5).text_color(color).child(text);
    return v_flex()
      .id("openspec-changes")
      .size_full()
      .min_h(0)
      .bg(t.popover)
      .border_1()
      .border_color(t.border)
      .font_family(mono)
      .text_size(12.5)
      .text_color(t.foreground)
      .track_focus(this.handle)
      .on_key_down((event, cx) => this.key(event, cx))
      .child(this.header(t, repo))
      .child(h_flex().h(30).flex_none().px(10).gap(16).items_center()
        .child(this.tabButton(t, "Changes", "changes", count(changes)))
        .child(this.tabButton(t, "Specs", "specs", count(specs)))
        .child(div().flex_1())
        .when(!this.loading && !this.error, (el) => el.child(div().text_size(10.5).text_color(t.dim).child(summary))))
      .child(div().h(1).flex_none().bg(t.border))
      .child(v_flex().id("os-list").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.scroll).py(4)
        .when(this.loading, (el) => el.child(this.notice(t, "Reading OpenSpec…", t.muted)))
        .when(!this.loading && Boolean(this.error), (el) => el.child(this.notice(t, this.error, t.blocked)))
        .when(!this.loading && !this.error && rows.length === 0, (el) => el.child(this.notice(t, this.tab === "changes" ? "No changes." : "No specs.", t.dim)))
        .when(!this.loading && !this.error, (el) => el.children(rows.map((item, index) => this.tab === "changes"
          ? this.row(t, index, item.name, right(item.archived ? "[archived]" : "[active]", item.archived ? t.dim : t.ansi2, 84), item.name)
          : this.row(t, index, item.id, right(`${item.requirements} requirement${item.requirements === 1 ? "" : "s"}`, t.dim, 128), item.id)))))
      .child(h_flex().h(24).flex_none().px(10).gap(14).items_center().border_t(1).border_color(t.border).text_size(10.5).text_color(t.dim)
        .child("↑↓ scroll")
        .child("←→ tabs")
        .child("↵ open")
        .child("esc/q close")
        .child(div().flex_1())
        .child("read-only"));
  }
}
