import React, {
	useCallback,
	useEffect,
	useState,
} from 'react';
import { X, ArrowsOutSimple } from '@phosphor-icons/react';

interface DiffViewProps {
	filePath: string;
	relativePath: string;
	cached: boolean;
	onClose: () => void;
	onOpenFile: (path: string) => void;
}

interface DiffLine {
	type: 'add' | 'remove' | 'context' | 'header' | 'meta';
	content: string;
}

function parseDiff(raw: string): DiffLine[] {
	const lines: DiffLine[] = [];
	for (const line of raw.split('\n')) {
		if (
			line.startsWith('@@') ||
			line.startsWith('diff ') ||
			line.startsWith('index ')
		) {
			lines.push({ type: 'header', content: line });
		} else if (
			line.startsWith('---') ||
			line.startsWith('+++')
		) {
			lines.push({ type: 'meta', content: line });
		} else if (line.startsWith('+')) {
			lines.push({ type: 'add', content: line });
		} else if (line.startsWith('-')) {
			lines.push({ type: 'remove', content: line });
		} else {
			lines.push({ type: 'context', content: line });
		}
	}
	return lines;
}

export function DiffView({
	filePath,
	relativePath,
	cached,
	onClose,
	onOpenFile,
}: DiffViewProps) {
	const [diff, setDiff] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		setLoading(true);
		window.api
			.gitDiff(relativePath, cached)
			.then((result) => {
				setDiff(result);
				setLoading(false);
			})
			.catch(() => {
				setDiff('');
				setLoading(false);
			});
	}, [relativePath, cached]);

	if (loading) {
		return (
			<div className="scm-diff-container">
				<div className="scm-diff-header">
					<span className="scm-diff-title">
						Loading...
					</span>
				</div>
			</div>
		);
	}

	if (!diff) {
		return (
			<div className="scm-diff-container">
				<div className="scm-diff-header">
					<span className="scm-diff-title">
						{relativePath}
					</span>
					<button
						type="button"
						className="scm-diff-close"
						onClick={onClose}
					>
						<X size={14} />
					</button>
				</div>
				<div className="scm-diff-empty">
					No differences found
				</div>
			</div>
		);
	}

	const lines = parseDiff(diff);

	return (
		<div className="scm-diff-container">
			<div className="scm-diff-header">
				<span className="scm-diff-title">
					{relativePath}
				</span>
				<div className="scm-diff-header-actions">
					<button
						type="button"
						className="scm-diff-action"
						title="Open file"
						onClick={() => onOpenFile(filePath)}
					>
						<ArrowsOutSimple size={14} />
					</button>
					<button
						type="button"
						className="scm-diff-action"
						title="Close diff"
						onClick={onClose}
					>
						<X size={14} />
					</button>
				</div>
			</div>
			<div className="scm-diff-content">
				{lines.map((line, i) => (
					<div
						key={i}
						className={`scm-diff-line scm-diff-${line.type}`}
					>
						<span className="scm-diff-line-text">
							{line.content || ' '}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}
