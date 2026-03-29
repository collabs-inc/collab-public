import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import type { GraphData, GraphLink, GraphNode } from "./types";
import {
	createForceGraph,
	type ForceGraphHandle,
	type ForceGraphThemeOptions,
} from "./forceGraph";

interface ForceDirectedGraphProps {
	data: GraphData;
	width: number;
	height: number;
	darkMode?: boolean;
	hidden?: boolean;
	nodeFill: (node: GraphNode) => string;
	nodeStroke?: (node: GraphNode, index: number) => string;
	nodeStrokeWidth?: (node: GraphNode, index: number) => number;
	nodeRadius?: number | ((node: GraphNode, index: number) => number);
	linkStroke?: string | ((link: GraphLink, index: number) => string);
	linkStrokeDasharray?: string | ((link: GraphLink, index: number) => string);
	linkOpacity?: number | ((link: GraphLink, index: number) => number);
	linkStrength?: number | ((link: GraphLink, index: number) => number);
	onNodeClick?: (node: GraphNode) => void;
}

export interface ForceDirectedGraphRef {
	resetView: () => void;
	refreshLinkStyles: () => void;
}

function getThemeOptions(isDark: boolean): ForceGraphThemeOptions {
	return {
		nodeStroke: isDark ? "#0f172a" : "#ffffff",
		nodeStrokeOpacity: 1,
		nodeStrokeWidth: 2,
		linkStroke: isDark ? "#64748b" : "#94a3b8",
	};
}

export const ForceDirectedGraph = forwardRef<
	ForceDirectedGraphRef,
	ForceDirectedGraphProps
>(({ data, width, height, darkMode, hidden, nodeFill, nodeStroke, nodeStrokeWidth, nodeRadius, linkStroke, linkStrokeDasharray, linkOpacity, linkStrength, onNodeClick }, ref) => {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const graphRef = useRef<ForceGraphHandle | null>(null);
	const onNodeClickRef = useRef(onNodeClick);
	const themeRef = useRef(getThemeOptions(!!darkMode));

	useImperativeHandle(ref, () => ({
		resetView: () => graphRef.current?.resetView(),
		refreshLinkStyles: () => graphRef.current?.refreshLinkStyles(),
	}));

	useEffect(() => {
		onNodeClickRef.current = onNodeClick;
	}, [onNodeClick]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		if (!graphRef.current) {
			if (!data || !Array.isArray(data.nodes) || data.nodes.length === 0) {
				container.innerHTML = "";
				return;
			}

			const handle = createForceGraph(data, {
				width,
				height,
				nodeTitle: (node) => node.title,
				...(nodeRadius !== undefined && { nodeRadius }),
				nodeFill,
				...(nodeStroke && { nodeStroke }),
				...(nodeStrokeWidth && { nodeStrokeWidth }),
				...(linkStroke && { linkStroke }),
				linkStrokeWidth: 1.33,
				...(linkStrokeDasharray && { linkStrokeDasharray }),
				...(linkOpacity !== undefined && { linkOpacity }),
				nodeStrength: -50,
				linkStrength: linkStrength ?? 0.01,
				centerStrengthX: 0.03,
				centerStrengthY: 0.03,
				onNodeClick: (node) => {
					onNodeClickRef.current?.(node);
				},
				tooltipRoot: container,
			});

			if (!handle) return;

			graphRef.current = handle;
			container.appendChild(handle.element);
			handle.updateTheme(themeRef.current);

			if (width > 0 && height > 0) {
				handle.resize(width, height);
			}
		}

		graphRef.current?.updateData(data);
		// linkOpacity excluded: refreshLinkStyles handles time-based updates
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [data, height, width, nodeFill, nodeRadius, linkStroke, linkStrokeDasharray]);

	useEffect(() => {
		return () => {
			const handle = graphRef.current;
			if (!handle) return;
			handle.destroy();
			handle.simulation.stop();
			handle.element.remove();
			graphRef.current = null;
		};
	}, []);

	useEffect(() => {
		if (!graphRef.current) return;
		const sim = graphRef.current.simulation;
		if (hidden) {
			sim.stop();
		} else {
			sim.alpha(0.3).restart();
		}
	}, [hidden]);

	useEffect(() => {
		const theme = getThemeOptions(!!darkMode);
		themeRef.current = theme;
		graphRef.current?.updateTheme(theme);
	}, [darkMode]);

	useEffect(() => {
		if (typeof nodeFill === "function") {
			graphRef.current?.updateNodeFill(nodeFill);
		}
	}, [nodeFill]);

	useEffect(() => {
		if (nodeStroke) {
			graphRef.current?.updateNodeStroke(nodeStroke);
		}
	}, [nodeStroke]);

	useEffect(() => {
		if (nodeStrokeWidth) {
			graphRef.current?.updateNodeStrokeWidth(nodeStrokeWidth);
		}
	}, [nodeStrokeWidth]);

	useEffect(() => {
		if (typeof linkStroke === "function") {
			graphRef.current?.updateLinkStroke(linkStroke);
		}
	}, [linkStroke]);

	useEffect(() => {
		const handle = graphRef.current;
		if (!handle || width <= 0 || height <= 0) return;
		handle.resize(width, height);
	}, [width, height]);

	return (
		<div style={{ position: "relative", width: "100%", height: "100%" }}>
			<div ref={containerRef} style={{ width: "100%", height: "100%" }} />
		</div>
	);
});

ForceDirectedGraph.displayName = "ForceDirectedGraph";
