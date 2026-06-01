import React, { useCallback, useRef, useState } from 'react';
import {
	Plus,
	Minus,
	ArrowCounterClockwise,
} from '@phosphor-icons/react';
import { getFileIcon } from '@collab/components/TreeView';
import type { GitChangeStatus } from '@collab/shared/git-types';

interface FileChangeRowProps {
	filename: string;
	dir: string;
	status: GitChangeStatus;
	section: 'staged' | 'unstaged' | 'untracked' | 'merge';
	lfs?: boolean;
	onStage?: () => void;
	onUnstage?: () => void;
	onDiscard?: () => void;
	onClick: () => void;
	onContextMenu?: (e: React.MouseEvent) => void;
}

export function FileChangeRow({
	filename,
	dir,
	status,
	section,
	onStage,
	onUnstage,
	onDiscard,
	onClick,
	onContextMenu,
	lfs,
}: FileChangeRowProps) {
	const [confirming, setConfirming] = useState(false);
	const confirmTimer = useRef<ReturnType<typeof setTimeout>>();

	const handleDiscard = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation();
			if (!confirming) {
				setConfirming(true);
				confirmTimer.current = setTimeout(
					() => setConfirming(false),
					3000,
				);
				return;
			}
			clearTimeout(confirmTimer.current);
			setConfirming(false);
			onDiscard?.();
		},
		[confirming, onDiscard],
	);

	const iconDef = getFileIcon(filename);
	const IconComponent = iconDef.icon;

	return (
		<div
			className="scm-file-row"
			onClick={onClick}
			onContextMenu={onContextMenu}
		>
			<span className="scm-file-icon">
				<IconComponent
					size={14}
					weight="duotone"
					style={{ color: iconDef.color }}
				/>
			</span>
			<span className="scm-file-info">
				<span className="scm-file-name">{filename}</span>
				{dir && (
					<span className="scm-file-dir">{dir}</span>
				)}
			</span>
			<span className="scm-file-actions">
				{confirming ? (
					<span
						className="scm-confirm-label"
						onClick={handleDiscard}
					>
						Confirm?
					</span>
				) : (
					<>
						{section === 'staged' && onUnstage && (
							<button
								type="button"
								className="scm-file-action-btn"
								title="Unstage"
								onClick={(e) => {
									e.stopPropagation();
									onUnstage();
								}}
							>
								<Minus size={14} />
							</button>
						)}
						{(section === 'unstaged' ||
							section === 'untracked') &&
							onStage && (
								<button
									type="button"
									className="scm-file-action-btn"
									title="Stage"
									onClick={(e) => {
										e.stopPropagation();
										onStage();
									}}
								>
									<Plus size={14} />
								</button>
							)}
						{onDiscard &&
							section !== 'untracked' && (
								<button
									type="button"
									className="scm-file-action-btn discard"
									title="Discard Changes"
									onClick={handleDiscard}
								>
									<ArrowCounterClockwise
										size={14}
									/>
								</button>
							)}
					</>
				)}
			</span>
			{lfs && (
				<span className="scm-file-badge badge-M" title="Git LFS">
					LFS
				</span>
			)}
			<span
				className={`scm-file-badge badge-${status}`}
			>
				{status}
			</span>
		</div>
	);
}
