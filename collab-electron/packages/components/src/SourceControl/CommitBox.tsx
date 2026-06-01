import React, { useCallback } from 'react';
import {
	Check,
	Sparkle,
	CircleNotch,
	ArrowUp,
	ArrowsClockwise,
} from '@phosphor-icons/react';

interface CommitBoxProps {
	message: string;
	onMessageChange: (message: string) => void;
	hasStagedChanges: boolean;
	canGenerate: boolean;
	agentName?: string;
	hasAnyChanges: boolean;
	hasCommits: boolean;
	hasMergeConflicts: boolean;
	amend: boolean;
	onAmendChange: (amend: boolean) => void;
	signCommit: boolean;
	onSignCommitChange: (sign: boolean) => void;
	showSignOption?: boolean;
	onCommit: () => void;
	onCommitAndPush: () => void;
	onCommitAndSync: () => void;
	onGenerateMessage: () => void;
	committing: boolean;
	generating: boolean;
}

export function CommitBox({
	message,
	onMessageChange,
	hasStagedChanges: _hasStagedChanges,
	canGenerate,
	agentName,
	hasAnyChanges,
	hasCommits,
	hasMergeConflicts,
	amend,
	onAmendChange,
	signCommit,
	onSignCommitChange,
	showSignOption,
	onCommit,
	onCommitAndPush,
	onCommitAndSync,
	onGenerateMessage,
	committing,
	generating,
}: CommitBoxProps) {
	const canCommit =
		hasAnyChanges &&
		message.trim().length > 0 &&
		!committing &&
		!hasMergeConflicts;

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (
				(e.metaKey || e.ctrlKey) &&
				e.key === 'Enter' &&
				canCommit
			) {
				e.preventDefault();
				onCommit();
			}
		},
		[canCommit, onCommit],
	);

	const aiDisabled =
		!canGenerate || !hasAnyChanges || generating;

	let aiTitle = 'Generate commit message with AI';
	if (!canGenerate) {
		aiTitle =
			'Install Claude Code, Codex, or Gemini CLI to generate commit messages';
	} else if (agentName) {
		aiTitle = `Generate commit message with ${agentName}`;
	}

	return (
		<div className="scm-commit-box">
			<textarea
				className="scm-commit-textarea"
				placeholder={
					hasMergeConflicts
						? 'Resolve merge conflicts before committing'
						: 'Commit message...'
				}
				value={message}
				onChange={(e) =>
					onMessageChange(e.target.value)
				}
				onKeyDown={handleKeyDown}
				rows={3}
				disabled={hasMergeConflicts}
			/>
			<label className="scm-commit-amend">
				<input
					type="checkbox"
					checked={amend}
					disabled={!hasCommits || hasMergeConflicts}
					onChange={(e) =>
						onAmendChange(e.target.checked)
					}
				/>
				<span>Amend</span>
			</label>
			{showSignOption && (
				<label className="scm-commit-amend scm-sign-row">
					<input
						type="checkbox"
						checked={signCommit}
						disabled={hasMergeConflicts}
						onChange={(e) =>
							onSignCommitChange(e.target.checked)
						}
					/>
					<span>Sign commit</span>
				</label>
			)}
			<div className="scm-commit-actions">
				<button
					type="button"
					className="scm-commit-button"
					disabled={!canCommit}
					onClick={onCommit}
					title="Commit (Cmd+Enter)"
				>
					{committing ? (
						<CircleNotch
							size={14}
							className="scm-spinner"
						/>
					) : (
						<Check size={14} weight="bold" />
					)}
					<span>
						{committing ? 'Committing...' : 'Commit'}
					</span>
				</button>
				<button
					type="button"
					className="scm-commit-button secondary"
					disabled={!canCommit}
					onClick={onCommitAndPush}
					title="Commit and push"
				>
					<ArrowUp size={14} weight="bold" />
					<span>Commit &amp; Push</span>
				</button>
				<button
					type="button"
					className="scm-commit-button secondary"
					disabled={!canCommit}
					onClick={onCommitAndSync}
					title="Commit, pull, and push"
				>
					<ArrowsClockwise size={14} weight="bold" />
					<span>Commit &amp; Sync</span>
				</button>
				<button
					type="button"
					className={`scm-ai-button${generating ? ' generating' : ''}`}
					disabled={aiDisabled}
					onClick={onGenerateMessage}
					title={aiTitle}
				>
					{generating ? (
						<CircleNotch
							size={14}
							className="scm-spinner"
						/>
					) : (
						<Sparkle size={14} weight="fill" />
					)}
				</button>
			</div>
		</div>
	);
}
