#!/usr/bin/env node
// Rebuild htdocs/.../7rules/sets.json: every Clash rule set in blackmatrix7/ios_rule_script,
// which file to use, its size, and the Chinese search words from aliases.txt.
// Entry: [name, file, kb, label?, words?]  file: 0 N_No_Resolve.yaml 1 N.yaml 2 N_Classical_No_Resolve.yaml 3 N_Classical.yaml
import { readFileSync, writeFileSync } from 'node:fs';

const here = new URL('.', import.meta.url);
const out = new URL('../htdocs/luci-static/resources/7rules/sets.json', here);
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const res = await fetch('https://api.github.com/repos/blackmatrix7/ios_rule_script/git/trees/master?recursive=1',
	{ headers: token ? { authorization: `Bearer ${token}` } : {} });
if (!res.ok) throw new Error(`GitHub API: ${res.status}`);
const tree = await res.json();
if (tree.truncated) throw new Error('tree truncated');

const dirs = {};
for (const { path, type, size } of tree.tree) {
	const p = path.split('/');
	if (type == 'blob' && p.length == 4 && p[0] == 'rule' && p[1] == 'Clash') (dirs[p[2]] ??= {})[p[3]] = size;
}

const words = {};
for (const line of readFileSync(new URL('aliases.txt', here), 'utf8').split('\n')) {
	const [ name, label, ...rest ] = line.trim().split(/\s+/);
	if (name && name[0] != '#') words[name] = [ label == '-' ? '' : label, rest.join(' ') ];
}

const FILES = [ '_No_Resolve.yaml', '.yaml', '_Classical_No_Resolve.yaml', '_Classical.yaml' ];
const sets = [];
for (const name of Object.keys(dirs).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))) {
	const f = dirs[name];
	// Big sets keep only a stub in N.yaml; their full list is the _Classical file.
	const order = f[name + '_Classical.yaml'] ? [ 2, 3 ] : [ 0, 1 ];
	const v = order.find(i => f[name + FILES[i]] != null);
	if (v == null) continue;
	const e = [ name, v, Math.max(1, Math.round(f[name + FILES[v]] / 1024)), ...(words[name] || []) ];
	while (e.length > 3 && !e[e.length - 1]) e.pop();
	sets.push(e);
}
for (const n in words) if (!dirs[n]) console.warn(`aliases.txt: ${n} is not in the repo any more`);

// Keep the old date when nothing changed, so the file (and the package) stays byte-identical.
let old = {};
try { old = JSON.parse(readFileSync(out, 'utf8')); } catch (e) {}
const t = JSON.stringify(old.s) == JSON.stringify(sets) ? old.t : new Date().toISOString().slice(0, 10);
writeFileSync(out, JSON.stringify({ t, s: sets }) + '\n');
console.log(`${sets.length} rule sets -> ${out.pathname}`);
