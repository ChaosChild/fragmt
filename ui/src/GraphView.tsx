import { X } from "lucide-react";
import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { DocGraph, GraphNode } from "./api";

/**
 * The reference graph lens (rung 5, D2/D3): the fourth main-pane state.
 * Zero dependencies – each node's angle is seeded from an FNV-1a hash of its
 * path so the same repo state draws the same shape twice, a capped force
 * loop (pairwise repulsion, edge springs, mild centering) settles within
 * TICK_CAP ticks and stops (no perpetual animation), and past RING_CAP nodes
 * the simulation is skipped for a deterministic ring (graph.nodes arrives
 * sorted by path). Wheel and pointer handlers bind natively so
 * preventDefault works; every handler guards its nulls – happy-dom mounts
 * this without layout and exercises only render + click.
 */

const RING_CAP = 300;
const TICK_CAP = 300;
/** The spring's rest length; also scales the seed circle. */
const EDGE_LEN = 130;
/** happy-dom never lays the pane out – the fallback keeps the math alive. */
const FALLBACK_W = 900;
const FALLBACK_H = 600;

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
function seedLayout(graph: DocGraph): Pt[] {
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

/** One force tick, position-based with an alpha-scaled displacement clamp. */
function forceTick(
	p: Pt[],
	graph: DocGraph,
	index: Map<string, number>,
	alpha: number,
) {
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
			const f = ((EDGE_LEN * EDGE_LEN) / d2) * alpha;
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

const truncate = (t: string) => (t.length > 20 ? `${t.slice(0, 20)}…` : t);

export function GraphView({
	graph,
	onOpenDoc,
	onClose,
}: {
	graph: DocGraph;
	onOpenDoc: (path: string) => void;
	onClose: () => void;
}) {
	const ring = graph.nodes.length > RING_CAP;
	const [pts, setPts] = useState<Pt[]>(() => seedLayout(graph));
	const [view, setView] = useState({ x: 0, y: 0, k: 1 });
	const [hot, setHot] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const svgRef = useRef<SVGSVGElement | null>(null);
	const pan = useRef<{ x: number; y: number; vx: number; vy: number } | null>(
		null,
	);

	const index = useMemo(
		() => new Map(graph.nodes.map((n, i): [string, number] => [n.path, i])),
		[graph],
	);
	const degree = useMemo(() => {
		const d = new Map<string, number>();
		for (const e of graph.edges) {
			d.set(e.from, (d.get(e.from) ?? 0) + 1);
			d.set(e.to, (d.get(e.to) ?? 0) + 1);
		}
		return d;
	}, [graph]);

	// The force loop: a few ticks per frame, one state commit at settle.
	useEffect(() => {
		const p = seedLayout(graph);
		if (ring) {
			setPts(p);
			return;
		}
		const idx = new Map(
			graph.nodes.map((n, i): [string, number] => [n.path, i]),
		);
		let raf = 0;
		let tick = 0;
		let alpha = 1;
		// ~30 frames to settle regardless of node count.
		const per = Math.ceil(TICK_CAP / 30);
		const frame = () => {
			for (let i = 0; i < per && tick < TICK_CAP && alpha > 0.01; i++) {
				forceTick(p, graph, idx, alpha);
				tick++;
				alpha *= 0.985;
			}
			if (tick >= TICK_CAP || alpha <= 0.01) {
				setPts([...p]);
				return;
			}
			raf = requestAnimationFrame(frame);
		};
		raf = requestAnimationFrame(frame);
		return () => cancelAnimationFrame(raf);
	}, [graph, ring]);

	// Zoom about a pane point (the pointer for the wheel, the center for the
	// buttons) – k clamps keep the graph reachable at any size.
	const zoomAt = useCallback((px: number, py: number, factor: number) => {
		setView((v) => {
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
		const pad = 48;
		const bw = Math.max(1, maxX - minX);
		const bh = Math.max(1, maxY - minY);
		const k = Math.min(
			2.5,
			Math.max(0.05, Math.min((w - pad) / bw, (h - pad) / bh)),
		);
		setView({
			k,
			x: w / 2 - (k * (minX + maxX)) / 2,
			y: h / 2 - (k * (minY + maxY)) / 2,
		});
	}, [pts]);
	// Refit whenever the layout lands (mount, ring, settle) – the pane is
	// then centered without any user act.
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

	const hotNode =
		hot === null ? undefined : graph.nodes.find((n) => n.path === hot);
	const hotPt = hotNode ? (pts[index.get(hotNode.path) ?? -1] ?? null) : null;
	const { w: paneW } = paneSize(svgRef.current);

	return (
		<div className="gv-pane">
			<div className="gv-toolbar">
				<span className="gv-count">
					{graph.nodes.length} docs · {graph.edges.length} links
				</span>
				<span className="gv-spacer" />
				<button type="button" className="iconbtn" onClick={fitView}>
					Fit
				</button>
				<button
					type="button"
					className="tool-btn"
					title="Zoom out"
					aria-label="Zoom out"
					onClick={() => {
						const { w, h } = paneSize(svgRef.current);
						zoomAt(w / 2, h / 2, 1 / 1.25);
					}}
				>
					−
				</button>
				<button
					type="button"
					className="tool-btn"
					title="Zoom in"
					aria-label="Zoom in"
					onClick={() => {
						const { w, h } = paneSize(svgRef.current);
						zoomAt(w / 2, h / 2, 1.25);
					}}
				>
					+
				</button>
				<button type="button" className="iconbtn" onClick={copyMermaid}>
					{copied ? "Copied" : "Copy Mermaid"}
				</button>
				{/* The server sets Content-Disposition; download is a hint. */}
				<a
					className="iconbtn"
					href="/api/graph?format=dot"
					download="graph.dot"
				>
					graph.dot
				</a>
				<a className="iconbtn" href="/api/graph" download="graph.json">
					graph.json
				</a>
				<a className="iconbtn" href="/api/export/bundle" download="bundle.zip">
					Bundle .zip
				</a>
				{/* Far right, Slideout's close idiom – exiting the lens is
				    always safe, no guard on close. */}
				<button
					type="button"
					className="slideout-close"
					title="Close graph"
					aria-label="Close graph"
					onClick={onClose}
				>
					<X aria-hidden="true" />
				</button>
			</div>
			{ring && (
				<div className="gv-note">
					Large bundle – the deterministic ring layout is shown.
				</div>
			)}
			<div className="gv-body">
				<svg
					ref={svgRef}
					role="img"
					aria-label="Reference graph"
					onPointerDown={(e: ReactPointerEvent<SVGSVGElement>) => {
						// A press on a node must stay the node's click: pointer
						// capture would retarget the browser's derived click to
						// the svg, so a pan simply never starts from a node.
						if ((e.target as Element).closest?.(".gv-node")) return;
						pan.current = {
							x: e.clientX,
							y: e.clientY,
							vx: view.x,
							vy: view.y,
						};
						e.currentTarget.setPointerCapture?.(e.pointerId);
					}}
					onPointerMove={(e: ReactPointerEvent<SVGSVGElement>) => {
						const d = pan.current;
						if (!d) return;
						setView((v) => ({
							...v,
							x: d.vx + e.clientX - d.x,
							y: d.vy + e.clientY - d.y,
						}));
					}}
					onPointerUp={(e: ReactPointerEvent<SVGSVGElement>) => {
						// Release only when a pan actually took the capture – an
						// unconditional release lies about a capture we never set.
						if (!pan.current) return;
						pan.current = null;
						e.currentTarget.releasePointerCapture?.(e.pointerId);
					}}
					onPointerCancel={() => {
						pan.current = null;
					}}
				>
					<g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
						{graph.edges.map((e) => {
							const a = pts[index.get(e.from) ?? -1];
							const b = pts[index.get(e.to) ?? -1];
							if (!a || !b) return null;
							const lit = hot !== null && (e.from === hot || e.to === hot);
							return (
								<line
									key={`${e.from}\u0000${e.to}`}
									x1={a.x}
									y1={a.y}
									x2={b.x}
									y2={b.y}
									className={lit ? "gv-edge gv-edge-hot" : "gv-edge"}
								/>
							);
						})}
						{graph.nodes.map((n: GraphNode, i) => {
							const p = pts[i];
							if (!p) return null;
							return (
								<g key={n.path} transform={`translate(${p.x} ${p.y})`}>
									{n.stale && <circle className="gv-stale" r={13} />}
									{/* biome-ignore lint/a11y/noStaticElementInteractions: pointer-only by design – every doc stays keyboard-reachable through the sidebar; the node click is the lens's one shortcut. */}
									<circle
										className={`gv-node gv-tier-${n.tier}${
											(degree.get(n.path) ?? 0) === 0 ? " gv-isolated" : ""
										}`}
										r={10}
										onClick={() => onOpenDoc(n.path)}
										onMouseEnter={() => setHot(n.path)}
										onMouseLeave={() =>
											setHot((h) => (h === n.path ? null : h))
										}
									/>
									<text className="gv-label" y={22}>
										{truncate(n.title)}
									</text>
								</g>
							);
						})}
					</g>
				</svg>
				{hotNode && hotPt && (
					<div
						className="gv-tip"
						style={{
							left: Math.min(
								Math.max(8, hotPt.x * view.k + view.x + 14),
								Math.max(8, paneW - 250),
							),
							top: Math.max(8, hotPt.y * view.k + view.y - 10),
						}}
					>
						<strong>{hotNode.title}</strong>
						<span className="gv-tip-path">{hotNode.path}</span>
						<span className="gv-tip-meta">
							{hotNode.type ?? "no type"} · {hotNode.tier} ·{" "}
							{degree.get(hotNode.path) ?? 0} links
						</span>
					</div>
				)}
				{/* The legend: exactly the encodings the view draws, swatches
				    mirroring the node/edge classes with the same tokens. Read-
				    only – pointer-events none keeps the pan alive underneath. */}
				<div className="gv-legend">
					<span className="gv-legend-item">
						<span className="gv-sw gv-sw-unverified" /> unverified
					</span>
					<span className="gv-legend-item">
						<span className="gv-sw gv-sw-machine-confirmed" /> machine-confirmed
					</span>
					<span className="gv-legend-item">
						<span className="gv-sw gv-sw-human-reviewed" /> human-reviewed
					</span>
					<span className="gv-legend-item">
						<span className="gv-sw gv-sw-stale" /> stale
					</span>
					<span className="gv-legend-item">
						<span className="gv-sw gv-sw-isolated" /> isolated — no links
					</span>
					<span className="gv-legend-item">
						{/* Inline width/height on purpose: this engine ignored the
						    class-level sizing, inflating the swatch to the svg
						    default (404x150) and breaking the legend layout. */}
						<svg
							className="gv-sw-edge"
							width={16}
							height={10}
							style={{ width: 16, height: 10 }}
							aria-hidden="true"
						>
							<line x1="0" y1="5" x2="16" y2="5" />
						</svg>
						edge = body link
					</span>
				</div>
			</div>
		</div>
	);
}
