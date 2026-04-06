/**
 * Thin wrapper holding a reference to the single nav webview.
 */

export function createWorkspaceManager({ navWebview }) {
	return {
		getNavWebview() { return navWebview; },
	};
}
