import React, {
	useCallback,
	useLayoutEffect,
	useRef,
	useState,
} from 'react';
import {
	CaretRight,
	CaretDown,
	Terminal,
	Plus,
	Graph,
} from '@phosphor-icons/react';
import type { FlatItem } from './useFileTree';
import {
	formatRelativeTime,
	displayFileName,
} from './Helpers';
import {
	splitDisplayPath,
} from '@collab/shared/path-utils';
import type { SortMode } from './types';
import { getFileIcon } from './fileIcons';
import { useImageThumbnail } from './useImageThumbnail';

const ICON_SIZE = 14;
export const ENABLE_GRAPH_TILES = false;

interface FolderRowProps {
	item: FlatItem;
	onToggle: (
		path: string,
		recursive: boolean,
	) => void;
	onCreateFile: (
		folderPath: string,
		name: string,
	) => void;
	onPlusClick?: (folderPath: string) => void;
	rowHeight: number;
	isRenaming: boolean;
	renameValue: string;
	renameInputRef: React.RefObject<HTMLInputElement | null>;
	onRenameChange: (value: string) => void;
	onRenameConfirm: () => void;
	onRenameCancel: () => void;
	onContextMenu?: (
		e: React.MouseEvent,
		item: FlatItem | null,
	) => void;
	isDropTarget: boolean;
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
	onSelectFolder?: (path: string) => void;
	isWorkspace?: boolean;
	isFirstWorkspace?: boolean;
	dimmed?: boolean;
}

export const FolderRow = React.memo(function FolderRow({
	item,
	onToggle,
	onCreateFile,
	onPlusClick,
	rowHeight,
	isRenaming,
	renameValue,
	renameInputRef,
	onRenameChange,
	onRenameConfirm,
	onContextMenu,
	onRenameCancel,
	isDropTarget,
	onDragStart,
	onDragOver,
	onDragLeave,
	onDrop,
	onDragEnd,
	onSelectFolder,
	isWorkspace = false,
	isFirstWorkspace = false,
	dimmed = false,
}: FolderRowProps) {
	const style: React.CSSProperties = isWorkspace
		? {
			paddingLeft: '0px',
			borderTop: isFirstWorkspace
				? 'none'
				: '1px solid color-mix(in srgb, var(--foreground) 8%, transparent)',
		}
		: {
			paddingLeft: `${item.level * 14}px`,
		};

	const className = `collection-tree-row collection-folder-row${isDropTarget ? ' drop-target' : ''}${isWorkspace ? ' workspace-folder-row' : ''}${dimmed ? ' dimmed' : ''}`;

	return (
		<div
			className={className}
			style={style}
			draggable={!isWorkspace}
			onDragStart={isWorkspace ? undefined : (e) =>
				onDragStart?.(e, item.path)
			}
			onDragOver={(e) =>
				onDragOver?.(e, item.path)
			}
			onDragLeave={onDragLeave}
			onDrop={(e) =>
				onDrop?.(e, item.path)
			}
			onDragEnd={onDragEnd}
			onClick={(e) =>
				onToggle(item.path, e.altKey)
			}
			onContextMenu={(e) => {
				e.preventDefault();
				onContextMenu?.(e, item);
			}}
		>
			<span className="collection-tree-caret">
				{item.isExpanded ? (
					<CaretDown
						size={10}
						weight="bold"
					/>
				) : (
					<CaretRight
						size={10}
						weight="bold"
					/>
				)}
			</span>
			{isRenaming && !isWorkspace ? (
				<input
					ref={renameInputRef}
					className="inline-rename-input"
					value={renameValue}
					onChange={(e) =>
						onRenameChange(e.target.value)
					}
					onKeyDown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							onRenameConfirm();
						} else if (
							e.key === 'Escape'
						) {
							e.preventDefault();
							onRenameCancel();
						}
					}}
					onBlur={onRenameConfirm}
					onClick={(e) =>
						e.stopPropagation()
					}
				/>
			) : isWorkspace ? (
				<div className="workspace-label">
					<span className="workspace-parent">
						{splitDisplayPath(item.path).parent}
					</span>
					<span className="workspace-name">
						{item.name}
					</span>
				</div>
			) : (
				<span className="collection-tree-name">
					{item.name}
				</span>
			)}
			{item.childCount != null && (
				<span className="collection-tree-count">
					{item.childCount}
				</span>
			)}
			<button
				className="folder-action-button"
				title="Add to folder"
				onClick={(e) => {
					e.stopPropagation();
					if (onPlusClick) {
						onPlusClick(item.path);
					} else {
						onCreateFile(item.path, '');
					}
				}}
			>
				<Plus size={12} weight="bold" />
			</button>
			<button
				className="folder-action-button"
				title="Open in Terminal"
				onClick={(e) => {
					e.stopPropagation();
					window.api.openInTerminal(
						item.path,
					);
				}}
			>
				<Terminal size={12} weight="bold" />
			</button>
			{ENABLE_GRAPH_TILES && (
				<button
					className="folder-action-button"
					title="Open graph view"
					onClick={(e) => {
						e.stopPropagation();
						if (typeof window.api.createGraphTile === "function") {
							window.api.createGraphTile(item.path);
						}
					}}
				>
					<Graph size={12} weight="bold" />
				</button>
			)}
		</div>
	);
});

export interface FileRowProps {
	item: FlatItem;
	isSelected: boolean;
	isMultiSelected?: boolean;
	isDeleteConfirm?: boolean;
	onItemClick: (
		path: string,
		e: { metaKey: boolean; shiftKey: boolean },
	) => void;
	onDelete?: (
		e: React.MouseEvent,
		path: string,
	) => void;
	onDeleteCancel?: () => void;
	isRenaming?: boolean;
	renameValue?: string;
	renameInputRef?: React.RefObject<HTMLInputElement | null>;
	onRenameChange?: (value: string) => void;
	onRenameConfirm?: () => void;
	onRenameCancel?: () => void;
	onContextMenu?: (
		e: React.MouseEvent,
		item: FlatItem | null,
	) => void;
	onDragStart?: (
		e: React.DragEvent,
		path: string,
	) => void;
	onDragEnd?: () => void;
	sortMode?: SortMode;
}

export const FileRow = React.memo(
	function FileRow({
		item,
		isSelected,
		isMultiSelected = false,
		isDeleteConfirm = false,
		onItemClick,
		onDelete,
		onDeleteCancel,
		isRenaming = false,
		renameValue = '',
		renameInputRef,
		onRenameChange,
		onRenameConfirm,
		onContextMenu,
		onRenameCancel,
		onDragStart,
		onDragEnd,
		sortMode,
	}: FileRowProps) {
		const slash = item.name.lastIndexOf('/');
		const isSearchResult = slash >= 0;
		const fileName = isSearchResult
			? item.name.slice(slash + 1)
			: item.name;
		const parentDir = isSearchResult
			? item.name.slice(0, slash + 1)
			: '';
		const { stem, ext } = displayFileName(fileName);
		const thumbnailUrl = useImageThumbnail(item.path, ICON_SIZE * 4);
		const showTimestamp = !sortMode?.startsWith('alpha');

		return (
			<div
				data-item-id={item.path}
				className={`collection-tree-row collection-item-row${isSelected ? ' isFocused' : ''}${isMultiSelected ? ' isMultiSelected' : ''}`}
				style={{
					paddingLeft: `${item.level * 14}px`,
				}}
				draggable
				onDragStart={(e) =>
					onDragStart?.(e, item.path)
				}
				onDragEnd={onDragEnd}
				onClick={(e) =>
					onItemClick(item.path, {
						metaKey: e.metaKey,
						shiftKey: e.shiftKey,
					})
				}
				onContextMenu={(e) => {
					e.preventDefault();
					onContextMenu?.(e, item);
				}}
				onMouseLeave={() => {
					if (isDeleteConfirm)
						onDeleteCancel?.();
				}}
			>
				<span className="item-icon">
					{thumbnailUrl ? (
						<img
							src={thumbnailUrl}
							width={ICON_SIZE}
							height={ICON_SIZE}
							style={{
								borderRadius: 2,
								objectFit: "cover",
							}}
							alt=""
						/>
					) : (() => {
						const { icon: IconComp, color } = getFileIcon(fileName);
						return (
							<IconComp
								size={ICON_SIZE}
								weight="regular"
								style={{ color }}
							/>
						);
					})()}
				</span>
				{isRenaming ? (
					<input
						ref={renameInputRef}
						className="inline-rename-input"
						value={renameValue}
						onChange={(e) =>
							onRenameChange(e.target.value)
						}
						onKeyDown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault();
								onRenameConfirm();
							} else if (e.key === 'Escape') {
								e.preventDefault();
								onRenameCancel();
							}
						}}
						onBlur={onRenameConfirm}
						onClick={(e) => e.stopPropagation()}
					/>
				) : isSearchResult ? (
					<div className="search-result-label">
						<span className="search-result-parent">
							{parentDir}
						</span>
						<span className="search-result-name">
							{stem}
							{ext && (
								<span style={{ opacity: 0.4 }}>
									{ext}
								</span>
							)}
						</span>
					</div>
				) : (
					<span className="item-text">
						{stem}
						{ext && (
							<span style={{ opacity: 0.4 }}>
								{ext}
							</span>
						)}
					</span>
				)}
				<div className="row-action-buttons">
					{showTimestamp && (
						<span className="row-timestamp">
							{formatRelativeTime(item.ctime)}
						</span>
					)}
				</div>
			</div>
		);
	},
	(prev, next) =>
		prev.item.id === next.item.id &&
		prev.item.name === next.item.name &&
		prev.item.ctime === next.item.ctime &&
		prev.isSelected === next.isSelected &&
		prev.isMultiSelected ===
			next.isMultiSelected &&
		prev.isDeleteConfirm ===
			next.isDeleteConfirm &&
		prev.item.level === next.item.level &&
		prev.onItemClick === next.onItemClick &&
		prev.onDelete === next.onDelete &&
		prev.isRenaming === next.isRenaming &&
		prev.renameValue === next.renameValue &&
		prev.onContextMenu === next.onContextMenu &&
		prev.onDragStart === next.onDragStart &&
		prev.onDragEnd === next.onDragEnd &&
		prev.sortMode === next.sortMode,
);

interface TreeViewProps {
	flatItems: FlatItem[];
	selectedPath: string | null;
	selectedPaths: Set<string>;
	onItemClick: (
		path: string,
		e: { metaKey: boolean; shiftKey: boolean },
	) => void;
	onToggleFolder: (
		path: string,
		recursive: boolean,
	) => void;
	onCreateFile: (
		folderPath: string,
		name: string,
	) => void;
	onPlusClick?: (folderPath: string) => void;
	onContextMenu?: (
		e: React.MouseEvent,
		item: FlatItem | null,
	) => void;
	onDeleteFile?: (path: string) => void;
	sortMode: SortMode;
	onCycleSortMode: () => void;
	renamingPath?: string | null;
	renameValue?: string;
	renameInputRef?: React.RefObject<HTMLInputElement | null>;
	onRenameChange?: (value: string) => void;
	onRenameConfirm?: () => void;
	onRenameCancel?: () => void;
	dropTargetPath?: string | null;
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
	workspacePath?: string;
	onSelectFolder?: (path: string) => void;
	searchQuery?: string;
}

export const TreeView: React.FC<
	TreeViewProps
> = ({
	flatItems,
	selectedPath,
	selectedPaths,
	onItemClick,
	onToggleFolder,
	onCreateFile,
	onPlusClick,
	onContextMenu,
	onDeleteFile,
	sortMode,
	renamingPath,
	renameValue,
	renameInputRef,
	onRenameChange,
	onRenameConfirm,
	onRenameCancel,
	dropTargetPath,
	onDragStart,
	onDragOver,
	onDragLeave,
	onDrop,
	onDragEnd,
	workspacePath,
	onSelectFolder,
}) => {
	const [deleteConfirmId, setDeleteConfirmId] =
		useState<string | null>(null);

	const deleteConfirmRef = useRef(deleteConfirmId);
	deleteConfirmRef.current = deleteConfirmId;

	const handleDelete = useCallback(
		(
			e: React.MouseEvent,
			filePath: string,
		) => {
			e.preventDefault();
			e.stopPropagation();
			if (
				deleteConfirmRef.current === filePath
			) {
				onDeleteFile?.(filePath);
				setDeleteConfirmId(null);
			} else {
				setDeleteConfirmId(filePath);
			}
		},
		[onDeleteFile],
	);

	const handleDeleteCancel = useCallback(() => {
		setDeleteConfirmId(null);
	}, []);

	const containerRef =
		useRef<HTMLDivElement>(null);
	const [folderRowHeight, setFolderRowHeight] =
		useState(0);

	useLayoutEffect(() => {
		if (
			folderRowHeight > 0 ||
			!containerRef.current
		)
			return;
		const el =
			containerRef.current.querySelector(
				'.collection-folder-row',
			);
		if (el) {
			setFolderRowHeight(
				el.getBoundingClientRect().height,
			);
		}
	}, [folderRowHeight, flatItems]);

	const renderItems = (
		start: number,
		minLevel: number,
	): [React.ReactNode[], number] => {
		const nodes: React.ReactNode[] = [];
		let i = start;

		while (i < flatItems.length) {
			const item = flatItems[i]!;
			if (item.level < minLevel) break;

			if (
				item.kind === 'folder' &&
				item.isExpanded
			) {
				i++;
				const [children, nextI] = renderItems(
					i,
					item.level + 1,
				);
				const guideStyle = {
					'--guide-left': `${item.level * 14 + 6}px`,
					'--guide-top': `${folderRowHeight}px`,
					'--guide-z': 9 - item.level,
				} as React.CSSProperties;
				nodes.push(
					<div
						key={item.id}
						className="folder-group"
						style={guideStyle}
					>
						<FolderRow
							item={item}
							onToggle={onToggleFolder}
							onCreateFile={
								onCreateFile
							}
							onPlusClick={
								onPlusClick
							}
							rowHeight={
								folderRowHeight
							}
							isRenaming={
								renamingPath ===
								item.path
							}
							renameValue={
								renameValue ?? ''
							}
							renameInputRef={
								renameInputRef ?? {
									current: null,
								}
							}
							onRenameChange={
								onRenameChange ??
								(() => {})
							}
							onRenameConfirm={
								onRenameConfirm ??
								(() => {})
							}
							onRenameCancel={
								onRenameCancel ??
								(() => {})
							}
							onContextMenu={
								onContextMenu
							}
							isDropTarget={
								dropTargetPath ===
								item.path
							}
							onDragStart={
								onDragStart
							}
							onDragOver={
								onDragOver
							}
							onDragLeave={
								onDragLeave
							}
							onDrop={onDrop}
							onDragEnd={
								onDragEnd
							}
							onSelectFolder={
								onSelectFolder
							}
						/>
						{children}
					</div>,
				);
				i = nextI;
			} else if (item.kind === 'folder') {
				nodes.push(
					<FolderRow
						key={item.id}
						item={item}
						onToggle={onToggleFolder}
						onCreateFile={onCreateFile}
						onPlusClick={onPlusClick}
						rowHeight={folderRowHeight}
						isRenaming={
							renamingPath ===
							item.path
						}
						renameValue={
							renameValue ?? ''
						}
						renameInputRef={
							renameInputRef ?? {
								current: null,
							}
						}
						onRenameChange={
							onRenameChange ??
							(() => {})
						}
						onRenameConfirm={
							onRenameConfirm ??
							(() => {})
						}
						onRenameCancel={
							onRenameCancel ??
							(() => {})
						}
						onContextMenu={
							onContextMenu
						}
						isDropTarget={
							dropTargetPath ===
							item.path
						}
						onDragStart={onDragStart}
						onDragOver={onDragOver}
						onDragLeave={onDragLeave}
						onDrop={onDrop}
						onDragEnd={onDragEnd}
						onSelectFolder={
							onSelectFolder
						}
					/>,
				);
				i++;
			} else {
				nodes.push(
					<FileRow
						key={item.id}
						item={item}
						isSelected={
							item.path === selectedPath
						}
						isMultiSelected={
							selectedPaths.has(
								item.path,
							) &&
							item.path !== selectedPath
						}
						isDeleteConfirm={
							deleteConfirmId ===
							item.path
						}
						onItemClick={onItemClick}
						onDelete={handleDelete}
						onDeleteCancel={
							handleDeleteCancel
						}
						isRenaming={
							renamingPath ===
							item.path
						}
						renameValue={
							renameValue ?? ''
						}
						renameInputRef={
							renameInputRef ?? {
								current: null,
							}
						}
						onRenameChange={
							onRenameChange ??
							(() => {})
						}
						onRenameConfirm={
							onRenameConfirm ??
							(() => {})
						}
						onRenameCancel={
							onRenameCancel ??
							(() => {})
						}
						onContextMenu={
							onContextMenu
						}
						onDragStart={onDragStart}
						onDragEnd={onDragEnd}
						sortMode={sortMode}
					/>,
				);
				i++;
			}
		}

		return [nodes, i];
	};

	const [treeContent] = renderItems(0, 0);

	return (
		<div
			ref={containerRef}
			onDragOver={
				workspacePath
					? (e) => {
							if (
								e.target !==
								e.currentTarget
							)
								return;
							onDragOver?.(
								e,
								workspacePath,
							);
						}
					: undefined
			}
			onDrop={
				workspacePath
					? (e) => {
							if (
								e.target !==
								e.currentTarget
							)
								return;
							onDrop?.(
								e,
								workspacePath,
							);
						}
					: undefined
			}
		>
			{treeContent}
		</div>
	);
};
