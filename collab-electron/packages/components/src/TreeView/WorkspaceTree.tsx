import React, {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useState,
} from 'react';
import type { TreeNode } from '@collab/shared/types';
import {
	useWorkspaceFileTree,
} from './useWorkspaceFileTree';
import type { WorkspaceFileTreeHandle } from './useWorkspaceFileTree';
import type { FlatItem } from './useFileTree';
import type { SortMode } from './types';
import { TreeView } from './TreeView';
import { FolderRow } from './TreeView';

export interface WorkspaceTreeProps {
	workspace: { path: string; name: string };
	isExpanded: boolean;
	onToggleExpand: (
		path: string,
		recursive: boolean,
	) => void;
	selectedPath: string | null;
	selectedPaths: Set<string>;
	onItemClick: (
		path: string,
		e: { metaKey: boolean; shiftKey: boolean },
	) => void;
	onCreateFile: (
		folderPath: string,
		name: string,
	) => void;
	onPlusClick?: (folderPath: string) => void;
	onDeleteFile?: (path: string) => void;
	onContextMenu?: (
		e: React.MouseEvent,
		item: FlatItem | null,
	) => void;
	sortMode: SortMode;
	renamingPath?: string | null;
	renameValue?: string;
	renameInputRef?: React.RefObject<HTMLInputElement | null>;
	onRenameChange?: (value: string) => void;
	onRenameConfirm?: () => void;
	onRenameCancel?: () => void;
	onDragStart?: (
		e: React.DragEvent,
		path: string,
	) => void;
	onDragOver?: (
		e: React.DragEvent,
		folderPath: string,
	) => void;
	onDragLeave?: () => void;
	onDrop?: (
		e: React.DragEvent,
		targetFolder: string,
	) => void;
	onDragEnd?: () => void;
	dropTargetPath?: string | null;
	onSelectFolder?: (path: string) => void;
	isFirstWorkspace?: boolean;
	searchQuery?: string;
	initialExpandAll?: boolean;
	onExpandAllComplete?: (wsPath: string) => void;
}

function flattenAllFiles(
	nodes: TreeNode[],
	workspacePath: string,
): FlatItem[] {
	const items: FlatItem[] = [];
	const prefix = workspacePath.length + 1;
	function walk(children: TreeNode[]) {
		for (const node of children) {
			if (node.kind === 'file') {
				items.push({
					id: node.path,
					kind: 'file',
					level: 1,
					name: node.path.slice(prefix),
					path: node.path,
					ctime: node.ctime,
					mtime: node.mtime,
					workspacePath,
				});
			}
			if (node.children) {
				walk(node.children);
			}
		}
	}
	walk(nodes);
	return items;
}

export const WorkspaceTree = forwardRef<
	WorkspaceFileTreeHandle,
	WorkspaceTreeProps
>(function WorkspaceTree(
	{
		workspace,
		isExpanded,
		onToggleExpand,
		selectedPath,
		selectedPaths,
		onItemClick,
		onCreateFile,
		onPlusClick,
		onDeleteFile,
		onContextMenu,
		sortMode,
		renamingPath,
		renameValue,
		renameInputRef,
		onRenameChange,
		onRenameConfirm,
		onRenameCancel,
		onDragStart,
		onDragOver,
		onDragLeave,
		onDrop,
		onDragEnd,
		dropTargetPath,
		onSelectFolder,
		isFirstWorkspace = false,
		searchQuery,
		initialExpandAll = false,
		onExpandAllComplete,
	},
	ref,
) {
	const {
		flatItems,
		toggleExpand: toggleDirExpand,
		expandFolder,
		expandAncestors,
		expandRecursive,
		collapseAllDirs,
		navigableItems,
	} = useWorkspaceFileTree(
		workspace.path,
		sortMode,
	);

	useImperativeHandle(
		ref,
		() => ({
			flatItems,
			navigableItems,
			expandAncestors,
			expandRecursive,
			collapseAllDirs,
		}),
		[
			flatItems,
			navigableItems,
			expandAncestors,
			expandRecursive,
			collapseAllDirs,
		],
	);

	// Handle initialExpandAll on mount
	useEffect(() => {
		if (initialExpandAll) {
			expandRecursive(workspace.path);
			onExpandAllComplete?.(workspace.path);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps -- only on mount when flag is set
	}, [initialExpandAll]);

	// Per-workspace search
	const [allFiles, setAllFiles] = useState<
		FlatItem[] | null
	>(null);
	const isSearching =
		(searchQuery ?? '').trim().length > 0;

	useEffect(() => {
		if (!isSearching) {
			setAllFiles(null);
			return;
		}
		if (allFiles) return;
		let cancelled = false;
		window.api
			.readTree({ root: workspace.path })
			.then((tree: TreeNode[]) => {
				if (cancelled) return;
				setAllFiles(
					flattenAllFiles(
						tree,
						workspace.path,
					),
				);
			});
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- allFiles tracked by isSearching
	}, [isSearching, workspace.path]);

	const filteredItems = useMemo(() => {
		if (!searchQuery?.trim()) return flatItems;
		const query = searchQuery.toLowerCase();
		const source = allFiles ?? flatItems;
		return source.filter((item) => {
			if (item.kind === 'folder') return false;
			const name = item.name.toLowerCase();
			const slash = name.lastIndexOf('/');
			const fileName =
				slash >= 0
					? name.slice(slash + 1)
					: name;
			return fileName.includes(query);
		});
	}, [flatItems, allFiles, searchQuery]);

	const workspaceItem: FlatItem = useMemo(
		() => ({
			id: `ws:${workspace.path}`,
			kind: 'workspace',
			level: 0,
			name: workspace.name,
			path: workspace.path,
			isExpanded,
		}),
		[workspace.path, workspace.name, isExpanded],
	);

	const handleToggleFolder = useCallback(
		(path: string, recursive: boolean) => {
			toggleDirExpand(path, recursive);
		},
		[toggleDirExpand],
	);

	return (
		<div className={`workspace-group${isExpanded ? '' : ' collapsed'}`}>
			<FolderRow
				item={workspaceItem}
				onToggle={(path, recursive) =>
					onToggleExpand(path, recursive)
				}
				onCreateFile={onCreateFile}
				onPlusClick={onPlusClick}
				rowHeight={0}
				isRenaming={false}
				renameValue=""
				renameInputRef={{ current: null }}
				onRenameChange={() => {}}
				onRenameConfirm={() => {}}
				onRenameCancel={() => {}}
				onContextMenu={onContextMenu}
				isDropTarget={
					dropTargetPath === workspace.path
				}
				onDragOver={onDragOver}
				onDragLeave={onDragLeave}
				onDrop={onDrop}
				isWorkspace
				isFirstWorkspace={isFirstWorkspace}
			/>
			{isExpanded && (
				<TreeView
					flatItems={filteredItems}
					selectedPath={selectedPath}
					selectedPaths={selectedPaths}
					onItemClick={onItemClick}
					onToggleFolder={
						handleToggleFolder
					}
					onCreateFile={onCreateFile}
					onPlusClick={onPlusClick}
					onContextMenu={onContextMenu}
					onDeleteFile={onDeleteFile}
					sortMode={sortMode}
					onCycleSortMode={() => {}}
					renamingPath={renamingPath}
					renameValue={renameValue}
					renameInputRef={renameInputRef}
					onRenameChange={onRenameChange}
					onRenameConfirm={onRenameConfirm}
					onRenameCancel={onRenameCancel}
					dropTargetPath={dropTargetPath}
					onDragStart={onDragStart}
					onDragOver={onDragOver}
					onDragLeave={onDragLeave}
					onDrop={onDrop}
					onDragEnd={onDragEnd}
					workspacePath={workspace.path}
					onSelectFolder={onSelectFolder}
					searchQuery={searchQuery}
				/>
			)}
			{isExpanded &&
				isSearching &&
				filteredItems.length === 0 && (
					<div className="search-no-matches">
						No matching files
					</div>
				)}
		</div>
	);
});
