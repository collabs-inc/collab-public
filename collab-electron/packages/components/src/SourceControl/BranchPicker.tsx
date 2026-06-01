import React, {
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react';
import {
	GitBranch,
	MagnifyingGlass,
	Plus,
	Trash,
	Check,
	Tag,
} from '@phosphor-icons/react';
import type {
	GitBranch as GitBranchType,
	GitTag,
} from '@collab/shared/git-types';

interface BranchPickerProps {
	workspacePath: string;
	currentBranch: string;
	onSwitch: (branch: string) => Promise<void>;
	onCreate: (name: string) => Promise<void>;
	onDelete: (name: string) => Promise<void>;
	onMerge?: (branch: string) => Promise<void>;
	onRebase?: (branch: string) => Promise<void>;
	onInteractiveRebase?: () => void;
	onError: (msg: string) => void;
}

export function BranchPicker({
	workspacePath,
	currentBranch,
	onSwitch,
	onCreate,
	onDelete,
	onMerge,
	onRebase,
	onInteractiveRebase,
	onError,
}: BranchPickerProps) {
	const [open, setOpen] = useState(false);
	const [branches, setBranches] = useState<GitBranchType[]>(
		[],
	);
	const [tags, setTags] = useState<GitTag[]>([]);
	const [filter, setFilter] = useState('');
	const [creating, setCreating] = useState(false);
	const [newName, setNewName] = useState('');
	const [loading, setLoading] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const loadBranches = useCallback(async () => {
		try {
			const [branchList, tagList] = await Promise.all([
				window.api.gitBranches(workspacePath),
				window.api.gitTags(workspacePath),
			]);
			setBranches(branchList);
			setTags(tagList);
		} catch {
			setBranches([]);
			setTags([]);
		}
	}, [workspacePath]);

	useEffect(() => {
		if (open) {
			loadBranches();
			setTimeout(() => inputRef.current?.focus(), 50);
		} else {
			setFilter('');
			setCreating(false);
			setNewName('');
		}
	}, [open, loadBranches]);

	useEffect(() => {
		if (!open) return;
		const handler = (e: MouseEvent) => {
			if (
				containerRef.current &&
				!containerRef.current.contains(
					e.target as Node,
				)
			) {
				setOpen(false);
			}
		};
		document.addEventListener('mousedown', handler);
		return () =>
			document.removeEventListener(
				'mousedown',
				handler,
			);
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const handler = (e: KeyboardEvent) => {
			if (e.key === 'Escape') setOpen(false);
		};
		window.addEventListener('keydown', handler);
		return () =>
			window.removeEventListener('keydown', handler);
	}, [open]);

	const handleSwitch = useCallback(
		async (ref: string, isTag?: boolean) => {
			if (ref === currentBranch) return;
			if (
				isTag &&
				!window.confirm(
					`Checkout tag "${ref}"? This puts you in detached HEAD state.`,
				)
			) {
				return;
			}
			setLoading(true);
			try {
				await onSwitch(ref);
				setOpen(false);
			} catch (err) {
				onError(
					err instanceof Error
						? err.message
						: 'Switch failed',
				);
			} finally {
				setLoading(false);
			}
		},
		[currentBranch, onSwitch, onError],
	);

	const handleCreate = useCallback(async () => {
		if (!newName.trim()) return;
		setLoading(true);
		try {
			await onCreate(newName.trim());
			setOpen(false);
		} catch (err) {
			onError(
				err instanceof Error
					? err.message
					: 'Create failed',
			);
		} finally {
			setLoading(false);
		}
	}, [newName, onCreate, onError]);

	const handleDelete = useCallback(
		async (name: string) => {
			if (name === currentBranch) {
				onError('Cannot delete the current branch');
				return;
			}
			if (
				!window.confirm(
					`Delete branch "${name}"?`,
				)
			) {
				return;
			}
			setLoading(true);
			try {
				await onDelete(name);
				await loadBranches();
			} catch (err) {
				onError(
					err instanceof Error
						? err.message
						: 'Delete failed',
				);
			} finally {
				setLoading(false);
			}
		},
		[currentBranch, onDelete, onError, loadBranches],
	);

	const q = filter.toLowerCase();
	const localBranches = branches.filter(
		(b) =>
			!b.isRemote &&
			b.name.toLowerCase().includes(q),
	);
	const remoteBranches = branches.filter(
		(b) =>
			b.isRemote &&
			b.name.toLowerCase().includes(q),
	);
	const filteredTags = tags.filter((t) =>
		t.name.toLowerCase().includes(q),
	);

	return (
		<div className="scm-branch-picker" ref={containerRef}>
			<button
				type="button"
				className="scm-branch-trigger"
				onClick={() => setOpen((o) => !o)}
				title="Switch branch"
			>
				<GitBranch size={14} weight="bold" />
				<span className="scm-branch-name">
					{currentBranch || 'HEAD'}
				</span>
			</button>

			{open && (
				<div className="scm-branch-dropdown">
					<div className="scm-branch-search">
						<MagnifyingGlass
							size={12}
							weight="bold"
						/>
						<input
							ref={inputRef}
							type="text"
							placeholder="Filter branches..."
							value={filter}
							onChange={(e) =>
								setFilter(e.target.value)
							}
							className="scm-branch-search-input"
						/>
					</div>

					<div className="scm-branch-list">
						{localBranches.length > 0 && (
							<div className="scm-branch-group">
								<div className="scm-branch-group-label">
									Local
								</div>
								{localBranches.map((b) => (
									<div
										key={b.name}
										className={`scm-branch-item${b.current ? ' current' : ''}`}
										onClick={() =>
											handleSwitch(
												b.name,
											)
										}
									>
										<span className="scm-branch-item-name">
											{b.name}
										</span>
										{b.current && (
											<Check
												size={12}
												weight="bold"
											/>
										)}
										{!b.current && (
											<button
												type="button"
												className="scm-branch-delete"
												title="Delete branch"
												onClick={(
													e,
												) => {
													e.stopPropagation();
													handleDelete(
														b.name,
													);
												}}
											>
												<Trash
													size={12}
												/>
											</button>
										)}
									</div>
								))}
							</div>
						)}

						{remoteBranches.length > 0 && (
							<div className="scm-branch-group">
								<div className="scm-branch-group-label">
									Remote
								</div>
								{remoteBranches.map((b) => (
									<div
										key={b.name}
										className="scm-branch-item"
										onClick={() =>
											handleSwitch(
												b.name,
											)
										}
									>
										<span className="scm-branch-item-name">
											{b.name}
										</span>
									</div>
								))}
							</div>
						)}

						{filteredTags.length > 0 && (
							<div className="scm-branch-group">
								<div className="scm-branch-group-label">
									Tags
								</div>
								{filteredTags.map((t) => (
									<div
										key={t.name}
										className="scm-branch-item tag"
										onClick={() =>
											handleSwitch(
												t.name,
												true,
											)
										}
									>
										<Tag
											size={12}
											weight="bold"
										/>
										<span className="scm-branch-item-name">
											{t.name}
										</span>
									</div>
								))}
							</div>
						)}
					</div>

					<div className="scm-branch-footer">
						{onMerge && (
							<button
								type="button"
								className="scm-branch-item"
								onClick={async () => {
									const branch = localBranches.find(
										(b) => !b.current,
									)?.name;
									if (!branch) return;
									const name = window.prompt(
										'Merge branch into current:',
										branch,
									);
									if (name) {
										try {
											await onMerge(name);
										} catch (err) {
											onError(
												err instanceof Error
													? err.message
													: 'Merge failed',
											);
										}
									}
								}}
							>
								Merge branch…
							</button>
						)}
						{onRebase && (
							<button
								type="button"
								className="scm-branch-item"
								onClick={async () => {
									const branch = localBranches.find(
										(b) => !b.current,
									)?.name;
									if (!branch) return;
									const name = window.prompt(
										'Rebase current onto:',
										branch,
									);
									if (name) {
										try {
											await onRebase(name);
										} catch (err) {
											onError(
												err instanceof Error
													? err.message
													: 'Rebase failed',
											);
										}
									}
								}}
							>
								Rebase onto…
							</button>
						)}
						{onInteractiveRebase && (
							<button
								type="button"
								className="scm-branch-item"
								onClick={onInteractiveRebase}
							>
								Interactive rebase…
							</button>
						)}
						{creating ? (
							<div className="scm-branch-create-input">
								<input
									type="text"
									placeholder="New branch name..."
									value={newName}
									onChange={(e) =>
										setNewName(
											e.target.value,
										)
									}
									onKeyDown={(e) => {
										if (
											e.key === 'Enter'
										)
											handleCreate();
										if (
											e.key === 'Escape'
										)
											setCreating(
												false,
											);
									}}
									autoFocus
									className="scm-branch-search-input"
								/>
							</div>
						) : (
							<button
								type="button"
								className="scm-branch-item create"
								onClick={() =>
									setCreating(true)
								}
							>
								<Plus
									size={12}
									weight="bold"
								/>
								<span>Create new branch</span>
							</button>
						)}
					</div>

					{loading && (
						<div className="scm-branch-loading">
							Working...
						</div>
					)}
				</div>
			)}
		</div>
	);
}
