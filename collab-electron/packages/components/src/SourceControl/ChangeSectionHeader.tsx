import React, { useState } from 'react';
import {
	CaretDown,
	Plus,
	Minus,
} from '@phosphor-icons/react';

interface ChangeSectionHeaderProps {
	title: string;
	count: number;
	actionIcon: 'stage' | 'unstage';
	onAction: () => void;
	children: React.ReactNode;
}

export function ChangeSectionHeader({
	title,
	count,
	actionIcon,
	onAction,
	children,
}: ChangeSectionHeaderProps) {
	const [collapsed, setCollapsed] = useState(false);

	if (count === 0) return null;

	const ActionIcon = actionIcon === 'stage' ? Plus : Minus;
	const actionTitle =
		actionIcon === 'stage' ? 'Stage All' : 'Unstage All';

	return (
		<>
			<div
				className="scm-section-header"
				onClick={() => setCollapsed((c) => !c)}
			>
				<span
					className={`scm-section-chevron${collapsed ? ' collapsed' : ''}`}
				>
					<CaretDown size={12} weight="bold" />
				</span>
				<span>{title}</span>
				<span className="scm-section-count">{count}</span>
				<button
					type="button"
					className="scm-section-action"
					title={actionTitle}
					onClick={(e) => {
						e.stopPropagation();
						onAction();
					}}
				>
					<ActionIcon size={14} />
				</button>
			</div>
			{!collapsed && children}
		</>
	);
}
