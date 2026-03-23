import React, { useCallback, useState } from 'react';
import {
	Check,
	Sparkle,
	CircleNotch,
} from '@phosphor-icons/react';

interface CommitBoxProps {
	message: string;
	onMessageChange: (message: string) => void;
	hasStagedChanges: boolean;
	hasApiKey: boolean;
	onCommit: () => void;
	onGenerateMessage: () => void;
	committing: boolean;
	generating: boolean;
}

export function CommitBox({
	message,
	onMessageChange,
	hasStagedChanges,
	hasApiKey,
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
					disabled={
						!hasStagedChanges ||
						!hasApiKey ||
						generating
					}
					onClick={onGenerateMessage}
					title={
						!hasApiKey
							? 'Set API key in Settings → AI'
							: 'Generate commit message with AI'
					}
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
