import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import {
	SearchSortControls,
	useMultiSelect,
	useInlineRename,
	useDragDrop,
	sortModeOrder,
	TREE_SORT_MODE_STORAGE_KEY,
	ENABLE_GRAPH_TILES,
} from '@collab/components/TreeView';
import { WorkspaceTree } from '@collab/components/TreeView/WorkspaceTree';
import type { WorkspaceFileTreeHandle } from '@collab/components/TreeView/useWorkspaceFileTree';
import type {
	SortMode,
	FlatItem,
	SearchSortControlsHandle,
} from '@collab/components/TreeView';
import {
	saveExpandedWorkspaces,
} from '@collab/components/TreeView/useFileTree';
import {
	displayBasename,
	isSubpath,
	parentPath,
} from '@collab/shared/path-utils';

const PLATFORM = window.api.getPlatform();

const REVEAL_LABEL =
	PLATFORM === 'darwin'
		? 'Reveal in Finder'
		: PLATFORM === 'win32'
			? 'Reveal in Explorer'
			: 'Reveal in File Manager';

function ImportWebArticleModal({
	folderPath,
	onClose,
	onImported,
}: {
	folderPath: string;
	onClose: () => void;
	onImported: (filePath: string) => void;
}) {
	const [url, setUrl] = useState('');
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(
		null,
	);

	const handleImport = async () => {
		if (!url.trim()) return;
		if (
			typeof window.api.importWebArticle !==
			'function'
		) {
			setError(
				'Import not available — restart the app to load the updated preload.',
			);
			return;
		}
		setLoading(true);
		setError(null);
		try {
			const result =
				await window.api.importWebArticle(
					url.trim(),
					folderPath,
				);
			onImported(result.path);
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: 'Failed to import article',
			);
		} finally {
			setLoading(false);
		}
	};

	return (
		<div
			className="create-item-modal-overlay"
			onClick={onClose}
		>
			<div
				className="create-item-modal-content"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="create-item-modal-header">
					<h3
						style={{
							fontSize: '15px',
							fontWeight: 500,
							margin: 0,
						}}
					>
						Import Web Article
					</h3>
				</div>
				<form
					className="create-item-modal-form"
					onSubmit={(e) => {
						e.preventDefault();
						if (!loading) handleImport();
					}}
				>
					<div className="create-item-form-group">
						<input
							type="url"
							placeholder="Enter article URL..."
							value={url}
							onChange={(e) =>
								setUrl(e.target.value)
							}
							onKeyDown={(e) => {
								if (e.key === 'Escape')
									onClose();
							}}
							className="create-item-modal-text-input"
							autoFocus
							disabled={loading}
						/>
					</div>
					{error && (
						<p
							style={{
								fontSize: '12px',
								color: 'var(--destructive, #ef4444)',
								margin: '-10px 0 12px',
							}}
						>
							{error}
						</p>
					)}
					<div className="create-item-modal-actions">
						<button
							type="button"
							onClick={onClose}
							className="create-item-modal-button create-item-modal-button-secondary"
							disabled={loading}
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={
								!url.trim() || loading
							}
							className="create-item-modal-button create-item-modal-button-primary"
						>
							{loading
								? 'Importing...'
								: 'Import'}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}

export default function App() {
	const treeSearchRef =
		useRef<SearchSortControlsHandle>(null);
	const [workspacePaths, setWorkspacePaths] =
		useState<string[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(
		null,
	);
	const [selectedPath, setSelectedPath] = useState<
		string | null
	>(null);
	const [importModal, setImportModal] = useState<{
		folderPath: string;
	} | null>(null);
	const [searchQuery, setSearchQuery] = useState('');

	const workspaces = useMemo(
		() =>
			workspacePaths.map((p) => ({
				path: p,
				name: displayBasename(p),
			})),
		[workspacePaths],
	);
	const sortedWorkspaces = useMemo(
		() =>
			[...workspaces].sort((a, b) =>
				a.name.localeCompare(b.name),
			),
		[workspaces],
	);
	const workspacePathsRef = useRef(workspacePaths);
	workspacePathsRef.current = workspacePaths;

	const [treeSortMode, setTreeSortMode] =
		useState<SortMode>('alpha-desc');
	const sortMode = treeSortMode;

	// Workspace expand/collapse state
	const [expandedWorkspaces, setExpandedWorkspaces] =
		useState<Set<string>>(new Set());
	const [pendingExpandAll, setPendingExpandAll] =
		useState<Set<string>>(new Set());

	// Refs for each workspace's imperative handle
	const workspaceRefsMap = useRef(
		new Map<
			string,
			React.RefObject<WorkspaceFileTreeHandle | null>
		>(),
	);

	const getWorkspaceRef = useCallback(
		(wsPath: string) => {
			let ref =
				workspaceRefsMap.current.get(wsPath);
			if (!ref) {
				ref =
					React.createRef<WorkspaceFileTreeHandle>();
				workspaceRefsMap.current.set(
					wsPath,
					ref,
				);
			}
			return ref;
		},
		[],
	);

	// Assemble flat items lazily from workspace refs
	const getAllFlatItems = useCallback(() => {
		const items: FlatItem[] = [];
		for (const ws of sortedWorkspaces) {
			if (!expandedWorkspaces.has(ws.path))
				continue;
			const ref =
				workspaceRefsMap.current.get(ws.path);
			if (ref?.current) {
				items.push(...ref.current.flatItems);
			}
		}
		return items;
	}, [sortedWorkspaces, expandedWorkspaces]);

	const focusActiveSearch = useCallback(() => {
		window.focus();
		treeSearchRef.current?.focusSearch();
	}, []);

	useEffect(() => {
		window.api
			.getPref(TREE_SORT_MODE_STORAGE_KEY)
			.then((v) => {
				if (
					typeof v === 'string' &&
					sortModeOrder.includes(
						v as SortMode,
					)
				) {
					setTreeSortMode(v as SortMode);
				}
			});
	}, []);

	// Load persisted expanded workspaces
	useEffect(() => {
		window.api
			.getPref('expanded_workspaces')
			.then((stored) => {
				if (
					Array.isArray(stored) &&
					stored.length > 0
				) {
					setExpandedWorkspaces(
						new Set(stored as string[]),
					);
				} else {
					// Default: expand all
					setExpandedWorkspaces(
						new Set(
							workspacePaths.map(
								(p) => p,
							),
						),
					);
				}
			})
			.catch(() => {});
		// eslint-disable-next-line react-hooks/exhaustive-deps -- one-time mount
	}, []);

	// When workspaces change, prune expanded state
	const workspacesKey = workspacePaths.join('\0');
	const prevWorkspacesKeyRef =
		useRef(workspacesKey);

	useEffect(() => {
		const changed =
			workspacesKey !==
			prevWorkspacesKeyRef.current;
		prevWorkspacesKeyRef.current = workspacesKey;

		if (changed) {
			const roots = new Set(workspacePaths);
			setExpandedWorkspaces((prev) => {
				const valid = new Set<string>();
				for (const p of prev) {
					if (roots.has(p)) valid.add(p);
				}
				if (valid.size === 0) return roots;
				return valid;
			});
			// Clean up refs for removed workspaces
			for (const key of workspaceRefsMap.current.keys()) {
				if (!roots.has(key)) {
					workspaceRefsMap.current.delete(
						key,
					);
				}
			}
		}
	}, [workspacesKey, workspacePaths]);

	useEffect(() => {
		window.api
			.getConfig()
			.then((cfg) => {
				setWorkspacePaths(cfg.workspaces);
				setLoading(false);
			})
			.catch((err) => {
				setError(String(err));
				setLoading(false);
			});
	}, []);

	useEffect(() => {
		const cleanupAdd =
			window.api.onWorkspaceAdded(
				(path: string) => {
					setWorkspacePaths((prev) =>
						prev.includes(path)
							? prev
							: [...prev, path],
					);
					setExpandedWorkspaces((prev) => {
						const next = new Set(prev);
						next.add(path);
						saveExpandedWorkspaces(next);
						return next;
					});
				},
			);
		const cleanupRemove =
			window.api.onWorkspaceRemoved(
				(path: string) => {
					setWorkspacePaths((prev) =>
						prev.filter(
							(p) => p !== path,
						),
					);
					setSelectedPath((current) =>
						current?.startsWith(
							path + '/',
						)
							? null
							: current,
					);
				},
			);
		return () => {
			cleanupAdd();
			cleanupRemove();
		};
	}, []);

	useEffect(() => {
		return window.api.onFileRenamed(
			(oldPath, newPath) => {
				setSelectedPath((current) =>
					current === oldPath
						? newPath
						: current,
				);
			},
		);
	}, []);

	useEffect(() => {
		return window.api.onFileSelected((path) => {
			setSelectedPath(path);
		});
	}, []);

	useEffect(() => {
		return window.api.onFocusSearch(() => {
			focusActiveSearch();
		});
	}, [focusActiveSearch]);

	// Expand ancestors when a file is selected externally
	useEffect(() => {
		if (!selectedPath) return;
		const ws = workspacePaths.find((p) =>
			isSubpath(p, selectedPath),
		);
		if (!ws) return;

		// Ensure workspace is expanded
		setExpandedWorkspaces((prev) => {
			if (prev.has(ws)) return prev;
			const next = new Set(prev);
			next.add(ws);
			saveExpandedWorkspaces(next);
			return next;
		});

		// Call expandAncestors on the workspace ref
		const ref =
			workspaceRefsMap.current.get(ws);
		ref?.current?.expandAncestors(selectedPath);
	}, [selectedPath, workspacePaths]);

	useEffect(() => {
		return window.api.onFilesDeleted((paths) => {
			setSelectedPath((current) =>
				current && paths.includes(current)
					? null
					: current,
			);
		});
	}, []);

	// Expand folder helper (used by drag-drop and create operations)
	const expandFolder = useCallback(
		(path: string) => {
			// Find the workspace this path belongs to and notify it
			// The workspace hook handles the actual expansion via its own state
			// For the drag-drop timer-based expand, we need to trigger the right workspace
			for (const ws of workspacePaths) {
				if (
					path === ws ||
					isSubpath(ws, path)
				) {
					const ref =
						workspaceRefsMap.current.get(
							ws,
						);
					if (ref?.current) {
						// expandAncestors also expands the target dir
						ref.current.expandAncestors(
							path + '/dummy',
						);
					}
					break;
				}
			}
		},
		[workspacePaths],
	);

	async function createFileInFolder(
		folderPath: string,
		name: string,
	) {
		let fileName = name
			? name.endsWith('.md')
				? name
				: `${name}.md`
			: 'Untitled.md';

		const entries =
			await window.api.readDir(folderPath);
		const existingNames = new Set(
			entries.map((e) =>
				e.name.toLowerCase(),
			),
		);

		if (
			existingNames.has(fileName.toLowerCase())
		) {
			const stem = fileName.replace(
				/\.md$/,
				'',
			);
			let n = 2;
			while (
				existingNames.has(
					`${stem} ${n}.md`.toLowerCase(),
				)
			) {
				n++;
			}
			fileName = `${stem} ${n}.md`;
		}

		const filePath = `${folderPath}/${fileName}`;
		const frontmatter = [
			'---',
			'type: "note"',
			'---',
			'',
		].join('\n');
		expandFolder(folderPath);
		await window.api.writeFile(
			filePath,
			frontmatter,
		);
	}

	async function createFolderInFolder(
		parentFolder: string,
	) {
		let folderName = 'New Folder';
		const entries =
			await window.api.readDir(parentFolder);
		const existingNames = new Set(
			entries.map((e) =>
				e.name.toLowerCase(),
			),
		);

		if (
			existingNames.has(
				folderName.toLowerCase(),
			)
		) {
			let n = 2;
			while (
				existingNames.has(
					`New Folder ${n}`.toLowerCase(),
				)
			) {
				n++;
			}
			folderName = `New Folder ${n}`;
		}

		const folderPath = `${parentFolder}/${folderName}`;
		await window.api.createDir(folderPath);
		expandFolder(parentFolder);
		inlineRename.startRename(
			folderPath,
			folderName,
		);
	}

	const deleteFile = useCallback(
		async (path: string) => {
			if (
				workspacePathsRef.current.includes(
					path,
				)
			)
				return;
			await window.api.trashFile(path);
		},
		[],
	);

	const selectFolder = useCallback(
		(path: string) => {
			window.api.selectFolder(path);
		},
		[],
	);

	const selectFile = useCallback(
		(path: string | null) => {
			setSelectedPath(path);
			window.api.selectFile(path);
		},
		[],
	);

	const multiSelect = useMultiSelect(
		getAllFlatItems,
		selectFile,
	);
	const multiSelectRef = useRef(multiSelect);
	multiSelectRef.current = multiSelect;

	const inlineRename = useInlineRename(
		async (
			oldPath: string,
			newName: string,
		) => {
			await window.api.renameFile(
				oldPath,
				newName,
			);
		},
	);
	const inlineRenameRef = useRef(inlineRename);
	inlineRenameRef.current = inlineRename;

	const dragDrop = useDragDrop(
		async (
			sourcePaths: string[],
			targetFolder: string,
		) => {
			for (const p of sourcePaths) {
				await window.api.moveFile(
					p,
					targetFolder,
				);
			}
		},
		expandFolder,
	);

	const stableDragStart = useCallback(
		(e: React.DragEvent, path: string) =>
			dragDrop.handleDragStart(
				e,
				path,
				multiSelectRef.current.selected,
			),
		[dragDrop.handleDragStart],
	);

	const cycleSortMode = useCallback(() => {
		setTreeSortMode((currentMode) => {
			const currentIndex =
				sortModeOrder.indexOf(currentMode);
			const nextIndex =
				(currentIndex + 1) %
				sortModeOrder.length;
			const newMode =
				sortModeOrder[nextIndex] ??
				currentMode;
			window.api.setPref(
				TREE_SORT_MODE_STORAGE_KEY,
				newMode,
			);
			return newMode;
		});
	}, []);

	const handlePlusClick = useCallback(
		async (folderPath: string) => {
			const result =
				await window.api.showContextMenu([
					{
						id: 'new-note',
						label: 'New Note',
					},
					{
						id: 'import-web-article',
						label: 'Import Web Article',
					},
				]);
			if (result === 'new-note') {
				createFileInFolder(folderPath, '');
			} else if (
				result === 'import-web-article'
			) {
				setImportModal({ folderPath });
			}
		},
		[],
	);

	const handleContextMenu = useCallback(
		async (
			_e: React.MouseEvent,
			item: FlatItem | null,
		) => {
			const ms = multiSelectRef.current;
			const wsPaths =
				workspacePathsRef.current;
			const multiSelected =
				ms.selected.size > 1;

			let menuItems: Array<{
				id: string;
				label: string;
				enabled?: boolean;
			}>;

			if (multiSelected) {
				menuItems = [
					{
						id: 'delete',
						label: `Delete ${ms.selected.size} Items`,
					},
				];
			} else if (!item) {
				menuItems = [
					{
						id: 'new-file',
						label: 'New File',
					},
					{
						id: 'new-folder',
						label: 'New Folder',
					},
				];
			} else if (item.kind === 'workspace') {
				menuItems = [
					{
						id: 'new-file',
						label: 'New File',
					},
					{
						id: 'new-folder',
						label: 'New Folder',
					},
					{
						id: 'import-web-article',
						label: 'Import Web Article',
					},
					{ id: 'separator', label: '' },
					...(ENABLE_GRAPH_TILES
						? [
								{
									id: 'open-graph',
									label: 'Open as Graph',
								},
							]
						: []),
					{
						id: 'copy-path',
						label: 'Copy Filepath',
					},
					{
						id: 'reveal-in-finder',
						label: REVEAL_LABEL,
					},
					{
						id: 'terminal',
						label: 'Open in Terminal',
					},
					{ id: 'separator', label: '' },
					{
						id: 'remove-workspace',
						label: 'Remove Workspace',
					},
				];
			} else if (item.kind === 'folder') {
				const isRoot = wsPaths.includes(
					item.path,
				);
				menuItems = [
					{
						id: 'new-file',
						label: 'New File',
					},
					{
						id: 'new-folder',
						label: 'New Folder',
					},
					{
						id: 'import-web-article',
						label: 'Import Web Article',
					},
					...(!isRoot
						? [
								{
									id: 'separator',
									label: '',
								},
								{
									id: 'rename',
									label: 'Rename',
								},
								{
									id: 'delete',
									label: 'Delete',
								},
							]
						: []),
					{ id: 'separator', label: '' },
					...(ENABLE_GRAPH_TILES
						? [
								{
									id: 'open-graph',
									label: 'Open as Graph',
								},
							]
						: []),
					{
						id: 'copy-path',
						label: 'Copy Filepath',
					},
					{
						id: 'reveal-in-finder',
						label: REVEAL_LABEL,
					},
					{
						id: 'terminal',
						label: 'Open in Terminal',
					},
				];
			} else {
				menuItems = [
					{
						id: 'rename',
						label: 'Rename',
					},
					{
						id: 'delete',
						label: 'Delete',
					},
					{ id: 'separator', label: '' },
					{
						id: 'copy-path',
						label: 'Copy Filepath',
					},
					{
						id: 'reveal-in-finder',
						label: REVEAL_LABEL,
					},
					{
						id: 'terminal',
						label: 'Open in Terminal',
					},
				];
			}

			const action =
				await window.api.showContextMenu(
					menuItems,
				);
			if (!action) return;

			const parentFolder = !item
				? wsPaths[0] ?? ''
				: item.kind === 'workspace' ||
						item.kind === 'folder'
					? item.path
					: parentPath(item.path);

			switch (action) {
				case 'new-file':
					await createFileInFolder(
						parentFolder,
						'',
					);
					break;
				case 'new-folder':
					await createFolderInFolder(
						parentFolder,
					);
					break;
				case 'import-web-article':
					if (item) {
						setImportModal({
							folderPath: item.path,
						});
					}
					break;
				case 'rename':
					if (item)
						inlineRenameRef.current.startRename(
							item.path,
							item.name,
						);
					break;
				case 'delete':
					if (multiSelected) {
						for (const path of ms.selected) {
							if (
								wsPaths.includes(path)
							)
								continue;
							await window.api.trashFile(
								path,
							);
						}
						ms.clearSelection();
					} else if (
						item &&
						!wsPaths.includes(item.path)
					) {
						await window.api.trashFile(
							item.path,
						);
					}
					break;
				case 'open-graph':
					if (item)
						window.api.createGraphTile(
							item.path,
						);
					break;
				case 'copy-path':
					if (item)
						navigator.clipboard.writeText(
							item.path,
						);
					break;
				case 'reveal-in-finder':
					if (item)
						window.api.revealInFinder(
							item.path,
						);
					break;
				case 'terminal':
					if (item)
						window.api.openInTerminal(
							item.kind === 'folder' ||
								item.kind ===
									'workspace'
								? item.path
								: parentPath(
										item.path,
									),
						);
					break;
				case 'remove-workspace':
					if (
						item &&
						item.kind === 'workspace'
					)
						await window.api.workspaceRemoveByPath(
							item.path,
						);
					break;
			}
		},
		[expandFolder],
	);

	// Workspace toggle (normal + alt-click recursive)
	const toggleWorkspace = useCallback(
		(path: string, recursive: boolean) => {
			setExpandedWorkspaces((prev) => {
				const wasExpanded = prev.has(path);

				if (recursive && wasExpanded) {
					const wsRef =
						workspaceRefsMap.current.get(
							path,
						);
					wsRef?.current?.collapseAllDirs();
					const next = new Set(prev);
					next.delete(path);
					saveExpandedWorkspaces(next);
					return next;
				}

				if (recursive && !wasExpanded) {
					setPendingExpandAll((p) => {
						const next = new Set(p);
						next.add(path);
						return next;
					});
					const next = new Set(prev);
					next.add(path);
					saveExpandedWorkspaces(next);
					return next;
				}

				const next = new Set(prev);
				if (wasExpanded) {
					next.delete(path);
				} else {
					next.add(path);
				}
				saveExpandedWorkspaces(next);
				return next;
			});
		},
		[],
	);

	const handleExpandAllComplete = useCallback(
		(wsPath: string) => {
			setPendingExpandAll((prev) => {
				const next = new Set(prev);
				next.delete(wsPath);
				return next;
			});
		},
		[],
	);

	// Keyboard navigation (arrow keys) — at App level
	const selectedPathRef = useRef(selectedPath);
	selectedPathRef.current = selectedPath;
	const lastSelectedIndexRef = useRef<number>(-1);

	const containerRef =
		useRef<HTMLDivElement>(null);

	const navigateItems = useCallback(
		(
			direction: 'up' | 'down',
			shiftKey: boolean,
		) => {
			const allNavigable: FlatItem[] = [];
			for (const ws of sortedWorkspaces) {
				if (!expandedWorkspaces.has(ws.path))
					continue;
				const ref =
					workspaceRefsMap.current.get(
						ws.path,
					);
				if (ref?.current) {
					allNavigable.push(
						...ref.current.navigableItems,
					);
				}
			}
			if (allNavigable.length === 0) return;

			const effectivePath =
				multiSelect.cursor ?? selectedPath;
			let currentIndex =
				allNavigable.findIndex(
					(d) => d.path === effectivePath,
				);

			if (
				currentIndex < 0 &&
				lastSelectedIndexRef.current >= 0
			) {
				currentIndex = Math.min(
					lastSelectedIndexRef.current,
					allNavigable.length - 1,
				);
			}

			let nextIndex: number;
			if (direction === 'down') {
				nextIndex =
					currentIndex < 0
						? 0
						: Math.min(
								currentIndex + 1,
								allNavigable.length -
									1,
							);
			} else {
				nextIndex =
					currentIndex < 0
						? 0
						: Math.max(
								currentIndex - 1,
								0,
							);
			}

			lastSelectedIndexRef.current = nextIndex;
			const next = allNavigable[nextIndex];
			if (!next) return;

			multiSelect.handleClick(next.path, {
				metaKey: false,
				shiftKey,
			});

			// Scroll into view
			const container = containerRef.current;
			const el = container?.querySelector(
				`[data-item-id="${CSS.escape(next.path)}"]`,
			);
			if (el && container) {
				const elRect =
					el.getBoundingClientRect();
				const boxRect =
					container.getBoundingClientRect();
				const top =
					elRect.top - boxRect.top;
				const bottom =
					elRect.bottom - boxRect.top;

				if (top < 0) {
					container.scrollTop += top;
				} else if (
					bottom > container.clientHeight
				) {
					container.scrollTop +=
						bottom -
						container.clientHeight;
				}
			}
		},
		[
			sortedWorkspaces,
			expandedWorkspaces,
			selectedPath,
			multiSelect.cursor,
			multiSelect.handleClick,
		],
	);

	// Arrow key handler
	useEffect(() => {
		const handleKeyDown = (
			e: KeyboardEvent,
		) => {
			if (
				e.key !== 'ArrowUp' &&
				e.key !== 'ArrowDown'
			)
				return;

			const active = document.activeElement;
			if (
				active?.tagName === 'INPUT' ||
				active?.tagName === 'TEXTAREA'
			)
				return;

			e.preventDefault();
			navigateItems(
				e.key === 'ArrowDown'
					? 'down'
					: 'up',
				e.shiftKey,
			);
		};

		window.addEventListener(
			'keydown',
			handleKeyDown,
		);
		return () =>
			window.removeEventListener(
				'keydown',
				handleKeyDown,
			);
	}, [navigateItems]);

	// Scroll selected item into view
	useEffect(() => {
		if (!selectedPath || !containerRef.current)
			return;
		const el =
			containerRef.current.querySelector(
				`[data-item-id="${CSS.escape(selectedPath)}"]`,
			);
		if (!el) return;
		const container = containerRef.current;
		const elRect = el.getBoundingClientRect();
		const boxRect =
			container.getBoundingClientRect();
		const top = elRect.top - boxRect.top;
		const bottom = elRect.bottom - boxRect.top;

		if (top < 0) {
			container.scrollTop += top;
		} else if (
			bottom > container.clientHeight
		) {
			container.scrollTop +=
				bottom - container.clientHeight;
		}
	}, [selectedPath]);

	// F2, Delete, Escape key handlers
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			const active = document.activeElement;
			if (
				active?.tagName === 'INPUT' ||
				active?.tagName === 'TEXTAREA'
			)
				return;

			const ir = inlineRenameRef.current;
			const ms = multiSelectRef.current;
			const sel = selectedPathRef.current;

			if (e.key === 'F2' && sel) {
				const items = getAllFlatItems();
				const item = items.find(
					(i) => i.path === sel,
				);
				if (item) {
					e.preventDefault();
					ir.startRename(
						item.path,
						item.name,
					);
				}
			}

			if (
				(e.key === 'Delete' ||
					e.key === 'Backspace') &&
				ms.selected.size > 0
			) {
				e.preventDefault();
				const wsPaths =
					workspacePathsRef.current;
				for (const path of ms.selected) {
					if (wsPaths.includes(path))
						continue;
					void window.api.trashFile(path);
				}
				ms.clearSelection();
			}

			if (e.key === 'Escape') {
				if (ir.renamingPath) {
					e.preventDefault();
					ir.cancelRename();
				} else if (sel) {
					e.preventDefault();
					selectFile(null);
				} else {
					ms.clearSelection();
				}
			}
		};

		window.addEventListener('keydown', handler);
		return () =>
			window.removeEventListener(
				'keydown',
				handler,
			);
	}, [focusActiveSearch, selectFile, getAllFlatItems]);

	return (
		<div className="app">
			<div className="workspace-content">
				{loading && (
					<div className="empty-state">
						<p>Loading...</p>
					</div>
				)}
				{error && (
					<div className="empty-state">
						<p>{error}</p>
					</div>
				)}

				{!loading && !error && (
						<div className="table-container items-table">
							<SearchSortControls
								ref={
									treeSearchRef
								}
								searchQuery={
									searchQuery
								}
								onSearchQueryChange={
									setSearchQuery
								}
								sortMode={
									sortMode
								}
								onCycleSortMode={
									cycleSortMode
								}
								searchPlaceholder="Search  ⌘K"
								onArrowNav={
									navigateItems
								}
							/>
							<div className="workspace-add-row">
								<button
									type="button"
									className="ws-add-btn"
									onClick={() =>
										window.api.workspaceAdd()
									}
								>
									+ Add
									workspace
								</button>
							</div>
							<div className="table-wrapper">
								<div
									ref={
										containerRef
									}
									className="table-body-scroll scrollbar-hover"
									onContextMenu={(
										e,
									) => {
										if (
											e.target ===
											e.currentTarget
										) {
											e.preventDefault();
											handleContextMenu(
												e,
												null,
											);
										}
									}}
								>
									{sortedWorkspaces.map(
										(
											ws,
											idx,
										) => (
											<WorkspaceTree
												key={
													ws.path
												}
												ref={getWorkspaceRef(
													ws.path,
												)}
												workspace={
													ws
												}
												isExpanded={expandedWorkspaces.has(
													ws.path,
												)}
												onToggleExpand={
													toggleWorkspace
												}
												selectedPath={
													selectedPath
												}
												selectedPaths={
													multiSelect.selected
												}
												onItemClick={
													multiSelect.handleClick
												}
												onCreateFile={
													createFileInFolder
												}
												onPlusClick={
													handlePlusClick
												}
												onDeleteFile={
													deleteFile
												}
												onContextMenu={
													handleContextMenu
												}
												sortMode={
													sortMode
												}
												renamingPath={
													inlineRename.renamingPath
												}
												renameValue={
													inlineRename.renameValue
												}
												renameInputRef={
													inlineRename.inputRef
												}
												onRenameChange={
													inlineRename.setRenameValue
												}
												onRenameConfirm={
													inlineRename.confirmRename
												}
												onRenameCancel={
													inlineRename.cancelRename
												}
												dropTargetPath={
													dragDrop.dropTargetPath
												}
												onDragStart={
													stableDragStart
												}
												onDragOver={
													dragDrop.handleDragOver
												}
												onDragLeave={
													dragDrop.handleDragLeave
												}
												onDrop={
													dragDrop.handleDrop
												}
												onDragEnd={
													dragDrop.handleDragEnd
												}
												onSelectFolder={
													selectFolder
												}
												isFirstWorkspace={
													idx ===
													0
												}
												searchQuery={
													searchQuery
												}
												initialExpandAll={pendingExpandAll.has(
													ws.path,
												)}
												onExpandAllComplete={
													handleExpandAllComplete
												}
											/>
										),
									)}
								</div>
							</div>
						</div>
					)}
			</div>
			{importModal && (
				<ImportWebArticleModal
					folderPath={
						importModal.folderPath
					}
					onClose={() =>
						setImportModal(null)
					}
					onImported={(filePath) => {
						setImportModal(null);
						selectFile(filePath);
					}}
				/>
			)}
		</div>
	);
}
