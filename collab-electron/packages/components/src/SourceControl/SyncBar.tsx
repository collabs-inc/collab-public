import React, { useCallback, useState } from 'react';
import {
	ArrowUp,
	ArrowDown,
	ArrowsClockwise,
	CloudArrowUp,
	CircleNotch,
} from '@phosphor-icons/react';

interface SyncBarProps {
	ahead: number;
	behind: number;
	hasUpstream: boolean;
	branch: string;
	onPush: () => Promise<void>;
	onPull: () => Promise<void>;
	onSync: () => Promise<void>;
	onPublish: () => Promise<void>;
	onError: (msg: string) => void;
}

export function SyncBar({
	ahead,
	behind,
	hasUpstream,
	branch,
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

	const busy = pushing || pulling || syncing || publishing;

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

	if (!hasUpstream) {
		return (
			<div className="scm-sync-bar">
				<button
					type="button"
					className="scm-sync-button publish"
					disabled={busy}
					onClick={wrap(setPublishing, onPublish)}
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
			<button
				type="button"
				className="scm-sync-button"
				disabled={busy || ahead === 0}
				onClick={wrap(setPushing, onPush)}
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
				onClick={wrap(setPulling, onPull)}
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
				onClick={wrap(setSyncing, onSync)}
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
