import type { ChainedCommands, Editor } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Link, MessageSquarePlus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { shouldShowBubble } from "./bubble.js";
import { ImageForm } from "./ImageForm";

type Pane = null | "turn" | "link" | "image" | "comment";

// The right-click (forced) lifecycle drives the bubble plugin via meta
// commands on this key: the plugin's update() ignores no-op transactions, so
// a right-click at the current caret would never re-evaluate shouldShow.
const bubblePluginKey = new PluginKey("fragmtFormattingBubble");

const LinkIcon = <Link aria-hidden="true" />;

/**
 * The contextual surface (M2-2 formatting, M4 comment). Selection or image
 * click; right-click (no selection needed – turn-into then applies to the
 * cursor's block) stays edit-only. Read mode mounts the SAME bubble with only
 * the Comment action (M4 review decision 1) – the anchoring flow runs on the
 * non-editable instance and never flips the mode. Right-click replaces the
 * browser's native context menu inside the edit area only; Ctrl+V and
 * friends are unaffected.
 */
export function BubbleToolbar({
	editor,
	editable,
	onComment,
	onVisibilityChange,
}: {
	editor: Editor;
	editable: boolean;
	onComment: (id: string, quote: string, body: string) => void;
	onVisibilityChange?: (visible: boolean) => void;
}) {
	const [pane, setPane] = useState<Pane>(null);
	const [forced, setForced] = useState(false);
	const [visible, setVisible] = useState(false);
	const forcedRef = useRef(false);
	const rootRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		// The right-click hijack is edit-only (M2-2); read mode's bubble is
		// selection-driven and comment-only.
		if (!editable) return;
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
			// 'show' appends the element with its previous coordinates; the
			// follow-up 'updatePosition' recomputes from the now-current
			// selection, so the bubble lands at THIS click, not the last one.
			editor.view.dispatch(editor.state.tr.setMeta(bubblePluginKey, "show"));
			editor.view.dispatch(
				editor.state.tr.setMeta(bubblePluginKey, "updatePosition"),
			);
		};
		const dom = editor.view.dom;
		dom.addEventListener("contextmenu", onContext);
		return () => dom.removeEventListener("contextmenu", onContext);
	}, [editor, editable]);

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

	// Escape while the bubble is visible closes the bubble – never edit mode.
	// Capture phase, so PM and the pane's Escape handler can't cancel editing
	// underneath an open surface (the Escape order contract's bubble leg).
	useEffect(() => {
		if (!visible && !forced) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopImmediatePropagation();
			if (pane) {
				setPane(null);
				return;
			}
			if (forcedRef.current) {
				hide();
				return;
			}
			// Selection/image bubble: clearing the selection hides it.
			editor.chain().focus().setTextSelection(editor.state.selection.to).run();
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [visible, forced, pane, hide, editor]);

	return (
		<BubbleMenu
			editor={editor}
			pluginKey={bubblePluginKey}
			shouldShow={({ state }) => shouldShowBubble(state, forcedRef.current)}
			options={{
				onShow: () => {
					setVisible(true);
					onVisibilityChange?.(true);
				},
				onHide: () => {
					setVisible(false);
					onVisibilityChange?.(false);
				},
			}}
		>
			<div
				ref={rootRef}
				className="edit-bubble"
				role="menu"
				aria-label={editable ? "Formatting" : "Comment"}
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
				<BubbleBody
					editor={editor}
					editable={editable}
					onComment={onComment}
					pane={pane}
					setPane={setPane}
					hide={hide}
				/>
			</div>
		</BubbleMenu>
	);
}

function BubbleBody({
	editor,
	editable,
	onComment,
	pane,
	setPane,
	hide,
}: {
	editor: Editor;
	editable: boolean;
	onComment: (id: string, quote: string, body: string) => void;
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
			hasSelection: !e.state.selection.empty,
		}),
	});

	// Every action restores editor focus (buttons steal it) and closes the
	// surface; popover panes stay open until submitted or cancelled.
	const linkInputRef = useRef<HTMLInputElement>(null);
	const commentRef = useRef<HTMLTextAreaElement>(null);
	// The composer's anchor: the selection captured when the pane opened –
	// focusing the textarea must not be able to move what a comment marks.
	const [anchor, setAnchor] = useState<{
		from: number;
		to: number;
		quote: string;
	} | null>(null);
	useEffect(() => {
		if (pane === "link") linkInputRef.current?.focus();
		if (pane === "comment") commentRef.current?.focus();
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

	// The comment action (M4 review decision 1): opens the composer on the
	// selection captured at click – the mark and the quote snapshot both come
	// from that stored range, so focusing the textarea cannot drift them.
	// Hidden without a selection: a forced (right-click) bubble can sit on a
	// bare caret, and there is nothing to anchor there.
	const commentButton = s.hasSelection && (
		<button
			type="button"
			className="bubble-btn"
			aria-label="Comment"
			aria-expanded={pane === "comment"}
			onMouseDown={(e) => e.preventDefault()}
			onClick={() => {
				if (pane === "comment") {
					setPane(null);
					return;
				}
				const { from, to } = editor.state.selection;
				setAnchor({
					from,
					to,
					quote: editor.state.doc.textBetween(from, to, " "),
				});
				setPane("comment");
			}}
		>
			<MessageSquarePlus aria-hidden="true" />
		</button>
	);

	// Anchoring (M4 spec's contract): apply the mark locally with a fresh
	// UUID, then hand the persistence of BOTH ends to DocView (doc first,
	// sidecar second – its business). Commands dispatch through
	// view.dispatch, which is NOT gated by editable (read-mode setContent
	// already relies on that), so the same chain works in both modes – the
	// mode never flips. Collapsing to the range end hides the bubble.
	const submitComment = () => {
		const body = commentRef.current?.value.trim();
		if (!body || !anchor?.quote) return;
		const id = crypto.randomUUID();
		editor
			.chain()
			.focus()
			.setTextSelection({ from: anchor.from, to: anchor.to })
			.setMark("comment", { dataC: id })
			.setTextSelection(anchor.to)
			.run();
		setPane(null);
		onComment(id, anchor.quote, body);
	};

	return (
		<>
			<div className="bubble-row">
				{editable && (
					<>
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
						<span className="bubble-sep" />
					</>
				)}
				{commentButton}
			</div>

			{editable && pane === "link" && (
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

			{editable && pane === "turn" && (
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

			{editable && s.image && pane === null && (
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

			{editable && s.image && pane === "image" && (
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

			{editable && s.inTable && pane === null && (
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

			{pane === "comment" && anchor && (
				<form
					className="popover-form"
					onSubmit={(e) => {
						e.preventDefault();
						submitComment();
					}}
				>
					<p className="comment-quote">{anchor.quote}</p>
					<label htmlFor="comment-body">Comment</label>
					<textarea
						id="comment-body"
						ref={commentRef}
						rows={3}
						placeholder="Leave a note…"
						required
					/>
					<div className="popover-actions">
						<button
							type="button"
							className="iconbtn subtle"
							onMouseDown={(e) => e.preventDefault()}
							onClick={() => setPane(null)}
						>
							Cancel
						</button>
						<button type="submit" className="iconbtn primary">
							Comment
						</button>
					</div>
				</form>
			)}
		</>
	);
}
