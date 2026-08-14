import type { ChainedCommands, Editor } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { useCallback, useEffect, useRef, useState } from "react";
import { shouldShowBubble } from "./bubble.js";
import { ImageForm } from "./ImageForm";

type Pane = null | "turn" | "link" | "image";

// The right-click (forced) lifecycle drives the bubble plugin via meta
// commands on this key: the plugin's update() ignores no-op transactions, so
// a right-click at the current caret would never re-evaluate shouldShow.
const bubblePluginKey = new PluginKey("fragmtFormattingBubble");

const LinkIcon = (
	<svg
		aria-hidden="true"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth={2}
		strokeLinecap="round"
		strokeLinejoin="round"
	>
		<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
		<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
	</svg>
);

/**
 * The contextual formatting surface (M2-2). Selection, image click, or
 * right-click (no selection needed — turn-into then applies to the cursor's
 * block). Right-click replaces the browser's native context menu inside the
 * edit area only; Ctrl+V and friends are unaffected.
 */
export function BubbleToolbar({ editor }: { editor: Editor }) {
	const [pane, setPane] = useState<Pane>(null);
	const [forced, setForced] = useState(false);
	const forcedRef = useRef(false);
	const rootRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const onContext = (event: MouseEvent) => {
			event.preventDefault();
			const hit = editor.view.posAtCoords({
				left: event.clientX,
				top: event.clientY,
			});
			if (!hit) return;
			forcedRef.current = true;
			setForced(true);
			setPane(null);
			editor.chain().focus().setTextSelection(hit.pos).run();
			editor.view.dispatch(editor.state.tr.setMeta(bubblePluginKey, "show"));
		};
		const dom = editor.view.dom;
		dom.addEventListener("contextmenu", onContext);
		return () => dom.removeEventListener("contextmenu", onContext);
	}, [editor]);

	// A click outside the bubble ends a forced (right-click) session.
	useEffect(() => {
		if (!forced) return;
		const onDown = (event: PointerEvent) => {
			if (rootRef.current?.contains(event.target as Node)) return;
			forcedRef.current = false;
			setForced(false);
		};
		document.addEventListener("pointerdown", onDown);
		return () => document.removeEventListener("pointerdown", onDown);
	}, [forced]);

	const hide = useCallback(() => {
		setPane(null);
		if (forcedRef.current) {
			forcedRef.current = false;
			setForced(false);
			editor.view.dispatch(editor.state.tr.setMeta(bubblePluginKey, "hide"));
		}
	}, [editor]);

	// While a right-click bubble is up, Escape closes it — even when focus is
	// in the editor (capture phase, so PM and the pane's Escape-cancel never
	// see the key). This is the "forced" leg of the Escape order contract.
	useEffect(() => {
		if (!forced) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopImmediatePropagation();
			hide();
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [forced, hide]);

	return (
		<BubbleMenu
			editor={editor}
			pluginKey={bubblePluginKey}
			shouldShow={({ state }) => shouldShowBubble(state, forcedRef.current)}
		>
			<div
				ref={rootRef}
				className="edit-bubble"
				role="menu"
				aria-label="Formatting"
				onKeyDown={(e) => {
					if (e.key !== "Escape") return;
					e.stopPropagation();
					if (pane) setPane(null);
					else if (forcedRef.current) hide();
					// Selection bubble: clearing the selection hides it.
					else
						editor
							.chain()
							.focus()
							.setTextSelection(editor.state.selection.to)
							.run();
				}}
			>
				<BubbleBody editor={editor} pane={pane} setPane={setPane} hide={hide} />
			</div>
		</BubbleMenu>
	);
}

function BubbleBody({
	editor,
	pane,
	setPane,
	hide,
}: {
	editor: Editor;
	pane: Pane;
	setPane: (p: Pane) => void;
	hide: () => void;
}) {
	const s = useEditorState({
		editor,
		selector: ({ editor: e }) => ({
			bold: e.isActive("bold"),
			italic: e.isActive("italic"),
			strike: e.isActive("strike"),
			code: e.isActive("code"),
			link: e.isActive("link"),
			href: (e.getAttributes("link").href as string | undefined) ?? "",
			h1: e.isActive("heading", { level: 1 }),
			h2: e.isActive("heading", { level: 2 }),
			h3: e.isActive("heading", { level: 3 }),
			text: e.isActive("paragraph"),
			quote: e.isActive("blockquote"),
			codeBlock: e.isActive("codeBlock"),
			inTable: e.isActive("table"),
			image: e.isActive("image"),
			imgSrc: (e.getAttributes("image").src as string | undefined) ?? "",
			imgAlt: (e.getAttributes("image").alt as string | undefined) ?? "",
		}),
	});

	// Every action restores editor focus (buttons steal it) and closes the
	// surface; popover panes stay open until submitted or cancelled.
	const linkInputRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (pane === "link") linkInputRef.current?.focus();
	}, [pane]);
	const run = (fn: (chain: ChainedCommands) => unknown) => {
		fn(editor.chain().focus());
		hide();
	};
	const btn = (label: string, fn: () => void, pressed = false) => (
		<button
			type="button"
			className="bubble-btn"
			aria-label={label}
			aria-pressed={pressed || undefined}
			onMouseDown={(e) => e.preventDefault()}
			onClick={fn}
		>
			{label === "Bold" ? (
				<b>B</b>
			) : label === "Italic" ? (
				<i>I</i>
			) : label === "Strike" ? (
				<s>S</s>
			) : label === "Code" ? (
				<code>&lt;/&gt;</code>
			) : label === "Link" ? (
				LinkIcon
			) : (
				label
			)}
		</button>
	);
	const item = (
		label: string,
		active: boolean,
		fn: (chain: ChainedCommands) => unknown,
		extra?: string,
	) => (
		<button
			type="button"
			className={`bubble-item${extra ? ` ${extra}` : ""}`}
			data-active={active || undefined}
			onMouseDown={(e) => e.preventDefault()}
			onClick={() => run(fn)}
		>
			<span>{label}</span>
			{active && <span className="kbd">✓</span>}
		</button>
	);

	return (
		<>
			<div className="bubble-row">
				{btn("Bold", () => run((c) => c.toggleBold().run()), s.bold)}
				{btn("Italic", () => run((c) => c.toggleItalic().run()), s.italic)}
				{btn("Strike", () => run((c) => c.toggleStrike().run()), s.strike)}
				{btn("Code", () => run((c) => c.toggleCode().run()), s.code)}
				<span className="bubble-sep" />
				<button
					type="button"
					className="bubble-btn"
					aria-label="Link"
					aria-pressed={s.link || undefined}
					aria-expanded={pane === "link"}
					onMouseDown={(e) => e.preventDefault()}
					onClick={() => setPane(pane === "link" ? null : "link")}
				>
					{LinkIcon}
				</button>
				<button
					type="button"
					className="bubble-btn"
					aria-label="Turn into"
					aria-expanded={pane === "turn"}
					onMouseDown={(e) => e.preventDefault()}
					onClick={() => setPane(pane === "turn" ? null : "turn")}
				>
					Aa ▾
				</button>
			</div>

			{pane === "link" && (
				<form
					className="popover-form"
					onSubmit={(e) => {
						e.preventDefault();
						const href = (
							document.getElementById("link-href") as HTMLInputElement
						).value.trim();
						if (href)
							run((c) => c.extendMarkRange("link").toggleLink({ href }).run());
					}}
				>
					<label htmlFor="link-href">Link URL</label>
					<input
						id="link-href"
						ref={linkInputRef}
						defaultValue={s.href}
						placeholder="https://…"
					/>
					<div className="popover-actions">
						{s.link && (
							<button
								type="button"
								className="iconbtn subtle"
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => run((c) => c.unsetLink().run())}
							>
								Unlink
							</button>
						)}
						<button type="submit" className="iconbtn primary">
							Apply
						</button>
					</div>
				</form>
			)}

			{pane === "turn" && (
				<div className="bubble-list">
					{item("Text", s.text, (c) => c.setParagraph().run())}
					{item(
						"Heading 1",
						s.h1,
						(c) => c.setHeading({ level: 1 }).run(),
						"serif",
					)}
					{item(
						"Heading 2",
						s.h2,
						(c) => c.setHeading({ level: 2 }).run(),
						"serif",
					)}
					{item(
						"Heading 3",
						s.h3,
						(c) => c.setHeading({ level: 3 }).run(),
						"serif",
					)}
					{item("Quote", s.quote, (c) => c.toggleBlockquote().run(), "quote")}
					{item(
						"Code block",
						s.codeBlock,
						(c) => c.toggleCodeBlock().run(),
						"mono",
					)}
				</div>
			)}

			{s.image && pane === null && (
				<>
					<div className="bubble-label">Image</div>
					<div className="bubble-list">
						<button
							type="button"
							className="bubble-item"
							onMouseDown={(e) => e.preventDefault()}
							onClick={() => setPane("image")}
						>
							<span>Edit URL / alt</span>
						</button>
						<button
							type="button"
							className="bubble-item danger"
							onMouseDown={(e) => e.preventDefault()}
							onClick={() => run((c) => c.deleteSelection().run())}
						>
							<span>Delete image</span>
						</button>
					</div>
				</>
			)}

			{s.image && pane === "image" && (
				<ImageForm
					initial={{ src: s.imgSrc, alt: s.imgAlt }}
					submitLabel="Apply"
					onCancel={() => setPane(null)}
					onSubmit={({ src, alt }) =>
						run((c) =>
							c.updateAttributes("image", { src, alt: alt || null }).run(),
						)
					}
				/>
			)}

			{s.inTable && pane === null && (
				<>
					<div className="bubble-label">Table</div>
					<div className="bubble-list">
						{item("Add row above", false, (c) => c.addRowBefore().run())}
						{item("Add row below", false, (c) => c.addRowAfter().run())}
						{item("Add column left", false, (c) => c.addColumnBefore().run())}
						{item("Add column right", false, (c) => c.addColumnAfter().run())}
						{item("Toggle header row", false, (c) => c.toggleHeaderRow().run())}
						{item("Delete row", false, (c) => c.deleteRow().run())}
						{item("Delete column", false, (c) => c.deleteColumn().run())}
						{item(
							"Delete table",
							false,
							(c) => c.deleteTable().run(),
							"danger",
						)}
					</div>
				</>
			)}
		</>
	);
}
