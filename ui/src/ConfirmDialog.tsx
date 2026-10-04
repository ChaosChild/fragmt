import { useEffect, useRef, useState } from "react";
import { type ConfirmRequest, registerConfirmHost } from "./confirm";

/**
 * One themed modal on the native <dialog> (focus trap, inert backdrop, top
 * layer). Focus lands on Cancel – Enter never confirms a delete by accident.
 * Escape is handled here and marked prevented, so the app's window-level
 * Escape chain (preview, PR view) leaves the surface behind alone.
 */
export function ConfirmHost() {
	const [pending, setPending] = useState<ConfirmRequest | null>(null);
	const ref = useRef<HTMLDialogElement>(null);
	const cancelRef = useRef<HTMLButtonElement>(null);

	useEffect(
		() =>
			registerConfirmHost((p) =>
				setPending((cur) => {
					// A second ask while one is open: the older one is declined.
					cur?.resolve(false);
					return p;
				}),
			),
		[],
	);

	useEffect(() => {
		const d = ref.current;
		if (!d || !pending) return;
		if (!d.open) d.showModal?.();
		cancelRef.current?.focus();
	}, [pending]);

	const settle = (ok: boolean) => {
		pending?.resolve(ok);
		ref.current?.close?.();
		setPending(null);
	};

	if (!pending) return null;
	return (
		<dialog
			ref={ref}
			className="confirm"
			aria-labelledby="confirm-title"
			aria-describedby={pending.body ? "confirm-body" : undefined}
			onKeyDown={(e) => {
				if (e.key === "Escape") {
					e.preventDefault();
					settle(false);
				}
			}}
			onCancel={(e) => {
				e.preventDefault();
				settle(false);
			}}
			// The padding lives on .confirm-in, so only a backdrop click
			// lands on the dialog element itself.
			onClick={(e) => {
				if (e.target === e.currentTarget) settle(false);
			}}
		>
			<div className="confirm-in">
				<h2 id="confirm-title">{pending.title}</h2>
				{pending.body && <p id="confirm-body">{pending.body}</p>}
				<div className="confirm-act">
					<button
						ref={cancelRef}
						type="button"
						className="btn line"
						onClick={() => settle(false)}
					>
						Cancel
					</button>
					<button
						type="button"
						className={`btn primary${pending.danger ? " danger" : ""}`}
						onClick={() => settle(true)}
					>
						{pending.confirmLabel}
					</button>
				</div>
			</div>
		</dialog>
	);
}
