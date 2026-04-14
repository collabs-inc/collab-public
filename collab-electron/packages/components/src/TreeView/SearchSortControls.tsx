import React, { useRef, useImperativeHandle } from 'react';
import { Clock, TextAa } from '@phosphor-icons/react';
import { sortModeLabels } from './types';
import type { SortMode } from './types';

export interface SearchSortControlsHandle {
	focusSearch: () => void;
}

interface SearchSortControlsProps {
	searchQuery: string;
	onSearchQueryChange: (value: string) => void;
	sortMode: SortMode;
	onCycleSortMode: () => void;
	searchPlaceholder?: string;
	searchShortcut?: string;
	leadingContent?: React.ReactNode;
	onArrowNav?: (direction: 'up' | 'down', shiftKey: boolean) => void;
}

export const SearchSortControls = React.forwardRef<
	SearchSortControlsHandle,
	SearchSortControlsProps
>(({
	searchQuery,
	onSearchQueryChange,
	sortMode,
	onCycleSortMode,
	searchPlaceholder = 'Search...',
	searchShortcut,
	leadingContent,
	onArrowNav,
}, ref) => {
	const inputRef = useRef<HTMLInputElement>(null);

	useImperativeHandle(ref, () => ({
		focusSearch() {
			inputRef.current?.focus();
		},
	}));

	return (
		<div className="table-search-row">
			{leadingContent ? (
				<div className="table-search-leading">
					{leadingContent}
				</div>
			) : null}
			<div className="search-input-wrapper">
				<input
					ref={inputRef}
					type="text"
					placeholder={searchPlaceholder}
					value={searchQuery}
					onChange={(e) =>
						onSearchQueryChange(
							e.target.value,
						)
					}
					onKeyDown={(e) => {
						if (e.key === 'Escape') {
							onSearchQueryChange('');
							inputRef.current?.blur();
						}
						if (
							(e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
							onArrowNav
						) {
							e.preventDefault();
							onArrowNav(
								e.key === 'ArrowDown' ? 'down' : 'up',
								e.shiftKey,
							);
						}
					}}
					className="search-input"
					aria-label="Search files"
				/>
				{searchQuery ? (
					<button
						type="button"
						className="search-clear"
						onClick={() => onSearchQueryChange('')}
						aria-label="Clear search"
					>
						&times;
					</button>
				) : searchShortcut ? (
					<kbd className="search-shortcut-kbd">{searchShortcut}</kbd>
				) : null}
			</div>
			<button
				type="button"
				className="sort-toggle-button"
				onClick={onCycleSortMode}
				title={`Sort by: ${sortModeLabels[sortMode]}. Click to cycle.`}
			>
				{sortMode.startsWith('alpha') ? (
					<TextAa
						size={12}
						weight="regular"
					/>
				) : (
					<Clock
						size={12}
						weight="regular"
					/>
				)}
				{sortModeLabels[sortMode]}
			</button>
		</div>
	);
});
