// Agents as a deck of cards: needs-you on top, then done, then working, and
// idle folded away. Cards tuck under each other like a hand of cards.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, panes, focused, spaces, run, theme, shared, setShared, setAgentOrder, window, layout } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function leadPanes(all) {
  const leads = new Map();
  for (const p of all) {
    if (!p.terminal) continue;
    const current = leads.get(p.tab);
    // First agent, else first focused terminal, else first terminal in the tab.
    if (!current || (!current.program?.agent && (p.program?.agent || (!current.focused && p.focused)))) leads.set(p.tab, p);
  }
  return leads;
}

function title(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  const telling = live && live !== prog && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return (tab.name === prog || !tab.named) && telling ? live : tab.name;
}

const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };

// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};

// The deck, top to bottom. Idle starts folded; the rest start open.
const SECTIONS = [
  { id: "needs", label: "Need you", rank: 4, status: "blocked" },
  { id: "done", label: "Done", rank: 3, status: "done" },
  { id: "working", label: "Working", rank: 2, status: "working" },
  { id: "idle", label: "Idle", rank: 1, status: "idle" },
];

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// The agent's icon from the app's program table: a one-color glyph or a picture.
function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

export default class AgentCards extends View {
  init(_props, cx) {
    // Each agent's last state and when it changed (ms), kept across restarts.
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    this.pendingPins = JSON.parse(localStorage.getItem("pins") ?? "[]");
    if (!this.pendingPins.length) localStorage.removeItem("pins");
    this.migratingPins = new Set();
    this.hovered = null;
    const saved = JSON.parse(localStorage.getItem("sections") ?? "null");
    this.folded = new Set(saved?.folded ?? ["idle"]);
    this.foldedAgents = new Set(saved?.agents ?? []);
    cx.timer.every(30000, (cx) => cx.notify());
  }

  save() {
    localStorage.setItem("sections", JSON.stringify({ folded: [...this.folded], agents: [...this.foldedAgents] }));
  }

  foldSection(id, cx) {
    this.folded.has(id) ? this.folded.delete(id) : this.folded.add(id);
    this.save();
    cx.notify();
  }

  foldAgent(address, cx) {
    this.foldedAgents.has(address) ? this.foldedAgents.delete(address) : this.foldedAgents.add(address);
    this.save();
    cx.notify();
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  // Keep offline pins until their terminal returns, and keep each pending until
  // core echoes the label so a failed write doesn't erase the old pin.
  migratePins(all) {
    const listed = new Map(all.filter((t) => t.state === "live").map((t) => [t.address, t]));
    const pending = this.pendingPins.filter((address) => {
      const terminal = listed.get(address);
      if (!terminal) return true;
      if (terminal.labels?.["herdr.pinned"]) return false;
      if (!this.migratingPins.has(address)) {
        this.migratingPins.add(address);
        run("terminal.pin", { terminal: address, pinned: true });
      }
      return true;
    });
    if (pending.length === this.pendingPins.length) return;
    this.pendingPins = pending;
    if (pending.length) localStorage.setItem("pins", JSON.stringify(pending));
    else localStorage.removeItem("pins");
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  // Looking at a done agent makes it idle; it stays with Done until you leave
  // it rather than drop away under you. Any other change moves it at once.
  hold(list) {
    const cur = list.find((a) => a.focused);
    const same = cur && cur.address === this.held?.address;
    if (!same || cur.status !== "idle") this.held = cur ? { address: cur.address, rank: RANK[cur.status] ?? 0 } : null;
  }

  rank(a) {
    const sawDone = a.address === this.held?.address && this.held.rank === RANK.done && a.status === "idle";
    return sawDone ? RANK.done : RANK[a.status] ?? 0;
  }

  peek(addr) {
    run("terminal.peek", { terminal: addr });
  }

  // Live sub-agents of `addr`, depth first.
  tree(all, addr) {
    return all.filter((k) => k.parent === addr && k.state === "live").flatMap((k) => [k, ...this.tree(all, k.address)]);
  }

  statusChip(t, a) {
    const s = a.status;
    if (s === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900);
    if (s === "blocked") {
      return div().flex_none().size(15).rounded(4).bg(t.blocked + "26").text_size(10).font_bold()
        .text_color(t.blocked).flex().items_center().justify_center()
        .loop("opacity", { from: 0.55, to: 1, period: 1100 }).child("!");
    }
    if (s === "done") return div().size(7).flex_none().rounded(4).bg(t.done);
    return div().size(7).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
  }

  pinBtn(t, a) {
    const isPinned = a.pinned;
    return div().id(`pin-${a.address}`).flex_none().p(2).rounded(4).text_color(t.dim).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(isPinned ? "Unpin" : "Pin to the top of its group")
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run("terminal.pin", { terminal: a.address, pinned: !isPinned });
        // The card moves away from under the pointer, and no hover-out comes.
        this.hovered = null;
        cx.notify();
      })
      .child(svg(`mods/workspace-chrome/${isPinned ? "pin-off" : "pin"}.svg`).size(12));
  }

  foldBtn(t, a, subs) {
    const open = !this.foldedAgents.has(a.address);
    return div().id(`fold-${a.address}`).h(15).px(3).gap(2).flex().items_center().rounded(4)
      .text_size(9.5).text_color(t.dim).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { cx.stop_propagation(); this.foldAgent(a.address, cx); })
      .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(9).flex_none())
      .when(!open, (el) => el.child(String(subs.length)));
  }

  card(a, i, ctx) {
    const { t, now, detail, branch, subs } = ctx;
    const idle = a.status === "idle" && !a.focused;
    const hov = this.hovered === a.address;
    const pic = icon(a.program, 14, t.foreground);
    // An agent on another machine (`vps/t7`) says which.
    const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
    const when = this.since(a);
    const name = a.space_name || a.title || a.program?.name || a.address;
    return v_flex()
      .id(`card-${a.address}`)
      .w_full()
      .h(62)
      .flex_none()
      .mt(i === 0 ? 2 : 6)
      .rounded(11)
      .overflow_hidden()
      .bg(t.background)
      .border_1()
      .border_color(a.focused ? t.accent : hov ? t.input : t.border)
      .shadow_2xs()
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_hover((on, cx) => {
        if (on) this.hovered = a.address;
        else if (this.hovered === a.address) this.hovered = null;
        cx.notify();
      })
      .on_click(() => run("pane.focus", { pane: a.pane }))
      .child(v_flex().flex_1().min_w(0).pl(12).pr(9).pt(7)
        .child(h_flex().w_full().gap(6).items_center()
          .when(Boolean(pic), (el) => el.child(div().flex_none().child(pic)))
          .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_semibold().text_color(idle ? t.muted : t.foreground).child(name))
          .child(this.statusChip(t, a)))
        .child(h_flex().w_full().gap(6).items_center().pt(4).text_size(10).text_color(t.dim)
          .when(Boolean(branch), (el) => el.child(div().flex_none().max_w(96).truncate().text_color(t.muted).child(branch)))
          .child(div().flex_1().min_w(0).truncate().child(detail ? (branch ? `· ${detail}` : detail) : ""))
          .when(Boolean(machine), (el) => el.child(div().flex_none().text_size(9.5).child(machine)))
          .when(subs.length > 0, (el) => el.child(this.foldBtn(t, a, subs)))
          .when(hov, (el) => el.child(this.pinBtn(t, a)))
          .when(!hov && Boolean(when), (el) => el.child(div().flex_none().child(duration(now - when))))));
  }

  // A sub-agent: a smaller card tucked under its parent.
  subCard(k, t) {
    const st = kidStatus(k, this.listed);
    const pic = icon(k.program, 11, t.foreground);
    return h_flex().id(`sub-${k.address}`).h(21).flex_none().ml(16).mr(2).mt(-4).px(7).gap(5).items_center()
      .rounded(7).bg(t.background).border_1().border_color(t.border)
      .text_size(10.5).text_color(t.muted)
      .hover((el) => el.bg(t.hover).text_color(t.foreground))
      .on_click(() => this.peek(k.address))
      .child(div().size(5).flex_none().rounded(3).bg(t[st] ?? t.dim))
      .when(Boolean(pic), (el) => el.child(div().flex_none().child(pic)))
      .child(div().flex_1().min_w(0).truncate().child(k.name || k.template || k.program?.name || k.address));
  }

  sectionHeader(sec, count, t) {
    const open = !this.folded.has(sec.id);
    return h_flex().id(`sec-${sec.id}`).h(24).flex_none().px(6).pt(4).gap(6).items_center()
      .text_size(9.5).font_semibold()
      .text_color(t[sec.status] ?? t.dim)
      .cursor_pointer()
      .hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => this.foldSection(sec.id, cx))
      .child(div().child(sec.label.toUpperCase()))
      .child(div().text_color(t.dim).child(String(count)))
      .child(div().flex_1())
      .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(10).flex_none().text_color(t.dim));
  }

  // The rail: one compact line per agent.
  rail(a, i, t) {
    return h_flex().id(`ag-${a.address}`).h(26).px(8).flex_none().items_center().gap(4)
      .hover((s) => s.bg(t.hover))
      .on_click(() => run("pane.focus", { pane: a.pane }))
      .child(div().flex_1().min_w(0).whitespace_nowrap().text_right().text_color(t.muted).child(String(i + 1)))
      .child(h_flex().w(14).flex_none().items_center().justify_center().child(this.statusChip(t, a)));
  }

  render(cx) {
    const t = theme();
    const collapsed = narrow();
    const list = agents();
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    const all = terminals();
    this.migratePins(all);
    const now = Date.now();
    this.track(list, now);
    this.hold(list);

    // Read the pane snapshot once: every host read copies the whole list into JS.
    const ps = panes();
    const leads = leadPanes(ps);
    const tabLabels = new Map(spaces().flatMap((s) => s.tabs).map((tab) => [tab.id, title(tab, leads.get(tab.id))]));
    const label = (a) => tabLabels.get(a.tab) ?? (a.title || a.program?.name || "");
    const detail = new Map(list.map((a) => [a.address, /^\d+$/.test(label(a)) ? null : label(a)]));
    const seen = {};
    for (const a of list) { const k = `${a.space_name}\u0000${detail.get(a.address) ?? ""}`; seen[k] = (seen[k] ?? 0) + 1; }
    for (const a of list) {
      if (detail.get(a.address) == null && seen[`${a.space_name}\u0000`] > 1) detail.set(a.address, label(a));
    }
    const branchOf = new Map(ps.filter((p) => p.pane && p.branch).map((p) => [p.pane, p.branch]));

    // Deal into the deck, keeping pins at the top of their group.
    const groups = new Map(SECTIONS.map((s) => [s.id, []]));
    for (const a of list) {
      const r = this.rank(a) || RANK.idle;
      const sec = SECTIONS.find((s) => s.rank === r) ?? SECTIONS[3];
      groups.get(sec.id).push(a);
    }
    for (const arr of groups.values()) {
      arr.sort((x, y) => Number(y.pinned) - Number(x.pinned) || this.since(y) - this.since(x) || y.seq - x.seq);
    }
    setAgentOrder(SECTIONS.flatMap((s) => groups.get(s.id)).map((a) => a.address));

    const needs = groups.get("needs").length;
    const rows = [];
    if (collapsed) {
      list.forEach((a, i) => rows.push(this.rail(a, i, t)));
    } else {
      for (const sec of SECTIONS) {
        const members = groups.get(sec.id);
        if (!members.length) continue;
        rows.push(this.sectionHeader(sec, members.length, t));
        if (this.folded.has(sec.id)) continue;
        members.forEach((a, i) => {
          const subs = this.tree(all, a.address);
          rows.push(this.card(a, i, { t, now, detail: detail.get(a.address), branch: branchOf.get(a.pane), subs }));
          if (subs.length && !this.foldedAgents.has(a.address)) rows.push(...subs.map((k) => this.subCard(k, t)));
        });
      }
    }

    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(13)
      .when(!collapsed, (el) =>
        el.child(
          h_flex()
            .px(16)
            .h(41)
            .pt(14)
            .pb(5)
            .flex_none()
            .items_center()
            .justify_between()
            .child(div().text_size(11.5).font_medium().text_color(t.dim).child("Agents"))
            .child(div().text_size(10.5).text_color(needs ? t.blocked : t.dim)
              .child(needs ? `${needs} need you` : String(list.length))),
        ),
      )
      .when(list.length === 0 && !collapsed, (el) =>
        el.child(div().px(12).text_size(12).text_color(t.dim).child("No agent status yet. Agents show up here when they report their status. Older versions and agents inside tmux may not.")),
      )
      .child(v_flex().id("ag-list").flex_1().min_h(0).px(collapsed ? 0 : 8).overflow_y_scrollbar().mode("always").children(rows))
      .when(collapsed, (el) =>
        el.child(
          h_flex()
            .h(28)
            .items_center()
            .justify_center()
            .child(
              div()
                .id("collapse")
                .text_size(13)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(toggleSidebar)
                .child("»"),
            ),
        ),
      );
  }
}
