'use strict';
'require view';
'require fs';
'require uci';
'require ui';

/* 分流规则: paste a subscription, make groups, decide what goes where.
   The page writes one complete config for OpenClash and switches OpenClash to it when you apply.
   Nothing runs in the background; the router only works when a button is pressed. */

const ZH = /^zh/i.test(document.documentElement.lang || '');
const T = (zh, en) => ZH ? zh : en;
const CONF = '/etc/openclash/config/7rules.yaml';
const DRAFT = '/tmp/7rules.yaml';
const FETCH = '/usr/libexec/7rules-fetch';
const APPLY = '/usr/libexec/7rules-apply';
const CACHE = i => `/etc/openclash/proxy_provider/7rules-${i + 1}.yaml`;
const TAG = '# 7rules: ';
const MINE = '7r-';                    // prefix of the rule sets this page owns
const PROBE = 'https://www.gstatic.com/generate_204';
const JUNK = '剩余|到期|过期|官网|Expire|Traffic|Remaining';   // info lines airports list as nodes
const REPO = 'blackmatrix7/ios_rule_script';
const MIRRORS = [
	[ 'jsDelivr', p => `https://cdn.jsdelivr.net/gh/${REPO}@master/rule/Clash/${p}` ],
	[ 'jsDelivr Fastly', p => `https://fastly.jsdelivr.net/gh/${REPO}@master/rule/Clash/${p}` ],
	[ 'GitHub', p => `https://raw.githubusercontent.com/${REPO}/master/rule/Clash/${p}` ]
];
const FILES = [ '_No_Resolve.yaml', '.yaml', '_Classical_No_Resolve.yaml', '_Classical.yaml' ];
const BUILTIN = [ 'DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE', 'GLOBAL' ];
const POPULAR = [ 'OpenAI', 'Claude', 'Gemini', 'YouTube', 'Netflix', 'Google', 'Telegram', 'GitHub', 'Twitter', 'Spotify', 'Steam', 'TikTok', 'Apple', 'Microsoft' ];
const BIG = 512;                       // KB; bigger sets cost the router noticeable memory
// Plain alternations only, so the same pattern works in JS here and in the core's filter.
const REGIONS = [
	[ 'hk', T('香港', 'Hong Kong'), '港|HK|Hong ?Kong|🇭🇰' ],
	[ 'tw', T('台湾', 'Taiwan'), '台|TW|Taiwan|Taipei|🇹🇼' ],
	[ 'jp', T('日本', 'Japan'), '日本|JP|Japan|东京|大阪|Tokyo|Osaka|🇯🇵' ],
	[ 'sg', T('新加坡', 'Singapore'), '新加坡|狮城|SG|Singapore|🇸🇬' ],
	[ 'us', T('美国', 'US'), '美|US|United States|America|洛杉矶|硅谷|纽约|Los Angeles|San Jose|Silicon|Seattle|New York|Dallas|Chicago|🇺🇸' ],
	[ 'kr', T('韩国', 'Korea'), '韩|KR|Korea|首尔|Seoul|🇰🇷' ],
	[ 'uk', T('英国', 'UK'), '英国|UK|United Kingdom|London|🇬🇧' ],
	[ 'de', T('德国', 'Germany'), '德国|DE|Germany|Frankfurt|🇩🇪' ]
].map(([ key, name, re ]) => ({ key, name, re, rx: new RegExp(re) }));
const REG = new Map(REGIONS.map(r => [ r.key, r ]));
const TYPES = [ [ 'select', T('手动选', 'Pick') ], [ 'url-test', T('自动选最快', 'Fastest') ], [ 'fallback', T('按顺序备用', 'Failover') ] ];
const STEPS = [ T('订阅', 'Subscription'), T('分组', 'Groups'), T('规则', 'Rules') ];
const still = matchMedia('(prefers-reduced-motion: reduce)');
const glide = (el, from, ms = 180) => still.matches || el.animate(from, { duration: ms, easing: 'cubic-bezier(.2,.7,.2,1)' });

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const q = s => `'${String(s).replace(/'/g, "''")}'`;
const reEsc = s => s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
const clean = s => String(s).replace(/[,'"#\n]/g, '').trim().slice(0, 32);
const svg = d => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const IC = {
	grip: svg('M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01'),
	x: svg('M6 6l12 12M18 6 6 18'),
	plus: svg('M12 5v14M5 12h14'),
	check: svg('m5 12.5 4.5 4.5L19 7.5'),
	next: svg('m9 6 6 6-6 6'),
	down: svg('M12 4v11m-5-5 5 5 5-5M5 20h14'),
	site: svg('M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-9 9h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z'),
	dev: svg('M7 3h10a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm4 15h2'),
	ip: svg('M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Zm0-9a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z'),
	other: svg('m8 8-4 4 4 4m8-8 4 4-4 4'),
	rest: svg('M5 12h.01M12 12h.01M19 12h.01'),
	back: svg('m15 6-6 6 6 6'),
	search: svg('m20 20-4.5-4.5M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z'),
	select: svg('M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01'),
	'url-test': svg('M13 3 4 14h7l-1 7 9-11h-7l1-7Z'),
	fallback: svg('m12 3 9 5-9 5-9-5 9-5Zm-9 10 9 5 9-5')
};

/* ---------- reading YAML (just enough of it, line by line) ---------- */

function unq(s) {
	s = s.trim();
	if (s[0] == "'") return s.slice(1, -1).replace(/''/g, "'");
	if (s[0] == '"') try { return JSON.parse(s); } catch (e) { return s.slice(1, -1); }
	return s;
}
// "value  # note" -> [ value, note ]; quoted values may hold a '#'
function split(s) {
	s = s.trim();
	const i = s[0] == "'" || s[0] == '"' ? s.indexOf(s[0], 1) : -1;
	const m = s.slice(i + 1).match(/\s+#\s?(.*)$/);
	return m ? [ unq(s.slice(0, i + 1 + m.index)), m[1].trim() ] : [ unq(s), '' ];
}

// Lines of a top-level YAML key (until the next top-level key).
function block(text, key) {
	const out = [];
	let on = false;
	for (const l of text.split('\n')) {
		if (/^[^\s#-]/.test(l)) on = new RegExp(`^['"]?${key}['"]?\\s*:`).test(l);
		else if (on) out.push(l);
	}
	return out;
}

// Names under proxies, block or flow style (the core caches providers as JSON-ish flow lines).
function names(text, key) {
	const out = [];
	let dash = null, col = null;           // indent of the list's dashes, column of an item's keys
	for (const l of block(text, key)) {
		if (/^\s*#/.test(l)) continue;
		const d = l.match(/^(\s*)-\s+/);
		if (d && (dash == null || d[1].length == dash)) { dash = d[1].length; col = d[0].length; }
		const f = l.match(/^\s*-\s*\{(.*)\}\s*$/);
		const n = f ? f[1].match(/(?:^|,)\s*["']?name["']?\s*:\s*('[^']*'|"[^"]*"|[^,]+)/) : l.match(/^(\s*(?:-\s+)?)name\s*:\s*(.*)$/);
		if (f ? n : n && n[1].length == col) out.push(split(f ? n[1] : n[2])[0]);
	}
	return out;
}

const b64 = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '')), c => c.charCodeAt(0)));

// Node names in a subscription: Clash YAML, or (base64 of) share links. null = not a subscription.
function nodesOf(text) {
	if (/^proxies\s*:/m.test(text)) return names(text, 'proxies');
	let t = text.trim();
	if (!/:\/\//.test(t)) try { t = b64(t); } catch (e) { return null; }
	const out = [];
	for (const l of t.split(/\r?\n/)) {
		const m = l.trim().match(/^([a-z0-9]+):\/\/(.+)$/i);
		if (!m) continue;
		if (m[1].toLowerCase() == 'vmess') { try { out.push(JSON.parse(b64(m[2])).ps); } catch (e) {} continue; }
		const h = m[2].indexOf('#');
		if (h >= 0) try { out.push(decodeURIComponent(m[2].slice(h + 1))); } catch (e) { out.push(m[2].slice(h + 1)); }
	}
	return out.length ? out : null;
}

const size = b => b >= 2 ** 40 ? (b / 2 ** 40).toFixed(1) + ' TB' : (b / 2 ** 30).toFixed(b >= 10 * 2 ** 30 ? 0 : 1) + ' GB';
// "upload=1; download=2; total=3; expire=4" -> "已用 3 GB / 100 GB · 2026-12-01 到期"
function quota(h) {
	const m = (h.match(/subscription-userinfo:[^\n]*/gi) || []).pop();
	if (!m) return '';
	const v = {};
	m.replace(/(\w+)=(\d+)/g, (_, k, n) => v[k] = +n);
	const out = [];
	if (v.total) out.push(T(`已用 ${size((v.upload || 0) + (v.download || 0))} / ${size(v.total)}`, `${size((v.upload || 0) + (v.download || 0))} of ${size(v.total)} used`));
	if (v.expire) out.push(T(`${new Date(v.expire * 1000).toLocaleDateString()} 到期`, `expires ${new Date(v.expire * 1000).toLocaleDateString()}`));
	return out.join(' · ');
}

/* ---------- rules ---------- */

function rule(raw, note) {
	const p = raw.split(',').map(s => s.trim());
	let t = p.length - 1;
	if (t > 1 && /^(no-resolve|src)$/i.test(p[t])) t--;
	const r = { type: p[0].toUpperCase(), value: p.slice(1, t).join(','), target: p[t] || 'DIRECT', tail: p.slice(t + 1), note: note || '' };
	r.kind = r.type == 'RULE-SET' && r.value.startsWith(MINE) ? 'set'
		: /^DOMAIN(-SUFFIX|-KEYWORD)?$/.test(r.type) ? 'site'
		: r.type == 'SRC-IP-CIDR' && /\/32$/.test(r.value) ? 'dev'
		: /^IP-CIDR6?$/.test(r.type) ? 'ip'
		: r.type == 'GEOIP' ? 'geo' : 'other';
	return r;
}
const line = r => [ r.type, ...(r.value ? [ r.value ] : []), r.target, ...r.tail ].join(',');

// What a new setup starts with: a main group, a fastest-node group, AI and streaming, and the usual rules.
function starter() {
	const [ main, auto, ai, media ] = ZH ? [ '节点选择', '自动选择', 'AI', '流媒体' ] : [ 'Proxy', 'Auto', 'AI', 'Streaming' ];
	return {
		subs: [ '' ],
		groups: [
			{ name: main, type: 'select', m: [ 'g:' + auto, '*' ] },
			{ name: auto, type: 'url-test', m: [ '*' ] },
			{ name: ai, type: 'select', m: [ 'g:' + main, '*' ] },
			{ name: media, type: 'select', m: [ 'g:' + main, '*' ] }
		],
		rules: [ [ 'RULE-SET,7r-Lan,DIRECT' ], [ `RULE-SET,7r-OpenAI,${ai}` ], [ `RULE-SET,7r-Claude,${ai}` ], [ `RULE-SET,7r-Gemini,${ai}` ],
			[ `RULE-SET,7r-YouTube,${media}` ], [ `RULE-SET,7r-Netflix,${media}` ], [ 'GEOIP,CN,DIRECT' ] ],
		final: main,
		mirror: 0
	};
}

function stateOf(conf) {
	const l = conf.split('\n').find(l => l.startsWith(TAG));
	try { return l && JSON.parse(l.slice(TAG.length)); } catch (e) { return null; }
}

return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	load() {
		const css = new Promise(ok => {
			if (document.querySelector('link[data-7rules]')) return ok();
			const l = document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: L.resource('7rules/rules.css') }));
			l.setAttribute('data-7rules', '');
			l.onload = l.onerror = ok;
		});
		return Promise.all([
			uci.load('openclash').catch(() => null),
			uci.load('dhcp').catch(() => null),
			fs.read(CONF).catch(() => ''),
			fs.read('/tmp/dhcp.leases').catch(() => ''),
			fetch(L.resource('7rules/sets.json'), { cache: 'no-cache' }).then(r => r.json()).catch(() => ({ s: [] })),
			css
		]).then(async ([ oc, , conf, leases, sets ]) => {
			const st = stateOf(conf);
			// After OpenClash has run once, the core keeps a copy of each subscription: node names for free.
			const cached = st ? await Promise.all(st.subs.map((u, i) => fs.read(CACHE(i)).catch(() => ''))) : [];
			return [ oc, st, leases, sets, cached ];
		});
	},

	render([ oc, st, leases, sets, cached ]) {
		const root = document.createElement('div');
		root.className = 'sr';
		this.root = root;
		if (!oc) {
			root.innerHTML = `<div class="sr-empty"><b>${T('没有找到 OpenClash', 'OpenClash is not installed')}</b><p>${T('这个页面为 OpenClash 生成配置，请先安装 OpenClash。', 'This page builds a config for OpenClash. Install OpenClash first.')}</p></div>`;
			return root;
		}

		this.sets = new Map(sets.s.map(e => [ e[0], { name: e[0], file: e[1], kb: e[2], label: e[3] || '', words: (e[0] + ' ' + (e[3] || '') + ' ' + (e[4] || '')).toLowerCase() } ]));
		this.devices = leases.split('\n').map(l => l.split(' ')).filter(p => p[2] && p[2].includes('.'))
			.map(p => ({ ip: p[2], mac: p[1], name: p[3] && p[3] != '*' ? p[3] : '' }));
		this.fixed = new Set(uci.sections('dhcp', 'host').map(s => s.ip).filter(Boolean));
		this.ocSubs = uci.sections('openclash', 'config_subscribe').filter(s => /^https?:\/\//.test(s.address || ''));
		this.using = uci.get('openclash', 'config', 'config_path') || '';
		this.saved = !!st;
		this.info = [];
		const nodes = cached.map(t => t && nodesOf(t)).filter(Boolean).flat();
		this.nodes = nodes.length ? this.tidy(nodes) : null;

		this.load2(st || starter());
		this.base = st ? this.build() : null;
		this.step = st ? 2 : 0;

		root.innerHTML = `<div class="sr-head"><div><h2>${T('分流规则', 'Split rules')}</h2>
				<p>${T('粘贴机场订阅，分好组，再决定哪些网站走哪个组。', 'Paste your subscription, make groups, then choose which sites use which group.')}</p></div>
				<span class="sr-chip ok sr-live"${this.using == CONF ? '' : ' hidden'}>${T('使用中', 'In use')}</span></div>
			<ol class="sr-steps"></ol>
			<div class="sr-body"></div>
			<div class="cbi-page-actions sr-bar" hidden><span class="sr-bar-t"></span>
				<span class="sr-bar-b"><button type="button" class="btn sr-undo">${T('撤销', 'Undo')}</button><button type="button" class="btn cbi-button-apply sr-save">${T('保存并生效', 'Save & apply')}</button></span></div>`;

		root.querySelector('.sr-steps').onclick = ev => { const b = ev.target.closest('[data-step]'); b && this.go(+b.dataset.step); };
		root.querySelector('.sr-undo').onclick = () => { this.load2(stateOf(this.base) || starter()); this.paint(); };
		root.querySelector('.sr-save').onclick = ev => this.save(ev.currentTarget);
		this.wire(root.querySelector('.sr-body'));
		this.paint();
		return root;
	},

	load2(st) {
		this.seq = 0;
		this.subs = st.subs.length ? [ ...st.subs ] : [ '' ];
		this.groups = st.groups.map(g => ({ name: g.name, type: g.type, m: [ ...g.m ], k: ++this.seq }));
		this.rules = st.rules.map(([ l, n ]) => Object.assign(rule(l, n), { k: ++this.seq }));
		this.final = st.final;
		this.mirror = st.mirror || 0;
	},

	tidy(list) {
		const junk = new RegExp(JUNK, 'i');
		return [ ...new Set(list) ].filter(n => n && !junk.test(n));
	},

	// One set of listeners for all three steps.
	wire(body) {
		body.addEventListener('click', ev => {
			const t = ev.target.closest('button');
			if (!t) return;
			const c = t.classList, card = t.closest('.sr-card');
			if (c.contains('sr-go')) this.next(t);
			else if (c.contains('sr-read')) this.read(t);
			else if (c.contains('sr-addsub')) { this.subs.push(''); this.paint(); body.querySelector('.sr-sub:last-of-type input').focus(); }
			else if (c.contains('sr-subx')) { const i = +t.dataset.i; this.subs.splice(i, 1); this.info.splice(i, 1); this.paint(); }
			else if (c.contains('sr-use')) { const i = this.subs.indexOf(''); i < 0 ? this.subs.push(t.dataset.u) : this.subs[i] = t.dataset.u; this.paint(); }
			else if (c.contains('sr-newg')) this.newGroup();
			else if (c.contains('sr-mx')) { const g = this.item(t); g.m = g.m.filter(x => x != t.dataset.t); this.paint(); }
			else if (c.contains('add') && card) this.pick(this.item(t));
			else if (c.contains('sr-x')) this.drop(card);
			else if (c.contains('sr-new') || t.closest('.sr-empty')) this.add();
		});
		body.addEventListener('change', ev => {
			const t = ev.target, c = t.classList;
			if (c.contains('sr-name')) this.rename(this.item(t), t);
			else if (c.contains('sr-type')) this.item(t).type = t.value;
			else if (c.contains('sr-fin')) this.final = t.value;
			else if (c.contains('sr-mirror')) this.mirror = +t.value;
			else if (t.closest('.sr-to')) this.item(t).target = t.value;
			else return;
			this.paint();
		});
		body.addEventListener('input', ev => {
			const i = ev.target.dataset.sub;
			if (i == null) return;
			this.subs[i] = ev.target.value.trim();
			this.bar();
		});
		body.addEventListener('keydown', ev => {
			if (ev.key == 'Enter' && ev.target.dataset.sub != null) return this.read(body.querySelector('.sr-read'));
			const g = ev.target.closest('.sr-grip'), d = { ArrowUp: -1, ArrowDown: 1 }[ev.key];
			if (!g || !d) return;
			ev.preventDefault();
			const arr = this.listOf(g), i = arr.indexOf(this.item(g)), j = i + d;
			if (j < 0 || j >= arr.length) return;
			[ arr[i], arr[j] ] = [ arr[j], arr[i] ];
			this.paint();
			body.querySelector(`.sr-card[data-k="${arr[j].k}"] .sr-grip`).focus();
		});
		body.addEventListener('pointerdown', ev => { const g = ev.target.closest('.sr-grip'); g && this.drag(ev, g); });
	},

	listOf(el) { return this[el.closest('.sr-list').dataset.of]; },
	item(el) {
		const c = el.closest('.sr-card');
		return c && this.listOf(c).find(x => x.k == c.dataset.k);
	},
	group(name) { return this.groups.find(g => g.name == name); },

	/* ---------- the file ---------- */

	url(name) {
		const s = this.sets.get(name);
		return MIRRORS[this.mirror][1](`${name}/${name}${s ? FILES[s.file] : '.yaml'}`);
	},

	// null = every node, '' = no nodes, otherwise a regex the core filters the subscription with
	filterOf(g) {
		if (g.m.includes('*')) return null;
		return [ ...g.m.filter(t => t[0] == 'r' && REG.has(t.slice(2))).map(t => REG.get(t.slice(2)).re),
			...g.m.filter(t => t[0] == 'n').map(t => `^${reEsc(t.slice(2))}$`) ].join('|');
	},

	count(f) {
		if (!this.nodes || f === '') return null;
		if (f == null) return this.nodes.length;
		const rx = new RegExp(f);
		return this.nodes.filter(n => rx.test(n)).length;
	},

	snap() {
		return { subs: this.subs.filter(Boolean), groups: this.groups.map(({ name, type, m }) => ({ name, type, m })),
			rules: this.rules.map(r => r.note ? [ line(r), r.note ] : [ line(r) ]), final: this.final, mirror: this.mirror };
	},

	build() {
		const subs = this.subs.filter(Boolean), use = subs.map((u, i) => 'sub' + (i + 1)).join(', ');
		const prov = subs.map((u, i) => [ `  sub${i + 1}:`, '    type: http', `    url: ${q(u)}`, `    path: ./proxy_provider/7rules-${i + 1}.yaml`,
			'    interval: 21600', `    exclude-filter: ${q('(?i)' + JUNK)}`, '    header:', '      User-Agent: [clash.meta]',
			'    health-check:', '      enable: true', `      url: ${PROBE}`, '      interval: 600', '      lazy: true' ].join('\n'));
		const groups = this.groups.map(g => {
			const sub = g.m.filter(t => t[0] == 'g').map(t => t.slice(2)), f = this.filterOf(g);
			const out = [ `  - name: ${q(g.name)}`, `    type: ${g.type}` ];
			if (sub.length || f === '' || !subs.length) out.push(`    proxies: [${(sub.length ? sub : [ 'DIRECT' ]).map(q).join(', ')}]`);
			if (f !== '' && subs.length) out.push(`    use: [${use}]`, ...(f ? [ `    filter: ${q(f)}` ] : []));
			if (g.type != 'select') out.push(`    url: ${PROBE}`, '    interval: 300', ...(g.type == 'url-test' ? [ '    tolerance: 50' ] : []));
			return out.join('\n');
		});
		const sets = [ ...new Set(this.rules.filter(r => r.kind == 'set').map(r => r.value)) ];
		return [ TAG + JSON.stringify(this.snap()),
			T('# 由「分流规则」页面生成，请在那里修改', '# Written by the Split rules page; edit it there'),
			'mode: rule',
			'dns:', '  enable: true', '  default-nameserver: [223.5.5.5, 119.29.29.29]',
			'  nameserver: [https://dns.alidns.com/dns-query, https://doh.pub/dns-query]',
			'proxy-providers:' + (prov.length ? '' : ' {}'), ...prov,
			'proxy-groups:', ...groups,
			'rule-providers:' + (sets.length ? '' : ' {}'),
			...sets.map(n => `  ${n}:\n    type: http\n    behavior: classical\n    format: yaml\n    url: ${this.url(n.slice(MINE.length))}\n    path: ./rule_provider/${n}.yaml\n    interval: 86400`),
			'rules:', ...this.rules.map(r => `  - ${q(line(r))}${r.note ? ' # ' + r.note.replace(/\s+/g, ' ') : ''}`),
			`  - ${q('MATCH,' + this.final)}`, '' ].join('\n');
	},

	// [ step, message ] for the first thing that would stop the config from working
	problem() {
		if (!this.subs.some(Boolean)) return [ 0, T('先填订阅链接', 'Add your subscription link first') ];
		const g = this.groups.find(g => !g.m.length);
		if (g) return [ 1, T(`「${g.name}」里还没有节点`, `"${g.name}" has no nodes yet`) ];
		const known = new Set([ ...BUILTIN, ...this.groups.map(g => g.name) ]);
		if (!known.has(this.final) || this.rules.some(r => !known.has(r.target))) return [ 2, T('有规则选的分组不存在了，重新选一个', 'A rule points at a group that no longer exists') ];
	},

	async save(btn) {
		const bad = this.problem();
		if (bad) { this.go(bad[0]); return ui.addNotification(null, E('p', bad[1]), 'warning'); }
		const text = this.build();
		btn.disabled = true;
		try {
			await fs.write(DRAFT, text);
			const r = await fs.exec(APPLY);
			if (r.code) throw new Error((r.stdout || r.stderr || '').trim() || 'exit ' + r.code);
			this.base = text;
			this.saved = true;
			this.using = CONF;
			this.root.querySelector('.sr-live').hidden = false;
			this.paint();
			ui.addNotification(null, E('p', T('已保存。OpenClash 正在重启，大约 10 秒后生效。', 'Saved. OpenClash is restarting; it takes about 10 seconds.')), 'info');
		}
		catch (e) {
			ui.addNotification(null, E('p', T('没有生效，配置检查没通过：', 'Not applied; the config check failed: ') + e.message), 'danger');
		}
		btn.disabled = false;
	},

	/* ---------- painting ---------- */

	go(step) {
		if (step == this.step) return;
		this.step = step;
		this.paint();
		glide(this.root.querySelector('.sr-body'), [ { opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' } ], 240);
		const top = this.root.getBoundingClientRect().top;
		top < 0 && this.root.scrollIntoView({ behavior: still.matches ? 'auto' : 'smooth' });
	},

	// From step 1, read the nodes first (once), so a wrong link shows up here and not after applying.
	async next(btn) {
		if (this.step == 0 && this.subs.some(Boolean) && this.readFor != this.subs.join('\n') && !await this.read(btn)) return;
		this.go(this.step + 1);
	},

	paint() {
		// a tick for steps that are filled in and already seen
		const R = this.root, ok = [ this.subs.some(Boolean), this.groups.every(g => g.m.length) ].map((v, i) => v && (this.saved || i < this.step));
		R.querySelector('.sr-steps').innerHTML = STEPS.map((s, i) => `<li><button type="button" data-step="${i}"${i == this.step ? ' aria-current="step"' : ok[i] ? ' class="done"' : ''}>
			<i>${i != this.step && ok[i] ? IC.check : i + 1}</i>${s}</button></li>`).join('');
		R.querySelector('.sr-body').innerHTML = [ this.pSubs, this.pGroups, this.pRules ][this.step].call(this);
		this.bar();
	},

	bar() {
		const text = this.build(), show = this.subs.some(Boolean) && text != this.base;
		const bar = this.root.querySelector('.sr-bar');
		bar.hidden = !show;
		bar.querySelector('.sr-undo').hidden = !this.saved;
		const other = this.using && this.using != CONF && this.using.replace(/^.*\/|\.ya?ml$/g, '');
		bar.querySelector('.sr-bar-t').textContent = other
			? T(`生效后 OpenClash 改用这份配置，原来的「${other}」还在，随时能在 OpenClash 里切回去。会断网几秒。`, `Applying switches OpenClash to this config. "${other}" stays and you can switch back in OpenClash. The internet drops for a few seconds.`)
			: T('有改动还没生效。生效时 OpenClash 会重启，断网几秒。', 'Unsaved changes. Applying restarts OpenClash; the internet drops for a few seconds.');
	},

	nextBtn(label) {
		return `<div class="sr-next"><button type="button" class="btn cbi-button-action important sr-go">${label}${IC.next}</button></div>`;
	},

	pSubs() {
		const rows = this.subs.map((u, i) => {
			const inf = this.info[i];
			return `<div class="sr-sub"><div class="sr-sub-r"><input class="cbi-input-text" type="url" data-sub="${i}" value="${esc(u)}" placeholder="https://…" autocomplete="off" spellcheck="false" aria-label="${T('订阅链接', 'Subscription link')}">
				${this.subs.length > 1 ? `<button type="button" class="sr-x sr-subx" data-i="${i}" aria-label="${T('删除', 'Delete')}">${IC.x}</button>` : ''}</div>
				${inf ? `<small class="sr-info${inf.bad ? ' bad' : ''}">${esc(inf.text)}</small>` : ''}</div>`;
		}).join('');
		const offer = this.ocSubs.filter(s => !this.subs.includes(s.address));
		const n = this.nodes;
		const regs = n ? REGIONS.map(r => [ r, this.count(r.re) ]).filter(([ , c ]) => c) : [];
		return `<section class="sr-sec">
				<div class="sr-cap2"><b>${T('订阅链接', 'Subscription link')}</b><small>${T('机场给你的订阅地址，一般以 https:// 开头', 'The link your provider gave you, usually starting with https://')}</small></div>
				${rows}
				<div class="sr-acts"><button type="button" class="btn sr-read">${IC.down}${T('读取节点', 'Read nodes')}</button>
					${this.subs.every(Boolean) ? `<button type="button" class="btn sr-addsub">${IC.plus}${T('再加一个订阅', 'Add another')}</button>` : ''}</div>
				${offer.length ? `<div class="sr-offer"><small>${T('OpenClash 里已有的订阅：', 'Already in OpenClash:')}</small>${offer.map(s => `<button type="button" class="sr-m add sr-use" data-u="${esc(s.address)}">${IC.plus}${esc(s.name || s.address.replace(/^https?:\/\/([^/]+).*/, '$1'))}</button>`).join('')}</div>` : ''}
			</section>
			${n ? `<section class="sr-sum"><b>${T(`共 ${n.length} 个节点`, `${n.length} nodes`)}</b>
				${regs.length ? `<div class="sr-ms">${regs.map(([ r, c ]) => `<span class="sr-m">${esc(r.name)}<small>${c}</small></span>`).join('')}</div>` : ''}
				<details><summary>${T('查看全部', 'Show all')}</summary><div class="sr-nodes">${n.map(x => `<span>${esc(x)}</span>`).join('')}</div></details></section>` : ''}
			${this.nextBtn(T('下一步：分组', 'Next: groups'))}`;
	},

	pGroups() {
		return `<section class="sr-sec">
				<div class="sr-cap2 row"><span><b>${T('分组', 'Groups')}</b><small>${T('把节点分成几组，规则里再决定什么走哪一组', 'Sort nodes into groups; rules then decide what uses which group')}</small></span>
					<button type="button" class="btn cbi-button-action sr-newg">${IC.plus}${T('新建分组', 'New group')}</button></div>
				<div class="sr-list" data-of="groups">${this.groups.map(g => this.gCard(g)).join('')}</div>
				<p class="sr-foot">${T('「手动选」的分组，在 OpenClash 的控制面板里点选节点。', 'For "Pick" groups, choose the node in the OpenClash dashboard.')}</p>
			</section>
			${this.nextBtn(T('下一步：规则', 'Next: rules'))}`;
	},

	mLabel(t) {
		return t == '*' ? T('全部节点', 'All nodes') : t[0] == 'r' ? (REG.get(t.slice(2)) || { name: t.slice(2) }).name : t.slice(2);
	},

	gCard(g) {
		const f = this.filterOf(g), n = this.count(f);
		const info = !g.m.length ? [ 'bad', T('还没有节点，点「添加」', 'No nodes yet; press Add') ]
			: n === 0 ? [ 'warn', T('订阅里没有匹配的节点', 'No matching nodes in the subscription') ]
			: n != null ? [ '', T(`${n} 个节点`, `${n} nodes`) ] : null;
		return `<div class="sr-card sr-g" data-k="${g.k}">
			<button type="button" class="sr-grip" aria-label="${T('拖动排序', 'Drag to reorder')}">${IC.grip}</button>
			<span class="sr-ic k-g">${IC[g.type]}</span>
			<div class="sr-t"><input class="sr-name" value="${esc(g.name)}" maxlength="32" aria-label="${T('分组名字', 'Group name')}" spellcheck="false">
				<div class="sr-ms">${g.m.map(t => `<span class="sr-m${t[0] == 'g' ? ' g' : ''}" title="${esc(this.mLabel(t))}"><span>${esc(this.mLabel(t))}</span><button type="button" class="sr-mx" data-t="${esc(t)}" aria-label="${T('移除', 'Remove')}">${IC.x}</button></span>`).join('')}
					<button type="button" class="sr-m add">${IC.plus}${T('添加', 'Add')}</button></div>
				${info ? `<small class="sr-info ${info[0]}">${esc(info[1])}</small>` : ''}</div>
			<label class="sr-to"><select class="sr-type" aria-label="${T('怎么选节点', 'How to choose')}">${TYPES.map(([ v, l ]) => `<option value="${v}"${v == g.type ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
			<button type="button" class="sr-x" aria-label="${T('删除', 'Delete')}"${this.groups.length < 2 ? ' disabled' : ''}>${IC.x}</button></div>`;
	},

	pRules() {
		const tos = [ 'DIRECT', ...this.groups.map(g => g.name) ];
		return `<section class="sr-sec">
				<div class="sr-cap2 row"><span><b>${T('规则', 'Rules')}</b><small>${T('越靠上越优先，拖动调整', 'Higher rules win; drag to reorder')}</small></span>
					<button type="button" class="btn cbi-button-action sr-new">${IC.plus}${T('添加', 'Add')}</button></div>
				<div class="sr-list" data-of="rules">${this.rules.length ? this.rules.map(r => this.card(r)).join('')
					: `<div class="sr-empty"><b>${T('还没有规则', 'No rules yet')}</b><p>${T('比如：让 YouTube 走流媒体组、让某台设备全部直连。', 'For example: send YouTube to a streaming group, or let one device go direct.')}</p>
						<button type="button" class="btn">${IC.plus}${T('添加第一条', 'Add the first one')}</button></div>`}</div>
				<div class="sr-card sr-final"><span class="sr-ic">${IC.rest}</span>
					<div class="sr-t"><b>${T('其他所有', 'Everything else')}</b><small>${T('上面都没对上的，走这里', 'Whatever no rule above matches')}</small></div>
					${this.pill('sr-fin', this.final, tos)}</div>
			</section>
			<details class="sr-more"><summary>${T('更多', 'More')}</summary>
				<label class="sr-row"><span>${T('规则集下载地址', 'Rule set source')}<small>${T('下载慢或失败时换一个', 'Switch if downloads are slow or fail')}</small></span>
					<select class="cbi-input-select sr-mirror">${MIRRORS.map(([ n ], i) => `<option value="${i}"${i == this.mirror ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
				<p class="sr-foot">${T('规则集来自', 'Rule sets from')} <a href="https://github.com/${REPO}" target="_blank" rel="noreferrer">${REPO}</a></p></details>`;
	},

	lab(t) {
		return t == 'DIRECT' ? T('直连', 'Direct') : /^REJECT/.test(t) ? T('拦截', 'Block') : t;
	},

	pill(cls, cur, tos) {
		const miss = !BUILTIN.includes(cur) && !this.group(cur);
		const opts = [ ...new Set([ ...tos, cur ]) ].map(t => `<option value="${esc(t)}"${t == cur ? ' selected' : ''}>${esc(this.lab(t))}${t == cur && miss ? T('（不存在）', ' (missing)') : ''}</option>`).join('');
		const tone = miss ? 'bad' : cur == 'DIRECT' ? 'ok' : /^REJECT/.test(cur) ? 'bad' : 'acc';
		return `<label class="sr-to ${tone}"><select class="${cls}" aria-label="${T('走哪里', 'Route')}">${opts}</select></label>`;
	},

	face(r) {
		const set = r.kind == 'set' && this.sets.get(r.value.slice(MINE.length));
		const dev = r.kind == 'dev' && this.devices.find(d => d.ip == r.value.slice(0, -3));
		switch (r.kind) {
		case 'set': {
			const n = r.value.slice(MINE.length);
			return { ic: `<i>${esc(n[0])}</i>`, title: n, label: set && set.label, sub: T('规则集', 'Rule set'),
				chip: set && set.kb >= BIG && [ 'warn', T('很大', 'Large'), T(`约 ${set.kb} KB，会多占一些内存`, `About ${set.kb} KB; uses more memory`) ] };
		}
		case 'site':
			return { ic: IC.site, title: r.value, sub: { 'DOMAIN-SUFFIX': T('网站（含子域名）', 'Site and subdomains'), DOMAIN: T('仅这个网址', 'This domain only'), 'DOMAIN-KEYWORD': T('网址里包含', 'Domain contains') }[r.type] };
		case 'dev':
			return { ic: IC.dev, title: r.note || dev && dev.name || r.value.slice(0, -3), sub: T('设备 · ', 'Device · ') + r.value.slice(0, -3),
				chip: !this.fixed.has(r.value.slice(0, -3)) && [ 'mute', T('IP 会变', 'IP may change'), T('在 DHCP 里给它设一个静态地址，这条规则才会一直有效', 'Give it a static lease in DHCP so this rule keeps working') ] };
		case 'ip':
			return { ic: IC.ip, title: r.value, sub: T('目标 IP', 'Destination IP') };
		case 'geo':
			return { ic: IC.ip, title: r.value.toUpperCase() == 'CN' ? T('国内网站', 'Sites in China') : r.value, sub: T('按 IP 归属地', 'By IP location') };
		default:
			return { ic: IC.other, title: r.value || r.type, sub: r.value ? r.type : T('高级规则', 'Advanced rule') };
		}
	},

	card(r) {
		const f = this.face(r);
		return `<div class="sr-card" data-k="${r.k}">
			<button type="button" class="sr-grip" aria-label="${T('拖动排序', 'Drag to reorder')}">${IC.grip}</button>
			<span class="sr-ic k-${r.kind}">${f.ic}</span>
			<div class="sr-t"><b>${esc(f.title)}${f.label ? ` <em>${esc(f.label)}</em>` : ''}</b>
				<small>${esc(f.sub)}${f.chip ? ` <span class="sr-chip ${f.chip[0]}" title="${esc(f.chip[2])}">${esc(f.chip[1])}</span>` : ''}</small></div>
			${this.pill('', r.target, [ 'DIRECT', ...this.groups.map(g => g.name), 'REJECT' ])}
			<button type="button" class="sr-x" aria-label="${T('删除', 'Delete')}">${IC.x}</button></div>`;
	},

	/* ---------- subscription ---------- */

	async read(btn) {
		const urls = this.subs.filter(Boolean);
		if (!urls.length) return false;
		const label = btn.innerHTML;
		btn.disabled = true;
		btn.textContent = T('正在读取…', 'Reading…');
		const all = [];
		this.info = [];
		for (const u of this.subs) {
			if (!u) { this.info.push(null); continue; }
			const r = /^https?:\/\/\S+$/.test(u) ? await fs.exec(FETCH, [ u ]).catch(() => ({ code: 1 })) : { code: 2 };
			// the script prints the traffic header on the first line, then the subscription itself
			const out = r.stdout || '', nl = out.indexOf('\n');
			const list = !r.code && nodesOf(out.slice(nl + 1));
			if (!list) {
				this.info.push({ bad: true, text: r.code == 2 ? T('这不是一个链接', 'This is not a link')
					: r.code ? T('打不开这个链接，检查一下是否完整', 'Could not open the link; check it is complete')
					: T('打开了，但里面不是订阅', 'It opened, but it is not a subscription') });
				continue;
			}
			const n = this.tidy(list);
			all.push(...n);
			this.info.push({ text: [ T(`${n.length} 个节点`, `${n.length} nodes`), quota(out.slice(0, nl)) ].filter(Boolean).join(' · ') });
		}
		this.readFor = this.subs.join('\n');
		this.nodes = all.length ? this.tidy(all) : this.nodes;
		btn.disabled = false;
		btn.innerHTML = label;
		const ok = this.info.every(i => !i || !i.bad);
		this.step == 0 && this.paint();
		return ok;
	},

	/* ---------- groups ---------- */

	taken(name, g) {
		return BUILTIN.some(b => b.toLowerCase() == name.toLowerCase()) || this.groups.some(h => h != g && h.name == name);
	},

	rename(g, input) {
		const v = clean(input.value);
		if (!v || this.taken(v, g)) { input.value = g.name; return; }
		const old = g.name;
		for (const h of this.groups) h.m = h.m.map(t => t == 'g:' + old ? 'g:' + v : t);
		for (const r of this.rules) if (r.target == old) r.target = v;
		if (this.final == old) this.final = v;
		g.name = v;
	},

	// Does group a (through its members) reach group b? Used to keep groups from containing each other.
	reaches(a, b, seen = new Set()) {
		if (a == b) return true;
		if (seen.has(a)) return false;
		seen.add(a);
		const g = this.group(a);
		return !!g && g.m.some(t => t[0] == 'g' && this.reaches(t.slice(2), b, seen));
	},

	opt(t, label, n, on) {
		return `<button type="button" class="sr-opt" data-t="${esc(t)}" aria-pressed="${on}">${esc(label)}${n != null ? `<small>${n}</small>` : ''}</button>`;
	},

	// What goes into a group: other groups, whole regions, all nodes, or single nodes.
	pick(g) {
		const box = document.createElement('div');
		box.className = 'sr sr-add sr-pick';
		const on = t => g.m.includes(t);
		const others = this.groups.filter(h => h != g && (on('g:' + h.name) || !this.reaches(h.name, g.name)));
		const regs = REGIONS.filter(r => !this.nodes || this.count(r.re) || on('r:' + r.key));
		box.innerHTML = (others.length ? `<p class="sr-cap">${T('分组', 'Groups')}</p><div class="sr-opts">${others.map(h => this.opt('g:' + h.name, h.name, null, on('g:' + h.name))).join('')}</div>` : '')
			+ `<p class="sr-cap">${T('节点', 'Nodes')}</p><div class="sr-opts">${this.opt('*', T('全部节点', 'All nodes'), this.count(null), on('*'))}${regs.map(r => this.opt('r:' + r.key, r.name, this.count(r.re), on('r:' + r.key))).join('')}</div>`
			+ (this.nodes ? `<details class="sr-one"${g.m.some(t => t[0] == 'n') ? ' open' : ''}><summary>${T('选单个节点', 'Single nodes')}</summary>
				<label class="sr-q">${IC.search}<input type="search" placeholder="${T('搜索节点', 'Search nodes')}" autocomplete="off"></label>
				<div class="sr-opts col">${this.nodes.map(n => this.opt('n:' + n, n, null, on('n:' + n))).join('')}</div></details>`
				: `<p class="sr-foot">${T('在第 1 步读取订阅后，还可以挑单个节点。', 'Read the subscription in step 1 to pick single nodes too.')}</p>`);
		box.onclick = ev => {
			const b = ev.target.closest('.sr-opt');
			if (!b) return;
			const t = b.dataset.t, was = on(t);
			g.m = was ? g.m.filter(x => x != t) : [ ...g.m, t ];
			b.setAttribute('aria-pressed', !was);
		};
		const s = box.querySelector('input');
		if (s) s.oninput = () => box.querySelectorAll('.sr-opts.col .sr-opt').forEach(b => b.hidden = !b.textContent.toLowerCase().includes(s.value.trim().toLowerCase()));
		ui.showModal(T(`「${g.name}」里放什么`, `What goes into "${g.name}"`), [ box,
			E('div', { class: 'right' }, E('button', { class: 'btn cbi-button-action', click: () => { ui.hideModal(); this.paint(); } }, T('完成', 'Done'))) ]);
	},

	newGroup() {
		const box = document.createElement('div');
		box.className = 'sr sr-add sr-pick';
		const ideas = (ZH ? [ 'AI', '流媒体', '游戏', '社交', '苹果', '微软', '下载' ] : [ 'AI', 'Streaming', 'Games', 'Social', 'Apple', 'Microsoft', 'Downloads' ])
			.filter(n => !this.group(n)).map(n => [ n ])
			.concat(REGIONS.filter(r => !this.group(r.name) && (this.nodes ? this.count(r.re) : /hk|jp|us|sg/.test(r.key))).map(r => [ r.name, r.key ]));
		let type = 'select', region = null;
		box.innerHTML = `<label class="sr-q"><input placeholder="${T('名字，比如 AI、游戏', 'Name, e.g. AI, Games')}" maxlength="32" autocomplete="off"></label>
			<div class="sr-opts sr-ideas">${ideas.map(([ n, r ]) => `<button type="button" class="sr-opt" data-r="${r || ''}">${esc(n)}</button>`).join('')}</div>
			<p class="sr-cap">${T('怎么选节点', 'How to choose the node')}</p>
			<div class="sr-opts sr-types">${TYPES.map(([ v, l ]) => this.opt(v, l, null, v == type)).join('')}</div>
			<p class="sr-foot">${T('手动选：自己在面板里点。自动选最快：定时测速，用最快的。按顺序备用：第一个坏了自动换下一个。', 'Pick: you choose in the dashboard. Fastest: tests regularly and uses the fastest. Failover: switches to the next one when the first fails.')}</p>
			<p class="sr-err" hidden></p>`;
		const input = box.querySelector('input'), err = box.querySelector('.sr-err');
		const setType = v => { type = v; box.querySelectorAll('.sr-types .sr-opt').forEach(b => b.setAttribute('aria-pressed', b.dataset.t == v)); };
		box.querySelector('.sr-ideas').onclick = ev => {
			const b = ev.target.closest('.sr-opt');
			if (!b) return;
			input.value = b.textContent;
			region = b.dataset.r || null;
			setType(region ? 'url-test' : 'select');
		};
		box.querySelector('.sr-types').onclick = ev => { const b = ev.target.closest('.sr-opt'); b && setType(b.dataset.t); };
		input.oninput = () => { region = null; err.hidden = true; };
		const make = () => {
			const name = clean(input.value);
			if (!name || this.taken(name)) {
				err.textContent = name ? T('这个名字已经用过了', 'That name is taken') : T('起个名字', 'Give it a name');
				err.hidden = false;
				return input.focus();
			}
			const first = this.groups[0];
			const g = { name, type, m: region ? [ 'r:' + region ] : type == 'select' && first ? [ 'g:' + first.name, '*' ] : [ '*' ], k: ++this.seq };
			this.groups.push(g);
			ui.hideModal();
			this.paint();
			this.flash(g.k);
		};
		input.onkeydown = ev => ev.key == 'Enter' && make();
		ui.showModal(T('新建分组', 'New group'), [ box, E('div', { class: 'right' }, [
			E('button', { class: 'btn', click: ui.hideModal }, T('取消', 'Cancel')), ' ',
			E('button', { class: 'btn cbi-button-action', click: make }, T('创建', 'Create')) ]) ]);
		requestAnimationFrame(() => input.focus());
	},

	flash(k) {
		const el = this.root.querySelector(`.sr-card[data-k="${k}"]`);
		if (!el) return;
		el.classList.add('new');
		el.scrollIntoView({ block: 'nearest', behavior: still.matches ? 'auto' : 'smooth' });
	},

	/* ---------- editing lists ---------- */

	drop(card) {
		const arr = this.listOf(card), x = arr.find(i => i.k == card.dataset.k);
		if (arr == this.groups) {
			// Whatever used the deleted group moves to the first one left.
			if (arr.length < 2) return;
			const rest = arr.filter(g => g != x), to = rest[0].name;
			rest.forEach(g => g.m = g.m.filter(t => t != 'g:' + x.name));
			this.rules.forEach(r => r.target == x.name && (r.target = to));
			if (this.final == x.name) this.final = to;
			this.groups = rest;
		}
		else this.rules = arr.filter(i => i != x);
		card.style.overflow = 'hidden';
		const a = glide(card, [ { opacity: 1, height: card.offsetHeight + 'px' }, { opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0, marginTop: '-10px' } ], 220);
		a === true ? this.paint() : a.onfinish = () => this.paint();
	},

	drag(ev, grip) {
		if (ev.button > 0) return;
		ev.preventDefault();
		const card = grip.closest('.sr-card'), list = card.parentNode, arr = this.listOf(card);
		const gap = parseFloat(getComputedStyle(list).rowGap) || 0;
		let y0 = ev.clientY, dy = 0;
		try { grip.setPointerCapture(ev.pointerId); } catch (e) {}
		card.classList.add('lift');
		const move = e => {
			dy = e.clientY - y0;
			for (;;) {
				const sib = dy > 0 ? card.nextElementSibling : card.previousElementSibling;
				// swap once the card has passed the neighbour's middle (gap included, so it can't flip back)
				if (!sib || Math.abs(dy) <= (sib.offsetHeight + gap) / 2) break;
				const t0 = card.offsetTop, s0 = sib.offsetTop;
				dy > 0 ? sib.after(card) : sib.before(card);
				y0 += card.offsetTop - t0;
				dy = e.clientY - y0;
				glide(sib, [ { transform: `translateY(${s0 - sib.offsetTop}px)` }, { transform: 'none' } ]);
			}
			card.style.transform = `translateY(${dy}px)`;
		};
		const up = () => {
			grip.removeEventListener('pointermove', move);
			grip.removeEventListener('pointerup', up);
			grip.removeEventListener('pointercancel', up);
			card.classList.remove('lift');
			card.style.transform = '';
			glide(card, [ { transform: `translateY(${dy}px)` }, { transform: 'none' } ]);
			const order = [ ...list.children ].map(c => c.dataset.k);
			arr.sort((a, b) => order.indexOf('' + a.k) - order.indexOf('' + b.k));
			this.bar();
		};
		grip.addEventListener('pointermove', move);
		grip.addEventListener('pointerup', up);
		grip.addEventListener('pointercancel', up);
	},

	// Search results: what was typed (a site, an IP), matching devices, then rule sets.
	hits(s) {
		s = s.trim().toLowerCase();
		const out = [];
		if (!s) return out;
		let host = '';
		try { host = new URL(/:\/\//.test(s) ? s : 'http://' + s).hostname.replace(/^www\./, ''); } catch (e) {}
		if (/^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(s))
			out.push({ kind: 'ip', title: s, sub: T('目标 IP', 'Destination IP'), make: () => rule(`IP-CIDR,${s.includes('/') ? s : s + '/32'},DIRECT,no-resolve`) });
		else if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(host))
			out.push({ kind: 'site', title: host, sub: T('网站（含子域名）', 'Site and subdomains'), make: () => rule(`DOMAIN-SUFFIX,${host},DIRECT`) });
		for (const d of this.devices)
			if ((d.name + ' ' + d.ip + ' ' + d.mac).toLowerCase().includes(s)) out.push(this.devHit(d));
		const score = e => {
			const n = e.name.toLowerCase();
			return n == s || e.label.toLowerCase() == s ? 4 : n.startsWith(s) ? 3 : e.words.split(' ').some(w => w.startsWith(s)) ? 2 : e.words.includes(s) ? 1 : 0;
		};
		const found = [];
		for (const e of this.sets.values()) { const k = score(e); if (k) found.push([ k + (e.label || e.words.length > e.name.length + 3 ? .5 : 0), e ]); }
		found.sort((a, b) => b[0] - a[0] || a[1].name.length - b[1].name.length);
		return out.concat(found.slice(0, 40).map(([ , e ]) => this.setHit(e)));
	},

	setHit(e) {
		return { kind: 'set', ic: `<i>${esc(e.name[0])}</i>`, title: e.name, label: e.label, sub: T('规则集', 'Rule set') + (e.kb >= BIG ? T(` · 很大（${e.kb} KB）`, ` · large (${e.kb} KB)`) : ''),
			make: () => rule(`RULE-SET,${MINE}${e.name},DIRECT`) };
	},

	devHit(d) {
		return { kind: 'dev', title: d.name || d.ip, sub: T('设备 · ', 'Device · ') + d.ip, make: () => rule(`SRC-IP-CIDR,${d.ip}/32,DIRECT`, d.name) };
	},

	hitHtml(h, i) {
		return `<button type="button" class="sr-hit" data-i="${i}"><span class="sr-ic k-${h.kind}">${h.ic || IC[h.kind] || IC.ip}</span>
			<span class="sr-t"><b>${esc(h.title)}${h.label ? ` <em>${esc(h.label)}</em>` : ''}</b><small>${esc(h.sub)}</small></span></button>`;
	},

	add() {
		const box = document.createElement('div');
		box.className = 'sr sr-add';
		let hits = [];
		const step1 = () => {
			box.innerHTML = `<label class="sr-q">${IC.search}<input type="search" placeholder="${T('搜索服务、粘贴网址或输入设备名', 'Search a service, paste a URL or a device name')}" autocomplete="off"></label><div class="sr-hits"></div>`;
			const input = box.querySelector('input'), out = box.querySelector('.sr-hits');
			const show = () => {
				const s = input.value;
				hits = s.trim() ? this.hits(s) : [ ...POPULAR.map(n => this.sets.get(n)).filter(Boolean).map(e => this.setHit(e)), ...this.devices.map(d => this.devHit(d)) ];
				out.innerHTML = s.trim()
					? hits.map((h, i) => this.hitHtml(h, i)).join('') || `<p class="sr-none">${T('没找到。可以试试英文名，或者直接粘贴网址。', 'Nothing found. Try the English name, or paste a URL.')}</p>`
					: `<p class="sr-cap">${T('常用', 'Popular')}</p><div class="sr-pop">${hits.filter(h => h.kind == 'set').map((h, i) => this.hitHtml(h, i)).join('')}</div>`
						+ (this.devices.length ? `<p class="sr-cap">${T('设备', 'Devices')}</p>` + hits.map((h, i) => h.kind == 'dev' ? this.hitHtml(h, i) : '').join('') : '');
			};
			input.oninput = show;
			out.onclick = ev => { const b = ev.target.closest('.sr-hit'); b && step2(hits[b.dataset.i]); };
			show();
			requestAnimationFrame(() => input.focus());
		};
		const step2 = h => {
			const r = h.make();
			const tos = [ 'DIRECT', ...this.groups.map(g => g.name), 'REJECT' ];
			box.innerHTML = `<div class="sr-picked">${this.hitHtml(h, 0)}</div><p class="sr-cap">${T('走哪里？', 'Route it through')}</p>
				<div class="sr-tos">${tos.map(t => `<button type="button" class="sr-tgt ${t == 'DIRECT' ? 'ok' : t == 'REJECT' ? 'bad' : 'acc'}" data-t="${esc(t)}">${esc(this.lab(t))}</button>`).join('')}</div>
				<button type="button" class="btn sr-back">${IC.back}${T('重新选', 'Back')}</button>`;
			box.querySelector('.sr-back').onclick = step1;
			box.querySelector('.sr-tos').onclick = ev => {
				const b = ev.target.closest('.sr-tgt');
				if (!b) return;
				r.target = b.dataset.t;
				// Adding something that is already listed just re-routes it.
				const same = this.rules.find(x => x.type == r.type && x.value == r.value);
				if (same) same.target = r.target;
				else this.rules.unshift(Object.assign(r, { k: ++this.seq }));
				ui.hideModal();
				this.paint();
				this.flash((same || r).k);
			};
		};
		step1();
		ui.showModal(T('添加规则', 'Add a rule'), [ box, E('div', { class: 'right' }, E('button', { class: 'btn', click: ui.hideModal }, T('取消', 'Cancel'))) ]);
	}
});
