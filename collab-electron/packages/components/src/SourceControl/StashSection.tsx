import React, {
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react';
import {
	CaretDown,
	Tray,
	ArrowCounterClockwise,
	ArrowLineUp,
	Trash,
} from '@phosphor-icons/react';
import type { GitStash } from '@collab/shared/git-types';

interface StashSectionProps {
	workspacePath: string;
	isActive: boolean;
	onRefresh: () => void;
	onError: (msg: string) => void;
}

export function StashSection({
	workspacePath,
	isActive,
	onRefresh,
	onError,
}: StashSectionProps) {
	const [stashes, setStashes] = useState<GitStash[]>([]);
	const [collapsed, setCollapsed] = useState(true);
	const [stashInput, setStashInput] = useState(false);
	const [stashMessage, setStashMessage] = useState('');
	const inputRef = useRef<HTMLInputElement>(null);

	const loadStashes = useCallback(async () => {
		try {
			const list =
				await window.api.gitStashList(workspacePath);
			setStashes(list);
		} catch {
			setStashes([]);
		}
	}, [workspacePath]);

	useEffect(() => {
		if (isActive) loadStashes();
	}, [isActive, loadStashes]);

	const handleSave = useCallback(async () => {
		try {
			await window.api.gitStashSave(
				workspacePath,
				stashMessage.trim() || undefined,
			);
			setStashInput(false);
			setStashMessage('');
			await loadStashes();
			onRefresh();
		} catch (err) {
			onError(
				err instanceof Error
					? err.message
					: 'Stash failed',
			);
		}
	}, [
		workspacePath,
		stashMessage,
		loadStashes,
		onRefresh,
		onError,
	]);

	const handlePop = useCallback(
		async (index: number) => {
			try {
				await window.api.gitStashPop(
					workspacePath,
					index,
				);
				await loadStashes();
				onRefresh();
			} catch (err) {
				onError(
					err instanceof Error
						? err.message
						: 'Pop failed',
				);
			}
		},
		[workspacePath, loadStashes, onRefresh, onError],
	);

	const handleApply = useCallback(
		async (index: number) => {
			try {
				await window.api.gitStashApply(
					workspacePath,
					index,
				);
				await loadStashes();
				onRefresh();
			} catch (err) {
				onError(
					err instanceof Error
						? err.message
						: 'Apply failed',
				);
			}
		},
		[workspacePath, loadStashes, onRefresh, onError],
	);

	const handleDrop = useCallback(
		async (index: number) => {
			try {
				await window.api.gitStashDrop(
					workspacePath,
					index,
				);
				await loadStashes();
			} catch (err) {
				onError(
					err instanceof Error
						? err.message
						: 'Drop failed',
				);
			}
		},
		[workspacePath, loadStashes, onError],
	);

	return (
		<>
			<div
				className="scm-section-header"
				onClick={() => {
					setCollapsed((c) => !c);
					if (collapsed) loadStashes();
				}}
			>
				<span
					className={`scm-section-chevron${collapsed ? ' collapsed' : ''}`}
				>
					<CaretDown size={12} weight="bold" />
				</span>
				<span>Stashes</span>
				{stashes.length > 0 && (
					<span className="scm-section-count">
						{stashes.length}
					</span>
				)}
				<button
					type="button"
					className="scm-section-action"
					title="Stash Changes"
					onClick={(e) => {
						e.stopPropagation();
						setStashInput(true);
						setCollapsed(false);
					}}
				>
					<Tray size={14} />
				</button>
			</div>

			{!collapsed && (
				<>
					{stashInput && (
						<div className="scm-stash-input-row">
							<input
								ref={inputRef}
								type="text"
								placeholder="Stash message (optional)..."
								value={stashMessage}
								onChange={(e) =>
									setStashMessage(
										e.target.value,
									)
								}
								onKeyDown={(e) => {
									if (e.key === 'Enter')
										handleSave();
									if (e.key === 'Escape') {
										setStashInput(false);
										setStashMessage('');
									}
								}}
								autoFocus
								className="scm-stash-input"
							/>
							<button
								type="button"
								className="scm-stash-save-btn"
								onClick={handleSave}
							>
								Stash
							</button>
						</div>
					)}

					{stashes.map((s) => (
						<div
							key={s.index}
							className="scm-stash-row"
						>
							<span className="scm-stash-message">
								{s.message}
							</span>
							<span className="scm-stash-actions">
								<button
									type="button"
									className="scm-file-action-btn"
									title="Pop (apply & remove)"
									onClick={() =>
										handlePop(s.index)
									}
								>
									<ArrowLineUp size={13} />
								</button>
								<button
									type="button"
									className="scm-file-action-btn"
									title="Apply (keep stash)"
									onClick={() =>
										handleApply(s.index)
									}
								>
									<ArrowCounterClockwise
										size={13}
									/>
								</button>
								<button
									type="button"
									className="scm-file-action-btn discard"
									title="Drop"
									onClick={() =>
										handleDrop(s.index)
									}
								>
									<Trash size={13} />
								</button>
							</span>
						</div>
					))}

					{stashes.length === 0 && !stashInput && (
						<div className="scm-stash-empty">
							No stashes
						</div>
					)}
				</>
			)}
		</>
	);
}
