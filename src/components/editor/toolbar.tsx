"use client";

import { useCallback } from "react";
import type { Editor } from "@tiptap/react";
import {
  Bold,
  Code,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";

import { cn } from "@/lib/utils";

const TEXT_COLORS = [
  { label: "Default", value: null },
  { label: "Red", value: "#dc2626" },
  { label: "Orange", value: "#ea580c" },
  { label: "Green", value: "#16a34a" },
  { label: "Blue", value: "#2563eb" },
  { label: "Purple", value: "#9333ea" },
];

const HIGHLIGHTS = [
  { label: "None", value: null },
  { label: "Yellow", value: "#fef08a" },
  { label: "Green", value: "#bbf7d0" },
  { label: "Blue", value: "#bfdbfe" },
  { label: "Pink", value: "#fbcfe8" },
];

export function Toolbar({
  editor,
  onPickImage,
}: {
  editor: Editor;
  onPickImage: () => void;
}) {
  const setLink = useCallback(() => {
    const previous = editor.getAttributes("link").href as string | undefined;
    // A prompt is a deliberate compromise: a popover would be nicer, but this
    // is a personal tool and the prompt is one line instead of a hundred.
    const url = window.prompt("Link URL", previous ?? "https://");

    if (url === null) return;

    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }

    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: url, target: "_blank" })
      .run();
  }, [editor]);

  return (
    <div className="border-border bg-background/90 sticky top-14 z-20 -mx-1 flex flex-wrap items-center gap-0.5 border-b px-1 py-1.5 backdrop-blur-md">
      <Group>
        <Item
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          label="Undo"
          icon={Undo2}
        />
        <Item
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          label="Redo"
          icon={Redo2}
        />
      </Group>

      <Divider />

      <Group>
        <Item
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          active={editor.isActive("heading", { level: 1 })}
          label="Heading 1"
          icon={Heading1}
        />
        <Item
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          active={editor.isActive("heading", { level: 2 })}
          label="Heading 2"
          icon={Heading2}
        />
        <Item
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          active={editor.isActive("heading", { level: 3 })}
          label="Heading 3"
          icon={Heading3}
        />
      </Group>

      <Divider />

      <Group>
        <Item
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive("bold")}
          label="Bold"
          shortcut="⌘B"
          icon={Bold}
        />
        <Item
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive("italic")}
          label="Italic"
          shortcut="⌘I"
          icon={Italic}
        />
        <Item
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          active={editor.isActive("underline")}
          label="Underline"
          shortcut="⌘U"
          icon={UnderlineIcon}
        />
        <Item
          onClick={() => editor.chain().focus().toggleStrike().run()}
          active={editor.isActive("strike")}
          label="Strikethrough"
          icon={Strikethrough}
        />
        <Item
          onClick={() => editor.chain().focus().toggleCode().run()}
          active={editor.isActive("code")}
          label="Inline code"
          icon={Code}
        />
      </Group>

      <Divider />

      <Group>
        <ColorPicker
          label="Text color"
          icon={
            <span
              className="flex size-4 items-center justify-center text-[13px] font-semibold"
              style={{ color: editor.getAttributes("textStyle").color as string }}
            >
              A
            </span>
          }
          options={TEXT_COLORS}
          onSelect={(value) =>
            value
              ? editor.chain().focus().setColor(value).run()
              : editor.chain().focus().unsetColor().run()
          }
        />
        <ColorPicker
          label="Highlight"
          icon={<Highlighter className="size-4" />}
          options={HIGHLIGHTS}
          onSelect={(value) =>
            value
              ? editor.chain().focus().toggleHighlight({ color: value }).run()
              : editor.chain().focus().unsetHighlight().run()
          }
        />
      </Group>

      <Divider />

      <Group>
        <Item
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive("bulletList")}
          label="Bullet list"
          icon={List}
        />
        <Item
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive("orderedList")}
          label="Numbered list"
          icon={ListOrdered}
        />
        <Item
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          active={editor.isActive("taskList")}
          label="Checklist"
          icon={ListChecks}
        />
        <Item
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          active={editor.isActive("blockquote")}
          label="Quote"
          icon={Quote}
        />
      </Group>

      <Divider />

      <Group>
        <Item
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          active={editor.isActive("codeBlock")}
          label="Code block"
          icon={Code2}
        />
        <Item
          onClick={setLink}
          active={editor.isActive("link")}
          label="Link"
          icon={Link2}
        />
        <Item onClick={onPickImage} label="Insert image" icon={ImagePlus} />
        <Item
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          label="Divider"
          icon={Minus}
        />
      </Group>
    </div>
  );
}

function Group({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-0.5">{children}</div>;
}

function Divider() {
  return <span className="bg-border mx-1 h-5 w-px shrink-0" aria-hidden />;
}

function Item({
  onClick,
  active,
  disabled,
  label,
  shortcut,
  icon: Icon,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  label: string;
  shortcut?: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <button
      type="button"
      // onMouseDown, not onClick: a click would move focus out of the editor
      // first, collapsing the selection the button is meant to act on.
      onMouseDown={(event) => {
        event.preventDefault();
        onClick();
      }}
      disabled={disabled}
      aria-label={shortcut ? `${label} (${shortcut})` : label}
      aria-pressed={active}
      title={shortcut ? `${label} · ${shortcut}` : label}
      className={cn(
        "rounded p-1.5 transition-colors disabled:pointer-events-none disabled:opacity-40",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}

function ColorPicker({
  label,
  icon,
  options,
  onSelect,
}: {
  label: string;
  icon: React.ReactNode;
  options: { label: string; value: string | null }[];
  onSelect: (value: string | null) => void;
}) {
  return (
    <div className="group/color relative">
      <button
        type="button"
        aria-label={label}
        title={label}
        onMouseDown={(event) => event.preventDefault()}
        className="text-muted-foreground hover:bg-muted hover:text-foreground rounded p-1.5 transition-colors"
      >
        {icon}
      </button>

      <div className="border-border bg-popover invisible absolute top-full left-0 z-30 mt-1 flex gap-1 rounded-lg border p-1.5 opacity-0 shadow-lg transition-[opacity,visibility] group-focus-within/color:visible group-focus-within/color:opacity-100 group-hover/color:visible group-hover/color:opacity-100">
        {options.map((option) => (
          <button
            key={option.label}
            type="button"
            aria-label={option.label}
            title={option.label}
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(option.value);
            }}
            className={cn(
              "border-border size-5 rounded border transition-transform hover:scale-110",
              !option.value && "bg-background",
            )}
            style={option.value ? { backgroundColor: option.value } : undefined}
          />
        ))}
      </div>
    </div>
  );
}
