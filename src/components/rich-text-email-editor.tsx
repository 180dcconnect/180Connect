"use client";

import { useState } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import UnderlineExtension from "@tiptap/extension-underline";
import LinkExtension from "@tiptap/extension-link";
import { Color as ColorExtension, FontFamily as FontFamilyExtension, FontSize as FontSizeExtension, TextStyle } from "@tiptap/extension-text-style";
import {
  Bold,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link2,
  List,
  ListOrdered,
  Palette,
  Quote,
  Smile,
  Strikethrough,
  Underline as UnderlineIcon,
  X,
} from "lucide-react";
import { Indent } from "@/lib/outreach/tiptap-extensions";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const FONT_FAMILIES = [
  { label: "Default", value: "" },
  { label: "Sans-serif", value: "Arial, Helvetica, sans-serif" },
  { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Monospace", value: "'Courier New', monospace" },
] as const;

const FONT_SIZES = [
  { label: "Small", value: "12px" },
  { label: "Normal", value: "" },
  { label: "Large", value: "18px" },
  { label: "Huge", value: "24px" },
] as const;

const TEXT_COLORS = [
  "#111827",
  "#dc2626",
  "#ea580c",
  "#ca8a04",
  "#16a34a",
  "#2563eb",
  "#7c3aed",
  "#6b7280",
] as const;

const EMOJIS = [
  "😀", "😊", "🙂", "😉", "🙌", "👍", "🎉", "✅",
  "📅", "📎", "💡", "❤️", "🔥", "⭐", "📈", "🤝",
] as const;

function ToolbarButton({
  active,
  disabled,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? "bg-brand/15 text-brand-hover" : "text-foreground/70 hover:bg-black/5"
      }`}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

function ToolbarSeparator() {
  return <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 self-center bg-black/10" />;
}

/**
 * F117: the rich-text body editor shared by the Stage 1 (compose-button.tsx)
 * and Stage 2 (follow-up-button.tsx) review flows.
 *
 * Uncontrolled by design: `initialContent` seeds the document once and the
 * parent is expected to remount this component (e.g. `key={draft.id}`) when
 * a new draft replaces the one being edited, exactly like the plain
 * `<textarea>` it replaces did. A fully controlled Tiptap editor that calls
 * `setContent` on every parent re-render fights the user's cursor and undo
 * history, so `onChange` is the only way data flows back out.
 */
export function RichTextEmailEditor({
  initialContent,
  onChange,
  disabled = false,
  ariaLabelledBy,
}: {
  initialContent: string;
  onChange?: (html: string) => void;
  disabled?: boolean;
  ariaLabelledBy: string;
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");

  const editor = useEditor({
    editable: !disabled,
    immediatelyRender: false,
    extensions: [
      // StarterKit v3 bundles its own Link and Underline by default — both are
      // disabled here so the standalone extensions below (configured the way
      // this editor actually needs) are the only ones registered, not a
      // silently-conflicting duplicate of the same extension name.
      StarterKit.configure({ heading: false, link: false, underline: false }),
      UnderlineExtension,
      TextStyle,
      ColorExtension,
      FontFamilyExtension,
      FontSizeExtension,
      Indent,
      LinkExtension.configure({
        openOnClick: false,
        autolink: true,
        defaultProtocol: "https",
      }),
    ],
    content: initialContent,
    onUpdate: ({ editor: updated }) => onChange?.(updated.getHTML()),
    editorProps: {
      attributes: {
        class:
          "min-h-64 w-full rounded-b-lg border border-t-0 border-black/10 bg-white px-3 py-2 text-sm leading-relaxed outline-none [&_a]:text-brand [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-black/15 [&_blockquote]:pl-3 [&_blockquote]:text-foreground/70 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5",
      },
    },
  });

  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current) return null;
      return {
        bold: current.isActive("bold"),
        italic: current.isActive("italic"),
        underline: current.isActive("underline"),
        strike: current.isActive("strike"),
        bulletList: current.isActive("bulletList"),
        orderedList: current.isActive("orderedList"),
        blockquote: current.isActive("blockquote"),
        link: current.isActive("link"),
        fontFamily: (current.getAttributes("textStyle").fontFamily as string | undefined) ?? "",
        fontSize: (current.getAttributes("textStyle").fontSize as string | undefined) ?? "",
      };
    },
  });

  // `state` legitimately starts null and only exists once the editor has
  // fired at least one transaction/update event — Tiptap's useEditorState
  // caches its snapshot and only invalidates it on those events, so it can't
  // reflect a freshly-created editor before anything has happened to it yet.
  // Gating the whole render on `state` (not just `editor`) would mean the
  // content editable never mounts, which means it can never fire the very
  // event that would make `state` exist — a deadlock. Only `editor` gates
  // rendering; toolbar indicators fall back to an inactive default until a
  // real transaction populates `state`.
  if (!editor) return null;
  const toolbarState = state ?? {
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    bulletList: false,
    orderedList: false,
    blockquote: false,
    link: false,
    fontFamily: "",
    fontSize: "",
  };

  function openLinkPopover() {
    setLinkUrl((editor!.getAttributes("link").href as string | undefined) ?? "");
    setLinkOpen(true);
  }

  function applyLink() {
    const url = linkUrl.trim();
    if (!url) {
      editor!.chain().focus().unsetLink().run();
    } else {
      editor!.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
    setLinkOpen(false);
  }

  return (
    <div aria-labelledby={ariaLabelledBy} role="group">
      <div className="flex flex-wrap items-center gap-0.5 rounded-t-lg border border-black/10 bg-black/2 px-2 py-1.5">
        <Select
          disabled={disabled}
          onValueChange={(value) => {
            if (value) editor.chain().focus().setFontFamily(value).run();
            else editor.chain().focus().unsetFontFamily().run();
          }}
          value={toolbarState.fontFamily}
        >
          <SelectTrigger className="h-7 w-38 text-xs" size="sm">
            <SelectValue placeholder="Font" />
          </SelectTrigger>
          <SelectContent>
            {FONT_FAMILIES.map((font) => (
              <SelectItem key={font.label} value={font.value}>
                {font.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          disabled={disabled}
          onValueChange={(value) => {
            if (value) editor.chain().focus().setFontSize(value).run();
            else editor.chain().focus().unsetFontSize().run();
          }}
          value={toolbarState.fontSize}
        >
          <SelectTrigger className="h-7 w-24 text-xs" size="sm">
            <SelectValue placeholder="Size" />
          </SelectTrigger>
          <SelectContent>
            {FONT_SIZES.map((size) => (
              <SelectItem key={size.label} value={size.value}>
                {size.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <ToolbarSeparator />

        <ToolbarButton active={toolbarState.bold} disabled={disabled} label="Bold" onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton active={toolbarState.italic} disabled={disabled} label="Italic" onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton active={toolbarState.underline} disabled={disabled} label="Underline" onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <UnderlineIcon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton active={toolbarState.strike} disabled={disabled} label="Strikethrough" onClick={() => editor.chain().focus().toggleStrike().run()}>
          <Strikethrough className="h-4 w-4" />
        </ToolbarButton>

        <Popover>
          <PopoverTrigger asChild>
            <span>
              <ToolbarButton disabled={disabled} label="Text colour" onClick={() => {}}>
                <Palette className="h-4 w-4" />
              </ToolbarButton>
            </span>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2">
            <div className="grid grid-cols-4 gap-1.5">
              {TEXT_COLORS.map((color) => (
                <button
                  aria-label={`Text colour ${color}`}
                  className="h-6 w-6 rounded-full border border-black/10"
                  key={color}
                  onClick={() => editor.chain().focus().setColor(color).run()}
                  style={{ backgroundColor: color }}
                  type="button"
                />
              ))}
            </div>
            <button
              className="mt-2 text-xs font-bold text-foreground/60 hover:text-foreground"
              onClick={() => editor.chain().focus().unsetColor().run()}
              type="button"
            >
              Clear colour
            </button>
          </PopoverContent>
        </Popover>

        <ToolbarSeparator />

        <ToolbarButton
          active={toolbarState.bulletList}
          disabled={disabled}
          label="Bulleted list"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          active={toolbarState.orderedList}
          disabled={disabled}
          label="Numbered list"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          active={toolbarState.blockquote}
          disabled={disabled}
          label="Quote"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <Quote className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          disabled={disabled}
          label="Decrease indent"
          onClick={() => editor.chain().focus().decreaseIndent().run()}
        >
          <IndentDecrease className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          disabled={disabled}
          label="Increase indent"
          onClick={() => editor.chain().focus().increaseIndent().run()}
        >
          <IndentIncrease className="h-4 w-4" />
        </ToolbarButton>

        <ToolbarSeparator />

        <Popover onOpenChange={(open) => open && openLinkPopover()} open={linkOpen}>
          <PopoverTrigger asChild>
            <span>
              <ToolbarButton active={toolbarState.link} disabled={disabled} label="Link" onClick={() => setLinkOpen(true)}>
                <Link2 className="h-4 w-4" />
              </ToolbarButton>
            </span>
          </PopoverTrigger>
          <PopoverContent className="w-64">
            <label className="block text-xs font-bold text-foreground/65">
              URL
              <input
                autoFocus
                className="mt-1 w-full rounded-md border border-black/10 px-2 py-1 text-sm"
                onChange={(event) => setLinkUrl(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && applyLink()}
                placeholder="https://example.org"
                value={linkUrl}
              />
            </label>
            <div className="mt-2 flex justify-end gap-2">
              {toolbarState.link && (
                <button
                  className="text-xs font-bold text-foreground/60 hover:text-foreground"
                  onClick={() => {
                    editor.chain().focus().unsetLink().run();
                    setLinkOpen(false);
                  }}
                  type="button"
                >
                  Remove
                </button>
              )}
              <button
                className="rounded-md bg-brand px-3 py-1 text-xs font-bold text-white"
                onClick={applyLink}
                type="button"
              >
                Apply
              </button>
            </div>
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <span>
              <ToolbarButton disabled={disabled} label="Insert emoji" onClick={() => {}}>
                <Smile className="h-4 w-4" />
              </ToolbarButton>
            </span>
          </PopoverTrigger>
          <PopoverContent className="w-56">
            <div className="grid grid-cols-8 gap-1">
              {EMOJIS.map((emoji) => (
                <button
                  aria-label={`Insert ${emoji}`}
                  className="grid h-6 w-6 place-items-center rounded hover:bg-black/5"
                  key={emoji}
                  onClick={() => editor.chain().focus().insertContent(emoji).run()}
                  type="button"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <ToolbarSeparator />

        <ToolbarButton
          disabled={disabled}
          label="Clear formatting"
          onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
        >
          <X className="h-4 w-4" />
        </ToolbarButton>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
