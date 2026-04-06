import { useCallback, useRef, useState } from 'react';

interface UseDragDropReturn {
	draggedPaths: string[] | null;
	dropTargetPath: string | null;
	handleDragStart: (
		e: React.DragEvent,
		path: string,
		selectedPaths: Set<string>,
	) => void;
	handleDragOver: (
		e: React.DragEvent,
		folderPath: string,
	) => void;
	handleDragLeave: () => void;
	handleDrop: (
		e: React.DragEvent,
		targetFolder: string,
	) => void;
	handleDragEnd: () => void;
}

export function useDragDrop(
	onMove: (
		sourcePaths: string[],
		targetFolder: string,
	) => Promise<void>,
	onExpandFolder: (path: string) => void,
	getWorkspacePath?: (path: string) => string | undefined,
): UseDragDropReturn {
	const [draggedPaths, setDraggedPaths] = useState<
		string[] | null
	>(null);
	const [dropTargetPath, setDropTargetPath] = useState<
		string | null
	>(null);
	const expandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const draggedPathsRef = useRef<string[] | null>(null);
	const dragSourceWorkspaceRef = useRef<string | undefined>(undefined);

	const clearExpandTimer = useCallback(() => {
		if (expandTimerRef.current) {
			clearTimeout(expandTimerRef.current);
			expandTimerRef.current = null;
		}
	}, []);

	const handleDragStart = useCallback(
		(
			e: React.DragEvent,
			path: string,
			selectedPaths: Set<string>,
		) => {
			const paths = selectedPaths.has(path)
				? [...selectedPaths]
				: [path];
			draggedPathsRef.current = paths;
			dragSourceWorkspaceRef.current =
				getWorkspacePath?.(path);
			setDraggedPaths(paths);
			window.api.setDragPaths(paths);
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData(
				'text/plain',
				paths.join('\n'),
			);

			// Clear drag signal on pointerup so the viewer
			// reverts immediately instead of waiting for the
			// browser's dragend snap-back animation.
			const onPointerUp = () => {
				window.api.clearDragPaths();
				document.removeEventListener(
					'pointerup',
					onPointerUp,
				);
			};
			document.addEventListener(
				'pointerup',
				onPointerUp,
				{ once: true },
			);
		},
		[getWorkspacePath],
	);

	const handleDragOver = useCallback(
		(e: React.DragEvent, folderPath: string) => {
			const paths = draggedPathsRef.current;
			if (!paths) return;

			const sourceWs = dragSourceWorkspaceRef.current;
			if (
				sourceWs &&
				getWorkspacePath &&
				getWorkspacePath(folderPath) !== sourceWs
			) {
				e.dataTransfer.dropEffect = 'none';
				return;
			}

			const isInvalid = paths.some(
				(p) =>
					p === folderPath ||
					folderPath.startsWith(p + '/'),
			);
			if (isInvalid) {
				e.dataTransfer.dropEffect = 'none';
				return;
			}

			e.preventDefault();
			e.dataTransfer.dropEffect = 'move';

			if (dropTargetPath !== folderPath) {
				setDropTargetPath(folderPath);
				clearExpandTimer();
				expandTimerRef.current = setTimeout(() => {
					onExpandFolder(folderPath);
				}, 800);
			}
		},
		[dropTargetPath, clearExpandTimer, onExpandFolder, getWorkspacePath],
	);

	const handleDragLeave = useCallback(() => {
		setDropTargetPath(null);
		clearExpandTimer();
	}, [clearExpandTimer]);

	const handleDrop = useCallback(
		(e: React.DragEvent, targetFolder: string) => {
			e.preventDefault();
			clearExpandTimer();
			setDropTargetPath(null);

			const paths = draggedPathsRef.current;
			if (!paths || paths.length === 0) return;

			const sourceWs = dragSourceWorkspaceRef.current;
			if (
				sourceWs &&
				getWorkspacePath &&
				getWorkspacePath(targetFolder) !== sourceWs
			) {
				return;
			}

			const isInvalid = paths.some(
				(p) =>
					p === targetFolder ||
					targetFolder.startsWith(p + '/'),
			);
			if (isInvalid) return;

			void onMove(paths, targetFolder);
			window.api.clearDragPaths();
			setDraggedPaths(null);
			draggedPathsRef.current = null;
		},
		[clearExpandTimer, onMove, getWorkspacePath],
	);

	const handleDragEnd = useCallback(() => {
		setDraggedPaths(null);
		window.api.clearDragPaths();
		draggedPathsRef.current = null;
		dragSourceWorkspaceRef.current = undefined;
		setDropTargetPath(null);
		clearExpandTimer();
	}, [clearExpandTimer]);

	return {
		draggedPaths,
		dropTargetPath,
		handleDragStart,
		handleDragOver,
		handleDragLeave,
		handleDrop,
		handleDragEnd,
	};
}
