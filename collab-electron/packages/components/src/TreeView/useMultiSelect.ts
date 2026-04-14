import { useCallback, useRef, useState } from 'react';
import type { FlatItem } from './useFileTree';

interface MultiSelectState {
	selected: Set<string>;
	anchor: string | null;
	cursor: string | null;
}

interface UseMultiSelectReturn {
	selected: Set<string>;
	cursor: string | null;
	handleClick: (
		path: string,
		e: { metaKey: boolean; shiftKey: boolean },
	) => void;
	isSelected: (path: string) => boolean;
	clearSelection: () => void;
	selectPaths: (paths: string[]) => void;
}

export function useMultiSelect(
	getFlatItems: () => FlatItem[],
	onItemClick: (path: string) => void,
): UseMultiSelectReturn {
	const [state, setState] = useState<MultiSelectState>({
		selected: new Set(),
		anchor: null,
		cursor: null,
	});
	const stateRef = useRef(state);
	stateRef.current = state;

	const handleClick = useCallback(
		(
			path: string,
			e: { metaKey: boolean; shiftKey: boolean },
		) => {
			if (e.metaKey) {
				setState((prev) => {
					const next = new Set(prev.selected);
					if (next.has(path)) {
						next.delete(path);
					} else {
						next.add(path);
					}
					return {
						selected: next,
						anchor: path,
						cursor: path,
					};
				});
				return;
			}

			if (e.shiftKey && stateRef.current.anchor) {
				const allPaths = getFlatItems()
					.filter((item) => item.kind === 'file')
					.map((item) => item.path);
				const anchorIdx = allPaths.indexOf(
					stateRef.current.anchor,
				);
				const clickIdx = allPaths.indexOf(path);
				if (anchorIdx >= 0 && clickIdx >= 0) {
					const start = Math.min(anchorIdx, clickIdx);
					const end = Math.max(anchorIdx, clickIdx);
					const range = new Set(
						allPaths.slice(start, end + 1),
					);
					setState((prev) => ({
						selected: range,
						anchor: prev.anchor,
						cursor: path,
					}));
					return;
				}
			}

			setState({
				selected: new Set([path]),
				anchor: path,
				cursor: null,
			});
			onItemClick(path);
		},
		[getFlatItems, onItemClick],
	);

	const isSelected = useCallback(
		(path: string) => state.selected.has(path),
		[state.selected],
	);

	const clearSelection = useCallback(() => {
		setState({ selected: new Set(), anchor: null, cursor: null });
	}, []);

	const selectPaths = useCallback(
		(paths: string[]) => {
			setState({
				selected: new Set(paths),
				anchor: paths[paths.length - 1] ?? null,
				cursor: null,
			});
		},
		[],
	);

	return {
		selected: state.selected,
		cursor: state.cursor,
		handleClick,
		isSelected,
		clearSelection,
		selectPaths,
	};
}
