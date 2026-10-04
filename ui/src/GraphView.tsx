import {
	ChevronDown,
	Download,
	Eye,
	Maximize,
	Minus,
	Plus,
	X,
} from "lucide-react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { DocGraph } from "./api";
import { CommandBar } from "./CommandBar";
import { TRUST_WORD, trustClass } from "./display";
import {
	folderAt,
	foldGraph,
	groupsOf,
	type ViewGraph,
	type ViewNode,
} from "./graph-group";
import { MenuPopover, useMenu } from "./Menus";

/**
 * The reference graph (rung 5, ui v1 phase 10): it takes over the stage.
 * Zero dependencies – each node's angle is seeded from an FNV-1a hash of its
 * path so the same repo state draws the same shape twice, a capped force
 * loop (pairwise repulsion, edge springs, mild centering, and a pull toward
 * the node's folder group) settles within TICK_CAP ticks and stops, and
 * past RING_CAP nodes the simulation is skipped for a deterministic ring.
 * Folders show as dashed hulls (grouping depth Off / 1 / 2 / All, kept in
 * localStorage) and fold into one node; a click selects a node (inspector,
 * non-neighbours dimmed), a double-click or Open navigates. Wheel and
 * pointer handlers bind natively so preventDefault works; every handler
 * guards its nulls – happy-dom mounts this without layout.
 */

const RING_CAP = 300;
const TICK_CAP = 300;
/** The spring's rest length; also scales the seed circle. */
const EDGE_LEN = 165;
/** The pull toward a node's folder centroid, per tick (alpha-scaled). */
const CLUSTER = 0.02;
/** Extra repulsion between nodes of different folder groups. */
const GROUP_APART = 6;
/** The fit never zooms past this – labels stay at reading size. */
const FIT_MAX = 1.1;
/** happy-dom never lays the pane out – the fallback keeps the math alive. */
const FALLBACK_W = 900;
const FALLBACK_H = 600;
const GROUP_KEY = "fragmt.graphGroup";
const DEPTHS = [
	[0, "Off"],
	[1, "1 level"],
	[2, "2 levels"],
	[Number.POSITIVE_INFINITY, "All"],
] as const;

function readDepth(): number {
	try {
		const v = localStorage.getItem(GROUP_KEY);
		if (v === "all") return Number.POSITIVE_INFINITY;
		const n = Number(v);
		return v !== null && [0, 1, 2].includes(n) ? n : 2;
	} catch {
		return 2;
	}
}
function storeDepth(d: number) {
	try {
		localStorage.setItem(
			GROUP_KEY,
			d === Number.POSITIVE_INFINITY ? "all" : String(d),
		);
	} catch {
		// a convenience – the choice still holds this session
	}
}

function fnv1a(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

interface Pt {
	x: number;
	y: number;
}

/** Seed positions: hash angle on a circle; the ring keeps the index angle. */
function seedLayout(graph: ViewGraph): Pt[] {
	const n = graph.nodes.length;
	const r = Math.max(200, n * 5);
	return graph.nodes.map((node, i) => {
		const big = n > RING_CAP;
		const t = big
			? (i / n) * Math.PI * 2
			: (fnv1a(node.path) / 2 ** 32) * Math.PI * 2;
		return { x: r * Math.cos(t), y: r * Math.sin(t) };
	});
}

/** One force tick, position-based with an alpha-scaled displacement clamp.
 *  `groups[k][i]` is node i's cluster key at level k (null = none): the
 *  pull goes toward every level's centroid, and the extra repulsion keys
 *  on the top level (level-0 entry) – a nested folder stays inside its
 *  parent's hull. */
function forceTick(
	p: Pt[],
	graph: ViewGraph,
	index: Map<string, number>,
	groups: (string | null)[][],
	alpha: number,
) {
	const top = groups[0] ?? [];
	const n = p.length;
	const fx = new Float64Array(n);
	const fy = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		for (let j = i + 1; j < n; j++) {
			let dx = p[i].x - p[j].x;
			let dy = p[i].y - p[j].y;
			let d2 = dx * dx + dy * dy;
			if (d2 < 1) {
				// Coincident seeds repel along a deterministic nudge.
				dx = 0.7;
				dy = i % 2 === 0 ? 0.7 : -0.7;
				d2 = 1;
			}
			const d = Math.sqrt(d2);
			// Different folders push apart harder – the hulls stay readable
			// even when their docs cross-link a lot.
			const apart =
				top[i] != null && top[j] != null && top[i] !== top[j] ? GROUP_APART : 1;
			const f = ((EDGE_LEN * EDGE_LEN) / d2) * alpha * apart;
			const ux = dx / d;
			const uy = dy / d;
			fx[i] += ux * f;
			fy[i] += uy * f;
			fx[j] -= ux * f;
			fy[j] -= uy * f;
		}
	}
	for (const e of graph.edges) {
		const i = index.get(e.from);
		const j = index.get(e.to);
		if (i === undefined || j === undefined) continue;
		const dx = p[j].x - p[i].x;
		const dy = p[j].y - p[i].y;
		const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
		const f = (d - EDGE_LEN) * 0.08 * alpha;
		const ux = dx / d;
		const uy = dy / d;
		fx[i] += ux * f;
		fy[i] += uy * f;
		fx[j] -= ux * f;
		fy[j] -= uy * f;
	}
	// The cluster force: each node drifts toward its groups' centroids.
	for (const group of groups) {
		const sum = new Map<string, { x: number; y: number; n: number }>();
		for (let i = 0; i < n; i++) {
			const g = group[i];
			if (g === null) continue;
			const s = sum.get(g) ?? { x: 0, y: 0, n: 0 };
			s.x += p[i].x;
			s.y += p[i].y;
			s.n++;
			sum.set(g, s);
		}
		for (let i = 0; i < n; i++) {
			const g = group[i];
			const s = g === null ? undefined : sum.get(g);
			if (!s || s.n < 2) continue;
			fx[i] += (s.x / s.n - p[i].x) * CLUSTER * alpha * 5;
			fy[i] += (s.y / s.n - p[i].y) * CLUSTER * alpha * 5;
		}
	}
	const max = 30 * alpha;
	for (let i = 0; i < n; i++) {
		fx[i] -= p[i].x * 0.02 * alpha;
		fy[i] -= p[i].y * 0.02 * alpha;
		p[i].x += Math.max(-max, Math.min(max, fx[i]));
		p[i].y += Math.max(-max, Math.min(max, fy[i]));
	}
}

function paneSize(svg: SVGSVGElement | null) {
	const r = svg?.getBoundingClientRect();
	return {
		w: r && r.width > 0 ? r.width : FALLBACK_W,
		h: r && r.height > 0 ? r.height : FALLBACK_H,
	};
}

/** A node's trust mark: stale wins, else the tier's. */
const markOf = (n: { tier: string; stale: boolean }) =>
	n.stale ? ("s" as const) : trustClass({ tier: n.tier, staleAfter: null });

const truncate = (t: string) => (t.length > 22 ? `${t.slice(0, 22)}…` : t);
const isFolder = (n: ViewNode) => n.count !== undefined;

export function GraphView({
	graph,
	onOpenDoc,
	onPreview,
	onClose,
}: {
	graph: DocGraph;
	onOpenDoc: (path: string) => void;
	/** Read a doc beside the current one (App closes the graph first). */
	onPreview?: (path: string) => void;
	onClose: () => void;
}) {
	const [depth, setDepth] = useState(readDepth);
	const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
	const [selected, setSelected] = useState<string | null>(null);
	const view = useMemo(() => foldGraph(graph, folded), [graph, folded]);
	const ring = view.nodes.length > RING_CAP;
	const [pts, setPts] = useState<Pt[]>(() => seedLayout(view));
	const [cam, setCam] = useState({ x: 0, y: 0, k: 1 });
	const [hot, setHot] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const svgRef = useRef<SVGSVGElement | null>(null);
	const pan = useRef<{ x: number; y: number; vx: number; vy: number } | null>(
		null,
	);
	const exportMenu = useMenu();

	const index = useMemo(
		() => new Map(view.nodes.map((n, i): [string, number] => [n.path, i])),
		[view],
	);
	const degree = useMemo(() => {
		const d = new Map<string, number>();
		for (const e of view.edges) {
			d.set(e.from, (d.get(e.from) ?? 0) + 1);
			d.set(e.to, (d.get(e.to) ?? 0) + 1);
		}
		return d;
	}, [view]);
	const isolated = view.nodes.filter((n) => !degree.get(n.path)).length;

	// The force loop: a few ticks per frame, one state commit at settle.
	// Re-runs when folding changes the node set or the grouping depth moves
	// the clusters.
	useEffect(() => {
		const p = seedLayout(view);
		if (ring) {
			setPts(p);
			return;
		}
		const idx = new Map(
			view.nodes.map((n, i): [string, number] => [n.path, i]),
		);
		// One key list per visible level (1 … depth, capped at the deepest
		// folder for "All").
		const deepest = Math.max(
			0,
			...view.nodes.map((n) => {
				const f = folderAt(n.path, Number.POSITIVE_INFINITY);
				return f === "" ? 0 : f.split("/").length;
			}),
		);
		const groups = Array.from({ length: Math.min(depth, deepest) }, (_, l) =>
			view.nodes.map((n) => folderAt(n.path, l + 1) || null),
		);
		let raf = 0;
		let tick = 0;
		let alpha = 1;
		// ~30 frames to settle regardless of node count.
		const per = Math.ceil(TICK_CAP / 30);
		const frame = () => {
			for (let i = 0; i < per && tick < TICK_CAP && alpha > 0.01; i++) {
				forceTick(p, view, idx, groups, alpha);
				tick++;
				alpha *= 0.985;
			}
			if (tick >= TICK_CAP || alpha <= 0.01) {
				setPts([...p]);
				return;
			}
			raf = requestAnimationFrame(frame);
		};
		setPts([...p]);
		raf = requestAnimationFrame(frame);
		return () => cancelAnimationFrame(raf);
	}, [view, ring, depth]);

	// Zoom about a pane point (the pointer for the wheel, the center for the
	// buttons) – k clamps keep the graph reachable at any size.
	const zoomAt = useCallback((px: number, py: number, factor: number) => {
		setCam((v) => {
			const k = Math.min(4, Math.max(0.05, v.k * factor));
			const s = k / v.k;
			return { k, x: px - (px - v.x) * s, y: py - (py - v.y) * s };
		});
	}, []);

	const fitView = useCallback(() => {
		if (pts.length === 0) return;
		const { w, h } = paneSize(svgRef.current);
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (const p of pts) {
			minX = Math.min(minX, p.x);
			minY = Math.min(minY, p.y);
			maxX = Math.max(maxX, p.x);
			maxY = Math.max(maxY, p.y);
		}
		// The hulls reach ~25% and 60px past their nodes, and their labels
		// sit above them; the floating controls take the pane's edges.
		const hx = (maxX - minX) * 0.08 + 70;
		const hy = (maxY - minY) * 0.08 + 80;
		minX -= hx;
		maxX += hx;
		minY -= hy;
		maxY += hy * 0.7;
		const padX = 48;
		const padY = 150;
		const bw = Math.max(1, maxX - minX);
		const bh = Math.max(1, maxY - minY);
		const k = Math.min(
			FIT_MAX,
			Math.max(0.05, Math.min((w - padX) / bw, (h - padY) / bh)),
		);
		setCam({
			k,
			x: w / 2 - (k * (minX + maxX)) / 2,
			y: h / 2 - (k * (minY + maxY)) / 2,
		});
	}, [pts]);
	// Refit whenever the layout lands – the pane is centered without a click.
	useEffect(() => {
		fitView();
	}, [fitView]);

	// Native wheel binding: React's onWheel is passive, preventDefault would
	// never stop the page scroll. zoomAt is stable, so this binds once.
	useEffect(() => {
		const svg = svgRef.current;
		if (!svg) return;
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			const r = svg.getBoundingClientRect();
			zoomAt(
				e.clientX - r.left,
				e.clientY - r.top,
				e.deltaY < 0 ? 1.15 : 1 / 1.15,
			);
		};
		svg.addEventListener("wheel", onWheel, { passive: false });
		return () => svg.removeEventListener("wheel", onWheel);
	}, [zoomAt]);

	const copyMermaid = () => {
		// A fetch or clipboard failure is a quiet no-op – export never throws.
		fetch("/api/graph?format=mermaid")
			.then((r) => (r.ok ? r.text() : undefined))
			.then((text) =>
				text === undefined ? undefined : navigator.clipboard.writeText(text),
			)
			.then(() => {
				setCopied(true);
				window.setTimeout(() => setCopied(false), 1500);
			})
			.catch(() => {});
	};

	const toggleFold = (folder: string) => {
		setSelected(null);
		setFolded((prev) => {
			const next = new Set(prev);
			if (next.has(folder)) next.delete(folder);
			else next.add(folder);
			return next;
		});
	};

	// Selection: the node, its neighbours (both directions), the rest dims.
	const out = selected
		? view.edges.filter((e) => e.from === selected).map((e) => e.to)
		: [];
	const inc = selected
		? view.edges.filter((e) => e.to === selected).map((e) => e.from)
		: [];
	const near = new Set([...(selected ? [selected] : []), ...out, ...inc]);
	const selNode = selected
		? view.nodes.find((n) => n.path === selected)
		: undefined;
	const titleOf = (p: string) => view.nodes.find((n) => n.path === p);

	const onNodeKey = (e: ReactKeyboardEvent, n: ViewNode) => {
		if (e.key !== "Enter" && e.key !== " ") return;
		e.preventDefault();
		if (isFolder(n)) toggleFold(n.path.slice(0, -1));
		else if (e.shiftKey) onOpenDoc(n.path);
		else setSelected((s) => (s === n.path ? null : n.path));
	};

	// Hulls: one dashed ellipse per visible group around its members.
	const hulls =
		depth === 0
			? []
			: [...groupsOf(view.nodes, depth)].flatMap(([key, g]) => {
					const ps = g.paths
						.map((p) => pts[index.get(p) ?? -1])
						.filter((p): p is Pt => !!p);
					if (ps.length === 0) return [];
					const xs = ps.map((p) => p.x);
					const ys = ps.map((p) => p.y);
					const pad = g.level === 1 ? 60 : 36;
					const minX = Math.min(...xs) - pad;
					const maxX = Math.max(...xs) + pad;
					const minY = Math.min(...ys) - pad;
					const maxY = Math.max(...ys) + pad;
					return [
						{
							key,
							level: g.level,
							cx: (minX + maxX) / 2,
							cy: (minY + maxY) / 2,
							rx: ((maxX - minX) / 2) * 1.12,
							ry: ((maxY - minY) / 2) * 1.12,
						},
					];
				});

	return (
		<div className="gv-pane docview">
			<CommandBar start={<b className="gv-crumb">Reference graph</b>}>
				<button
					type="button"
					className="btn"
					title="Close graph"
					aria-label="Close graph"
					onClick={onClose}
				>
					<X aria-hidden="true" />
					Close
				</button>
			</CommandBar>
			<div className="gv-stage">
				{ring && (
					<div className="gv-note">
						Large bundle – the deterministic ring layout is shown.
					</div>
				)}
				<svg
					ref={svgRef}
					className="gv-svg"
					role="img"
					aria-label={`Reference graph of ${graph.nodes.length} docs`}
					onPointerDown={(e: ReactPointerEvent<SVGSVGElement>) => {
						// A press on a node or a hull label must stay its click:
						// pointer capture would retarget the derived click to the
						// svg, so a pan never starts from one.
						if ((e.target as Element).closest?.(".gv-hit")) return;
						pan.current = {
							x: e.clientX,
							y: e.clientY,
							vx: cam.x,
							vy: cam.y,
						};
						e.currentTarget.setPointerCapture?.(e.pointerId);
					}}
					onPointerMove={(e: ReactPointerEvent<SVGSVGElement>) => {
						const d = pan.current;
						if (!d) return;
						setCam((v) => ({
							...v,
							x: d.vx + e.clientX - d.x,
							y: d.vy + e.clientY - d.y,
						}));
					}}
					onPointerUp={(e: ReactPointerEvent<SVGSVGElement>) => {
						// Release only when a pan actually took the capture. A press
						// that never moved on the empty canvas clears the selection.
						const d = pan.current;
						if (!d) return;
						pan.current = null;
						e.currentTarget.releasePointerCapture?.(e.pointerId);
						if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) < 3)
							setSelected(null);
					}}
					onPointerCancel={() => {
						pan.current = null;
					}}
				>
					<g transform={`translate(${cam.x} ${cam.y}) scale(${cam.k})`}>
						{hulls.map((h) => (
							<g key={`hull:${h.key}`}>
								<ellipse
									className={`gv-hull l${Math.min(h.level, 2)}`}
									cx={h.cx}
									cy={h.cy}
									rx={h.rx}
									ry={h.ry}
								/>
								{/* biome-ignore lint/a11y/useSemanticElements: an SVG text control – no HTML button can sit inside the drawing. */}
								<text
									className={`gv-hull-label gv-hit l${Math.min(h.level, 2)}`}
									x={h.cx - h.rx * 0.7}
									y={h.cy - h.ry - 8}
									role="button"
									tabIndex={0}
									aria-label={`Fold ${h.key}`}
									onClick={() => toggleFold(h.key)}
									onKeyDown={(e) => {
										if (e.key === "Enter" || e.key === " ") {
											e.preventDefault();
											toggleFold(h.key);
										}
									}}
								>
									<title>{`Fold ${h.key}`}</title>
									{h.level === 1 ? h.key : `${h.key.split("/").at(-1)}/`}{" "}
									<tspan className="gv-fold">−</tspan>
								</text>
							</g>
						))}
						{view.edges.map((e) => {
							const a = pts[index.get(e.from) ?? -1];
							const b = pts[index.get(e.to) ?? -1];
							if (!a || !b) return null;
							const lit =
								(hot !== null && (e.from === hot || e.to === hot)) ||
								(selected !== null &&
									(e.from === selected || e.to === selected));
							const dim =
								selected !== null && e.from !== selected && e.to !== selected;
							return (
								<g key={`${e.from}\u0000${e.to}`}>
									<line
										x1={a.x}
										y1={a.y}
										x2={b.x}
										y2={b.y}
										className={`gv-edge${lit ? " gv-edge-hot" : ""}${dim ? " dim" : ""}`}
									/>
									{e.weight > 1 && (
										<text
											className="gv-weight"
											x={(a.x + b.x) / 2}
											y={(a.y + b.y) / 2}
										>
											{e.weight}
										</text>
									)}
								</g>
							);
						})}
						{view.nodes.map((n, i) => {
							const p = pts[i];
							if (!p) return null;
							const dim = selected !== null && !near.has(n.path);
							if (isFolder(n)) {
								const label = `${n.title} · ${n.count} ${n.count === 1 ? "doc" : "docs"}`;
								const w = Math.max(120, label.length * 7.4 + 24);
								return (
									// biome-ignore lint/a11y/useSemanticElements: an SVG control – no HTML button can sit inside the drawing.
									<g
										key={n.path}
										className={`gv-folder gv-hit${dim ? " dim" : ""}`}
										transform={`translate(${p.x} ${p.y})`}
										role="button"
										tabIndex={0}
										aria-label={`Unfold ${n.path.slice(0, -1)}`}
										onClick={() => toggleFold(n.path.slice(0, -1))}
										onKeyDown={(e) => onNodeKey(e, n)}
									>
										<title>{`Unfold ${n.path.slice(0, -1)}`}</title>
										<rect x={-w / 2} y={-17} width={w} height={34} rx={9} />
										<text y={5}>{label}</text>
									</g>
								);
							}
							const tr = markOf(n);
							return (
								// biome-ignore lint/a11y/useSemanticElements: an SVG control – no HTML button can sit inside the drawing.
								<g
									key={n.path}
									className={`gv-n gv-hit${selected === n.path ? " sel" : ""}${dim ? " dim" : ""}`}
									transform={`translate(${p.x} ${p.y})`}
									role="button"
									tabIndex={0}
									aria-label={`${n.title} – ${tr ? TRUST_WORD[tr] : n.tier}`}
									aria-pressed={selected === n.path}
									onKeyDown={(e) => onNodeKey(e, n)}
								>
									{selected === n.path && <circle className="gv-ring" r={16} />}
									{n.stale && <circle className="gv-stale" r={13} />}
									{/* biome-ignore lint/a11y/noStaticElementInteractions: the group above is the keyboard control; the circle is its pointer target. */}
									<circle
										className={`gv-node gv-tier-${n.tier}${
											(degree.get(n.path) ?? 0) === 0 ? " gv-isolated" : ""
										}`}
										r={10}
										onClick={() =>
											setSelected((s) => (s === n.path ? null : n.path))
										}
										onDoubleClick={() => onOpenDoc(n.path)}
										onMouseEnter={() => setHot(n.path)}
										onMouseLeave={() =>
											setHot((h) => (h === n.path ? null : h))
										}
									/>
									<text className="gv-label" y={26}>
										{truncate(n.title)}
									</text>
								</g>
							);
						})}
					</g>
				</svg>

				<div className="gfloat gtitle">
					<b className="gv-count">{view.nodes.length} docs</b>
					<span>
						{view.edges.length} links · {isolated} isolated
					</span>
					<fieldset className="seg" aria-label="Group by folder depth">
						{DEPTHS.map(([d, label]) => (
							<button
								key={label}
								type="button"
								aria-pressed={depth === d}
								onClick={() => {
									setDepth(d);
									storeDepth(d);
								}}
							>
								{label}
							</button>
						))}
					</fieldset>
				</div>

				<div className="gfloat gtools">
					<button
						type="button"
						className="btn icon"
						title="Zoom out"
						aria-label="Zoom out"
						onClick={() => {
							const { w, h } = paneSize(svgRef.current);
							zoomAt(w / 2, h / 2, 1 / 1.25);
						}}
					>
						<Minus aria-hidden="true" />
					</button>
					<button
						type="button"
						className="btn icon"
						title="Zoom in"
						aria-label="Zoom in"
						onClick={() => {
							const { w, h } = paneSize(svgRef.current);
							zoomAt(w / 2, h / 2, 1.25);
						}}
					>
						<Plus aria-hidden="true" />
					</button>
					<button
						type="button"
						className="btn icon"
						title="Fit"
						aria-label="Fit"
						onClick={fitView}
					>
						<Maximize aria-hidden="true" />
					</button>
					<span className="vsep" />
					<span className="menu-wrap" ref={exportMenu.wrapRef}>
						<button
							type="button"
							className="btn"
							aria-expanded={exportMenu.open}
							onClick={exportMenu.toggle}
						>
							<Download aria-hidden="true" />
							Export
							<ChevronDown aria-hidden="true" />
						</button>
						<MenuPopover anchor={exportMenu.anchor} popRef={exportMenu.popRef}>
							<button type="button" className="menu-item" onClick={copyMermaid}>
								{copied ? "Copied" : "Copy Mermaid"}
							</button>
							{/* The server sets Content-Disposition; download is a hint. */}
							<a
								className="menu-item"
								href="/api/graph?format=dot"
								download="graph.dot"
							>
								graph.dot
							</a>
							<a className="menu-item" href="/api/graph" download="graph.json">
								graph.json
							</a>
							<a
								className="menu-item"
								href="/api/export/bundle"
								download="bundle.zip"
							>
								Bundle .zip
							</a>
						</MenuPopover>
					</span>
				</div>

				{selNode && !isFolder(selNode) && (
					<aside className="insp" aria-label="Selected document">
						<div className="kicker">
							{selNode.type && <span className="type">{selNode.type}</span>}
							{selNode.type && <span className="rule" />}
							<span>{selNode.path}</span>
						</div>
						<h3>{selNode.title}</h3>
						<div className="lst">
							{(
								[
									["References", out],
									["Referenced by", inc],
								] as const
							).map(([label, list]) => (
								<div key={label}>
									<h5>
										{label} · {list.length}
									</h5>
									{list.map((p) => {
										const t = titleOf(p);
										const m = t ? markOf(t) : null;
										return (
											<button
												key={p}
												type="button"
												onClick={() => setSelected(p)}
											>
												{m && <span className={`tr ${m}`} aria-hidden="true" />}
												{t?.title ?? p}
											</button>
										);
									})}
								</div>
							))}
						</div>
						<div className="act">
							<button
								type="button"
								className="btn primary"
								onClick={() => onOpenDoc(selNode.path)}
							>
								Open
							</button>
							{onPreview && (
								<button
									type="button"
									className="btn line"
									onClick={() => onPreview(selNode.path)}
								>
									<Eye aria-hidden="true" />
									Preview
								</button>
							)}
						</div>
					</aside>
				)}

				{/* The legend: exactly the encodings the view draws. */}
				<div className="gfloat glegend">
					<span>
						<i className="tr u" /> Unverified
					</span>
					<span>
						<i className="tr m" /> Machine-confirmed
					</span>
					<span>
						<i className="tr h" /> Human-reviewed
					</span>
					<span>
						<i className="tr s" /> Stale
					</span>
					<span>
						<i className="tr u gv-sw-isolated" /> Isolated
					</span>
					<span>
						<i className="gv-sw-folder" /> Folded folder
					</span>
				</div>
			</div>
		</div>
	);
}
