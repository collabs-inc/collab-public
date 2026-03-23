import React, {
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react';
import {
	GitBranch,
	ArrowsClockwise,
	CheckCircle,
} from '@phosphor-icons/react';
import type { GitStatusResult } from '@collab/shared/git-types';
import { CommitBox } from './CommitBox';
import { ChangeSectionHeader } from './ChangeSectionHeader';
import { FileChangeRow } from './FileChangeRow';
import { SyncBar } from './SyncBar';
import { BranchPicker } from './BranchPicker';
import { DiffView } from './DiffView';

interface SourceControlViewProps {
	workspacePath: string;
	isActive?: boolean;
	onSelectFile: (path: string) => void;
	leadingContent?: React.ReactNode;
}

export function SourceControlView({
	workspacePath,
	isActive,
	onSelectFile,
	leadingContent,
}: SourceControlViewProps) {
	const [status, setStatus] =
		useState<GitStatusResult | null>(null);
	const [commitMessage, setCommitMessage] = useState('');
	const [committing, setCommitting] = useState(false);
	const [generating, setGenerating] = useState(false);
	const [canGenerate, setCanGenerate] = useState(false);
	const [agentName, setAgentName] = useState<string | undefined>();
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(
		null,
	);
	const [hasUpstream, setHasUpstream] = useState(false);
	const [diffFile, setDiffFile] = useState<{
		filePath: string;
		absPath: string;
		relativePath: string;
		cached: boolean;
	} | null>(null);
	const refreshTimer = useRef<ReturnType<typeof setTimeout>>();

	const refresh = useCallback(async () => {
		try {
			const result = await window.api.gitStatus();
			setStatus(result);
			window.api
				.gitHasUpstream()
				.then(setHasUpstream)
				.catch(() => setHasUpstream(false));
		} catch (err) {
			setStatus({
				branch: '',
				ahead: 0,
				behind: 0,
				staged: [],
				unstaged: [],
				untracked: [],
				isGitRepo: false,
			});
		}
	}, []);

	// Initial load
	useEffect(() => {
		refresh();
		window.api
			.aiCanGenerate()
			.then((result) => {
				setCanGenerate(result.available);
				setAgentName(result.agent);
			})
			.catch(() => {});
	}, [workspacePath, refresh]);

	// Auto-refresh on file changes (debounced)
	useEffect(() => {
		if (!isActive) return;
		return window.api.onFsChanged(() => {
			clearTimeout(refreshTimer.current);
			refreshTimer.current = setTimeout(refresh, 200);
		});
	}, [isActive, refresh]);

	// Cleanup timer
	useEffect(() => {
		return () => clearTimeout(refreshTimer.current);
	}, []);

	const handleStage = useCallback(
		async (paths: string[]) => {
			try {
				await window.api.gitStage(paths);
				await refresh();
			} catch (err) {
				setError(
					err instanceof Error
						? err.message
						: 'Failed to stage',
				);
			}
		},
		[refresh],
	);

	const handleUnstage = useCallback(
		async (paths: string[]) => {
			try {
				await window.api.gitUnstage(paths);
				await refresh();
			} catch (err) {
				setError(
					err instanceof Error
						? err.message
						: 'Failed to unstage',
				);
			}
		},
		[refresh],
	);

	const handleStageAll = useCallback(async () => {
		try {
			await window.api.gitStageAll();
			await refresh();
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: 'Failed to stage all',
			);
		}
	}, [refresh]);

	const handleUnstageAll = useCallback(async () => {
		try {
			await window.api.gitUnstageAll();
			await refresh();
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: 'Failed to unstage all',
			);
		}
	}, [refresh]);

	const handleDiscard = useCallback(
		async (paths: string[]) => {
			try {
				await window.api.gitDiscard(paths);
				await refresh();
			} catch (err) {
				setError(
					err instanceof Error
						? err.message
						: 'Failed to discard',
				);
			}
		},
		[refresh],
	);

	const handleCommit = useCallback(async () => {
		if (!commitMessage.trim()) return;
		setCommitting(true);
		setError(null);
		setSuccess(null);
		try {
			const result = await window.api.gitCommit(
				commitMessage,
			);
			setCommitMessage('');
			setSuccess(
				`Committed ${result.hash.slice(0, 7)}`,
			);
			setTimeout(() => setSuccess(null), 3000);
			await refresh();
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: 'Commit failed',
			);
		} finally {
			setCommitting(false);
		}
	}, [commitMessage, refresh]);

	const handleGenerateMessage = useCallback(async () => {
		setGenerating(true);
		setError(null);
		try {
			const result =
				await window.api.gitGenerateCommitMessage();
			setCommitMessage(result.message);
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: 'Failed to generate message',
			);
		} finally {
			setGenerating(false);
		}
	}, []);

	// Push / Pull / Sync handlers
	const handlePush = useCallback(async () => {
		await window.api.gitPush();
		await refresh();
	}, [refresh]);

	const handlePull = useCallback(async () => {
		await window.api.gitPull();
		await refresh();
	}, [refresh]);

	const handleSync = useCallback(async () => {
		await window.api.gitFetch();
		await window.api.gitPull();
		await window.api.gitPush();
		await refresh();
	}, [refresh]);

	const handlePublish = useCallback(async () => {
		const remotes = await window.api.gitRemotes();
		const remote = remotes[0]?.name ?? 'origin';
		const branch = status?.branch ?? 'main';
		await window.api.gitPushSetUpstream(
			remote,
			branch,
		);
		await refresh();
	}, [status?.branch, refresh]);

	// Branch handlers
	const handleBranchSwitch = useCallback(
		async (branch: string) => {
			await window.api.gitCheckout(branch);
			await refresh();
		},
		[refresh],
	);

	const handleBranchCreate = useCallback(
		async (name: string) => {
			await window.api.gitCreateBranch(name);
			await refresh();
		},
		[refresh],
	);

	const handleBranchDelete = useCallback(
		async (name: string) => {
			await window.api.gitDeleteBranch(name);
			await refresh();
		},
		[refresh],
	);

	// Diff handler
	const handleFileClick = useCallback(
		(
			absPath: string,
			relativePath: string,
			cached: boolean,
		) => {
			setDiffFile({
				filePath: absPath,
				absPath,
				relativePath,
				cached,
			});
		},
		[],
	);

	// Not a git repo
	if (status && !status.isGitRepo) {
		return (
			<div className="scm-container">
				{leadingContent}
				<div className="scm-empty">
					<GitBranch
						size={32}
						weight="thin"
						className="scm-empty-icon"
					/>
					<span>
						This workspace is not a git
						repository.
					</span>
				</div>
			</div>
		);
	}

	// Loading
	if (!status) {
		return (
			<div className="scm-container">
				{leadingContent}
				<div className="scm-empty">
					<span>Loading...</span>
				</div>
			</div>
		);
	}

	const hasStagedChanges = status.staged.length > 0;
	const hasAnyChanges =
		status.staged.length +
			status.unstaged.length +
			status.untracked.length >
		0;
	const totalChanges =
		status.staged.length +
		status.unstaged.length +
		status.untracked.length;

	function dirOf(filePath: string): string {
		const lastSlash = filePath.lastIndexOf('/');
		return lastSlash > 0
			? filePath.slice(0, lastSlash)
			: '';
	}

	function nameOf(filePath: string): string {
		const lastSlash = filePath.lastIndexOf('/');
		return lastSlash >= 0
			? filePath.slice(lastSlash + 1)
			: filePath;
	}

	return (
		<div className="scm-container">
			{leadingContent}

			{/* Branch header */}
			<div className="scm-header">
				<BranchPicker
					currentBranch={status.branch}
					onSwitch={handleBranchSwitch}
					onCreate={handleBranchCreate}
					onDelete={handleBranchDelete}
					onError={setError}
				/>
				<button
					type="button"
					className="scm-refresh-button"
					title="Refresh"
					onClick={refresh}
				>
					<ArrowsClockwise size={14} />
				</button>
			</div>

			{/* Sync bar */}
			<SyncBar
				ahead={status.ahead}
				behind={status.behind}
				hasUpstream={hasUpstream}
				branch={status.branch}
				onPush={handlePush}
				onPull={handlePull}
				onSync={handleSync}
				onPublish={handlePublish}
				onError={setError}
			/>

			{/* Commit box */}
			<CommitBox
				message={commitMessage}
				onMessageChange={setCommitMessage}
				hasStagedChanges={hasStagedChanges}
				canGenerate={canGenerate}
				agentName={agentName}
				hasAnyChanges={hasAnyChanges}
				onCommit={handleCommit}
				onGenerateMessage={handleGenerateMessage}
				committing={committing}
				generating={generating}
			/>

			{/* Status messages */}
			{error && (
				<div className="scm-error">{error}</div>
			)}
			{success && (
				<div className="scm-success">
					<CheckCircle
						size={12}
						weight="fill"
						style={{
							verticalAlign: 'middle',
							marginRight: 4,
						}}
					/>
					{success}
				</div>
			)}

			{/* File list */}
			<div className="scm-file-list">
				{totalChanges === 0 && (
					<div className="scm-empty">
						<CheckCircle
							size={32}
							weight="thin"
							className="scm-empty-icon"
						/>
						<span>
							No changes in working tree.
						</span>
					</div>
				)}

				{/* Staged changes */}
				<ChangeSectionHeader
					title="Staged Changes"
					count={status.staged.length}
					actionIcon="unstage"
					onAction={handleUnstageAll}
				>
					{status.staged.map((file) => (
						<FileChangeRow
							key={`staged-${file.path}`}
							filename={nameOf(file.path)}
							dir={dirOf(file.path)}
							status={file.status}
							section="staged"
							onUnstage={() =>
								handleUnstage([file.path])
							}
							onDiscard={() =>
								handleDiscard([file.path])
							}
							onClick={() =>
								handleFileClick(
									file.absPath,
									file.path,
									true,
								)
							}
						/>
					))}
				</ChangeSectionHeader>

				{/* Changes (unstaged + untracked combined) */}
				<ChangeSectionHeader
					title="Changes"
					count={
						status.unstaged.length +
						status.untracked.length
					}
					actionIcon="stage"
					onAction={() =>
						handleStage([
							...status.unstaged.map(
								(f) => f.path,
							),
							...status.untracked.map(
								(f) => f.path,
							),
						])
					}
				>
					{status.unstaged.map((file) => (
						<FileChangeRow
							key={`unstaged-${file.path}`}
							filename={nameOf(file.path)}
							dir={dirOf(file.path)}
							status={file.status}
							section="unstaged"
							onStage={() =>
								handleStage([file.path])
							}
							onDiscard={() =>
								handleDiscard([file.path])
							}
							onClick={() =>
								handleFileClick(
									file.absPath,
									file.path,
									false,
								)
							}
						/>
					))}
					{status.untracked.map((file) => (
						<FileChangeRow
							key={`untracked-${file.path}`}
							filename={nameOf(file.path)}
							dir={dirOf(file.path)}
							status={file.status}
							section="untracked"
							onStage={() =>
								handleStage([file.path])
							}
							onClick={() =>
								onSelectFile(file.absPath)
							}
						/>
					))}
				</ChangeSectionHeader>
			</div>

			{/* Diff viewer */}
			{diffFile && (
				<DiffView
					filePath={diffFile.absPath}
					relativePath={diffFile.relativePath}
					cached={diffFile.cached}
					onClose={() => setDiffFile(null)}
					onOpenFile={onSelectFile}
				/>
			)}
		</div>
	);
}
