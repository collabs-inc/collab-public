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
import type {
	GitFileChange,
	GitStatusResult,
} from '@collab/shared/git-types';
import { CommitBox } from './CommitBox';
import { ChangeSectionHeader } from './ChangeSectionHeader';
import { FileChangeRow } from './FileChangeRow';
import { SyncBar } from './SyncBar';
import { BranchPicker } from './BranchPicker';
import { StashSection } from './StashSection';
import { MergeBanner } from './MergeBanner';
import { RemoteManagerModal } from './RemoteManagerModal';
import { CloneRepositoryModal } from './CloneRepositoryModal';
import { CompareBranchModal } from './CompareBranchModal';
import { HistoryPanel } from './HistoryPanel';
import { InteractiveRebasePanel } from './InteractiveRebasePanel';
import { SubmodulesSection } from './SubmodulesSection';
import { WorktreesSection } from './WorktreesSection';
import {
	showScmContextMenu,
	type ScmContextTarget,
} from './scmContextMenu';
import {
	openScmFileDiff,
	openMergeConflictDiff,
} from './scmOpenDiff';

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
	const [amend, setAmend] = useState(false);
	const [committing, setCommitting] = useState(false);
	const [generating, setGenerating] = useState(false);
	const [canGenerate, setCanGenerate] = useState(false);
	const [agentName, setAgentName] = useState<string | undefined>();
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(
		null,
	);
	const [hasUpstream, setHasUpstream] = useState(false);
	const [initializing, setInitializing] = useState(false);
	const [selectedRemote, setSelectedRemote] = useState('origin');
	const [signCommit, setSignCommit] = useState(false);
	const [showSignOption, setShowSignOption] = useState(false);
	const [remoteModalOpen, setRemoteModalOpen] = useState(false);
	const [cloneModalOpen, setCloneModalOpen] = useState(false);
	const [compareFile, setCompareFile] = useState<string | null>(
		null,
	);
	const [historyExpanded, setHistoryExpanded] = useState(false);
	const [repoBusy, setRepoBusy] = useState(false);
	const refreshTimer = useRef<ReturnType<typeof setTimeout>>();

	const refresh = useCallback(async () => {
		if (!workspacePath) return;
		try {
			const result = await window.api.gitStatus(workspacePath);
			setStatus(result);
			window.api
				.gitHasUpstream(workspacePath)
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
				merge: [],
				isGitRepo: false,
				hasCommits: false,
				repoState: 'clean',
			});
		}
	}, [workspacePath]);

	useEffect(() => {
		refresh();
		window.api
			.aiCanGenerate()
			.then((result) => {
				setCanGenerate(result.available);
				setAgentName(result.agent);
			})
			.catch(() => {});
		window.api
			.gitGpgSignEnabled(workspacePath)
			.then(setShowSignOption)
			.catch(() => setShowSignOption(false));
		window.api
			.gitConfigDisplay(workspacePath)
			.then((cfg) => setSignCommit(cfg.gpgSign))
			.catch(() => {});
	}, [workspacePath, refresh]);

	useEffect(() => {
		if (!isActive) return;
		return window.api.onFsChanged(() => {
			clearTimeout(refreshTimer.current);
			refreshTimer.current = setTimeout(refresh, 200);
		});
	}, [isActive, refresh]);

	useEffect(() => {
		return () => clearTimeout(refreshTimer.current);
	}, []);

	const handleStage = useCallback(
		async (paths: string[]) => {
			try {
				await window.api.gitStage(workspacePath, paths);
				await refresh();
			} catch (err) {
				setError(
					err instanceof Error
						? err.message
						: 'Failed to stage',
				);
			}
		},
		[workspacePath, refresh],
	);

	const handleUnstage = useCallback(
		async (paths: string[]) => {
			try {
				await window.api.gitUnstage(workspacePath, paths);
				await refresh();
			} catch (err) {
				setError(
					err instanceof Error
						? err.message
						: 'Failed to unstage',
				);
			}
		},
		[workspacePath, refresh],
	);

	const handleStageAll = useCallback(async () => {
		try {
			await window.api.gitStageAll(workspacePath);
			await refresh();
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: 'Failed to stage all',
			);
		}
	}, [workspacePath, refresh]);

	const handleUnstageAll = useCallback(async () => {
		try {
			await window.api.gitUnstageAll(workspacePath);
			await refresh();
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: 'Failed to unstage all',
			);
		}
	}, [workspacePath, refresh]);

	const handleDiscard = useCallback(
		async (paths: string[]) => {
			try {
				await window.api.gitDiscard(workspacePath, paths);
				await refresh();
			} catch (err) {
				setError(
					err instanceof Error
						? err.message
						: 'Failed to discard',
				);
			}
		},
		[workspacePath, refresh],
	);

	const handleDiscardAll = useCallback(async () => {
		const ok = window.confirm(
			'Discard all changes in the working tree? This cannot be undone.',
		);
		if (!ok) return;
		try {
			await window.api.gitDiscardAll(workspacePath);
			await refresh();
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: 'Failed to discard all',
			);
		}
	}, [workspacePath, refresh]);

	const performCommit = useCallback(
		async (options?: { amend?: boolean }) => {
			if (!commitMessage.trim()) return;
			setCommitting(true);
			setError(null);
			setSuccess(null);
			try {
				if (
					!options?.amend &&
					(!status || status.staged.length === 0)
				) {
					await window.api.gitStageAll(workspacePath);
				}
				const result = await window.api.gitCommit(
					workspacePath,
					commitMessage,
					{
						...options,
						sign: signCommit || undefined,
					},
				);
				setCommitMessage('');
				setAmend(false);
				setSuccess(
					`Committed ${result.hash.slice(0, 7)}`,
				);
				setTimeout(() => setSuccess(null), 3000);
				await refresh();
				return true;
			} catch (err) {
				setError(
					err instanceof Error
						? err.message
						: 'Commit failed',
				);
				return false;
			} finally {
				setCommitting(false);
			}
		},
		[commitMessage, workspacePath, refresh, status, signCommit],
	);

	const handleCommit = useCallback(async () => {
		await performCommit(amend ? { amend: true } : undefined);
	}, [performCommit, amend]);

	const handleCommitAndPush = useCallback(async () => {
		const ok = await performCommit(
			amend ? { amend: true } : undefined,
		);
		if (!ok) return;
		try {
			await window.api.gitPush(
				workspacePath,
				selectedRemote || undefined,
			);
			await refresh();
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: 'Push failed',
			);
		}
	}, [
		performCommit,
		amend,
		workspacePath,
		refresh,
		selectedRemote,
	]);

	const handleCommitAndSync = useCallback(async () => {
		const ok = await performCommit(
			amend ? { amend: true } : undefined,
		);
		if (!ok) return;
		try {
			const remote = selectedRemote || undefined;
			await window.api.gitFetch(workspacePath, remote);
			await window.api.gitPull(workspacePath, remote);
			await window.api.gitPush(workspacePath, remote);
			await refresh();
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: 'Sync failed',
			);
		}
	}, [
		performCommit,
		amend,
		workspacePath,
		refresh,
		selectedRemote,
	]);

	const handleGenerateMessage = useCallback(async () => {
		setGenerating(true);
		setError(null);
		try {
			const result =
				await window.api.gitGenerateCommitMessage(
					workspacePath,
				);
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
	}, [workspacePath]);

	const handleInitRepo = useCallback(async () => {
		setInitializing(true);
		setError(null);
		try {
			await window.api.gitInit(workspacePath);
			await refresh();
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: 'Failed to initialize repository',
			);
		} finally {
			setInitializing(false);
		}
	}, [workspacePath, refresh]);

	const handlePush = useCallback(
		async (remote?: string) => {
			await window.api.gitPush(workspacePath, remote);
			await refresh();
		},
		[workspacePath, refresh],
	);

	const handlePull = useCallback(
		async (remote?: string) => {
			await window.api.gitPull(workspacePath, remote);
			await refresh();
		},
		[workspacePath, refresh],
	);

	const handleSync = useCallback(
		async (remote?: string) => {
			await window.api.gitFetch(workspacePath, remote);
			await window.api.gitPull(workspacePath, remote);
			await window.api.gitPush(workspacePath, remote);
			await refresh();
		},
		[workspacePath, refresh],
	);

	const handlePublish = useCallback(
		async (remote: string) => {
			const branch = status?.branch ?? 'main';
			await window.api.gitPushSetUpstream(
				workspacePath,
				remote,
				branch,
			);
			await refresh();
		},
		[workspacePath, status?.branch, refresh],
	);

	const handleBranchSwitch = useCallback(
		async (branch: string) => {
			await window.api.gitCheckout(workspacePath, branch);
			await refresh();
		},
		[workspacePath, refresh],
	);

	const handleBranchCreate = useCallback(
		async (name: string) => {
			await window.api.gitCreateBranch(workspacePath, name);
			await refresh();
		},
		[workspacePath, refresh],
	);

	const handleBranchDelete = useCallback(
		async (name: string) => {
			await window.api.gitDeleteBranch(workspacePath, name);
			await refresh();
		},
		[workspacePath, refresh],
	);

	const handleFileClick = useCallback(
		(relativePath: string, cached: boolean) => {
			openScmFileDiff(workspacePath, relativePath, cached);
		},
		[workspacePath],
	);

	const handleRepoContinue = useCallback(async () => {
		setRepoBusy(true);
		try {
			const state = status?.repoState;
			if (state === 'merging') {
				await window.api.gitMergeContinue(workspacePath);
			} else if (state === 'cherry-picking') {
				await window.api.gitCherryPickContinue(workspacePath);
			} else if (state === 'reverting') {
				await window.api.gitRevertContinue(workspacePath);
			} else {
				await window.api.gitRebaseContinue(workspacePath);
			}
			await refresh();
		} catch (err) {
			setError(
				err instanceof Error ? err.message : 'Continue failed',
			);
		} finally {
			setRepoBusy(false);
		}
	}, [workspacePath, status?.repoState, refresh]);

	const handleRepoAbort = useCallback(async () => {
		setRepoBusy(true);
		try {
			const state = status?.repoState;
			if (state === 'merging') {
				await window.api.gitMergeAbort(workspacePath);
			} else if (state === 'cherry-picking') {
				await window.api.gitCherryPickAbort(workspacePath);
			} else if (state === 'reverting') {
				await window.api.gitRevertAbort(workspacePath);
			} else {
				await window.api.gitRebaseAbort(workspacePath);
			}
			await refresh();
		} catch (err) {
			setError(
				err instanceof Error ? err.message : 'Abort failed',
			);
		} finally {
			setRepoBusy(false);
		}
	}, [workspacePath, status?.repoState, refresh]);

	const handleRepoSkip = useCallback(async () => {
		setRepoBusy(true);
		try {
			await window.api.gitRebaseSkip(workspacePath);
			await refresh();
		} catch (err) {
			setError(
				err instanceof Error ? err.message : 'Skip failed',
			);
		} finally {
			setRepoBusy(false);
		}
	}, [workspacePath, refresh]);

	const handleFileContext = useCallback(
		async (
			e: React.MouseEvent,
			file: GitFileChange,
			section: string,
			cached?: boolean,
		) => {
			e.preventDefault();
			const target: ScmContextTarget = {
				kind: 'file',
				section,
				path: file.path,
				absPath: file.absPath,
				cached,
			};
			const choice = await showScmContextMenu(target);
			if (!choice) return;
			try {
				switch (choice) {
					case 'open-changes':
						if (section === 'merge') {
							openMergeConflictDiff(
								workspacePath,
								file.path,
							);
						} else {
							openScmFileDiff(
								workspacePath,
								file.path,
								!!cached,
							);
						}
						break;
					case 'open-file':
						onSelectFile(file.absPath);
						break;
					case 'stage':
						await handleStage([file.path]);
						break;
					case 'unstage':
						await handleUnstage([file.path]);
						break;
					case 'discard':
						await handleDiscard([file.path]);
						break;
					case 'accept-current':
						await window.api.gitCheckoutOurs(workspacePath, [
							file.path,
						]);
						await refresh();
						break;
					case 'accept-incoming':
						await window.api.gitCheckoutTheirs(workspacePath, [
							file.path,
						]);
						await refresh();
						break;
					case 'mark-resolved':
						await window.api.gitAdd(workspacePath, [
							file.path,
						]);
						await refresh();
						break;
					case 'compare-branch':
						setCompareFile(file.path);
						break;
					case 'copy-path':
						void navigator.clipboard.writeText(file.path);
						break;
					case 'reveal':
						window.api.revealInFinder(file.absPath);
						break;
				}
			} catch (err) {
				setError(
					err instanceof Error
						? err.message
						: 'Action failed',
				);
			}
		},
		[
			workspacePath,
			onSelectFile,
			handleStage,
			handleUnstage,
			handleDiscard,
			refresh,
		],
	);

	const openGitignore = useCallback(() => {
		const path = `${workspacePath}/.gitignore`;
		onSelectFile(path);
	}, [workspacePath, onSelectFile]);

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
						This workspace is not a git repository.
					</span>
					<button
						type="button"
						className="scm-init-button"
						disabled={initializing}
						onClick={handleInitRepo}
					>
						{initializing
							? 'Initializing...'
							: 'Initialize Repository'}
					</button>
					<button
						type="button"
						className="scm-init-button secondary"
						onClick={() => setCloneModalOpen(true)}
					>
						Clone Repository
					</button>
				</div>
				<CloneRepositoryModal
					open={cloneModalOpen}
					onClose={() => setCloneModalOpen(false)}
					onCloned={() => void refresh()}
					onError={setError}
				/>
				{error && (
					<div className="scm-error">{error}</div>
				)}
			</div>
		);
	}

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

	const hasMergeConflicts =
		status.merge.length > 0 || status.repoState === 'merging';
	const showRebasePanel =
		status.repoState === 'interactive-rebase';
	const hasStagedChanges = status.staged.length > 0;
	const hasAnyChanges =
		status.staged.length +
			status.unstaged.length +
			status.untracked.length +
			status.merge.length >
		0;
	const totalChanges =
		status.staged.length +
		status.unstaged.length +
		status.untracked.length +
		status.merge.length;

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

			<div className="scm-header">
				<BranchPicker
					workspacePath={workspacePath}
					currentBranch={status.branch}
					onSwitch={handleBranchSwitch}
					onCreate={handleBranchCreate}
					onDelete={handleBranchDelete}
					onMerge={async (branch) => {
						await window.api.gitMerge(
							workspacePath,
							branch,
						);
						await refresh();
					}}
					onRebase={async (onto) => {
						await window.api.gitRebase(
							workspacePath,
							onto,
						);
						await refresh();
					}}
					onInteractiveRebase={() => {
						const count = window.prompt(
							'Interactive rebase: number of commits (HEAD~n):',
							'5',
						);
						if (!count) return;
						const n = parseInt(count, 10);
						if (!n || n < 1) {
							setError('Invalid commit count');
							return;
						}
						void window.api
							.gitRebaseStartInteractive(
								workspacePath,
								null,
								n,
							)
							.then(refresh)
							.catch((err) =>
								setError(
									err instanceof Error
										? err.message
										: 'Rebase failed',
								),
							);
					}}
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

			<SyncBar
				workspacePath={workspacePath}
				ahead={status.ahead}
				behind={status.behind}
				hasUpstream={hasUpstream}
				branch={status.branch}
				selectedRemote={selectedRemote}
				onRemoteChange={setSelectedRemote}
				onManageRemotes={() => setRemoteModalOpen(true)}
				onPush={handlePush}
				onPull={handlePull}
				onSync={handleSync}
				onPublish={handlePublish}
				onError={setError}
			/>

			<MergeBanner
				repoState={status.repoState}
				onContinue={handleRepoContinue}
				onAbort={handleRepoAbort}
				onSkip={handleRepoSkip}
				busy={repoBusy}
			/>

			<CommitBox
				message={commitMessage}
				onMessageChange={setCommitMessage}
				hasStagedChanges={hasStagedChanges}
				canGenerate={canGenerate}
				agentName={agentName}
				hasAnyChanges={hasAnyChanges}
				hasCommits={status.hasCommits}
				hasMergeConflicts={hasMergeConflicts}
				amend={amend}
				onAmendChange={setAmend}
				signCommit={signCommit}
				onSignCommitChange={setSignCommit}
				showSignOption={showSignOption}
				onCommit={handleCommit}
				onCommitAndPush={handleCommitAndPush}
				onCommitAndSync={handleCommitAndSync}
				onGenerateMessage={handleGenerateMessage}
				committing={committing}
				generating={generating}
			/>

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

			<div
				className="scm-file-list"
				onContextMenu={async (e) => {
					if (
						(e.target as HTMLElement).closest(
							'.scm-file-row',
						)
					) {
						return;
					}
					e.preventDefault();
					const choice = await showScmContextMenu({
						kind: 'header',
					});
					if (choice === 'refresh') await refresh();
					if (choice === 'pull')
						await handlePull(selectedRemote);
					if (choice === 'push')
						await handlePush(selectedRemote);
					if (choice === 'fetch')
						await window.api.gitFetch(
							workspacePath,
							selectedRemote,
						);
					if (choice === 'view-history')
						setHistoryExpanded(true);
					if (choice === 'open-gitignore') openGitignore();
				}}
			>
				{showRebasePanel && (
					<InteractiveRebasePanel
						workspacePath={workspacePath}
						onRefresh={refresh}
						onError={setError}
					/>
				)}
				{!showRebasePanel && totalChanges === 0 && (
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

				{!showRebasePanel && (
				<ChangeSectionHeader
					title="Merge Changes"
					count={status.merge.length}
				>
					{status.merge.map((file) => (
						<FileChangeRow
							key={`merge-${file.path}`}
							filename={nameOf(file.path)}
							dir={dirOf(file.path)}
							status={file.status}
							section="merge"
							onStage={() =>
								handleStage([file.path])
							}
							onClick={() =>
								openMergeConflictDiff(
									workspacePath,
									file.path,
								)
							}
							onContextMenu={(e) =>
								void handleFileContext(
									e,
									file,
									'merge',
								)
							}
						/>
					))}
				</ChangeSectionHeader>
				)}

				{!showRebasePanel && (
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
							lfs={file.lfs}
							onUnstage={() =>
								handleUnstage([file.path])
							}
							onDiscard={() =>
								handleDiscard([file.path])
							}
							onClick={() =>
								handleFileClick(file.path, true)
							}
							onContextMenu={(e) =>
								void handleFileContext(
									e,
									file,
									'staged',
									true,
								)
							}
						/>
					))}
				</ChangeSectionHeader>
				)}

				{!showRebasePanel && (
				<ChangeSectionHeader
					title="Changes"
					count={
						status.unstaged.length +
						status.untracked.length
					}
					actionIcon="stage"
					onAction={handleStageAll}
					secondaryActionIcon="discard"
					onSecondaryAction={handleDiscardAll}
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
								handleFileClick(file.path, false)
							}
							onContextMenu={(e) =>
								void handleFileContext(
									e,
									file,
									'unstaged',
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
							onContextMenu={(e) =>
								void handleFileContext(
									e,
									file,
									'untracked',
								)
							}
						/>
					))}
				</ChangeSectionHeader>
				)}

				<SubmodulesSection
					workspacePath={workspacePath}
					onRefresh={refresh}
					onError={setError}
				/>
				<WorktreesSection
					workspacePath={workspacePath}
					onError={setError}
				/>

				<HistoryPanel
					workspacePath={workspacePath}
					expanded={historyExpanded}
					onToggle={() =>
						setHistoryExpanded((v) => !v)
					}
					onRefresh={refresh}
					onError={setError}
				/>

				<StashSection
					workspacePath={workspacePath}
					isActive={isActive ?? false}
					onRefresh={refresh}
					onError={setError}
				/>
			</div>

			<RemoteManagerModal
				workspacePath={workspacePath}
				open={remoteModalOpen}
				onClose={() => setRemoteModalOpen(false)}
				onChanged={refresh}
				onError={setError}
			/>
			<CompareBranchModal
				workspacePath={workspacePath}
				relativePath={compareFile ?? ''}
				open={!!compareFile}
				onClose={() => setCompareFile(null)}
			/>
		</div>
	);
}
