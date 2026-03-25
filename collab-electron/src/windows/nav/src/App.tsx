import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	TreeView,
	useFileTree,
	useMultiSelect,
	useInlineRename,
	useDragDrop,
	sortModeOrder,
	SORT_MODE_STORAGE_KEY,
	ENABLE_GRAPH_TILES,
} from '@collab/components/TreeView';
import type {
	SortMode,
	FlatItem,
	SearchSortControlsHandle,
} from '@collab/components/TreeView';
import {
	TreeView as TreeViewIcon,
	List,
} from '@phosphor-icons/react';
import { SourcesFeed } from '@collab/components/SourcesFeed';
import '@collab/components/SourcesFeed/SourcesFeed.css';
import type { AppConfig } from '@collab/shared/types';

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
		if (typeof window.api.importWebArticle !== 'function') {
			setError('Import not available — restart the app to load the updated preload.');
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
					<h3 style={{ fontSize: '15px', fontWeight: 500, margin: 0 }}>
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
						<p style={{
							fontSize: '12px',
							color: 'var(--destructive, #ef4444)',
							margin: '-10px 0 12px',
						}}>
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
	const feedSearchRef =
		useRef<SearchSortControlsHandle>(null);
	const [config, setConfig] =
		useState<AppConfig | null>(null);
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

	type NavViewMode = 'tree' | 'feed';
	const VIEW_MODE_KEY = 'collab:nav-view-mode';
	const [viewMode, setViewMode] =
		useState<NavViewMode>('tree');

	useEffect(() => {
		window.api.getPref(VIEW_MODE_KEY).then((v) => {
			if (v === 'feed') setViewMode('feed');
		});
	}, []);

	const workspacePath =
		config?.workspaces?.[config?.active_workspace] ?? '';
	const folders = useMemo(
		() =>
			workspacePath
				? [
						{
							path: workspacePath,
							name:
								workspacePath.split('/').pop() ??
								workspacePath,
						},
					]
				: [],
		[workspacePath],
	);

	const [sortMode, setSortMode] =
		useState<SortMode>('created-desc');

	const focusActiveSearch = useCallback(() => {
		window.focus();
		if (viewMode === 'feed') {
			feedSearchRef.current?.focusSearch();
			return;
		}
		treeSearchRef.current?.focusSearch();
	}, [viewMode]);

	useEffect(() => {
		window.api
			.getPref(SORT_MODE_STORAGE_KEY)
			.then((v) => {
				if (
					typeof v === 'string' &&
					sortModeOrder.includes(
						v as SortMode,
					)
				) {
					setSortMode(v as SortMode);
				}
			});
	}, []);

	const {
		flatItems,
		toggleExpand,
		expandFolder,
		expandAncestors,
	} = useFileTree(folders, sortMode);
	const expandAncestorsRef = useRef(expandAncestors);
	expandAncestorsRef.current = expandAncestors;

	useEffect(() => {
		window.api
			.getConfig()
			.then((cfg) => {
				setConfig(cfg);
				setLoading(false);
			})
			.catch((err) => {
				setError(String(err));
				setLoading(false);
			});
	}, []);

	useEffect(() => {
		return window.api.onWorkspaceChanged(
			(newPath) => {
				setConfig((prev) => {
					if (!prev) return prev;
					const idx =
						prev.workspaces.indexOf(newPath);
					if (idx !== -1) {
						return {
							...prev,
							active_workspace: idx,
						};
					}
					return {
						...prev,
						workspaces: [
							...prev.workspaces,
							newPath,
						],
						active_workspace:
							prev.workspaces.length,
					};
				});
			},
		);
	}, []);

	useEffect(() => {
		window.api.getSelectedFile().then((saved) => {
			if (saved) setSelectedPath(saved);
		});
	}, []);

	useEffect(() => {
		return window.api.onFileRenamed(
			(oldPath, newPath) => {
				setSelectedPath((current) =>
					current === oldPath ? newPath : current,
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

	useEffect(() => {
		if (selectedPath) {
			expandAncestorsRef.current(selectedPath);
		}
	}, [selectedPath]);

	useEffect(() => {
		return window.api.onFilesDeleted((paths) => {
			setSelectedPath((current) =>
				current && paths.includes(current)
					? null
					: current,
			);
		});
	}, []);

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
			entries.map((e) => e.name.toLowerCase()),
		);

		if (existingNames.has(fileName.toLowerCase())) {
			const stem = fileName.replace(/\.md$/, '');
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
		await window.api.writeFile(filePath, frontmatter);
	}

	async function createFolderInFolder(
		parentPath: string,
	) {
		let folderName = 'New Folder';
		const entries =
			await window.api.readDir(parentPath);
		const existingNames = new Set(
			entries.map((e) => e.name.toLowerCase()),
		);

		if (
			existingNames.has(folderName.toLowerCase())
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

		const folderPath = `${parentPath}/${folderName}`;
		await window.api.createDir(folderPath);
		expandFolder(parentPath);
		inlineRename.startRename(
			folderPath,
			folderName,
		);
	}

	const deleteFile = useCallback(
		async (path: string) => {
			if (path === workspacePath) return;
			await window.api.trashFile(path);
		},
		[workspacePath],
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

	const handleFeedSelect = useCallback(
		(path: string) => {
			selectFile(path);
		},
		[selectFile],
	);

	const switchViewMode = useCallback(
		(mode: NavViewMode) => {
			setViewMode(mode);
			window.api.setPref(VIEW_MODE_KEY, mode);
		},
		[],
	);

	const multiSelect = useMultiSelect(
		flatItems,
		selectFile,
	);
	const multiSelectRef = useRef(multiSelect);
	multiSelectRef.current = multiSelect;

	const inlineRename = useInlineRename(
		async (oldPath: string, newName: string) => {
			await window.api.renameFile(oldPath, newName);
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
				await window.api.moveFile(p, targetFolder);
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
		setSortMode((currentMode) => {
			const currentIndex =
				sortModeOrder.indexOf(currentMode);
			const nextIndex =
				(currentIndex + 1) %
				sortModeOrder.length;
			const newMode =
				sortModeOrder[nextIndex] ??
				currentMode;
			window.api.setPref(
				SORT_MODE_STORAGE_KEY,
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
					{ id: 'new-file', label: 'New File' },
					{
						id: 'new-folder',
						label: 'New Folder',
					},
				];
			} else if (item.kind === 'folder') {
				const isRoot =
					item.path === workspacePath;
				menuItems = [
					{ id: 'new-file', label: 'New File' },
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
								{ id: 'separator', label: '' },
								{ id: 'rename', label: 'Rename' },
								{ id: 'delete', label: 'Delete' },
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
						label: 'Reveal in Finder',
					},
					{
						id: 'terminal',
						label: 'Open in Terminal',
					},
				];
			} else {
				menuItems = [
					{ id: 'rename', label: 'Rename' },
					{ id: 'delete', label: 'Delete' },
					{ id: 'separator', label: '' },
					{
						id: 'copy-path',
						label: 'Copy Filepath',
					},
					{
						id: 'reveal-in-finder',
						label: 'Reveal in Finder',
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
				? workspacePath
				: item.kind === 'folder'
					? item.path
					: item.path.substring(
							0,
							item.path.lastIndexOf('/'),
						);

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
							if (path === workspacePath) continue;
							await window.api.trashFile(
								path,
							);
						}
						ms.clearSelection();
					} else if (item && item.path !== workspacePath) {
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
						window.api.revealInFinder(item.path);
					break;
				case 'terminal':
					if (item)
						window.api.openInTerminal(
							item.kind === 'folder'
								? item.path
								: item.path.substring(
										0,
										item.path.lastIndexOf(
											'/',
										),
									),
						);
					break;
			}
		},
		[workspacePath, expandFolder],
	);

	const selectedPathRef = useRef(selectedPath);
	selectedPathRef.current = selectedPath;
	const flatItemsRef = useRef(flatItems);
	flatItemsRef.current = flatItems;

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (
				(e.metaKey || e.ctrlKey) &&
				e.key.toLowerCase() === 'k'
			) {
				e.preventDefault();
				focusActiveSearch();
				return;
			}

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
				const item = flatItemsRef.current.find(
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
				for (const path of ms.selected) {
					if (path === workspacePath) continue;
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
	}, [focusActiveSearch, selectFile, workspacePath]);

	const renderViewModeToggle = () => (
		<div className="nav-view-toggle">
			<button
				type="button"
				className={`nav-view-toggle-button${viewMode === 'tree' ? ' active' : ''}`}
				onClick={() => switchViewMode('tree')}
				title="Tree view"
			>
				<TreeViewIcon
					size={14}
					weight={
						viewMode === 'tree'
							? 'fill'
							: 'regular'
					}
				/>
			</button>
			<button
				type="button"
				className={`nav-view-toggle-button${viewMode === 'feed' ? ' active' : ''}`}
				onClick={() => switchViewMode('feed')}
				title="Feed view"
			>
				<List
					size={14}
					weight={
						viewMode === 'feed'
							? 'bold'
							: 'regular'
					}
				/>
			</button>
		</div>
	);

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

				{!loading &&
					!error &&
					workspacePath && (
					<>
						<div style={{ display: viewMode === 'tree' ? 'contents' : 'none' }}>
							<TreeView
								flatItems={flatItems}
								selectedPath={
									selectedPath
								}
								selectedPaths={
									multiSelect.selected
								}
								onItemClick={
									multiSelect.handleClick
								}
								onToggleFolder={
									toggleExpand
								}
								onCreateFile={
									createFileInFolder
								}
								onPlusClick={
									handlePlusClick
								}
								onDeleteFile={deleteFile}
								sortMode={sortMode}
								onCycleSortMode={
									cycleSortMode
								}
								leadingContent={renderViewModeToggle()}
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
								onContextMenu={
									handleContextMenu
								}
								workspacePath={
									workspacePath
								}
								cursorPath={
									multiSelect.cursor
								}
								isActive={viewMode === 'tree'}
								searchRef={treeSearchRef}
							/>
						</div>
						<div style={{ display: viewMode === 'feed' ? 'contents' : 'none' }}>
							<SourcesFeed
								workspacePath={
									workspacePath
								}
								selectedPath={
									selectedPath
								}
								sortMode={sortMode}
								isActive={viewMode === 'feed'}
								onSelectFile={
									handleFeedSelect
								}
								onDeleteFile={
									deleteFile
								}
								onCycleSortMode={
									cycleSortMode
								}
								onDragStart={stableDragStart}
								leadingContent={renderViewModeToggle()}
								searchRef={feedSearchRef}
							/>
						</div>
					</>
				)}

				{!loading &&
					!error &&
					!workspacePath && (
						<div className="empty-state">
							<p>
								No workspace selected. Open
								a folder in Settings.
							</p>
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
