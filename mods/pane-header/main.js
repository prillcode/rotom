// Rotom's pane header: a clone of Herdr's shipped `pane` header (v0.1.13), reworked.
//   program icon · repo/folder · branch · [machine] ······ state · (hover) split split zoom close
// No space name or tab title (the sidebar and tab bar already show them). The controls
// appear only on hover and always target this header's own pane.
// Props from the app: { pane, terminal }. Click: focus the pane.

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, spaces, props, run, theme, home } from "herdr";

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

const slash = (p) => p.split(String.fromCharCode(92)).join("/");

// The folder's own name ("~" at home), not the whole path.
function folder(cwd) {
  if (!cwd) return "";
  const c = slash(cwd).replace(/\/+$/, "");
  const h = slash(home()).replace(/\/+$/, "");
  if (c === h) return "~";
  return c.slice(c.lastIndexOf("/") + 1) || c;
}

// The machine that owns this pane: its space's `machine`, else the machine/ prefix of its
// qualified ids. Never the focused pane's: a header belongs to its own pane.
function machineOf(p) {
  const s = spaces().find((s) => s.tabs.some((t) => t.id === p.tab));
  if (s) return s.machine ?? null;
  for (const id of [p.tab, p.terminal, p.pane]) {
    const i = typeof id === "string" ? id.indexOf("/") : -1;
    if (i > 0) return id.slice(0, i);
  }
  return null;
}

export default class PaneHeader extends View {
  init() { this.hovered = false; }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  button(t, id, glyph, command, args) {
    return div()
      .id(id)
      .p(3)
      .rounded(4)
      .text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run(command, args);
      })
      .child(svg(`mods/pane-header/${glyph}.svg`).size(14));
  }

  render(cx) {
    const t = theme();
    const p = this.me();
    if (!p) return div();
    const pane = p.pane;
    const pic = icon(p.program, 14, p.focused ? t.foreground : t.dim);
    const where = folder(p.cwd) || (p.program?.name ?? "shell");
    const machine = machineOf(p);
    const st = p.status;
    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .px(10)
      .gap(8)
      .items_center()
      .bg(t.background)
      .border_b(1)
      .border_color(p.focused ? t.accent : t.border)
      .text_size(12)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().truncate().max_w(220).font_medium().text_color(p.focused ? t.foreground : t.muted).child(where))
      .when(Boolean(p.branch), (el) => el.child(div().min_w(0).truncate().max_w(200).text_size(11.5).text_color(t.dim).child(p.branch)))
      .when(Boolean(machine), (el) => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(t.raised).text_size(10.5).text_color(t.muted).child(machine)))
      .child(div().flex_1())
      .when(st === "working", (el) => el
        .child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900))
        .child(div().flex_none().text_size(10.5).text_color(t.working).child("Working")))
      .when(st === "blocked", (el) => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).child("Needs you")))
      .when(st === "done", (el) => el
        .child(div().size(7).flex_none().rounded(4).bg(t.done))
        .child(div().flex_none().text_size(10.5).text_color(t.done).child("Done")))
      .when(this.hovered, (el) => el
        .child(this.button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
        .child(this.button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
        .child(this.button(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
        .child(this.button(t, `ph-x-${pane}`, "close", "pane.close", { pane })));
  }
}
