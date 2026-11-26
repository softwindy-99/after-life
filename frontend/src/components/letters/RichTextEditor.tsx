import { ChangeEvent, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import {
  Bold,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  ImagePlus,
  Paperclip,
  Quote,
  Undo2,
  Redo2,
} from "lucide-react";
import { absoluteResourceUrl, uploadResource } from "../../lib/api";
import { Button, Dialog, Field, Input } from "../ui";

export function RichTextEditor(props: {
  value: string;
  onChange: (value: string) => void;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [external, setExternal] = useState<"link" | "image" | null>(null);
  const [externalUrl, setExternalUrl] = useState("");
  const [urlError, setUrlError] = useState("");
  const alive = useRef(true);
  const busyCallback = useRef(props.onBusyChange);
  busyCallback.current = props.onBusyChange;
  const imageInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
      Link.configure({ openOnClick: false }),
      Image,
    ],
    content: props.value,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: {
        class: "rich-editor-content",
        role: "textbox",
        "aria-label": "信件正文",
        "aria-multiline": "true",
      },
    },
    onUpdate: ({ editor: current }) => props.onChange(current.getHTML()),
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      busyCallback.current?.(false);
    };
  }, []);

  useEffect(() => {
    if (editor && editor.getHTML() !== props.value) {
      editor.commands.setContent(props.value, { emitUpdate: false });
    }
  }, [editor, props.value]);

  useEffect(() => {
    editor?.setEditable(!props.disabled && !uploading);
  }, [editor, props.disabled, uploading]);

  function openExternal(kind: "link" | "image") {
    setExternal(kind);
    setExternalUrl("");
    setUrlError("");
  }

  function insertExternal() {
    const url = externalUrl.trim();
    try {
      if (!["http:", "https:"].includes(new URL(url).protocol)) throw new Error();
    } catch {
      setUrlError("请输入完整的 http 或 https 网址。");
      return;
    }
    if (external === "image") editor?.chain().focus().setImage({ src: url }).run();
    else if (editor?.state.selection.empty) {
      editor
        .chain()
        .focus()
        .insertContent({ type: "text", text: url, marks: [{ type: "link", attrs: { href: url } }] })
        .run();
    } else {
      editor?.chain().focus().setLink({ href: url }).run();
    }
    setExternal(null);
    requestAnimationFrame(() => {
      if (alive.current) editor?.commands.focus();
    });
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>, image: boolean) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    props.onBusyChange?.(true);
    setError("");
    try {
      const result = await uploadResource(file);
      if (!alive.current) return;
      const url = absoluteResourceUrl(result.url);
      if (image) {
        editor?.chain().focus().setImage({ src: url, alt: file.name }).run();
      } else {
        editor
          ?.chain()
          .focus()
          .insertContent({
            type: "text",
            text: file.name,
            marks: [{ type: "link", attrs: { href: url } }],
          })
          .run();
      }
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : "上传失败");
    } finally {
      if (alive.current) {
        setUploading(false);
        busyCallback.current?.(false);
      }
    }
  }

  const toolbar = [
    {
      label: "二级标题",
      pressed: editor?.isActive("heading", { level: 2 }),
      icon: Heading2,
      action: () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: "三级标题",
      pressed: editor?.isActive("heading", { level: 3 }),
      icon: Heading3,
      action: () => editor?.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      label: "加粗",
      icon: Bold,
      pressed: editor?.isActive("bold"),
      action: () => editor?.chain().focus().toggleBold().run(),
    },
    {
      label: "斜体",
      icon: Italic,
      pressed: editor?.isActive("italic"),
      action: () => editor?.chain().focus().toggleItalic().run(),
    },
    {
      label: "无序列表",
      pressed: editor?.isActive("bulletList"),
      icon: List,
      action: () => editor?.chain().focus().toggleBulletList().run(),
    },
    {
      label: "有序列表",
      pressed: editor?.isActive("orderedList"),
      icon: ListOrdered,
      action: () => editor?.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "引用",
      icon: Quote,
      pressed: editor?.isActive("blockquote"),
      action: () => editor?.chain().focus().toggleBlockquote().run(),
    },
    {
      label: "撤销",
      icon: Undo2,
      unavailable: !editor?.can().undo(),
      action: () => editor?.chain().focus().undo().run(),
    },
    {
      label: "重做",
      icon: Redo2,
      unavailable: !editor?.can().redo(),
      action: () => editor?.chain().focus().redo().run(),
    },
  ];

  return (
    <div className="rich-editor">
      <div className="rich-editor-toolbar" role="toolbar" aria-label="信件排版工具">
        {toolbar.map(({ label, icon: Icon, action, pressed, unavailable }) => (
          <Button
            variant="ghost"
            size="icon"
            key={label}
            aria-label={label}
            aria-pressed={pressed}
            title={label}
            disabled={!editor || props.disabled || uploading || unavailable}
            onClick={action}
            type="button"
          >
            <Icon size={16} />
          </Button>
        ))}
        <Button
          variant="ghost"
          size="icon"
          aria-label="插入外链"
          disabled={!editor || props.disabled || uploading}
          onClick={() => openExternal("link")}
          type="button"
        >
          <Link2 size={16} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="插入外链图片"
          disabled={!editor || props.disabled || uploading}
          onClick={() => openExternal("image")}
          type="button"
        >
          <ImagePlus size={16} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label="上传图片"
          disabled={!editor || props.disabled || uploading}
          onClick={() => imageInput.current?.click()}
          type="button"
        >
          上传图片
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label="上传附件"
          disabled={!editor || props.disabled || uploading}
          onClick={() => fileInput.current?.click()}
          type="button"
        >
          <Paperclip size={16} /> 附件
        </Button>
      </div>
      <input
        ref={imageInput}
        hidden
        accept="image/png,image/jpeg,image/gif,image/webp"
        onChange={(event) => void handleUpload(event, true)}
        type="file"
      />
      <input
        ref={fileInput}
        hidden
        onChange={(event) => void handleUpload(event, false)}
        type="file"
      />
      <EditorContent editor={editor} />
      {uploading ? <small>正在上传…</small> : null}
      {error ? <small role="alert">{error}</small> : null}
      <Dialog
        open={external !== null}
        title={external === "image" ? "插入图片网址" : "插入网页或附件链接"}
        className="dialog-surface-sm"
        onOpenChange={(open) => {
          if (!open) setExternal(null);
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            insertExternal();
          }}
        >
          <div className="dialog-body">
            <Field label="网址" hint="支持 http 和 https。" error={urlError}>
              <Input
                autoFocus
                required
                type="url"
                value={externalUrl}
                onChange={(event) => {
                  setExternalUrl(event.target.value);
                  setUrlError("");
                }}
              />
            </Field>
          </div>
          <div className="dialog-footer">
            <Button variant="outline" onClick={() => setExternal(null)}>
              取消
            </Button>
            <Button type="submit">插入</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
