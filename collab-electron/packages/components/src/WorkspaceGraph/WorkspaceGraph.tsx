import { isImageFile } from "@collab/shared/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	ForceDirectedGraph,
	type ForceDirectedGraphRef,
} from "./ForceDirectedGraph";
import { buildHueMap, hueToColor } from "./hueMap";
import { useReplayEngine } from "./useReplayEngine";
import { ReplayTimeline } from "./ReplayTimeline";
import type { GraphData, GraphLink, GraphNode } from "./types";

interface WorkspaceGraphProps {
	workspacePath: string;
	onSelectFile: (path: string) => void;
	theme: "light" | "dark";
	hidden?: boolean;
	scopePath?: string;
}

export function WorkspaceGraph({
	workspacePath,
	onSelectFile,
	theme,
	hidden = false,
	scopePath,
}: WorkspaceGraphProps) {
	const [graphData, setGraphData] = useState<GraphData | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const containerRef = useRef<HTMLDivElement>(null);
	const graphRef = useRef<ForceDirectedGraphRef>(null);
	const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
	const canvasRef = useRef<HTMLDivElement>(null);
	const [agentSessions, setAgentSessions] = useState<
		Map<string, { interactions: Array<{ filePath: string; touchType: string; timestamp: number }> }>
	>(new Map());
	const [, setTick] = useState(0);
	const replay = useReplayEngine();
	const [pulsingFiles, setPulsingFiles] = useState<Set<string>>(new Set());

	const fetchGraph = useCallback(() => {
		window.api
			.getWorkspaceGraph({ workspacePath })
			.then((data) => {
				setGraphData(data);
				setLoading(false);
			})
			.catch((err) => {
				setError(String(err));
				setLoading(false);
			});
	}, [workspacePath]);

	useEffect(() => {
		setLoading(true);
		setError(null);
		fetchGraph();
	}, [fetchGraph]);

	useEffect(() => {
		let timeout: ReturnType<typeof setTimeout>;
		const unsub = window.api.onFsChanged(() => {
			clearTimeout(timeout);
			timeout = setTimeout(fetchGraph, 300);
		});
		return () => {
			clearTimeout(timeout);
			unsub();
		};
	}, [fetchGraph]);

	useEffect(() => {
		replay.start(workspacePath);
		return () => replay.stop();
	}, [workspacePath]); // eslint-disable-line react-hooks/exhaustive-deps

	useEffect(() => {
		const container = canvasRef.current;
		if (!container) return;

		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (!entry) return;
			const { width, height } = entry.contentRect;
			if (width === 0 || height === 0) return;
			setDimensions({ width: Math.floor(width), height: Math.floor(height) });
		});
		observer.observe(container);
		return () => observer.disconnect();
	}, []);

	const prevHiddenRef = useRef(hidden);
	useEffect(() => {
		const wasHidden = prevHiddenRef.current;
		prevHiddenRef.current = hidden;
		if (wasHidden && !hidden) {
			graphRef.current?.resetView();
		}
	}, [hidden]);

	useEffect(() => {
		return window.api.onAgentEvent((event) => {
			setAgentSessions((prev) => {
				const next = new Map(prev);
				if (event.kind === "session-started") {
					next.set(event.sessionId, { interactions: [] });
				} else if (
					event.kind === "file-touched" &&
					event.filePath &&
					event.touchType &&
					event.timestamp
				) {
					const session = next.get(event.sessionId);
					if (session) {
						session.interactions = [
							...session.interactions,
							{
								filePath: event.filePath,
								touchType: event.touchType,
								timestamp: event.timestamp,
							},
						];
					}
				} else if (event.kind === "session-ended") {
					next.delete(event.sessionId);
				}
				return next;
			});
		});
	}, []);

	useEffect(() => {
		if (agentSessions.size === 0) return;
		const interval = setInterval(() => setTick((t) => t + 1), 1000);
		return () => clearInterval(interval);
	}, [agentSessions.size]);

	const mergedData = useMemo(() => {
		if (!graphData) return null;

		const agentNodes: GraphNode[] = [];
		const agentLinks: GraphLink[] = [];
		const fileNodeIds = new Set(graphData.nodes.map((n) => n.id));

		for (const [sessionId, session] of agentSessions) {
			agentNodes.push({
				id: `agent:${sessionId}`,
				title: "Claude Code",
				path: "",
				weight: session.interactions.length,
				nodeType: "agent",
			});

			const seenFiles = new Map<string, { touchType: string; timestamp: number }>();
			for (const interaction of session.interactions) {
				const existing = seenFiles.get(interaction.filePath);
				if (!existing || interaction.timestamp > existing.timestamp) {
					seenFiles.set(interaction.filePath, interaction);
				}
			}

			for (const [filePath, { touchType, timestamp }] of seenFiles) {
				if (!fileNodeIds.has(filePath)) continue;
				agentLinks.push({
					source: `agent:${sessionId}`,
					target: filePath,
					linkType: touchType === "read" ? "agent-read" : "agent-write",
					timestamp,
				});
			}
		}

		return {
			nodes: [...graphData.nodes, ...agentNodes],
			links: [...graphData.links, ...agentLinks],
		};
	}, [graphData, agentSessions]);

	const scopedData = useMemo(() => {
		if (!mergedData) return null;
		if (!scopePath) return mergedData;

		const relativePrefix = scopePath.startsWith(workspacePath)
			? scopePath.slice(workspacePath.length).replace(/^\//, "")
			: scopePath;
		if (!relativePrefix) return mergedData;
		const prefix = relativePrefix.endsWith("/")
			? relativePrefix
			: relativePrefix + "/";

		const scopedNodes = mergedData.nodes.filter(
			(n) => n.nodeType === "agent" || n.id.startsWith(prefix) || n.id === relativePrefix,
		);
		const nodeIds = new Set(scopedNodes.map((n) => n.id));

		const scopedLinks = mergedData.links.filter(
			(l) => {
				const src = typeof l.source === "string" ? l.source : l.source.id;
				const tgt = typeof l.target === "string" ? l.target : l.target.id;
				return nodeIds.has(src) && nodeIds.has(tgt);
			},
		);

		const linkedAgentIds = new Set<string>();
		for (const l of scopedLinks) {
			const src = typeof l.source === "string" ? l.source : l.source.id;
			const tgt = typeof l.target === "string" ? l.target : l.target.id;
			if (src.startsWith("agent:")) linkedAgentIds.add(src);
			if (tgt.startsWith("agent:")) linkedAgentIds.add(tgt);
		}

		const finalNodes = scopedNodes.filter(
			(n) => n.nodeType !== "agent" || linkedAgentIds.has(n.id),
		);
		const finalNodeIds = new Set(finalNodes.map((n) => n.id));
		const finalLinks = scopedLinks.filter((l) => {
			const src = typeof l.source === "string" ? l.source : l.source.id;
			const tgt = typeof l.target === "string" ? l.target : l.target.id;
			return finalNodeIds.has(src) && finalNodeIds.has(tgt);
		});

		return { nodes: finalNodes, links: finalLinks };
	}, [mergedData, scopePath, workspacePath]);

	const [thumbnailData, setThumbnailData] = useState<GraphData | null>(null);

	useEffect(() => {
		if (!scopedData) {
			setThumbnailData(null);
			return;
		}

		setThumbnailData(scopedData);

		const imageNodes = scopedData.nodes.filter(
			(n) => n.path && isImageFile(n.path),
		);
		if (imageNodes.length === 0) return;

		let cancelled = false;

		Promise.all(
			imageNodes.map(async (node) => {
				try {
					const url = await window.api.getImageThumbnail(
						node.path,
						192,
					);
					return { id: node.id, url };
				} catch {
					return null;
				}
			}),
		).then((results) => {
			if (cancelled) return;
			const urlMap = new Map<string, string>();
			for (const r of results) {
				if (r) urlMap.set(r.id, r.url);
			}
			if (urlMap.size === 0) return;

			setThumbnailData((prev) => {
				if (!prev) return prev;
				return {
					...prev,
					nodes: prev.nodes.map((n) => {
						const url = urlMap.get(n.id);
						return url ? { ...n, thumbnailUrl: url } : n;
					}),
				};
			});
		});

		return () => {
			cancelled = true;
		};
	}, [scopedData]);

	const isLive = replay.currentIndex === -1;
	const liveData = thumbnailData ?? scopedData;
	const displayData = isLive ? liveData : replay.currentGraphData;

	const hueMap = useMemo(
		() =>
			displayData
				? buildHueMap(displayData.nodes.map((n) => n.id))
				: new Map<string, number>(),
		[displayData],
	);
	const isDark = theme === "dark";

	useEffect(() => {
		if (replay.currentIndex < 0 || replay.modifiedFiles.size === 0) {
			setPulsingFiles(new Set());
			return;
		}
		setPulsingFiles(new Set(replay.modifiedFiles));
		const timer = setTimeout(() => setPulsingFiles(new Set()), 300);
		return () => clearTimeout(timer);
	}, [replay.currentIndex, replay.modifiedFiles]);

	const nodeFill = useCallback(
		(node: GraphNode) => {
			if (pulsingFiles.has(node.id)) {
				return isDark ? "#ffffff" : "#000000";
			}
			if (node.nodeType === "agent") return "#E8714A";
			if (node.nodeType === "code") return isDark ? "#3b82f6" : "#1e3a8a";
			const hue = hueMap.get(node.id) ?? -1;
			return hueToColor(hue, isDark);
		},
		[hueMap, isDark, pulsingFiles],
	);

	const nodeStroke = useCallback(
		(node: GraphNode) => {
			if (node.nodeType === "agent") {
				return isDark ? "#ffffff" : "#000000";
			}
			if (isImageFile(node.path)) {
				return isDark ? "#ffffff99" : "#00000099";
			}
			return isDark ? "#0f172a" : "#ffffff";
		},
		[isDark],
	);

	const nodeStrokeWidthFn = useCallback(
		(node: GraphNode) => {
			if (node.nodeType === "agent") return 6;
			return 2;
		},
		[],
	);

	const linkStroke = useCallback(
		(link: GraphLink) => {
			if (link.linkType === "agent-read" || link.linkType === "agent-write") {
				return isDark ? "#ffffff" : "#000000";
			}
			if (link.linkType === "import") {
				return isDark ? "#3b82f6" : "#1e3a8a";
			}
			return isDark ? "#64748b" : "#94a3b8";
		},
		[isDark],
	);

	// TODO: add recency-rank-based fading for opacity and strength
	const linkOpacity = useCallback(
		(link: GraphLink) => {
			if (link.linkType === "agent-read") return 0.5;
			if (link.linkType === "agent-write") return 0.7;
			return 0.5;
		},
		[],
	);

	const weightRange = useMemo(() => {
		if (!graphData) return { min: 0, max: 1 };
		let min = Infinity;
		let max = 0;
		for (const node of graphData.nodes) {
			const w = node.weight ?? 0;
			if (w < min) min = w;
			if (w > max) max = w;
		}
		if (!isFinite(min)) min = 0;
		if (max <= min) max = min + 1;
		return { min, max };
	}, [graphData]);

	const nodeRadius = useCallback(
		(node: GraphNode) => {
			if (node.nodeType === "agent") return 16;
			if (isImageFile(node.path)) return 24;
			const w = node.weight ?? 0;
			const t = Math.max(0, Math.min(1, (w - weightRange.min) / (weightRange.max - weightRange.min)));
			return 10 + Math.pow(t, 1 / 2) * 16;
		},
		[weightRange],
	);

	const handleNodeClick = useCallback(
		(node: GraphNode) => {
			if (node.nodeType === "agent") {
				const sessionId = node.id.replace("agent:", "");
				window.api.focusAgentSession(sessionId);
				return;
			}
			onSelectFile(node.path);
		},
		[onSelectFile],
	);

	useEffect(() => {
		if (agentSessions.size === 0) return;
		graphRef.current?.refreshLinkStyles();
	}, [agentSessions]);

	const atGitRoot = !scopePath || scopePath === workspacePath;
	const timelineElement = !replay.isGitRepo || !atGitRoot ? null : (
		<ReplayTimeline
			commits={replay.commits}
			currentIndex={replay.currentIndex}
			isPlaying={replay.isPlaying}
			isLoading={replay.isLoading}
			totalCommits={replay.totalCommits}
			timeRange={replay.timeRange}
			onPlay={replay.play}
			onPause={replay.pause}
			onSeekTo={replay.seekTo}
			onSeekToLive={replay.seekToLive}
		/>
	);

	if (loading) {
		return (
			<div className="workspace-graph-container" ref={containerRef}>
				<div className="workspace-graph-canvas" ref={canvasRef}>
					<div className="workspace-graph-status">Loading graph...</div>
					{timelineElement}
				</div>
			</div>
		);
	}

	if (error) {
		return (
			<div className="workspace-graph-container" ref={containerRef}>
				<div className="workspace-graph-canvas" ref={canvasRef}>
					<div className="workspace-graph-status workspace-graph-error">
						{error}
					</div>
					{timelineElement}
				</div>
			</div>
		);
	}

	const hasData = displayData && displayData.nodes.length > 0;

	return (
		<div className="workspace-graph-container" ref={containerRef}>
			<div className="workspace-graph-canvas" ref={canvasRef}>
				{!hasData && (
					<div className="workspace-graph-status">
						No files found in workspace
					</div>
				)}
				{hasData && dimensions.width > 0 && dimensions.height > 0 && (
					<ForceDirectedGraph
						ref={graphRef}
						data={displayData}
						width={dimensions.width}
						height={dimensions.height}
						darkMode={isDark}
						hidden={hidden}
						nodeFill={nodeFill}
						nodeStroke={nodeStroke}
						nodeStrokeWidth={nodeStrokeWidthFn}
						nodeRadius={nodeRadius}
						linkStroke={linkStroke}
						linkOpacity={linkOpacity}
						onNodeClick={handleNodeClick}
					/>
				)}
				{timelineElement}
			</div>
		</div>
	);
}
