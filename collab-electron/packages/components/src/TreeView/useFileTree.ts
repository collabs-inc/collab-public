import {
	useState,
	useCallback,
	useEffect,
	useMemo,
	useRef,
} from 'react';
import type { TreeNode } from '@collab/shared/types';
import type { SortMode } from './types';

export interface FlatItem {
	id: string;
	kind: 'folder' | 'file';
	level: number;
	name: string;
	path: string;
	isExpanded?: boolean;
	ctime?: string;
	mtime?: string;
	childCount?: number;
}

interface TrackedFolder {
	path: string;
	name: string;
}

function loadExpandedState(): Set<string> {
	return new Set<string>();
}

function saveExpandedState(expanded: Set<string>) {
	window.api.setWorkspacePref(
		'expanded_dirs',
		[...expanded],
	);
}

function sortFiles(
	files: TreeNode[],
	sortMode: SortMode,
): TreeNode[] {
	if (sortMode.startsWith('alpha')) {
		const isDesc = sortMode === 'alpha-desc';
		return [...files].sort((a, b) => {
			const cmp = a.name.localeCompare(b.name);
			return isDesc ? -cmp : cmp;
		});
	}

	const useModified = sortMode.startsWith('modified');
	const isDesc = sortMode.endsWith('desc');

	return [...files].sort((a, b) => {
		const getTs = (n: TreeNode) => {
			const raw = useModified ? n.mtime : n.ctime;
			if (!raw) return 0;
			return new Date(raw).getTime();
		};
		const ta = getTs(a);
		const tb = getTs(b);
		return isDesc ? tb - ta : ta - tb;
	});
}

function flattenTree(
	nodes: TreeNode[],
	expanded: Set<string>,
	level: number,
	sortMode: SortMode,
): FlatItem[] {
	const items: FlatItem[] = [];
	const dirs = nodes.filter(
		(n) => n.kind === 'folder',
	);
	const files = nodes.filter(
		(n) => n.kind === 'file',
	);

	for (const dir of dirs) {
		const isOpen = expanded.has(dir.path);
		items.push({
			id: dir.path,
			kind: 'folder',
			level,
			name: dir.name,
			path: dir.path,
			isExpanded: isOpen,
			childCount: countFilesInNode(dir),
		});
		if (
			isOpen &&
			(dir.children ?? []).length > 0
		) {
			items.push(
				...flattenTree(
					dir.children ?? [],
					expanded,
					level + 1,
					sortMode,
				),
			);
		}
	}

	const sorted = sortFiles(files, sortMode);
	for (const file of sorted) {
		items.push({
			id: file.path,
			kind: 'file',
			level,
			name: file.name,
			path: file.path,
			ctime: file.ctime,
			mtime: file.mtime,
		});
	}

	return items;
}

export function useFileTree(
	folders: TrackedFolder[],
	sortMode: SortMode,
) {
	const [dirContents, setDirContents] = useState<
		Map<string, TreeNode[]>
	>(new Map());
	const [expanded, setExpanded] = useState<
		Set<string>
	>(loadExpandedState);
	const dirContentsRef = useRef(dirContents);
	dirContentsRef.current = dirContents;
	const pendingLoadsRef = useRef(
		new Map<string, Promise<TreeNode[]>>(),
	);
	const dirtyDirsRef = useRef(new Set<string>());

	useEffect(() => {
		window.api
			.getWorkspacePref('expanded_dirs')
			.then((stored) => {
				if (
					Array.isArray(stored) &&
					stored.length > 0
				) {
					setExpanded(
						new Set(stored as string[]),
					);
				} else {
					setExpanded(
						new Set(
							folders.map((f) => f.path),
						),
					);
				}
			})
			.catch(() => {});
		// eslint-disable-next-line react-hooks/exhaustive-deps -- one-time mount; folder changes handled below
	}, []);

	const foldersKey = folders
		.map((f) => f.path)
		.join('\0');
	const prevFoldersKeyRef = useRef(foldersKey);

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
								path: `${dirPath}/${e.name}`,
								kind: e.isDirectory
									? 'folder'
									: 'file',
								ctime: e.createdAt,
								mtime: e.modifiedAt,
							};

							if (
								e.fileCount !== undefined
							) {
								node.fileCount =
									e.fileCount;
							}

							return node;
						},
					)
					.sort(
						(a: TreeNode, b: TreeNode) => {
							const aIsDir =
								a.kind === 'folder';
							const bIsDir =
								b.kind === 'folder';
							if (aIsDir !== bIsDir)
								return aIsDir ? -1 : 1;
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
						treesEqual(existing, children)
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
					if (prev.has(dirPath)) return prev;
					const next = new Map(prev);
					next.set(dirPath, []);
					return next;
				});
				return [];
			} finally {
				pendingLoadsRef.current.delete(
					dirPath,
				);
				if (dirtyDirsRef.current.delete(dirPath)) {
					queueMicrotask(() => loadDir(dirPath));
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

	useEffect(() => {
		return window.api.onFsChanged((events) => {
			const affectedDirs = new Set(
				events.map((e) => e.dirPath),
			);
			const toReload = new Set<string>();
			for (const dirPath of affectedDirs) {
				if (
					dirContentsRef.current.has(dirPath) ||
					pendingLoadsRef.current.has(dirPath)
				) {
					toReload.add(dirPath);
				} else {
					let parent = dirPath;
					while (true) {
						const slash =
							parent.lastIndexOf('/');
						if (slash <= 0) break;
						parent = parent.substring(
							0,
							slash,
						);
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
	}, [loadDir]);

	useEffect(() => {
		return window.api.onFileRenamed((oldPath: string, newPath: string) => {
			const dirs = new Set<string>();

			const oldParent = oldPath.substring(0, oldPath.lastIndexOf('/'));
			if (dirContentsRef.current.has(oldParent)) dirs.add(oldParent);

			const newParent = newPath.substring(0, newPath.lastIndexOf('/'));
			if (dirContentsRef.current.has(newParent)) dirs.add(newParent);

			// Edge case: folder rename — invalidate stale child entries
			const oldPrefix = oldPath + '/';
			setDirContents(prev => {
				const next = new Map(prev);
				let changed = false;
				for (const dirPath of next.keys()) {
					if (dirPath.startsWith(oldPrefix)) {
						next.delete(dirPath);
						changed = true;
					}
				}
				return changed ? next : prev;
			});

			for (const dirPath of dirs) loadDir(dirPath);
		});
	}, [loadDir]);

	useEffect(() => {
		const changed =
			foldersKey !== prevFoldersKeyRef.current;
		prevFoldersKeyRef.current = foldersKey;

		if (changed) {
			const roots = new Set(
				folders.map((f) => f.path),
			);
			setDirContents((prev) => {
				const next = new Map<
					string,
					TreeNode[]
				>();
				for (const [k, v] of prev) {
					for (const root of roots) {
						if (
							k === root ||
							k.startsWith(`${root}/`)
						) {
							next.set(k, v);
						}
					}
				}
				return next;
			});
			window.api
				.getWorkspacePref('expanded_dirs')
				.then((stored) => {
					const valid = new Set<string>();
					if (
						Array.isArray(stored) &&
						stored.length > 0
					) {
						for (const p of stored as string[]) {
							for (const root of roots) {
								if (
									p === root ||
									p.startsWith(
										`${root}/`,
									)
								) {
									valid.add(p);
								}
							}
						}
					} else {
						for (const root of roots) {
							valid.add(root);
						}
					}
					setExpanded(valid);
				})
				.catch(() => {
					setExpanded(
						new Set(
							folders.map((f) => f.path),
						),
					);
				});
		}

		for (const folder of folders) {
			loadDir(folder.path);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps -- folders is represented by foldersKey
	}, [foldersKey, loadDir]);

	useEffect(() => {
		for (const dirPath of expanded) {
			if (!dirContents.has(dirPath)) {
				loadDir(dirPath);
			}
		}
	}, [expanded, dirContents, loadDir]);

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

			setExpanded((prev) => {
				const next = new Set(prev);
				for (const p of toExpand) next.add(p);
				saveExpandedState(next);
				return next;
			});
		},
		[loadDir],
	);

	const toggleExpand = useCallback(
		(path: string, recursive = false) => {
			const isOpen = expanded.has(path);

			if (isOpen) {
				setExpanded((prev) => {
					const next = new Set(prev);
					if (recursive) {
						for (const p of prev) {
							if (
								p === path ||
								p.startsWith(path + '/')
							) {
								next.delete(p);
							}
						}
					} else {
						next.delete(path);
					}
					saveExpandedState(next);
					return next;
				});
			} else if (recursive) {
				expandRecursive(path);
			} else {
				setExpanded((prev) => {
					const next = new Set(prev);
					next.add(path);
					saveExpandedState(next);
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
			expanded,
			expandRecursive,
		],
	);

	const tree = useMemo(() => {
		const rootNodes: TreeNode[] = folders
			.map((f): TreeNode => {
				const children =
					dirContents.get(f.path) ?? [];
				const hydratedChildren = children.map(
					(child) =>
						hydrateNode(child, dirContents),
				);
				return {
					name: f.name,
					path: f.path,
					kind: 'folder',
					ctime: '',
					mtime: '',
					children: hydratedChildren,
				};
			})
			.sort((a, b) =>
				a.name.localeCompare(b.name),
			);
		return rootNodes;
	}, [folders, dirContents]);

	const flatItems = useMemo(
		() => flattenTree(tree, expanded, 0, sortMode),
		[tree, expanded, sortMode],
	);

	const expandFolder = useCallback(
		(path: string) => {
			if (expanded.has(path)) return;
			setExpanded((prev) => {
				const next = new Set(prev);
				next.add(path);
				saveExpandedState(next);
				return next;
			});
			if (!dirContents.has(path)) {
				loadDir(path);
			}
		},
		[expanded, dirContents, loadDir],
	);

	const expandAncestors = useCallback(
		(filePath: string) => {
			const roots = folders.map((f) => f.path);
			const root = roots.find(
				(r) =>
					filePath === r ||
					filePath.startsWith(r + '/'),
			);
			if (!root) return;

			const relative = filePath.slice(
				root.length + 1,
			);
			const parts = relative.split('/');
			parts.pop();

			const toExpand: string[] = [root];
			let current = root;
			for (const part of parts) {
				current = `${current}/${part}`;
				toExpand.push(current);
			}

			setExpanded((prev) => {
				if (
					toExpand.every((p) => prev.has(p))
				)
					return prev;
				const next = new Set(prev);
				for (const p of toExpand) next.add(p);
				saveExpandedState(next);
				return next;
			});

			for (const p of toExpand) {
				if (
					!dirContentsRef.current.has(p)
				) {
					loadDir(p);
				}
			}
		},
		[folders, loadDir],
	);

	return {
		tree,
		flatItems,
		expanded,
		toggleExpand,
		expandFolder,
		expandAncestors,
	};
}

function hydrateNode(
	node: TreeNode,
	dirContents: Map<string, TreeNode[]>,
): TreeNode {
	if (node.kind !== 'folder') return node;

	const children = dirContents.get(node.path);
	if (!children) return node;

	const hydratedChildren = children.map((child) =>
		hydrateNode(child, dirContents),
	);
	return {
		...node,
		children: hydratedChildren,
	};
}

function treesEqual(
	left: TreeNode[],
	right: TreeNode[],
): boolean {
	if (left.length !== right.length) {
		return false;
	}

	for (let i = 0; i < left.length; i++) {
		const a = left[i]!;
		const b = right[i]!;
		if (
			a.path !== b.path ||
			a.name !== b.name ||
			a.kind !== b.kind ||
			a.ctime !== b.ctime ||
			a.mtime !== b.mtime ||
			a.fileCount !== b.fileCount
		) {
			return false;
		}
	}

	return true;
}

function countFilesInTree(
	nodes: TreeNode[],
): number {
	let count = 0;
	for (const node of nodes) {
		count += countFilesInNode(node);
	}
	return count;
}

function countFilesInNode(node: TreeNode): number {
	if (node.kind === 'file') {
		return 1;
	}

	if (node.children === undefined) {
		return node.fileCount ?? 0;
	}

	return countFilesInTree(node.children);
}
