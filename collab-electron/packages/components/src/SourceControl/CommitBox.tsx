import React, { useCallback } from 'react';
import {
	Check,
	Sparkle,
	CircleNotch,
} from '@phosphor-icons/react';

interface CommitBoxProps {
	message: string;
	onMessageChange: (message: string) => void;
	hasStagedChanges: boolean;
	canGenerate: boolean;
	agentName?: string;
	hasAnyChanges: boolean;
	onCommit: () => void;
	onGenerateMessage: () => void;
	committing: boolean;
	generating: boolean;
}

export function CommitBox({
	message,
	onMessageChange,
	hasStagedChanges,
	canGenerate,
	agentName,
	hasAnyChanges,
	onCommit,
	onGenerateMessage,
	committing,
	generating,
}: CommitBoxProps) {
	const canCommit =
		hasStagedChanges && message.trim().length > 0 && !committing;

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
				placeholder="Commit message..."
				value={message}
				onChange={(e) =>
					onMessageChange(e.target.value)
				}
				onKeyDown={handleKeyDown}
				rows={3}
			/>
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
