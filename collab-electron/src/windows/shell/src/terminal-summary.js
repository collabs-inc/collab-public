/**
 * Heuristic summary engine for terminal tile output.
 *
 * Takes ~100 lines of terminal output + metadata (cwd, foreground process,
 * pane title, other terminals) and produces three summary tiers:
 *   - detailed (50% zoom): 4-7 lines — full context
 *   - reduced  (25% zoom): 2-3 lines — key facts
 *   - compact  (badge):    1 line    — status word
 */

const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]|\x1b\].*?\x07|\x1b\(B/g;
const PROMPT_RE = /^[\$❯›%#>»]\s+|^\S+[\$#%]\s+|^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+[:\$#]\s*/;

function strip(text) {
	return (text || "").replace(ANSI_RE, "");
}

function shortPath(p) {
	if (!p) return "";
	const home = p.replace(/^\/Users\/\w+/, "~");
	const parts = home.split("/");
	if (parts.length <= 3) return home;
	return parts.slice(-2).join("/");
}

function projectName(cwd) {
	if (!cwd) return "";
	const parts = cwd.replace(/\/$/, "").split("/");
	return parts[parts.length - 1] || "";
}

function lastCommand(lines) {
	for (let i = lines.length - 1; i >= 0; i--) {
		if (PROMPT_RE.test(lines[i])) {
			return lines[i].replace(PROMPT_RE, "").trim();
		}
	}
	return null;
}

function recentMeaningful(lines, n = 4) {
	return lines
		.filter((l) => l.trim().length > 2 && !PROMPT_RE.test(l))
		.slice(-n)
		.map((l) => l.trim().slice(0, 80));
}

function findElapsed(lines) {
	for (let i = lines.length - 1; i >= 0; i--) {
		const m = lines[i].match(/\b(\d+(?:\.\d+)?)\s*(ms|s|sec|min|minutes?)\b/i);
		if (m) return m[0];
	}
	return null;
}

function countPattern(lines, re) {
	return lines.filter((l) => re.test(l)).length;
}

// ── Matchers ──

function matchTests(lines) {
	// Jest / Vitest style
	for (let i = lines.length - 1; i >= 0; i--) {
		const m = lines[i].match(/Tests?:\s*(\d+)\s*failed?,?\s*(\d+)\s*passed?,?\s*(\d+)\s*total/i)
			|| lines[i].match(/(\d+)\s*failing[,\s]*(\d+)\s*passing/i);
		if (!m) continue;

		const failed = parseInt(m[1], 10);
		const passed = parseInt(m[2], 10);
		const total = m[3] ? parseInt(m[3], 10) : failed + passed;
		const time = findElapsed(lines);

		const failFiles = [];
		const failNames = [];
		for (const l of lines) {
			const ff = l.match(/FAIL\s+(\S+)/);
			if (ff) failFiles.push(ff[1].split("/").slice(-2).join("/"));
			const fn = l.match(/[✗✕×●]\s+(.+)/);
			if (fn && failNames.length < 3) failNames.push(fn[1].trim().slice(0, 55));
		}

		const suites = lines.find((l) => /Test Suites?:/i.test(l));
		const suitesInfo = suites?.match(/(\d+)\s*failed.*?(\d+)\s*passed/i);

		if (failed > 0) {
			return {
				match: true, type: "test-fail", status: "error",
				detailed: [
					`${failed}/${total} tests failed`,
					...(suitesInfo ? [`${suitesInfo[1]} suite${+suitesInfo[1] > 1 ? "s" : ""} failing`] : []),
					...failFiles.slice(0, 2),
					...failNames.slice(0, 2).map((n) => `✗ ${n}`),
					...(time ? [`ran in ${time}`] : []),
				],
				reduced: [`✗ ${failed}/${total} failed`, failNames[0] ? `✗ ${failNames[0].slice(0, 35)}` : (failFiles[0] || "")],
				compact: `✗ ${failed} failed`,
			};
		}
		return {
			match: true, type: "test-pass", status: "success",
			detailed: [`All ${passed} tests passed`, ...(time ? [`in ${time}`] : [])],
			reduced: [`✓ ${passed}/${total} passed`],
			compact: `✓ All passed`,
		};
	}

	const passing = lines.find((l) => /(\d+)\s+passing/i.test(l));
	if (passing) {
		const n = passing.match(/(\d+)/)[1];
		return {
			match: true, type: "test-pass", status: "success",
			detailed: [`${n} tests passing`],
			reduced: [`✓ ${n} passing`],
			compact: `✓ ${n} passed`,
		};
	}
	return { match: false };
}

function matchBuildError(lines) {
	let count = 0;
	const files = [];
	const msgs = [];

	for (const l of lines) {
		const fc = l.match(/Found\s+(\d+)\s+error/i) || l.match(/(\d+)\s+error(?:s)?\s+generated/i);
		if (fc) count = Math.max(count, parseInt(fc[1], 10));

		const ef = l.match(/ERROR\s+in\s+(\S+)/i);
		if (ef) files.push(ef[1].split("/").pop());

		const ts = l.match(/error\s+TS(\d+):\s*(.+)/i);
		if (ts) msgs.push(`TS${ts[1]}: ${ts[2].slice(0, 50)}`);

		const syn = l.match(/SyntaxError:\s*(.+)/i);
		if (syn) msgs.push(syn[1].slice(0, 55));

		const mod = l.match(/Module not found:\s*(.+)/i);
		if (mod) msgs.push(`Missing: ${mod[1].slice(0, 50)}`);

		const ref = l.match(/ReferenceError:\s*(.+)/i);
		if (ref) msgs.push(ref[1].slice(0, 55));

		const typ = l.match(/TypeError:\s*(.+)/i);
		if (typ) msgs.push(typ[1].slice(0, 55));
	}

	if (!count && files.length) count = files.length;
	if (!count && msgs.length) count = msgs.length;
	if (!count) return { match: false };

	return {
		match: true, type: "build-error", status: "error",
		detailed: [
			`Build failed — ${count} error${count > 1 ? "s" : ""}`,
			...files.slice(0, 2).map((f) => `in ${f}`),
			...msgs.slice(0, 3),
		],
		reduced: [`⚠ ${count} error${count > 1 ? "s" : ""}`, msgs[0] || files[0] || ""],
		compact: `⚠ ${count} error${count > 1 ? "s" : ""}`,
	};
}

function matchBuildOk(lines) {
	const ok = lines.find((l) => /built\s+in|compiled\s+successfully|build\s+completed|✓\s+built/i.test(l));
	if (!ok) return { match: false };
	if (lines.some((l) => /error/i.test(l) && !/0\s+error/i.test(l) && !/no\s+error/i.test(l))) return { match: false };

	const time = findElapsed(lines);
	const sizes = lines
		.filter((l) => /\d+(\.\d+)?\s*(kB|KB|MB|bytes|B)\b/.test(l))
		.slice(0, 2)
		.map((l) => l.trim().slice(0, 60));
	const warns = countPattern(lines, /warning/i);

	return {
		match: true, type: "build-ok", status: "success",
		detailed: [
			`Build succeeded${time ? ` in ${time}` : ""}`,
			...(warns ? [`${warns} warning${warns > 1 ? "s" : ""}`] : []),
			...sizes,
		],
		reduced: [`✓ Built${time ? ` (${time})` : ""}`, ...(warns ? [`${warns} warning${warns > 1 ? "s" : ""}`] : [])],
		compact: "✓ Built",
	};
}

function matchServer(lines, ctx) {
	let port = null;
	let ready = false;
	let framework = null;
	let url = null;

	for (const l of lines) {
		const pm = l.match(/https?:\/\/localhost:(\d+)/) || l.match(/localhost:(\d+)/)
			|| l.match(/port\s+(\d+)/i) || l.match(/:\s*(\d{4,5})\/?[\s]*$/);
		if (pm) port = pm[1];

		const um = l.match(/(https?:\/\/localhost:\d+\S*)/);
		if (um) url = um[1];

		if (/ready\s+in|compiled|successfully|started|listening/i.test(l)) ready = true;
		if (/\bnext\b/i.test(l) && !framework) framework = "Next.js";
		if (/\bvite\b/i.test(l) && !framework) framework = "Vite";
		if (/\bwebpack\b/i.test(l) && !framework) framework = "Webpack";
		if (/\bnuxt\b/i.test(l) && !framework) framework = "Nuxt";
		if (/\bremix\b/i.test(l) && !framework) framework = "Remix";
		if (/\bexpress\b/i.test(l) && !framework) framework = "Express";
		if (/\bfastify\b/i.test(l) && !framework) framework = "Fastify";
		if (/\bhono\b/i.test(l) && !framework) framework = "Hono";
		if (/\bflask\b/i.test(l) && !framework) framework = "Flask";
		if (/\bdjango\b/i.test(l) && !framework) framework = "Django";
		if (/\brails\b/i.test(l) && !framework) framework = "Rails";
		if (/\belectron-vite\b/i.test(l)) framework = "Electron";
	}

	if (!port) return { match: false };

	const label = framework || "Server";
	const proj = projectName(ctx.cwd);
	const time = findElapsed(lines);
	const hmr = lines.some((l) => /hmr|hot\s+module|watching/i.test(l));

	return {
		match: true, type: "dev-server", status: "running",
		detailed: [
			`${label} — :${port}`,
			ready ? "Running" : "Starting…",
			...(hmr ? ["HMR active"] : []),
			...(proj ? [proj] : []),
			...(time ? [`ready in ${time}`] : []),
			...(url ? [url] : []),
		],
		reduced: [`● ${label} :${port}`, proj || (ready ? "Running" : "Starting…")],
		compact: `● :${port}`,
	};
}

function matchGit(lines) {
	const branchLine = lines.find((l) => /On branch\s+/.test(l));
	const branch = branchLine?.match(/On branch\s+(\S+)/)?.[1];

	const modified = lines.filter((l) => /^\s+modified:/.test(l));
	const added = lines.filter((l) => /^\s+new file:/.test(l));
	const deleted = lines.filter((l) => /^\s+deleted:/.test(l));
	const untracked = lines.some((l) => /Untracked files/i.test(l));
	const conflict = lines.some((l) => /CONFLICT|both modified|Unmerged/i.test(l));
	const aheadM = lines.find((l) => /ahead.*?(\d+)/i.test(l))?.match(/ahead.*?(\d+)/i);
	const behindM = lines.find((l) => /behind.*?(\d+)/i.test(l))?.match(/behind.*?(\d+)/i);
	const clean = lines.some((l) => /nothing to commit|working tree clean/i.test(l));

	const total = modified.length + added.length + deleted.length;
	if (!branch && total === 0 && !conflict && !clean) return { match: false };

	if (conflict) {
		const conflictFiles = lines
			.filter((l) => /both modified/i.test(l))
			.map((l) => l.split(":").pop()?.trim()?.split("/").pop())
			.filter(Boolean);
		return {
			match: true, type: "git-conflict", status: "error",
			detailed: ["Merge conflict", ...(branch ? [`on ${branch}`] : []), ...conflictFiles.slice(0, 3)],
			reduced: ["⚠ Merge conflict", branch || ""],
			compact: "⚠ Conflict",
		};
	}

	const changedNames = [...modified, ...added, ...deleted]
		.map((l) => l.split(":").pop()?.trim()?.split("/").pop())
		.filter(Boolean)
		.slice(0, 4);

	if (total > 0 || untracked) {
		const parts = [];
		if (modified.length) parts.push(`${modified.length} modified`);
		if (added.length) parts.push(`${added.length} added`);
		if (deleted.length) parts.push(`${deleted.length} deleted`);
		if (untracked) parts.push("+ untracked");

		return {
			match: true, type: "git-dirty", status: "info",
			detailed: [
				branch || "git",
				parts.join(", "),
				...changedNames,
				...(aheadM ? [`↑ ${aheadM[1]} to push`] : []),
				...(behindM ? [`↓ ${behindM[1]} behind`] : []),
			],
			reduced: [branch || "git", `${total} file${total > 1 ? "s" : ""} changed`],
			compact: `${total} changed`,
		};
	}

	if (clean && branch) {
		return {
			match: true, type: "git-clean", status: "success",
			detailed: [
				branch,
				"Working tree clean",
				...(aheadM ? [`↑ ${aheadM[1]} commit${+aheadM[1] > 1 ? "s" : ""} to push`] : []),
			],
			reduced: [branch, "✓ Clean"],
			compact: branch.length > 14 ? branch.slice(0, 14) + "…" : branch,
		};
	}

	if (branch) {
		return {
			match: true, type: "git-branch", status: "info",
			detailed: [branch, ...(aheadM ? [`↑ ${aheadM[1]} ahead`] : [])],
			reduced: [branch],
			compact: branch.length > 14 ? branch.slice(0, 14) + "…" : branch,
		};
	}
	return { match: false };
}

function matchGitDiff(lines) {
	const diffs = lines.filter((l) => /^diff --git/.test(l));
	if (!diffs.length) return { match: false };

	const insertions = countPattern(lines, /^\+[^+]/);
	const deletions = countPattern(lines, /^-[^-]/);
	const fileNames = diffs.map((l) => l.match(/b\/(\S+)/)?.[1]?.split("/").pop()).filter(Boolean);

	return {
		match: true, type: "git-diff", status: "info",
		detailed: [
			`Diff: ${diffs.length} file${diffs.length > 1 ? "s" : ""}`,
			`+${insertions} -${deletions}`,
			...fileNames.slice(0, 3),
		],
		reduced: [`${diffs.length} files diffed`, `+${insertions} -${deletions}`],
		compact: `+${insertions} -${deletions}`,
	};
}

function matchGitLog(lines) {
	const commits = lines.filter((l) => /^[a-f0-9]{7,40}\s/.test(l));
	if (commits.length < 2) return { match: false };

	const msgs = commits.slice(0, 4).map((c) => {
		const m = c.match(/^[a-f0-9]+\s+(.+)/);
		return m ? m[1].trim().slice(0, 50) : c.slice(0, 50);
	});

	return {
		match: true, type: "git-log", status: "info",
		detailed: [`${commits.length} commits`, ...msgs],
		reduced: [msgs[0] || `${commits.length} commits`],
		compact: `${commits.length} commits`,
	};
}

function matchInstall(lines) {
	const done = lines.find((l) => /added\s+\d+\s+package/i.test(l));
	if (done) {
		const n = done.match(/(\d+)/)[1];
		const time = findElapsed(lines);
		const audits = lines.find((l) => /vulnerabilit/i.test(l));
		const auditInfo = audits?.match(/(\d+)\s+vulnerabilit/i)?.[1];
		return {
			match: true, type: "install-done", status: "success",
			detailed: [
				`Installed ${n} packages`,
				...(time ? [`in ${time}`] : []),
				...(auditInfo ? [`${auditInfo} vulnerabilities found`] : []),
			],
			reduced: [`✓ ${n} packages installed`],
			compact: "✓ Installed",
		};
	}
	if (lines.some((l) => /npm\s+(warn|info)|resolving|bun\s+install|installing/i.test(l))) {
		return {
			match: true, type: "install-wip", status: "running",
			detailed: ["Installing dependencies…"],
			reduced: ["Installing…"],
			compact: "Installing…",
		};
	}
	return { match: false };
}

function matchPrompt(lines) {
	const tail = lines.filter((l) => l.trim()).slice(-6);
	for (const l of tail) {
		if (/\(y\/n\)/i.test(l) || /\(yes\/no\)/i.test(l)) {
			return {
				match: true, type: "prompt-yn", status: "warning",
				detailed: ["Waiting for confirmation", l.trim().slice(0, 60)],
				reduced: ["Needs input", l.trim().slice(0, 40)],
				compact: "? Confirm",
			};
		}
		if (/\?\s+\S/.test(l) && /[\(\[]/.test(l)) {
			return {
				match: true, type: "prompt-choice", status: "warning",
				detailed: ["Waiting for selection", l.trim().slice(0, 60)],
				reduced: ["Needs input", l.trim().slice(0, 40)],
				compact: "? Choose",
			};
		}
		if (/Enter.*to\s+continue|Press\s+.*to/i.test(l)) {
			return {
				match: true, type: "prompt-key", status: "warning",
				detailed: ["Waiting for keypress", l.trim().slice(0, 60)],
				reduced: ["Needs input"],
				compact: "? Input",
			};
		}
		if (/password|passphrase/i.test(l)) {
			return {
				match: true, type: "prompt-password", status: "warning",
				detailed: ["Waiting for password"],
				reduced: ["Password required"],
				compact: "🔒 Password",
			};
		}
	}
	return { match: false };
}

function matchDocker(lines) {
	if (lines.some((l) => /Successfully built|Successfully tagged/i.test(l))) {
		const tag = lines.find((l) => /tagged/i.test(l))?.match(/tagged\s+(\S+)/)?.[1];
		return {
			match: true, type: "docker-built", status: "success",
			detailed: ["Docker image built", ...(tag ? [tag] : [])],
			reduced: ["✓ Image built", ...(tag ? [tag] : [])],
			compact: "✓ Built",
		};
	}
	if (lines.some((l) => /container.*started|up\s+\d+/i.test(l))) {
		const containers = lines.filter((l) => /\s+up\s+/i.test(l)).length;
		return {
			match: true, type: "docker-up", status: "running",
			detailed: [`${containers || "?"} container${containers !== 1 ? "s" : ""} running`],
			reduced: ["Containers up"],
			compact: "● Docker",
		};
	}
	return { match: false };
}

function matchSSH(lines, ctx) {
	const fg = ctx.foreground || "";
	if (!/ssh/i.test(fg)) return { match: false };
	const host = fg.match(/ssh\s+(?:\S+@)?(\S+)/i)?.[1] || "remote";
	const welcome = lines.find((l) => /welcome|last login|ubuntu|debian|centos/i.test(l));
	return {
		match: true, type: "ssh", status: "running",
		detailed: [`SSH → ${host}`, ...(welcome ? [welcome.trim().slice(0, 55)] : [])],
		reduced: [`SSH → ${host}`],
		compact: `→ ${host.split(".")[0].slice(0, 12)}`,
	};
}

function matchProcess(lines, ctx) {
	const fg = ctx.foreground || "";
	if (!fg || /^(zsh|bash|fish|sh|login)$/.test(fg)) return { match: false };

	const cmd = lastCommand(lines);
	const recent = recentMeaningful(lines, 3);
	const time = findElapsed(lines);
	const proj = projectName(ctx.cwd);

	const exitLine = lines.find((l) => /exit\s*(code|status)?\s*(\d+)/i.test(l));
	const exitCode = exitLine?.match(/(\d+)/)?.[1];

	const isEditor = /vim|nvim|nano|emacs|micro|helix/i.test(fg);
	if (isEditor) {
		const file = cmd?.match(/\S+$/)?.[0]?.split("/").pop() || "";
		return {
			match: true, type: "editor", status: "running",
			detailed: [`Editing${file ? `: ${file}` : ""}`, proj || shortPath(ctx.cwd)],
			reduced: [fg, file || ""],
			compact: file ? file.slice(0, 14) : fg,
		};
	}

	let label = cmd || fg;
	if (label.length > 60) label = label.slice(0, 57) + "…";

	return {
		match: true, type: "process", status: exitCode ? (exitCode === "0" ? "success" : "error") : "running",
		detailed: [
			label,
			...(proj ? [proj] : []),
			...recent,
			...(time ? [`elapsed: ${time}`] : []),
			...(exitCode ? [`exit ${exitCode}`] : []),
		],
		reduced: [
			label.slice(0, 40),
			recent.length > 0 ? recent[recent.length - 1] : "",
		],
		compact: exitCode
			? (exitCode === "0" ? "✓ Done" : `✗ exit ${exitCode}`)
			: (cmd || fg).split(/\s/)[0].slice(0, 14),
	};
}

// ── Cross-terminal enrichment ──

function enrich(result, ctx) {
	if (!ctx.otherTerminals?.length) return result;
	const detailed = [...result.detailed];

	for (const other of ctx.otherTerminals) {
		if (!other.summary) continue;
		if (result.type === "test-fail" && other.summary.type === "build-error")
			detailed.push("→ Likely blocked by build errors");
		if (result.type === "dev-server" && other.summary.type === "dev-server") {
			const p = other.summary.compact?.match(/:(\d+)/)?.[1];
			if (p) detailed.push(`Also: :${p}`);
		}
		if (result.type === "idle") {
			if (other.summary.status === "error") {
				const act = other.summary.type.includes("build") ? "Fix build errors"
					: other.summary.type.includes("test") ? "Fix failing tests"
					: other.summary.type.includes("conflict") ? "Resolve merge conflict"
					: null;
				if (act && !detailed.includes(`→ ${act}`)) detailed.push(`→ ${act}`);
			}
		}
	}
	return { ...result, detailed };
}

// ── Idle / fallback ──

function idle(lines, ctx) {
	const dir = shortPath(ctx.cwd);
	const proj = projectName(ctx.cwd);
	const cmd = lastCommand(lines);
	const recent = recentMeaningful(lines, 3);

	const actions = [];
	for (const o of ctx.otherTerminals || []) {
		if (!o.summary) continue;
		if (o.summary.type === "build-error") actions.push("→ Fix build errors");
		else if (o.summary.type === "test-fail") actions.push("→ Fix failing tests");
		else if (o.summary.type === "git-conflict") actions.push("→ Resolve conflict");
	}

	const detailed = [proj || "Idle"];
	if (dir && dir !== proj) detailed.push(dir);
	if (cmd) detailed.push(`$ ${cmd.slice(0, 55)}`);
	for (const r of recent.slice(-2)) detailed.push(r);
	for (const a of actions.slice(0, 2)) detailed.push(a);

	const reduced = [proj || "Idle"];
	if (cmd) reduced.push(`$ ${cmd.slice(0, 35)}`);
	else if (dir) reduced.push(dir);
	if (actions[0]) reduced.push(actions[0]);

	return {
		match: true, type: "idle", status: actions.length ? "warning" : "idle",
		detailed,
		reduced,
		compact: actions.length
			? actions[0].replace("→ ", "").slice(0, 16)
			: (cmd ? `$ ${cmd.split(/\s/)[0]}` : (proj || "Idle")),
	};
}

// ── Main ──

const matchers = [
	matchPrompt,
	matchTests,
	matchBuildError,
	matchBuildOk,
	matchServer,
	matchGit,
	matchGitDiff,
	matchGitLog,
	matchInstall,
	matchDocker,
	matchSSH,
	matchProcess,
];

/**
 * @param {string} terminalOutput
 * @param {{ foreground?: string, shell?: string, cwd?: string, title?: string,
 *           otherTerminals?: Array<{ foreground?: string, cwd?: string, summary?: object }> }} ctx
 * @returns {{ type: string, status: string, detailed: string[], reduced: string[], compact: string }}
 */
export function generateSummary(terminalOutput, ctx = {}) {
	const clean = strip(terminalOutput);
	const lines = clean.split("\n").filter((l) => l.trim());
	const fg = ctx.foreground || "";
	const shell = ctx.shell ? ctx.shell.split("/").pop() : "zsh";
	const isIdle = !fg || fg === shell;

	for (const m of matchers) {
		const r = m(lines, ctx);
		if (r.match) return enrich(r, ctx);
	}

	if (isIdle) return enrich(idle(lines, ctx), ctx);

	const cmd = lastCommand(lines);
	const recent = recentMeaningful(lines, 3);
	const proj = projectName(ctx.cwd);

	return {
		type: "unknown", status: "running",
		detailed: [
			fg,
			...(proj ? [proj] : []),
			...(cmd ? [`$ ${cmd.slice(0, 55)}`] : []),
			...recent,
		],
		reduced: [fg, recent.length ? recent[recent.length - 1] : ""],
		compact: fg.split(/\s/)[0].slice(0, 14),
	};
}
