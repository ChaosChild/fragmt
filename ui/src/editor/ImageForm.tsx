import type { Editor } from "@tiptap/core";
import { useEffect, useRef, useState } from "react";

export interface ImageAttrs {
	src: string;
	alt: string;
}

/**
 * URL + alt fields shared by the slash-menu insert popover and the bubble's
 * edit-image pane (M2-2). Escape cancels and never leaves the form.
 */
export function ImageForm({
	initial,
	submitLabel,
	onSubmit,
	onCancel,
}: {
	initial?: Partial<ImageAttrs>;
	submitLabel: string;
	onSubmit: (attrs: ImageAttrs) => void;
	onCancel: () => void;
}) {
	const srcRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		srcRef.current?.focus();
	}, []);
	return (
		<form
			className="popover-form"
			onSubmit={(e) => {
				e.preventDefault();
				const src = srcRef.current?.value.trim();
				if (!src) return;
				const alt = document.getElementById(
					"img-alt",
				) as HTMLInputElement | null;
				onSubmit({ src, alt: alt?.value.trim() ?? "" });
			}}
			onKeyDown={(e) => {
				if (e.key === "Escape") {
					e.stopPropagation();
					onCancel();
				}
			}}
		>
			<label htmlFor="img-src">Image URL</label>
			<input
				id="img-src"
				ref={srcRef}
				defaultValue={initial?.src ?? ""}
				placeholder="https://… or ./assets/picture.png"
				required
			/>
			<label htmlFor="img-alt">Alt text</label>
			<input
				id="img-alt"
				defaultValue={initial?.alt ?? ""}
				placeholder="describe the image"
			/>
			<div className="popover-actions">
				<button type="button" className="iconbtn subtle" onClick={onCancel}>
					Cancel
				</button>
				<button type="submit" className="iconbtn primary">
					{submitLabel}
				</button>
			</div>
		</form>
	);
}

/**
 * Fixed-position popover that inserts an image node at a stored position –
 * used by the slash menu's Image item, where the cursor may have moved
 * between picking the item and submitting the form.
 */
export function ImagePopover({
	editor,
	insertAt,
	onClose,
}: {
	editor: Editor;
	insertAt: number;
	onClose: () => void;
}) {
	const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
	useEffect(() => {
		const coords = editor.view.coordsAtPos(insertAt);
		setPos({
			top: Math.min(coords.bottom + 6, window.innerHeight - 230),
			left: Math.min(coords.left, window.innerWidth - 330),
		});
	}, [editor, insertAt]);
	if (!pos) return null;
	return (
		<div className="popover-anchor" style={pos}>
			<ImageForm
				submitLabel="Insert"
				onCancel={onClose}
				onSubmit={({ src, alt }) => {
					editor
						.chain()
						.focus()
						.insertContentAt(insertAt, {
							type: "image",
							attrs: { src, alt: alt || null },
						})
						.run();
					onClose();
				}}
			/>
		</div>
	);
}
