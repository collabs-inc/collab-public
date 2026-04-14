import {
	useState,
	useCallback,
	useEffect,
	useMemo,
	useRef,
} from 'react';
import type { TreeNode } from '@collab/shared/types';
import {
	isSubpath,
	joinPath,
	parentPath,
	splitPathSegments,
} from '@collab/shared/path-utils';
import type { FlatItem } from './useFileTree';
import {
	flattenTree,
	hydrateNode,
	treesEqual,
	saveExpandedDirs,
} from './useFileTree';
import type { SortMode } from './types';

export interface WorkspaceFileTreeHandle {
	flatItems: FlatItem[];
	navigableItems: FlatItem[];
	expandAncestors: (filePath: string) => void;
	expandRecursive: (rootPath: string) => void;
	collapseAllDirs: () => void;
}

export function useWorkspaceFileTree(
	workspacePath: string,
	sortMode: SortMode,
) {
	const [dirContents, setDirContents] = useState<
		Map<string, TreeNode[]>
	>(new Map());
	const [expandedDirs, setExpandedDirs] = useState<
		Set<string>
	>(new Set);
	const dirContentsRef = useRef(dirContents);
	dirContentsRef.current = dirContents;
	const pendingLoadsRef = useRef(
		new Map<string, Promise<TreeNode[]>>(),
	);
	const dirtyDirsRef = useRef(new Set<string>());

	const loadDir = useCallback(
		async (dirPath: string) => {
			const pending =
				pendingLoadsRef.current.get(dirPath);
			if (pending) {
				dirtyDirsRef.current.add(dirPath);
				return pending;
			}

			const request = (async () => {
				try {
					const entries =
						await window.api.readDir(dirPath);
					const children: TreeNode[] = entries
						.map(
							(e: {
								name: string;
								isDirectory: boolean;
								createdAt: string;
								modifiedAt: string;
								fileCount?: number;
							}): TreeNode => {
								const node: TreeNode = {
									name: e.name,
									path: joinPath(
										dirPath,
										e.name,
									),
									kind: e.isDirectory
										? 'folder'
										: 'file',
									ctime: e.createdAt,
									mtime: e.modifiedAt,
								};
								if (
									e.fileCount !==
									undefined
								) {
									node.fileCount =
										e.fileCount;
								}
								return node;
							},
						)
						.sort(
							(
								a: TreeNode,
								b: TreeNode,
							) => {
								const aIsDir =
									a.kind === 'folder';
								const bIsDir =
									b.kind === 'folder';
								if (aIsDir !== bIsDir)
									return aIsDir
										? -1
										: 1;
								if (aIsDir)
									return a.name.localeCompare(
										b.name,
									);
								return 0;
							},
						);

					setDirContents((prev) => {
						const existing =
							prev.get(dirPath);
						if (
							existing &&
							treesEqual(
								existing,
								children,
							)
						) {
							return prev;
						}
						const next = new Map(prev);
						next.set(dirPath, children);
						return next;
					});

					return children;
				} catch (err) {
					console.error(
						`Failed to load dir ${dirPath}:`,
						err,
					);
					setDirContents((prev) => {
						if (prev.has(dirPath))
							return prev;
						const next = new Map(prev);
						next.set(dirPath, []);
						return next;
					});
					return [];
				} finally {
					pendingLoadsRef.current.delete(
						dirPath,
					);
					if (
						dirtyDirsRef.current.delete(
							dirPath,
						)
					) {
						queueMicrotask(() =>
							loadDir(dirPath),
						);
					}
				}
			})();

			pendingLoadsRef.current.set(
				dirPath,
				request,
			);
			return request;
		},
		[],
	);

	// Load persisted expanded dirs and root on mount
	useEffect(() => {
		window.api
			.getWorkspacePref(
				'expanded_dirs',
				workspacePath,
			)
			.then((dirs) => {
				if (Array.isArray(dirs)) {
					setExpandedDirs(
						new Set(dirs as string[]),
					);
				}
			})
			.catch(() => {});
		loadDir(workspacePath);
	}, [workspacePath, loadDir]);

	// Load expanded dirs when they change
	useEffect(() => {
		for (const dirPath of expandedDirs) {
			if (!dirContents.has(dirPath)) {
				loadDir(dirPath);
			}
		}
	}, [expandedDirs, dirContents, loadDir]);

	// File watcher — scoped to this workspace
	useEffect(() => {
		return window.api.onFsChanged((events) => {
			const affectedDirs = new Set(
				events.map((e) => e.dirPath),
			);
			const toReload = new Set<string>();
			for (const dirPath of affectedDirs) {
				if (
					dirPath !== workspacePath &&
					!isSubpath(workspacePath, dirPath)
				)
					continue;
				if (
					dirContentsRef.current.has(
						dirPath,
					) ||
					pendingLoadsRef.current.has(dirPath)
				) {
					toReload.add(dirPath);
				} else {
					let parent = dirPath;
					while (true) {
						const nextParent =
							parentPath(parent);
						if (nextParent === parent)
							break;
						parent = nextParent;
						if (
							dirContentsRef.current.has(
								parent,
							)
						) {
							toReload.add(parent);
							break;
						}
					}
				}
			}
			for (const dirPath of toReload) {
				loadDir(dirPath);
			}
		});
	}, [workspacePath, loadDir]);

	// Rename events — reload cached dirs in this workspace
	useEffect(() => {
		return window.api.onFileRenamed(() => {
			for (const dirPath of dirContentsRef.current.keys()) {
				if (
					dirPath === workspacePath ||
					isSubpath(workspacePath, dirPath)
				) {
					loadDir(dirPath);
				}
			}
		});
	}, [workspacePath, loadDir]);

	// Hydrate + flatten
	const hydratedTree = useMemo(() => {
		const children =
			dirContents.get(workspacePath) ?? [];
		return children.map((child) =>
			hydrateNode(child, dirContents),
		);
	}, [workspacePath, dirContents]);

	const flatItems = useMemo(() => {
		const items = flattenTree(
			hydratedTree,
			expandedDirs,
			0,
			sortMode,
			1,
		);
		return items.map((item) => ({
			...item,
			workspacePath,
		}));
	}, [
		hydratedTree,
		expandedDirs,
		sortMode,
		workspacePath,
	]);

	const navigableItems = useMemo(
		() =>
			flatItems.filter(
				(item) => item.kind === 'file',
			),
		[flatItems],
	);

	// Expand/collapse logic
	const expandRecursive = useCallback(
		async (rootPath: string) => {
			const toExpand: string[] = [];

			async function collect(path: string) {
				toExpand.push(path);
				const cached =
					dirContentsRef.current.get(path);
				const children =
					cached ?? (await loadDir(path));
				const subs = children.filter(
					(n) => n.kind === 'folder',
				);
				await Promise.all(
					subs.map((s) => collect(s.path)),
				);
			}

			await collect(rootPath);

			setExpandedDirs((prev) => {
				const next = new Set(prev);
				for (const p of toExpand) next.add(p);
				saveExpandedDirs(next, workspacePath);
				return next;
			});
		},
		[workspacePath, loadDir],
	);

	const collapseAllDirs = useCallback(() => {
		setExpandedDirs((prev) => {
			const next = new Set<string>();
			for (const p of prev) {
				if (
					p !== workspacePath &&
					!isSubpath(workspacePath, p)
				) {
					next.add(p);
				}
			}
			saveExpandedDirs(next, workspacePath);
			return next;
		});
	}, [workspacePath]);

	const toggleExpand = useCallback(
		(path: string, recursive = false) => {
			const isOpen = expandedDirs.has(path);

			if (isOpen) {
				setExpandedDirs((prev) => {
					const next = new Set(prev);
					if (recursive) {
						for (const p of prev) {
							if (
								p === path ||
								isSubpath(path, p)
							) {
								next.delete(p);
							}
						}
					} else {
						next.delete(path);
					}
					saveExpandedDirs(
						next,
						workspacePath,
					);
					return next;
				});
			} else if (recursive) {
				expandRecursive(path);
			} else {
				setExpandedDirs((prev) => {
					const next = new Set(prev);
					next.add(path);
					saveExpandedDirs(
						next,
						workspacePath,
					);
					return next;
				});
				if (!dirContents.has(path)) {
					loadDir(path);
				}
			}
		},
		[
			dirContents,
			loadDir,
			expandedDirs,
			expandRecursive,
			workspacePath,
		],
	);

	const expandFolder = useCallback(
		(path: string) => {
			if (expandedDirs.has(path)) return;
			setExpandedDirs((prev) => {
				const next = new Set(prev);
				next.add(path);
				saveExpandedDirs(
					next,
					workspacePath,
				);
				return next;
			});
			if (!dirContents.has(path)) {
				loadDir(path);
			}
		},
		[expandedDirs, dirContents, loadDir, workspacePath],
	);

	const expandAncestors = useCallback(
		(filePath: string) => {
			if (!isSubpath(workspacePath, filePath))
				return;

			const relative = filePath.slice(
				workspacePath.length + 1,
			);
			const parts = splitPathSegments(relative);
			parts.pop();

			const dirsToExpand: string[] = [];
			let current = workspacePath;
			for (const part of parts) {
				current = joinPath(current, part);
				dirsToExpand.push(current);
			}

			setExpandedDirs((prev) => {
				if (
					dirsToExpand.every((p) =>
						prev.has(p),
					)
				)
					return prev;
				const next = new Set(prev);
				for (const p of dirsToExpand)
					next.add(p);
				saveExpandedDirs(
					next,
					workspacePath,
				);
				return next;
			});

			for (const p of dirsToExpand) {
				if (!dirContentsRef.current.has(p)) {
					loadDir(p);
				}
			}
		},
		[workspacePath, loadDir],
	);

	return {
		flatItems,
		expandedDirs,
		toggleExpand,
		expandFolder,
		expandAncestors,
		expandRecursive,
		collapseAllDirs,
		navigableItems,
	};
}
