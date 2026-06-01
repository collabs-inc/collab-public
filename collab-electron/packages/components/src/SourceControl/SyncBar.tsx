import React, {
	useCallback,
	useEffect,
	useState,
} from 'react';
import {
	ArrowUp,
	ArrowDown,
	ArrowsClockwise,
	CloudArrowUp,
	CircleNotch,
	CaretDown,
} from '@phosphor-icons/react';
import type { GitRemote } from '@collab/shared/git-types';

interface SyncBarProps {
	workspacePath: string;
	ahead: number;
	behind: number;
	hasUpstream: boolean;
	branch: string;
	selectedRemote: string;
	onRemoteChange: (name: string) => void;
	onManageRemotes?: () => void;
	onPush: (remote?: string) => Promise<void>;
	onPull: (remote?: string) => Promise<void>;
	onSync: (remote?: string) => Promise<void>;
	onPublish: (remote: string) => Promise<void>;
	onError: (msg: string) => void;
}

export function SyncBar({
	workspacePath,
	ahead,
	behind,
	hasUpstream,
	branch,
	selectedRemote,
	onRemoteChange,
	onManageRemotes,
	onPush,
	onPull,
	onSync,
	onPublish,
	onError,
}: SyncBarProps) {
	const [pushing, setPushing] = useState(false);
	const [pulling, setPulling] = useState(false);
	const [syncing, setSyncing] = useState(false);
	const [publishing, setPublishing] = useState(false);
	const [remotes, setRemotes] = useState<GitRemote[]>([]);
	const [remoteMenuOpen, setRemoteMenuOpen] = useState(false);

	useEffect(() => {
		window.api
			.gitRemotes(workspacePath)
			.then((list) => {
				setRemotes(list);
				if (list.length > 0) {
					const names = list.map((r) => r.name);
					if (!names.includes(selectedRemote)) {
						onRemoteChange(list[0]!.name);
					}
				}
			})
			.catch(() => setRemotes([]));
	}, [workspacePath, selectedRemote, onRemoteChange]);

	const busy = pushing || pulling || syncing || publishing;
	const remote = selectedRemote || remotes[0]?.name;

	const wrap = useCallback(
		(
			setter: (v: boolean) => void,
			action: () => Promise<void>,
		) =>
			async () => {
				if (busy) return;
				setter(true);
				try {
					await action();
				} catch (err) {
					onError(
						err instanceof Error
							? err.message
							: 'Operation failed',
					);
				} finally {
					setter(false);
				}
			},
		[busy, onError],
	);

	const remotePicker =
		remotes.length > 1 ? (
			<div className="scm-remote-picker">
				<button
					type="button"
					className="scm-remote-trigger"
					onClick={() =>
						setRemoteMenuOpen((o) => !o)
					}
					title="Select remote"
				>
					<span>{remote}</span>
					<CaretDown size={10} weight="bold" />
				</button>
				{remoteMenuOpen && (
					<div className="scm-remote-menu">
						{remotes.map((r) => (
							<button
								key={r.name}
								type="button"
								className={`scm-remote-option${r.name === remote ? ' active' : ''}`}
								onClick={() => {
									onRemoteChange(r.name);
									setRemoteMenuOpen(false);
								}}
							>
								{r.name}
							</button>
						))}
					</div>
				)}
			</div>
		) : remotes.length === 1 ? (
			<span className="scm-remote-label">
				{remotes[0]!.name}
			</span>
		) : null;

	const manageRemotes = onManageRemotes ? (
		<button
			type="button"
			className="scm-manage-remotes"
			onClick={onManageRemotes}
		>
			Manage…
		</button>
	) : null;

	if (!hasUpstream) {
		return (
			<div className="scm-sync-bar">
				{remotePicker}
				{manageRemotes}
				<button
					type="button"
					className="scm-sync-button publish"
					disabled={busy}
					onClick={wrap(setPublishing, () =>
						onPublish(remote || 'origin'),
					)}
					title={`Publish branch "${branch}" to remote`}
				>
					{publishing ? (
						<CircleNotch
							size={13}
							className="scm-spinner"
						/>
					) : (
						<CloudArrowUp size={13} weight="bold" />
					)}
					<span>Publish Branch</span>
				</button>
			</div>
		);
	}

	return (
		<div className="scm-sync-bar">
			{remotePicker}
			{manageRemotes}
			<button
				type="button"
				className="scm-sync-button"
				disabled={busy || ahead === 0}
				onClick={wrap(setPushing, () =>
					onPush(remote),
				)}
				title={`Push ${ahead} commit${ahead !== 1 ? 's' : ''}`}
			>
				{pushing ? (
					<CircleNotch
						size={13}
						className="scm-spinner"
					/>
				) : (
					<ArrowUp size={13} weight="bold" />
				)}
				{ahead > 0 && (
					<span className="scm-sync-badge">
						{ahead}
					</span>
				)}
			</button>
			<button
				type="button"
				className="scm-sync-button"
				disabled={busy || behind === 0}
				onClick={wrap(setPulling, () =>
					onPull(remote),
				)}
				title={`Pull ${behind} commit${behind !== 1 ? 's' : ''}`}
			>
				{pulling ? (
					<CircleNotch
						size={13}
						className="scm-spinner"
					/>
				) : (
					<ArrowDown size={13} weight="bold" />
				)}
				{behind > 0 && (
					<span className="scm-sync-badge">
						{behind}
					</span>
				)}
			</button>
			<button
				type="button"
				className="scm-sync-button"
				disabled={busy}
				onClick={wrap(setSyncing, () =>
					onSync(remote),
				)}
				title="Fetch, pull, then push"
			>
				{syncing ? (
					<CircleNotch
						size={13}
						className="scm-spinner"
					/>
				) : (
					<ArrowsClockwise size={13} weight="bold" />
				)}
			</button>
		</div>
	);
}
