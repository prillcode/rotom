// The sidebar footer: Settings and Add machine side by side, small.
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { run, theme, layout, updates } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The rail hides labels: only the icons fit.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

export default class Footer extends View {
  button(t, id, icon, label, action) {
    return h_flex().id(id).flex_1().min_w(0).h_full().gap(5).items_center().justify_center()
      .rounded(6).text_size(11.8).text_color(t.muted).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click(action)
      .child(svg(`mods/workspace-chrome/${icon}.svg`).size(13).flex_none())
      .when(!narrow(), (el) => el.child(div().truncate().child(label)));
  }

  render() {
    const t = theme();
    return h_flex().size_full().bg(t.chrome).border_t(1).border_color(t.border)
      .px(6).py(4).gap(4)
      .child(this.button(t, "foot-settings", "settings", "Settings", () => run("app.settings"))
        .when(Boolean(updates?.().app?.ready), (el) => el.child(div().size(5).rounded_full().bg(t.accent))))
      .child(this.button(t, "foot-machine", "plus", "Add machine", () => run("mod.open", { name: "machine-add" })));
  }
}
