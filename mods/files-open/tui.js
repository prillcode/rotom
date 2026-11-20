// A terminal-style Markdown view: monospace text with ANSI-ish colors from the
// theme. It is read-only and flat (no virtual list), so the caller caps how much
// of a large file it hands over.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";

const LIMIT = 100000, LINE_LIMIT = 2000;

// Inline Markdown: `code`, **bold**, *italic*, ~~strike~~, [text](url),
// ![alt](src), <https://…>, and backslash escapes. Returns styled segments.
function tokens(text, style = {}, depth = 0) {
  const out = [];
  let plain = "";
  const flush = () => { if (plain) { out.push({ text: plain, style }); plain = ""; } };
  for (let i = 0; i < text.length;) {
    const rest = text.slice(i);
    let m;
    if (rest[0] === "\\" && i + 1 < text.length) { plain += text[i + 1]; i += 2; continue; }
    if ((m = /^`([^`]+)`/.exec(rest))) { flush(); out.push({ text: m[1], style: { ...style, code: true } }); i += m[0].length; continue; }
    if (depth < 3 && (m = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(rest))) {
      flush(); out.push({ text: `[image: ${m[1] || m[2]}]`, style: { ...style, image: true } }); i += m[0].length; continue;
    }
    if (depth < 3 && (m = /^\[([^\]]+)\]\([^)]*\)/.exec(rest))) {
      flush(); out.push(...tokens(m[1], { ...style, link: true }, depth + 1)); i += m[0].length; continue;
    }
    if (depth < 3 && (m = /^<((?:https?|mailto):[^>]+)>/.exec(rest))) {
      flush(); out.push({ text: m[1], style: { ...style, link: true } }); i += m[0].length; continue;
    }
    if (depth < 3 && (m = /^\*\*([^*\s](?:[^*]*[^*\s])?)\*\*/.exec(rest))) {
      flush(); out.push(...tokens(m[1], { ...style, bold: true }, depth + 1)); i += m[0].length; continue;
    }
    if (depth < 3 && (m = /^__([^_\s](?:[^_]*[^_\s])?)__/.exec(rest))) {
      flush(); out.push(...tokens(m[1], { ...style, bold: true }, depth + 1)); i += m[0].length; continue;
    }
    if (depth < 3 && (m = /^~~([^~\s](?:[^~]*[^~\s])?)~~/.exec(rest))) {
      flush(); out.push(...tokens(m[1], { ...style, strike: true }, depth + 1)); i += m[0].length; continue;
    }
    if (depth < 3 && (m = /^\*([^*\s](?:[^*]*[^*\s])?)\*/.exec(rest))) {
      flush(); out.push(...tokens(m[1], { ...style, italic: true }, depth + 1)); i += m[0].length; continue;
    }
    if (depth < 3 && (m = /^_([^_\n\s](?:[^_\n]*[^_\n\s])?)_(?!\w)/.exec(rest)) && (i === 0 || !/\w/.test(text[i - 1]))) {
      flush(); out.push(...tokens(m[1], { ...style, italic: true }, depth + 1)); i += m[0].length; continue;
    }
    plain += text[i]; i++;
  }
  flush();
  return out;
}

function span(seg, t, mono) {
  const s = seg.style;
  let el = div().whitespace_nowrap().flex_none().child(seg.text);
  if (s.bold) el = el.font_bold();
  if (s.italic) el = el.italic();
  if (s.strike) el = el.line_through();
  if (s.color) el = el.text_color(s.color);
  if (s.link) el = el.text_color(t.ansi4).underline();
  if (s.image) el = el.text_color(t.ansi5).italic();
  if (s.code) el = el.font_family(mono).text_color(t.ansi6).bg(t.raised).px(3).rounded(3);
  if (s.dim) el = el.text_color(t.dim);
  return el;
}

// Words and their spaces are separate items so a row can wrap between them.
function inline(text, t, mono, base = {}) {
  const parts = [];
  for (const seg of tokens(text, base)) {
    for (const chunk of seg.text.split(/(\s+)/)) {
      if (!chunk) continue;
      if (/^\s+$/.test(chunk)) parts.push(div().whitespace_nowrap().flex_none().child(chunk.replace(/\t/g, "    ")));
      else parts.push(span({ text: chunk, style: seg.style }, t, mono));
    }
  }
  return h_flex().flex_wrap().items_baseline().min_w(0).children(parts);
}

function codeLine(text, t, mono) {
  const m = /^(\s*)(.*)$/.exec(text);
  const indent = m[1].replace(/\t/g, "    ").length;
  const content = m[2].replace(/\t/g, "    ");
  return h_flex().w_full().flex_none().items_start()
    .when(indent > 0, el => el.child(div().flex_none().child("\u00a0".repeat(indent))))
    .child(div().flex_1().min_w(0).font_family(mono).text_color(t.ansi2).child(content || "\u00a0"));
}

function codeBlock(rows, lang, t, mono) {
  return v_flex().w_full().flex_none().my(4).rounded(6).bg(t.raised).border_1().border_color(t.border).px(10).py(6).gap(1)
    .font_family(mono)
    .when(Boolean(lang), el => el.child(div().flex_none().text_size(10).text_color(t.dim).child(lang.replace(/^\{\.?|\}$/g, ""))))
    .children((rows.length ? rows : [""]).map(row => codeLine(row, t, mono)));
}

function tableBlock(rows, t, mono) {
  const grid = rows.map(l => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim()));
  const sep = grid.length > 1 && grid[1].length > 0 && grid[1].every(c => /^:?-{1,}:?$/.test(c)) ? 1 : -1;
  const widths = [];
  for (let r = 0; r < grid.length; r++) {
    if (r === sep) continue;
    grid[r].forEach((c, j) => { widths[j] = Math.max(widths[j] ?? 0, c.length); });
  }
  const pad = (c, j) => c + "\u00a0".repeat(Math.max(0, (widths[j] ?? 0) - c.length));
  const lines = [];
  grid.forEach((cells, r) => {
    if (r === sep) {
      lines.push(h_flex().w_full().flex_none().items_baseline().font_family(mono).text_color(t.dim)
        .child(div().flex_none().child("├"))
        .children(cells.flatMap((_, j) => [
          div().flex_none().px(5).child("─".repeat(Math.max(3, widths[j] ?? 0))),
          div().flex_none().child(j === cells.length - 1 ? "┤" : "┼"),
        ])));
      return;
    }
    const header = sep === 1 && r === 0;
    lines.push(h_flex().w_full().flex_none().items_baseline().font_family(mono)
      .child(div().flex_none().text_color(t.dim).child("│"))
      .children(cells.flatMap((c, j) => [
        div().flex_none().px(5).when(header, el => el.font_bold().text_color(t.ansi4)).child(pad(c, j) || "\u00a0"),
        div().flex_none().text_color(t.dim).child("│"),
      ])));
  });
  return v_flex().w_full().flex_none().my(4).gap(1).children(lines);
}

const blockStart = (l) => !l.trim() || /^\s{0,3}#{1,6}\s+/.test(l) || /^\s*>/.test(l)
  || /^\s*([-*+]|\d+[.)])\s+/.test(l) || /^\s*(```+|~~~+)/.test(l)
  || /^\s*([-*_])\s*(?:\1\s*){2,}$/.test(l) || l.trim().startsWith("|");

export function tuiMarkdown(source, t, mono, id = "tui", size = 12.5, padding = 16) {
  let clipped = false;
  let text = String(source ?? "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (text.length > LIMIT) { text = text.slice(0, LIMIT); clipped = true; }
  let lines = text.split("\n");
  if (lines.length > LINE_LIMIT) { lines = lines.slice(0, LINE_LIMIT); clipped = true; }

  const blocks = [];
  let spaced = true;
  const push = (el) => { blocks.push(el); spaced = false; };
  const space = () => { if (!spaced) { blocks.push(div().h(8).flex_none()); spaced = true; } };

  let i = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, j) => j > 0 && l.trim() === "---");
    if (end > 1 && end < 100 && lines.slice(1, end).some(l => /^\s*[\w.-]+\s*:/.test(l))) {
      push(codeBlock(lines.slice(1, end), "frontmatter", t, mono));
      i = end + 1;
    }
  }

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { space(); i++; continue; }

    const fence = /^\s*(```+|~~~+)\s*(\S*)/.exec(line);
    if (fence) {
      const mark = fence[1][0].repeat(3), lang = fence[2] ?? "", body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(mark)) body.push(lines[i++]);
      if (i < lines.length) i++;
      push(codeBlock(body, lang, t, mono));
      continue;
    }

    const heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const color = level === 1 ? t.accent : level === 2 ? t.ansi5 : level === 3 ? t.ansi4 : t.muted;
      push(h_flex().w_full().flex_none().items_baseline().mt(level <= 2 ? 10 : 6).mb(2)
        .child(div().flex_none().font_bold().text_color(t.dim).child(`${"#".repeat(level)} `))
        .child(inline(heading[2], t, mono, { bold: true, color }).flex_1().min_w(0)));
      i++; continue;
    }

    if (/^\s*>\s?/.test(line)) {
      push(h_flex().w_full().flex_none().items_stretch().my(1)
        .child(div().w(2).flex_none().bg(t.muted))
        .child(div().flex_1().min_w(0).pl(10).child(inline(line.replace(/^\s*>\s?/, ""), t, mono, { italic: true, color: t.muted }))));
      i++; continue;
    }

    const list = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (list) {
      const depth = Math.min(8, Math.floor(list[1].replace(/\t/g, "    ").length / 2));
      let marker = list[2], rest = list[3];
      // Soft-wrapped source lines belong to the item, not to a new paragraph.
      if (!/\s{2,}$/.test(line)) {
        while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]) && !blockStart(lines[i + 1])) {
          rest += " " + lines[++i].trim();
        }
      }
      const task = /^\[([ xX])\]\s+(.*)$/.exec(rest);
      if (task) { marker = task[1].toLowerCase() === "x" ? "☑" : "☐"; rest = task[2]; }
      else if (!/^\d/.test(marker)) marker = "•";
      const color = task ? (task[1].toLowerCase() === "x" ? t.ansi2 : t.ansi3) : t.accent;
      push(h_flex().w_full().flex_none().items_baseline().pl(depth * 16).gap(6).my(1)
        .child(div().flex_none().font_bold().text_color(color).child(marker))
        .child(inline(rest, t, mono).flex_1().min_w(0)));
      i++; continue;
    }

    if (line.trim().startsWith("|")) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(lines[i++]);
      push(tableBlock(rows, t, mono));
      continue;
    }

    if (/^\s*([-*_])\s*(?:\1\s*){2,}$/.test(line)) {
      push(div().w_full().flex_none().h(1).my(6).bg(t.border));
      i++; continue;
    }

    // Join soft-wrapped source lines into one paragraph so inline emphasis that
    // crosses a newline still closes, and the text reflows at the pane width.
    let para = line, j = i + 1;
    if (!/\s{2,}$/.test(line)) {
      while (j < lines.length && !blockStart(lines[j])) { para += " " + lines[j].trim(); j++; }
    }
    push(inline(para, t, mono).w_full().flex_none().my(1));
    i = j;
  }

  if (clipped) push(div().w_full().flex_none().mt(10).text_size(11).text_color(t.dim).child("… (TUI preview truncated)"));
  if (!blocks.length) push(div().text_color(t.dim).child("Empty file"));

  return v_flex().id(id).size_full().min_h(0).overflow_y_scrollbar()
    .font_family(mono).text_size(size).line_height(`${Math.round(size * 1.55)}px`)
    .text_color(t.foreground).p(padding).children(blocks);
}
