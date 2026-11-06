// A git graph for the focused pane's repo: commits, branches and merges as text.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, focused, exec, theme, settings } from "herdr";

const LIMIT = 300;
const GRAPH = /^[\s|\\/*_\-]*/;
const HEX = /^[0-9a-f]{7,40}/;

let held = null;

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const loc = { cwd: pane?.cwd || f?.cwd || space?.folder, on: f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null };
  // A mod pane (a file opened as a tab) takes the focus without having a folder:
  // hold the last real one so opening a file doesn't reset the graph to the space's
  // folder; with no memory yet, prefer a terminal pane in this tab over the fallback.
  if (pane && !pane.cwd) {
    if (held) return held;
    const inTab = panes().find(p => p.tab === f?.tab && p.cwd)?.cwd || f?.cwd;
    // A file-only tab has no terminal: the last tab of this space with one, in case.
    const inSpace = [...(space?.tabs ?? [])].reverse().map(t => panes().find(p => p.tab === t.id && p.cwd)?.cwd).find(Boolean) || f?.cwd;
    const cwd = inTab || inSpace;
    if (cwd) return { cwd, on: space?.machine ?? null };
    return loc;
  }
  if (loc.cwd) held = loc;
  return loc;
}
const key = () => JSON.stringify(location());

function parse(line) {
  const graph = line.match(GRAPH)?.[0] ?? "";
  const rest = line.slice(graph.length);
  const hash = rest.match(HEX)?.[0] ?? "";
  if (!hash) return { graph: line, hash: "", refs: [], subject: "" };
  const tail = rest.slice(hash.length);
  const refs = tail.match(/^\s*\(([^)]*)\)/)?.[1];
  const subject = (refs !== undefined ? tail.replace(/^\s*\([^)]*\)\s?/, "") : tail.replace(/^\s+/, ""));
  return {
    graph,
    hash,
    refs: refs ? refs.split(",").map(r => r.trim()).filter(Boolean) : [],
    subject,
  };
}

function refColor(name, t) {
  if (name.startsWith("HEAD")) return t.working;
  if (name.startsWith("tag:")) return t.blocked;
  if (name.includes("/")) return t.dim;
  return t.done;
}

export default class GitGraph extends View {
  init(_props, cx) {
    this.state = { key: null, root: null, rows: [], error: null };
    this.sig = null;
    this.rootFor = null;
    this.refresh(cx);
    cx.timer.every(5000, cx => this.refresh(cx));
  }

  refresh(cx) {
    const loc = location();
    const k = key();
    if (!loc.cwd) {
      this.update(cx, { key: k, root: null, rows: [], error: "No folder" });
      return;
    }
    cx.spawn(async cx => {
      let root = this.rootFor?.cwd === loc.cwd ? this.rootFor.root : undefined;
      if (root === undefined) {
        try {
          const r = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: loc.cwd, on: loc.on });
          root = r.code === 0 ? r.stdout.trim() : null;
        } catch {
          root = null;
        }
        this.rootFor = { cwd: loc.cwd, root };
      }
      if (k !== key()) return;
      if (!root) {
        this.update(cx, { key: k, root: null, rows: [], error: "Not a git repository" });
        return;
      }
      let out;
      try {
        const r = await exec("git", ["log", "--graph", "--all", "--decorate", "--date-order", "--oneline", "-n", String(LIMIT)], { cwd: root, on: loc.on });
        if (r.code !== 0) throw new Error(r.stderr.trim() || `git log failed (${r.code})`);
        out = r.stdout;
      } catch (e) {
        if (k === key()) this.update(cx, { key: k, root, rows: [], error: String(e?.message ?? e) });
        return;
      }
      if (k !== key()) return;
      this.update(cx, { key: k, root, rows: out.split("\n").filter(l => l.length > 0), error: null });
    });
  }

  update(cx, next) {
    const sig = JSON.stringify([next.key, next.root, next.error, next.rows]);
    this.state = next;
    if (sig !== this.sig) {
      this.sig = sig;
      cx.notify();
    }
  }

  row(line, i, t, mono) {
    const p = parse(line);
    const short = (r) => (r.length > 13 ? `${r.slice(0, 12)}…` : r);
    return h_flex().id(`gg-${i}`).h(17).flex_none().min_w(0).font_family(mono).text_size(12.2)
      .child(div().whitespace_nowrap().text_color(t.dim).child(p.graph))
      .when(Boolean(p.hash), el => el.child(div().whitespace_nowrap().text_color(t.accent).child(p.hash)))
      .when(p.refs.length > 0, el => el.child(h_flex().ml(5).gap(4).flex_none().children(
        p.refs.slice(0, 2).map(r => div().px(4).py(1).rounded(3).bg(t.raised).whitespace_nowrap()
          .text_color(refColor(r, t)).child(short(r)))
          .concat(p.refs.length > 2 ? [div().py(1).text_color(t.dim).child(`+${p.refs.length - 2}`)] : []))))
      .when(Boolean(p.subject), el => el.child(div().ml(6).flex_1().min_w(0).truncate().text_color(t.muted).child(p.subject)));
  }

  render(cx) {
    if (key() !== this.state.key) this.refresh(cx);
    const t = theme();
    const mono = settings().font_family ?? "JetBrains Mono";
    const { root, rows, error } = this.state;
    const commits = rows.reduce((n, l) => n + (parse(l).hash ? 1 : 0), 0);
    const branch = spaces().find(s => s.active)?.branch ?? "";
    return v_flex().id("git-graph").size_full().min_h(0).rounded(10).overflow_hidden()
      .bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Git"))
        .when(Boolean(branch), el => el.child(div().px(6).py(1).rounded(4).bg(t.raised).text_size(11.5).text_color(t.muted).child(branch)))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim)
          .child(root ? `${root.split(/[\\/]/).pop()} · ${commits}` : "")))
      .child(v_flex().id("gg-list").flex_1().min_h(0).overflow_y_scrollbar().py(6).px(10)
        .when(rows.length > 0, el => el.children(rows.map((l, i) => this.row(l, i, t, mono))))
        .when(rows.length === 0, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(error ?? "Loading commits…"))));
  }
}
