export type SortMode =
	| 'created-desc'
	| 'created-asc'
	| 'modified-desc'
	| 'modified-asc'
	| 'alpha-asc'
	| 'alpha-desc';

export const sortModeLabels: Record<SortMode, string> =
	{
		'created-desc': 'Created \u2193',
		'created-asc': 'Created \u2191',
		'modified-desc': 'Modified \u2193',
		'modified-asc': 'Modified \u2191',
		'alpha-asc': 'Name A\u2013Z',
		'alpha-desc': 'Name Z\u2013A',
	};

export const sortModeOrder: SortMode[] = [
	'created-desc',
	'created-asc',
	'modified-desc',
	'modified-asc',
	'alpha-asc',
	'alpha-desc',
];

export const SORT_MODE_STORAGE_KEY =
	'collab:nav-sort-mode';

export const TREE_SORT_MODE_STORAGE_KEY =
	'collab:nav-tree-sort-mode';
