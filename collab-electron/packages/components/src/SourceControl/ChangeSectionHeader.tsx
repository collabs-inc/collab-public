import React, { useState } from 'react';
import {
	CaretDown,
	Plus,
	Minus,
	Trash,
} from '@phosphor-icons/react';

interface ChangeSectionHeaderProps {
	title: string;
	count: number;
	actionIcon?: 'stage' | 'unstage';
	onAction?: () => void;
	secondaryActionIcon?: 'discard';
	onSecondaryAction?: () => void;
	children: React.ReactNode;
}

export function ChangeSectionHeader({
	title,
	count,
	actionIcon,
	onAction,
	secondaryActionIcon,
	onSecondaryAction,
	children,
}: ChangeSectionHeaderProps) {
	const [collapsed, setCollapsed] = useState(false);

	if (count === 0) return null;

	const ActionIcon =
		actionIcon === 'stage'
			? Plus
			: actionIcon === 'unstage'
				? Minus
				: null;
	const actionTitle =
		actionIcon === 'stage'
			? 'Stage All'
			: actionIcon === 'unstage'
				? 'Unstage All'
				: '';

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
				{secondaryActionIcon === 'discard' &&
					onSecondaryAction && (
						<button
							type="button"
							className="scm-section-action discard"
							title="Discard All Changes"
							onClick={(e) => {
								e.stopPropagation();
								onSecondaryAction();
							}}
						>
							<Trash size={14} />
						</button>
					)}
				{ActionIcon && onAction && (
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
				)}
			</div>
			{!collapsed && children}
		</>
	);
}
