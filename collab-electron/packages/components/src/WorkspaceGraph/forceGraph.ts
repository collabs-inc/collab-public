import * as d3 from "d3";
import type {
	GraphData,
	GraphLink,
	GraphNode,
	ForceNode,
	ForceLink,
} from "./types";

export interface ForceGraphOptions {
	width?: number;
	height?: number;
	nodeId?: (node: GraphNode, index: number) => string;
	nodeTitle?: (
		node: GraphNode,
		index: number,
	) => string | null | undefined;
	nodeRadius?:
	| number
	| ((node: GraphNode, index: number) => number);
	nodeFill?:
	| string
	| ((node: GraphNode, index: number) => string);
	nodeStroke?:
	| string
	| ((node: GraphNode, index: number) => string);
	nodeStrokeWidth?:
	| number
	| ((node: GraphNode, index: number) => number);
	nodeStrokeOpacity?: number;
	nodeStrength?: number;
	linkSource?: (link: GraphLink, index: number) => string;
	linkTarget?: (link: GraphLink, index: number) => string;
	linkStroke?:
	| string
	| ((link: GraphLink, index: number) => string);
	linkStrokeOpacity?: number;
	linkStrokeWidth?:
	| number
	| ((link: GraphLink, index: number) => number);
	linkStrokeLinecap?: string;
	linkStrokeDasharray?:
	| string
	| ((link: GraphLink, index: number) => string);
	linkOpacity?:
	| number
	| ((link: GraphLink, index: number) => number);
	linkStrength?:
	| number
	| ((link: GraphLink, index: number) => number);
	centerX?: number;
	centerY?: number;
	centerStrengthX?: number;
	centerStrengthY?: number;
	onNodeClick?: (node: GraphNode) => void;
	tooltipRoot?: HTMLElement;
}

export interface ForceGraphThemeOptions {
	nodeFill?: string;
	nodeStroke?: string;
	nodeStrokeOpacity?: number;
	nodeStrokeWidth?: number;
	linkStroke?: string;
	linkStrokeOpacity?: number;
}

export interface ForceGraphHandle {
	element: SVGSVGElement;
	simulation: d3.Simulation<ForceNode, ForceLink>;
	resize: (width: number, height: number) => void;
	updateTheme: (theme: ForceGraphThemeOptions) => void;
	updateData: (data: GraphData) => void;
	updateNodeFill: (
		fn: (node: GraphNode, index: number) => string,
	) => void;
	updateNodeStroke: (
		fn: (node: GraphNode, index: number) => string,
	) => void;
	updateNodeStrokeWidth: (
		fn: (node: GraphNode, index: number) => number,
	) => void;
	updateLinkStroke: (
		fn: (link: GraphLink, index: number) => string,
	) => void;
	resetView: () => void;
	refreshLinkStyles: () => void;
	destroy: () => void;
}

function safePatternId(raw: string): string {
	return raw.replace(/[^a-zA-Z0-9_-]/g, (ch) =>
		`_${ch.charCodeAt(0).toString(16).padStart(2, "0")}`,
	);
}

function intern(value: unknown) {
	if (value !== null && typeof value === "object") {
		return (value as { valueOf: () => unknown }).valueOf();
	}
	return value;
}

function createCentralSpringForce(
	axis: "x" | "y",
	target: number,
	constantMagnitude: number,
): d3.Force<ForceNode, ForceLink> {
	let nodes: ForceNode[] = [];
	const safeConstant = Math.abs(constantMagnitude);

	const force = (alpha: number) => {
		if (!nodes || nodes.length === 0) return;
		for (const node of nodes) {
			const coord = axis === "x" ? node.x : node.y;
			if (coord === undefined) {
				continue;
			}
			const offset = coord - target;
			if (offset === 0) {
				continue;
			}
			const applied = -offset * safeConstant;
			if (axis === "x") {
				node.vx = (node.vx ?? 0) + applied * alpha;
			} else {
				node.vy = (node.vy ?? 0) + applied * alpha;
			}
		}
	};

	force.initialize = (initNodes: ForceNode[]) => {
		nodes = initNodes;
	};

	return force;
}

export function createForceGraph(
	data: GraphData,
	opts: ForceGraphOptions = {},
): ForceGraphHandle | null {
	const { nodes, links } = data;

	const initialNodes = Array.isArray(nodes) ? nodes : [];
	const initialLinks = Array.isArray(links) ? links : [];

	if (initialNodes.length === 0) {
		return null;
	}

	const {
		width = 640,
		height = 400,
		nodeId = (node: GraphNode) => node.id,
		nodeTitle,
		nodeRadius = 5,
		nodeFill: initialNodeFill = "currentColor",
		nodeStroke: initialNodeStroke = "#fff",
		nodeStrokeWidth: initialNodeStrokeWidth = 1.5,
		nodeStrokeOpacity = 1,
		nodeStrength,
		linkSource = (link: GraphLink) => link.source,
		linkTarget = (link: GraphLink) => link.target,
		linkStroke: initialLinkStroke = "#999",
		linkStrokeOpacity,
		linkStrokeWidth = 1.5,
		linkStrokeLinecap = "round",
		linkStrokeDasharray,
		linkOpacity,
		linkStrength,
		centerX,
		centerY,
		centerStrengthX,
		centerStrengthY,
		onNodeClick,
		tooltipRoot,
	} = opts;

	let nodeFill: string | ((node: GraphNode, index: number) => string) =
		initialNodeFill;
	let nodeStroke: string | ((node: GraphNode, index: number) => string) =
		initialNodeStroke;
	let nodeStrokeWidth: number | ((node: GraphNode, index: number) => number) =
		initialNodeStrokeWidth;
	let linkStroke: string | ((link: GraphLink, index: number) => string) =
		initialLinkStroke;
	let currentNodes = [...initialNodes];
	let currentLinks = [...initialLinks];

	let nodeIds = currentNodes.map((node, index) =>
		String(intern(nodeId(node, index))),
	);
	let nodeTitles = nodeTitle
		? currentNodes.map((node, index) =>
			nodeTitle(node, index),
		)
		: null;
	let radiusValues =
		typeof nodeRadius === "function"
			? currentNodes.map((node, index) =>
				nodeRadius(node, index),
			)
			: null;
	let nodeFillValues =
		typeof nodeFill === "function"
			? currentNodes.map((node, index) =>
				nodeFill(node, index),
			)
			: null;
	let nodeStrokeValues =
		typeof nodeStroke === "function"
			? currentNodes.map((node, index) =>
				nodeStroke(node, index),
			)
			: null;
	let nodeStrokeWidthValues =
		typeof nodeStrokeWidth === "function"
			? currentNodes.map((node, index) =>
				nodeStrokeWidth(node, index),
			)
			: null;
	let linkSources = currentLinks.map((link, index) =>
		String(intern(linkSource(link, index))),
	);
	let linkTargets = currentLinks.map((link, index) =>
		String(intern(linkTarget(link, index))),
	);
	let linkStrokeWidths =
		typeof linkStrokeWidth === "function"
			? d3.map(currentLinks, linkStrokeWidth)
			: null;
	let linkStrokeColors =
		typeof linkStroke === "function"
			? d3.map(currentLinks, linkStroke)
			: null;

	let forceNodes: ForceNode[] = currentNodes.map(
		(node, index) => ({
			...node,
			id: String(nodeIds[index]),
			__index: index,
		}),
	);

	let forceLinks: ForceLink[] = currentLinks.map(
		(link, index) => ({
			...link,
			source: linkSources[index],
			target: linkTargets[index],
		}),
	);

	const getNodeRadius = (
		_d: ForceNode,
		index: number,
	) => {
		if (typeof nodeRadius === "number") {
			return nodeRadius;
		}
		return radiusValues ? radiusValues[index] : 5;
	};

	const IMAGE_CORNER_RADIUS = 6;

	const applyNodeSize = (
		sel: d3.Selection<SVGRectElement, ForceNode, SVGGElement, unknown>,
	) => {
		sel
			.attr("width", (d, i) => getNodeRadius(d, i) * 2)
			.attr("height", (d, i) => getNodeRadius(d, i) * 2)
			.attr("rx", (d, i) =>
				d.thumbnailUrl ? IMAGE_CORNER_RADIUS : getNodeRadius(d, i),
			)
			.attr("ry", (d, i) =>
				d.thumbnailUrl ? IMAGE_CORNER_RADIUS : getNodeRadius(d, i),
			);
	};

	let currentTheme: ForceGraphThemeOptions = {
		nodeFill:
			typeof nodeFill === "string" ? nodeFill : undefined,
		nodeStroke,
		nodeStrokeOpacity,
		nodeStrokeWidth,
		linkStroke:
			typeof linkStroke === "string"
				? linkStroke
				: undefined,
		linkStrokeOpacity,
	};

	const getNodeFill = (d: ForceNode, index: number) => {
		if (typeof nodeFill === "string") {
			return nodeFill;
		}
		if (typeof nodeFill === "function") {
			return (
				currentTheme.nodeFill ||
				(nodeFillValues
					? nodeFillValues[index]
					: "currentColor")
			);
		}
		return nodeFillValues
			? nodeFillValues[index]
			: "currentColor";
	};

	const getLinkStrokeWidth = (
		_d: ForceLink,
		index: number,
	) => {
		if (typeof linkStrokeWidth === "number") {
			return linkStrokeWidth;
		}
		return linkStrokeWidths
			? linkStrokeWidths[index]
			: 1.5;
	};

	const getLinkStrokeColor = (
		_d: ForceLink,
		index: number,
	) => {
		if (typeof linkStroke === "string") {
			return linkStroke;
		}
		return linkStrokeColors
			? linkStrokeColors[index]
			: "#999";
	};

	const linkForce = d3
		.forceLink<ForceNode, ForceLink>(forceLinks)
		.id((node) => node.id);
	if (linkStrength !== undefined) {
		linkForce.strength(linkStrength as number);
	}

	const nodeForce = d3.forceManyBody<ForceNode>();
	if (nodeStrength !== undefined) {
		nodeForce.strength(nodeStrength);
	}

	const simulation = d3
		.forceSimulation<ForceNode>(forceNodes)
		.alphaDecay(0.01)
		.force("link", linkForce)
		.force("charge", nodeForce)
		.on("tick", ticked);

	if (
		centerStrengthX !== undefined ||
		centerStrengthY !== undefined ||
		centerX !== undefined ||
		centerY !== undefined
	) {
		const piecewiseX = createCentralSpringForce(
			"x",
			centerX ?? 0,
			centerStrengthX ?? 0.05,
		);
		const piecewiseY = createCentralSpringForce(
			"y",
			centerY ?? 0,
			centerStrengthY ?? 0.05,
		);
		simulation
			.force("centerX", piecewiseX)
			.force("centerY", piecewiseY);
	} else {
		simulation.force("center", d3.forceCenter());
	}

	let currentWidth = Math.max(1, width);
	let currentHeight = Math.max(1, height);

	const svg = d3
		.create("svg")
		.attr("width", currentWidth)
		.attr("height", currentHeight)
		.attr("viewBox", [
			-currentWidth / 2,
			-currentHeight / 2,
			currentWidth,
			currentHeight,
		])
		.attr(
			"style",
			"cursor: default; touch-action: none; max-width: 100%; height: auto; height: intrinsic;",
		);

	const tooltipHost = tooltipRoot ?? document.body;
	const tooltip = document.createElement("div");
	const tooltipPositioning =
		tooltipHost === document.body ? "fixed" : "absolute";
	tooltip.setAttribute(
		"data-forcegraph-tooltip",
		"true",
	);
	Object.assign(tooltip.style, {
		position: tooltipPositioning,
		pointerEvents: "none",
		padding: "6px 10px",
		borderRadius: "8px",
		background: "rgba(15, 23, 42, 0.45)",
		backdropFilter: "blur(8px)",
		WebkitBackdropFilter: "blur(8px)",
		color: "#f1f5f9",
		fontSize: "13px",
		lineHeight: "1.35",
		boxShadow: "0 12px 32px rgba(15, 23, 42, 0.35)",
		opacity: "0",
		transform: "translate(-9999px, -9999px)",
		transition: "opacity 0.1s ease",
		zIndex: "2147483647",
	});
	tooltipHost.appendChild(tooltip);

	const showTooltip = (
		event: PointerEvent,
		node: ForceNode,
	) => {
		const nodeTitleText =
			nodeTitles?.[node.__index] ?? node.title ?? "";
		if (!nodeTitleText) {
			return;
		}
		tooltip.textContent = nodeTitleText;
		tooltip.style.opacity = "1";
		positionTooltip(event);
	};

	const hideTooltip = () => {
		tooltip.style.opacity = "0";
		tooltip.style.transform =
			"translate(-9999px, -9999px)";
	};

	const positionTooltip = (event: PointerEvent) => {
		const offsetX = 14;
		const offsetY = 12;
		if (tooltipPositioning === "fixed") {
			const x = event.clientX + offsetX;
			const y = event.clientY + offsetY;
			tooltip.style.transform = `translate(${x}px, ${y}px)`;
			return;
		}
		const rootRect =
			tooltipHost.getBoundingClientRect();
		const x =
			event.clientX - rootRect.left + offsetX;
		const y =
			event.clientY - rootRect.top + offsetY;
		tooltip.style.transform = `translate(${x}px, ${y}px)`;
	};

	const handlePointerEnter = (
		event: PointerEvent,
		node: ForceNode,
	) => {
		showTooltip(event, node);
	};

	const handlePointerMove = (
		event: PointerEvent,
	) => {
		if (tooltip.style.opacity === "0") {
			return;
		}
		positionTooltip(event);
	};

	const handlePointerLeave = () => {
		hideTooltip();
	};

	const defs = svg.append("defs");

	function syncThumbnailPatterns(nodes: ForceNode[]) {
		const imageNodes = nodes.filter((n) => n.thumbnailUrl);

		defs
			.selectAll<SVGPatternElement, ForceNode>(
				"pattern.node-thumb",
			)
			.data(imageNodes, (d) => d.id)
			.join(
				(enter) => {
					const pattern = enter
						.append("pattern")
						.attr("class", "node-thumb")
						.attr(
							"id",
							(d) => `thumb-${safePatternId(d.id)}`,
						)
						.attr("width", 1)
						.attr("height", 1)
						.attr(
							"patternContentUnits",
							"objectBoundingBox",
						);
					pattern
						.append("image")
						.attr("href", (d) => d.thumbnailUrl!)
						.attr("width", 1)
						.attr("height", 1)
						.attr(
							"preserveAspectRatio",
							"xMidYMid slice",
						);
					return pattern;
				},
				(update) => {
					update
						.select("image")
						.attr("href", (d) => d.thumbnailUrl!);
					return update;
				},
			);
	}

	const zoomLayer = svg
		.append("g")
		.attr("data-graph-layer", "zoomable");

	const linkLayer = zoomLayer
		.append("g")
		.attr(
			"stroke",
			typeof linkStroke === "string"
				? linkStroke
				: null,
		)
		.attr("stroke-opacity", linkStrokeOpacity)
		.attr(
			"stroke-width",
			typeof linkStrokeWidth === "number"
				? linkStrokeWidth
				: null,
		)
		.attr("stroke-linecap", linkStrokeLinecap);

	const nodeLayer = zoomLayer
		.append("g")
		.attr(
			"fill",
			typeof nodeFill === "string" ? nodeFill : null,
		)
		.attr(
			"stroke",
			typeof nodeStroke === "string" ? nodeStroke : null,
		)
		.attr("stroke-opacity", nodeStrokeOpacity)
		.attr(
			"stroke-width",
			typeof nodeStrokeWidth === "number"
				? nodeStrokeWidth
				: null,
		);

	let linkSelection = linkLayer
		.selectAll<SVGLineElement, ForceLink>("line")
		.data(forceLinks)
		.join("line");

	if (typeof linkStrokeDasharray === "function") {
		linkSelection.attr("stroke-dasharray", (d, i) =>
			(linkStrokeDasharray as (link: GraphLink, index: number) => string)(d, i),
		);
	} else if (typeof linkStrokeDasharray === "string") {
		linkSelection.attr("stroke-dasharray", linkStrokeDasharray);
	}

	if (typeof linkOpacity === "function") {
		linkSelection.attr("opacity", (d, i) =>
			(linkOpacity as (link: GraphLink, index: number) => number)(d, i),
		);
	} else if (typeof linkOpacity === "number") {
		linkSelection.attr("opacity", linkOpacity);
	}

	let nodeSelection = nodeLayer
		.selectAll<SVGRectElement, ForceNode>("rect")
		.data(forceNodes)
		.join("rect");
	applyNodeSize(nodeSelection);

	if (typeof nodeFill === "function") {
		nodeSelection.attr("fill", getNodeFill);
	} else if (typeof nodeFill === "string") {
		nodeSelection.attr("fill", nodeFill);
	}

	if (typeof nodeStroke === "function") {
		nodeSelection.attr(
			"stroke",
			(_d, i) => nodeStrokeValues![i],
		);
	}

	if (typeof nodeStrokeWidth === "function") {
		nodeSelection.attr(
			"stroke-width",
			(_d, i) => nodeStrokeWidthValues![i],
		);
	}

	syncThumbnailPatterns(forceNodes);
	nodeSelection.attr("fill", (d, i) => {
		if (d.thumbnailUrl) {
			return `url(#thumb-${safePatternId(d.id)})`;
		}
		return getNodeFill(d, i);
	});

	nodeSelection.call(drag(simulation) as any);

	const bindNodeInteractions = (
		selection: d3.Selection<
			SVGRectElement,
			ForceNode,
			SVGGElement,
			unknown
		>,
	) => {
		selection
			.on(
				"pointerenter.tooltip",
				(event, node) =>
					handlePointerEnter(
						event as PointerEvent,
						node,
					),
			)
			.on(
				"pointermove.tooltip",
				(event) =>
					handlePointerMove(event as PointerEvent),
			)
			.on("pointerleave.tooltip", () =>
				handlePointerLeave(),
			);

		if (onNodeClick) {
			selection.on("click", (event, node) => {
				if (event.defaultPrevented) {
					return;
				}
				event.stopPropagation();
				hideTooltip();
				onNodeClick(node);
			});
		} else {
			selection.on("click", null);
		}

		return selection;
	};

	bindNodeInteractions(nodeSelection);

	const initialZoomScale = 0.333;
	let currentTransform =
		d3.zoomIdentity.scale(initialZoomScale);

	const zoomBehavior = d3
		.zoom<SVGSVGElement, unknown>()
		.scaleExtent([0.1, 1])
		.filter((event) => {
			if (event.type === "wheel") {
				return (
					event.ctrlKey ||
					event.metaKey ||
					event.shiftKey
				);
			}
			return true;
		})
		.on("start", () =>
			svg.style("cursor", "default"),
		)
		.on("end", () =>
			svg.style("cursor", "default"),
		)
		.on("zoom", (event) => {
			currentTransform = event.transform;
			zoomLayer.attr(
				"transform",
				currentTransform.toString(),
			);
		});

	svg
		.call(zoomBehavior as any)
		.call(
			zoomBehavior.transform as any,
			currentTransform,
		);

	const svgElement = svg.node();
	if (!svgElement) {
		simulation.stop();
		return null;
	}

	const handleWheelPan = (event: WheelEvent) => {
		if (
			event.ctrlKey ||
			event.metaKey ||
			event.shiftKey
		) {
			return;
		}
		event.preventDefault();
		const nextTransform = currentTransform.translate(
			-(2 * event.deltaX) / currentTransform.k,
			-(2 * event.deltaY) / currentTransform.k,
		);
		currentTransform = nextTransform;
		svg.call(
			zoomBehavior.transform as any,
			currentTransform,
		);
	};

	svgElement.addEventListener("wheel", handleWheelPan, {
		passive: false,
	});

	const applyTheme = (
		nextTheme: ForceGraphThemeOptions,
	) => {
		currentTheme = {
			...currentTheme,
			...nextTheme,
		};

		if (
			currentTheme.nodeFill &&
			typeof nodeFill !== "function"
		) {
			nodeSelection.attr("fill", (d) => {
				if (d.thumbnailUrl) {
					return `url(#thumb-${safePatternId(d.id)})`;
				}
				return currentTheme.nodeFill!;
			});
		} else if (typeof nodeFill === "function") {
			nodeSelection.attr("fill", (d, i) => {
				if (d.thumbnailUrl) {
					return `url(#thumb-${safePatternId(d.id)})`;
				}
				return getNodeFill(d, i);
			});
		}

		if (currentTheme.nodeStroke && typeof nodeStroke !== "function") {
			nodeSelection.attr(
				"stroke",
				currentTheme.nodeStroke,
			);
		}

		if (currentTheme.nodeStrokeOpacity !== undefined) {
			nodeSelection.attr(
				"stroke-opacity",
				currentTheme.nodeStrokeOpacity,
			);
		}

		if (currentTheme.nodeStrokeWidth !== undefined && typeof nodeStrokeWidth !== "function") {
			nodeSelection.attr(
				"stroke-width",
				currentTheme.nodeStrokeWidth,
			);
		}

		if (currentTheme.linkStrokeOpacity !== undefined) {
			linkSelection.attr(
				"stroke-opacity",
				currentTheme.linkStrokeOpacity,
			);
		}

		if (typeof linkStroke === "function") {
			linkStrokeColors = d3.map(currentLinks, linkStroke);
			linkSelection.attr("stroke", (_d, i) => linkStrokeColors![i]);
		} else if (currentTheme.linkStroke) {
			linkSelection.attr(
				"stroke",
				currentTheme.linkStroke,
			);
		} else if (typeof linkStroke === "string") {
			linkSelection.attr("stroke", linkStroke);
		}
	};

	applyTheme({});

	if (typeof linkStrokeWidth === "function") {
		linkSelection.attr(
			"stroke-width",
			getLinkStrokeWidth,
		);
	}

	if (typeof linkStroke === "function") {
		linkSelection.attr("stroke", getLinkStrokeColor);
	}

	const getLinkKey = (link: ForceLink) => {
		const source =
			typeof link.source === "string"
				? link.source
				: (link.source as ForceNode).id;
		const target =
			typeof link.target === "string"
				? link.target
				: (link.target as ForceNode).id;
		return `${source}->${target}`;
	};

	function getPosition(
		value: string | ForceNode,
		axis: "x" | "y",
	): number {
		if (typeof value === "string") return 0;
		const coordinate =
			axis === "x" ? value.x : value.y;
		return coordinate ?? 0;
	}

	function ticked() {
		linkSelection
			.attr("x1", (d) =>
				getPosition(d.source, "x"),
			)
			.attr("y1", (d) =>
				getPosition(d.source, "y"),
			)
			.attr("x2", (d) =>
				getPosition(d.target, "x"),
			)
			.attr("y2", (d) =>
				getPosition(d.target, "y"),
			);

		nodeSelection
			.attr("x", (d) => (d.x ?? 0) - getNodeRadius(d, d.__index))
			.attr("y", (d) => (d.y ?? 0) - getNodeRadius(d, d.__index));
	}

	const updateData = (nextData: GraphData) => {
		const nextNodes = Array.isArray(nextData?.nodes)
			? nextData.nodes
			: [];
		const nextLinks = Array.isArray(nextData?.links)
			? nextData.links
			: [];

		const previousNodeIds = new Set(
			forceNodes.map((node) => node.id),
		);
		const previousLinkKeys = new Set(
			forceLinks.map((link) => getLinkKey(link)),
		);
		const existingNodeById = new Map(
			forceNodes.map(
				(node) => [node.id, node] as const,
			),
		);
		const existingLinkByKey = new Map(
			forceLinks.map(
				(link) =>
					[getLinkKey(link), link] as const,
			),
		);

		currentNodes = [...nextNodes];
		currentLinks = [...nextLinks];

		nodeIds = currentNodes.map((node, index) =>
			String(intern(nodeId(node, index))),
		);
		const nextNodeIdSet = new Set(nodeIds);
		nodeTitles = nodeTitle
			? currentNodes.map((node, index) =>
				nodeTitle(node, index),
			)
			: null;
		radiusValues =
			typeof nodeRadius === "function"
				? currentNodes.map((node, index) =>
					nodeRadius(node, index),
				)
				: null;
		nodeFillValues =
			typeof nodeFill === "function"
				? currentNodes.map((node, index) =>
					nodeFill(node, index),
				)
				: null;
		nodeStrokeValues =
			typeof nodeStroke === "function"
				? currentNodes.map((node, index) =>
					nodeStroke(node, index),
				)
				: null;
		nodeStrokeWidthValues =
			typeof nodeStrokeWidth === "function"
				? currentNodes.map((node, index) =>
					nodeStrokeWidth(node, index),
				)
				: null;

		let nodesChanged =
			currentNodes.length !== forceNodes.length;
		let nodePropsChanged = false;

		const nextForceNodes: ForceNode[] =
			currentNodes.map((node, index) => {
				const id = String(nodeIds[index]);
				const existing = existingNodeById.get(id);

				if (existing) {
					if (
						existing.title !== node.title ||
						existing.weight !== node.weight ||
						existing.thumbnailUrl !== node.thumbnailUrl
					) {
						nodePropsChanged = true;
					}

					existing.__index = index;
					existing.title = node.title;
					existing.weight = node.weight;
					existing.thumbnailUrl = node.thumbnailUrl;

					return existing;
				}

				nodesChanged = true;
				const nextNode: ForceNode = {
					...node,
					id,
					__index: index,
				};
				return nextNode;
			});

		linkSources = currentLinks.map((link, index) =>
			String(intern(linkSource(link, index))),
		);
		linkTargets = currentLinks.map((link, index) =>
			String(intern(linkTarget(link, index))),
		);
		const nextLinkKeys = currentLinks.map(
			(_link, index) =>
				`${linkSources[index]}->${linkTargets[index]}`,
		);
		const nextLinkKeySet = new Set(nextLinkKeys);
		linkStrokeWidths =
			typeof linkStrokeWidth === "function"
				? d3.map(currentLinks, linkStrokeWidth)
				: null;
		linkStrokeColors =
			typeof linkStroke === "function"
				? d3.map(currentLinks, linkStroke)
				: null;

		let linksChanged =
			currentLinks.length !== forceLinks.length;

		const nextForceLinks: ForceLink[] =
			currentLinks.map((link, index) => {
				const sourceId = linkSources[index];
				const targetId = linkTargets[index];
				const key = nextLinkKeys[index];
				const existing = existingLinkByKey.get(key);

				if (existing) {
					existing.source = sourceId;
					existing.target = targetId;
					return existing;
				}

				linksChanged = true;
				return {
					...link,
					source: sourceId,
					target: targetId,
				};
			});

		if (!nodesChanged) {
			for (const previousId of previousNodeIds) {
				if (!nextNodeIdSet.has(previousId)) {
					nodesChanged = true;
					break;
				}
			}
		}

		if (!linksChanged) {
			for (const previousKey of previousLinkKeys) {
				if (!nextLinkKeySet.has(previousKey)) {
					linksChanged = true;
					break;
				}
			}
		}

		forceNodes = nextForceNodes;
		forceLinks = nextForceLinks;

		linkSelection = linkLayer
			.selectAll<SVGLineElement, ForceLink>("line")
			.data(forceLinks, getLinkKey)
			.join(
				(enter) => enter.append("line"),
				(update) => update,
				(exit) => exit.remove(),
			);

		if (typeof linkStrokeWidth === "function") {
			linkSelection.attr(
				"stroke-width",
				getLinkStrokeWidth,
			);
		}

		if (typeof linkStroke === "function") {
			linkSelection.attr(
				"stroke",
				getLinkStrokeColor,
			);
		}

		if (typeof linkStrokeDasharray === "function") {
			linkSelection.attr("stroke-dasharray", (d, i) =>
				(linkStrokeDasharray as (link: GraphLink, index: number) => string)(d, i),
			);
		} else if (typeof linkStrokeDasharray === "string") {
			linkSelection.attr("stroke-dasharray", linkStrokeDasharray);
		}

		if (typeof linkOpacity === "function") {
			linkSelection.attr("opacity", (d, i) =>
				(linkOpacity as (link: GraphLink, index: number) => number)(d, i),
			);
		} else if (typeof linkOpacity === "number") {
			linkSelection.attr("opacity", linkOpacity);
		}

		const joinedNodes = nodeLayer
			.selectAll<SVGRectElement, ForceNode>("rect")
			.data(forceNodes, (node) => node.id)
			.join(
				(enter) => {
					const enterSelection = enter
						.append("rect");
					applyNodeSize(enterSelection);
					if (typeof nodeFill === "function") {
						enterSelection.attr(
							"fill",
							getNodeFill,
						);
					} else if (typeof nodeFill === "string") {
						enterSelection.attr("fill", nodeFill);
					}
					if (typeof nodeStroke === "function") {
						enterSelection.attr(
							"stroke",
							(_d, i) => nodeStrokeValues![i],
						);
					}
					if (typeof nodeStrokeWidth === "function") {
						enterSelection.attr(
							"stroke-width",
							(_d, i) => nodeStrokeWidthValues![i],
						);
					}
					return bindNodeInteractions(
						enterSelection.call(
							drag(simulation) as any,
						),
					);
				},
				(update) => bindNodeInteractions(update),
				(exit) => {
					exit
						.on("pointerenter.tooltip", null)
						.on("pointermove.tooltip", null)
						.on("pointerleave.tooltip", null)
						.on("click", null)
						.remove();
					return exit;
				},
			);

		nodeSelection = joinedNodes;
		applyNodeSize(nodeSelection);
		if (typeof nodeFill === "function") {
			nodeSelection.attr("fill", getNodeFill);
		} else if (typeof nodeFill === "string") {
			nodeSelection.attr("fill", nodeFill);
		}
		if (typeof nodeStroke === "function") {
			nodeSelection.attr(
				"stroke",
				(_d, i) => nodeStrokeValues![i],
			);
		}
		if (typeof nodeStrokeWidth === "function") {
			nodeSelection.attr(
				"stroke-width",
				(_d, i) => nodeStrokeWidthValues![i],
			);
		}
		syncThumbnailPatterns(forceNodes);
		nodeSelection.attr("fill", (d, i) => {
			if (d.thumbnailUrl) {
				return `url(#thumb-${safePatternId(d.id)})`;
			}
			return getNodeFill(d, i);
		});
		nodeSelection.call(drag(simulation) as any);

		if (forceNodes.length === 0) {
			hideTooltip();
			simulation.nodes([]);
			linkForce.links([]);
			simulation.alphaTarget(0);
			simulation.stop();
			return;
		}

		simulation.nodes(forceNodes);
		linkForce.links(forceLinks);

		if (
			nodesChanged ||
			linksChanged ||
			nodePropsChanged
		) {
			const targetAlpha =
				nodesChanged || linksChanged ? 0.45 : 0.25;
			simulation
				.alpha(
					Math.max(simulation.alpha(), targetAlpha),
				)
				.restart();
		}

		applyTheme({});
	};

	function drag(
		sim: d3.Simulation<ForceNode, ForceLink>,
	) {
		function stopEventPropagation(
			event: d3.D3DragEvent<
				SVGRectElement,
				ForceNode,
				ForceNode
			>,
		) {
			(
				event.sourceEvent as
				| {
					stopPropagation?: () => void;
				}
				| undefined
			)?.stopPropagation?.();
		}

		function dragstarted(
			event: d3.D3DragEvent<
				SVGRectElement,
				ForceNode,
				ForceNode
			>,
		) {
			stopEventPropagation(event);
			hideTooltip();
			if (!event.active)
				sim.alphaTarget(0.5).restart();
			event.subject.fx = event.subject.x;
			event.subject.fy = event.subject.y;
		}

		function dragged(
			event: d3.D3DragEvent<
				SVGRectElement,
				ForceNode,
				ForceNode
			>,
		) {
			stopEventPropagation(event);
			event.subject.fx = event.x;
			event.subject.fy = event.y;
		}

		function dragended(
			event: d3.D3DragEvent<
				SVGRectElement,
				ForceNode,
				ForceNode
			>,
		) {
			stopEventPropagation(event);
			if (!event.active) {
				sim.alphaTarget(0).alpha(0.5).restart();
			}
			event.subject.fx = null;
			event.subject.fy = null;
		}

		return d3
			.drag<SVGRectElement, ForceNode>()
			.on("start", dragstarted)
			.on("drag", dragged)
			.on("end", dragended);
	}

	return {
		element: svgElement,
		simulation,
		resize: (
			nextWidth: number,
			nextHeight: number,
		) => {
			const widthValue = Math.max(
				1,
				Math.floor(nextWidth),
			);
			const heightValue = Math.max(
				1,
				Math.floor(nextHeight),
			);
			if (
				widthValue === currentWidth &&
				heightValue === currentHeight
			) {
				return;
			}
			currentWidth = widthValue;
			currentHeight = heightValue;
			svg
				.attr("width", currentWidth)
				.attr("height", currentHeight)
				.attr("viewBox", [
					-currentWidth / 2,
					-currentHeight / 2,
					currentWidth,
					currentHeight,
				]);
		},
		updateData,
		updateTheme: applyTheme,
		updateNodeFill: (
			fn: (node: GraphNode, index: number) => string,
		) => {
			nodeFill = fn;
			nodeFillValues = currentNodes.map((node, i) =>
				fn(node, i),
			);
			nodeSelection.attr("fill", (d, i) => {
				if (d.thumbnailUrl) {
					return `url(#thumb-${safePatternId(d.id)})`;
				}
				return nodeFillValues![i];
			});
		},
		updateNodeStroke: (
			fn: (node: GraphNode, index: number) => string,
		) => {
			nodeStroke = fn;
			nodeStrokeValues = currentNodes.map((node, i) =>
				fn(node, i),
			);
			nodeSelection.attr("stroke", (_d, i) =>
				nodeStrokeValues![i],
			);
		},
		updateNodeStrokeWidth: (
			fn: (node: GraphNode, index: number) => number,
		) => {
			nodeStrokeWidth = fn;
			nodeStrokeWidthValues = currentNodes.map((node, i) =>
				fn(node, i),
			);
			nodeSelection.attr("stroke-width", (_d, i) =>
				nodeStrokeWidthValues![i],
			);
		},
		updateLinkStroke: (
			fn: (link: GraphLink, index: number) => string,
		) => {
			linkStroke = fn;
			linkStrokeColors = d3.map(currentLinks, fn);
			linkSelection.attr(
				"stroke",
				(_d, i) => linkStrokeColors![i],
			);
		},
		resetView: () => {
			const baseTransform =
				d3.zoomIdentity.scale(initialZoomScale);
			currentTransform = baseTransform;
			svg.call(
				zoomBehavior.transform as any,
				baseTransform,
			);
		},
		refreshLinkStyles: () => {
			if (typeof linkStrokeDasharray === "function") {
				linkSelection.attr("stroke-dasharray", (d, i) =>
					(linkStrokeDasharray as (link: GraphLink, index: number) => string)(d, i),
				);
			}
			if (typeof linkOpacity === "function") {
				linkSelection.attr("opacity", (d, i) =>
					(linkOpacity as (link: GraphLink, index: number) => number)(d, i),
				);
			}
			if (typeof linkStrength === "function") {
				linkForce.strength(linkStrength as (link: GraphLink, index: number) => number);
				if (simulation.alpha() < 0.05) {
					simulation.alpha(0.05).restart();
				}
			}
		},
		destroy: () => {
			svgElement.removeEventListener(
				"wheel",
				handleWheelPan,
			);
			hideTooltip();
			tooltip.remove();
		},
	};
}
