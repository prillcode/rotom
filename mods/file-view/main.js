// A file in a middle-pane tab: opened from file-menu's right-click on a file.
// View mode is read-only (select and copy still work); edit mode is an editor
// saved with writeTextFile, which writes only if the file still matches what
// was loaded. Editing is local-only: writeTextFile has no `on`, so a file on
// another machine opens read-only with a note. Markdown starts formatted in
// view mode, with TUI / Rendered / Source switches in the header.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, TextView } from "gpui-base";
import { props, readTextFile, writeTextFile, theme, settings, notify, nextCommand, window } from "herdr";
import { tuiMarkdown } from "./tui.js";

const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const MD = /\.(md|markdown|mdx)$/i;
const VIEWS = ["tui", "rendered", "source"];
// Paths are stored and compared with forward slashes; Windows reads them either
// way, so only the display is native.
const shown = (p) => !p || window().platform !== "windows" ? p ?? "" : String(p).replaceAll("/", "\\");

export default class FileView extends View {
  init(_props, cx) {
    this.load(cx);
    // Bound to a key as `<mod>.<command>` (e.g. "file-view.save" in keys.json).
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "save" || c === "file-view.save") this.save(cx);
        cx.notify();
      }
    });
  }

  async load(cx) {
    const p = props() ?? {};
    this.file = p.file ?? null;
    this.on = p.on ?? null;
    this.remote = Boolean(this.on);
    this.editable = Boolean(p.editable) && !this.remote;
    this.note = p.editable && this.remote ? "Read-only: editing files on another machine is not supported" : null;
    this.error = null; this.dirty = false; this.saving = false;
    this.original = null; this.code = null; this.text = null;
    this.markdown = Boolean(this.file && MD.test(this.file));
    this.view = "source";
    if (!this.file) { this.error = "No file"; return; }
    try {
      const text = await readTextFile(this.file, { on: this.on });
      if (text === null) { this.error = "File not found"; return; }
      if (text.includes("\0")) { this.error = "Binary file — nothing to show"; return; }
      const big = text.length > 400000;
      if (big && this.editable) { this.editable = false; this.note = "Read-only: file too large to edit"; }
      this.original = text;
      this.text = big ? text.slice(0, 400000) + "\n… (file truncated)" : text;
      // Markdown opens formatted in view mode; an edit tab stays on the source.
      // A tab opened with props.view starts on TUI, Rendered or Source instead.
      this.view = this.markdown && VIEWS.includes(p.view) ? p.view : (this.editable || !this.markdown ? "source" : "rendered");
      const t = theme(), name = this.file.split(/[\\/]/).pop(), ext = name.includes(".") ? name.split(".").pop() : "txt";
      this.code = EditorState.new({
        language: LANG[ext] ?? ext, readonly: !this.editable,
        value: this.text,
        font_family: settings().font_family, font_size: 12,
        syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 },
      });
      if (this.editable) this.code.on("change", (_e, cx) => { this.dirty = this.code.value() !== this.original; cx.notify(); });
    } catch { this.error = "Cannot open this file"; }
    finally { cx.notify(); }
  }

  // The Markdown view reads the editor's current text, so an edit-mode preview
  // includes unsaved changes.
  sourceText() {
    return this.code ? this.code.value() : this.text ?? "";
  }

  rendered() {
    return this.markdown && this.view === "rendered" && this.text !== null;
  }

  tui() {
    return this.markdown && this.view === "tui" && this.text !== null;
  }

  mode(t, label) {
    const selected = this.view === label.toLowerCase();
    return h_flex()
      .id(`file-view-${label.toLowerCase()}`)
      .h(20).flex_none().px(8).rounded(5).items_center().cursor_pointer().text_size(11)
      .when(selected, el => el.bg(t.solid).text_color(t.solid_foreground))
      .when(!selected, el => el.text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground)))
      .on_click((_e, cx) => { this.view = label.toLowerCase(); cx.notify(); })
      .child(label);
  }

  async save(cx) {
    if (!this.editable || !this.code || !this.dirty || this.saving) return;
    const value = this.code.value();
    this.saving = true; cx.notify();
    try {
      await writeTextFile(this.file, value, this.original);
      this.original = value; this.dirty = false;
      notify({ title: `Saved ${this.file.split(/[\\/]/).pop()}`, level: "success" });
    } catch (e) {
      notify({ title: "Not saved", body: String(e?.message ?? e), level: "error" });
    } finally { this.saving = false; cx.notify(); }
  }

  render(cx) {
    const t = theme(), mono = settings().font_family ?? "monospace";
    const name = this.file?.split(/[\\/]/).pop() ?? "File";
    const where = shown(this.file);
    return v_flex().id("file-view").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(36).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child(name))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(this.note ?? where))
        .when(this.markdown && this.code, el => el.child(
          h_flex().h(24).flex_none().p(2).gap(2).rounded(6).bg(t.raised)
            .child(this.mode(t, "TUI"))
            .child(this.mode(t, "Rendered"))
            .child(this.mode(t, "Source"))))
        .when(this.editable, el => el.child(
          h_flex().h(24).px(10).gap(6).rounded(6).items_center().text_size(12)
            .bg(this.dirty && !this.saving ? t.solid : t.raised)
            .text_color(this.dirty && !this.saving ? t.solid_foreground : t.dim)
            .when(this.dirty && !this.saving, el => el.cursor_pointer().on_click((_e, cx) => this.save(cx)))
            .child(this.saving ? "Saving…" : "Save"))))
      .child(this.tui()
        ? v_flex().flex_1().min_h(0).overflow_hidden()
            .child(tuiMarkdown(this.sourceText(), t, mono, "file-view-tui", 12.5, 18))
        : this.rendered()
          ? v_flex().flex_1().min_h(0).overflow_hidden()
              .child(TextView.markdown("file-view-md", this.sourceText()).scrollable(true).px(18).py(14))
          : this.code
            ? Editor.new(this.code).flex_1().min_h(0)
            : div().p(14).text_size(12).text_color(t.dim).child(this.error ?? "Loading file…"));
  }
}
