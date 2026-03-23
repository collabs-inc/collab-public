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
} from '@phosphor-icons/react';
import type { GitBranch as GitBranchType } from '@collab/shared/git-types';

interface BranchPickerProps {
	currentBranch: string;
	onSwitch: (branch: string) => Promise<void>;
	onCreate: (name: string) => Promise<void>;
	onDelete: (name: string) => Promise<void>;
	onError: (msg: string) => void;
}

export function BranchPicker({
	currentBranch,
	onSwitch,
	onCreate,
	onDelete,
	onError,
}: BranchPickerProps) {
	const [open, setOpen] = useState(false);
	const [branches, setBranches] = useState<GitBranchType[]>(
		[],
	);
	const [filter, setFilter] = useState('');
	const [creating, setCreating] = useState(false);
	const [newName, setNewName] = useState('');
	const [loading, setLoading] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const loadBranches = useCallback(async () => {
		try {
			const result = await window.api.gitBranches();
			setBranches(result);
		} catch {
			setBranches([]);
		}
	}, []);

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

	// Close on outside click
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

	// Close on Escape
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
		async (branch: string) => {
			if (branch === currentBranch) return;
			setLoading(true);
			try {
				await onSwitch(branch);
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
		[onDelete, onError, loadBranches],
	);

	const localBranches = branches.filter(
		(b) =>
			!b.isRemote &&
			b.name
				.toLowerCase()
				.includes(filter.toLowerCase()),
	);
	const remoteBranches = branches.filter(
		(b) =>
			b.isRemote &&
			b.name
				.toLowerCase()
				.includes(filter.toLowerCase()),
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
					</div>

					<div className="scm-branch-footer">
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
				</div>
			)}
		</div>
	);
}
