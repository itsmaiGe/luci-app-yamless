'use strict';
'require view';
'require fs';
'require uci';
'require ui';

/* 分流规则: a visual editor for OpenClash's own custom rules file.
   It never touches the subscription; it only rewrites the file OpenClash prepends to it,
   and only when you press save. Nothing runs in the background. */

const ZH = /^zh/i.test(document.documentElement.lang || '');
const T = (zh, en) => ZH ? zh : en;
const FILE = '/etc/openclash/custom/openclash_custom_rules.list';
const APPLY = '/usr/libexec/7rules-apply';
const MINE = '7r-';                    // prefix of the rule sets this page owns
const HEAD = '# luci-app-7rules';
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
const still = matchMedia('(prefers-reduced-motion: reduce)');
const glide = (el, from, ms = 180) => still.matches || el.animate(from, { duration: ms, easing: 'cubic-bezier(.2,.7,.2,1)' });

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const svg = d => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const IC = {
	grip: svg('M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01'),
	x: svg('M6 6l12 12M18 6 6 18'),
	plus: svg('M12 5v14M5 12h14'),
	site: svg('M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-9 9h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z'),
	dev: svg('M7 3h10a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm4 15h2'),
	ip: svg('M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Zm0-9a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z'),
	other: svg('m8 8-4 4 4 4m8-8 4 4-4 4'),
	back: svg('m15 6-6 6 6 6'),
	search: svg('m20 20-4.5-4.5M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z')
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
	const q = s[0] == "'" || s[0] == '"' ? s.indexOf(s[0], 1) : -1;
	const m = s.slice(q + 1).match(/\s+#\s?(.*)$/);
	return m ? [ unq(s.slice(0, q + 1 + m.index)), m[1].trim() ] : [ unq(s), '' ];
}
const yq = s => /: | #|:$|^['"&*!|>%@`{\[?#-]/.test(s) ? `'${s.replace(/'/g, "''")}'` : s;

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

// Names under proxy-groups / proxies, block or flow style.
function names(text, key) {
	const out = [];
	let dash = null, col = null;           // indent of the list's dashes, column of an item's keys
	for (const l of block(text, key)) {
		if (/^\s*#/.test(l)) continue;
		const d = l.match(/^(\s*)-\s+/);
		if (d && (dash == null || d[1].length == dash)) { dash = d[1].length; col = d[0].length; }
		const f = l.match(/^\s*-\s*\{(.*)\}\s*$/);
		const n = f ? f[1].match(/(?:^|,)\s*name\s*:\s*('[^']*'|"[^"]*"|[^,]+)/) : l.match(/^(\s*(?:-\s+)?)name\s*:\s*(.*)$/);
		if (f ? n : n && n[1].length == col) out.push(split(f ? n[1] : n[2])[0]);
	}
	return out;
}

/* ---------- rules ---------- */

function rule(raw, note) {
	const p = raw.split(',').map(s => s.trim());
	let t = p.length - 1;
	if (t > 1 && /^(no-resolve|src)$/i.test(p[t])) t--;
	const r = { type: p[0].toUpperCase(), value: p.slice(1, t).join(','), target: p[t] || 'DIRECT', tail: p.slice(t + 1), note };
	r.kind = r.type == 'RULE-SET' && r.value.startsWith(MINE) ? 'set'
		: /^DOMAIN(-SUFFIX|-KEYWORD)?$/.test(r.type) ? 'site'
		: r.type == 'SRC-IP-CIDR' && /\/32$/.test(r.value) ? 'dev'
		: /^IP-CIDR6?$/.test(r.type) ? 'ip'
		: r.type == 'GEOIP' ? 'geo' : 'other';
	return r;
}
const line = r => [ r.type, ...(r.value ? [ r.value ] : []), r.target, ...r.tail ].join(',');

// Our file: rules and our rule sets become cards; anything else is kept word for word.
function parse(text) {
	const rules = [], urls = {}, keep = [], kprov = [];
	let key = null, cur = null, ind = null;
	const flush = () => { if (cur && !cur.mine) kprov.push(...cur.lines); cur = null; };
	for (const l of text.split('\n')) {
		if (/^\s*(#|$)/.test(l)) continue;
		if (/^[^\s#-]/.test(l)) {
			flush();
			key = unq(l.slice(0, l.indexOf(':')));
			if (key != 'rules' && key != 'rule-providers') keep.push(l);
			continue;
		}
		if (key == 'rule-providers') {
			const i = l.search(/\S/);
			if (ind == null) ind = i;
			if (i == ind) {
				flush();
				const name = unq(l.slice(0, l.indexOf(':')));
				cur = { mine: name.startsWith(MINE), name, lines: [ l ] };
			}
			else if (cur) {
				cur.lines.push(l);
				const u = l.match(/^\s*url\s*:\s*(.+)$/);
				if (u && cur.mine) urls[cur.name] = split(u[1])[0];
			}
		}
		else if (key == 'rules' || key == null) {
			const m = l.match(/^\s*-\s+(.*)$/);
			if (m) rules.push(rule(...split(m[1])));
		}
		else keep.push(l);
	}
	flush();
	return { rules, urls, keep, kprov };
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
			fs.read(FILE).catch(() => ''),
			fs.read('/tmp/dhcp.leases').catch(() => ''),
			fetch(L.resource('7rules/sets.json'), { cache: 'no-cache' }).then(r => r.json()).catch(() => ({ s: [] })),
			css
		]).then(async ([ oc, , file, leases, sets ]) => {
			const path = oc && uci.get('openclash', 'config', 'config_path');
			return [ oc, file, leases, sets, path ? await fs.read(path).catch(() => '') : '' ];
		});
	},

	render([ oc, file, leases, sets, conf ]) {
		const root = document.createElement('div');
		root.className = 'sr';
		this.root = root;
		if (!oc) {
			root.innerHTML = `<div class="sr-empty"><b>${T('没有找到 OpenClash', 'OpenClash is not installed')}</b><p>${T('这个页面编辑的是 OpenClash 的分流规则，请先安装 OpenClash。', 'This page edits OpenClash rules. Install OpenClash first.')}</p></div>`;
			return root;
		}

		this.sets = new Map(sets.s.map(e => [ e[0], { name: e[0], file: e[1], kb: e[2], label: e[3] || '', words: (e[0] + ' ' + (e[3] || '') + ' ' + (e[4] || '')).toLowerCase() } ]));
		this.groups = names(conf, 'proxy-groups');
		this.known = new Set([ ...BUILTIN, ...this.groups, ...names(conf, 'proxies') ]);
		this.devices = leases.split('\n').map(l => l.split(' ')).filter(p => p[2] && p[2].includes('.'))
			.map(p => ({ ip: p[2], mac: p[1], name: p[3] && p[3] != '*' ? p[3] : '' }));
		this.fixed = new Set(uci.sections('dhcp', 'host').map(s => s.ip).filter(Boolean));
		this.core = uci.get('openclash', 'config', 'core_type');
		this.on = uci.get('openclash', 'config', 'enable_custom_clash_rules') == '1';
		this.conf = !!conf;
		this.orig = file;

		this.load2(parse(file));
		this.base = this.build();

		root.innerHTML = `<div class="sr-head"><div><h2>${T('分流规则', 'Split rules')}</h2>
				<p>${T('决定哪些网站、哪些设备走直连还是代理。越靠上越优先。', 'Choose which sites and devices go direct or through a proxy. Higher rules win.')}</p></div>
				<button type="button" class="btn cbi-button-action important sr-new">${IC.plus}${T('添加', 'Add')}</button></div>
			<div class="sr-notes"></div>
			<div class="sr-list"></div>
			<details class="sr-more"><summary>${T('更多', 'More')}</summary><div class="sr-more-b"></div></details>
			<div class="cbi-page-actions sr-bar" hidden><span>${T('有改动还没生效。生效时 OpenClash 会重启，断网几秒。', 'Unsaved changes. Applying restarts OpenClash; the internet drops for a few seconds.')}</span>
				<span class="sr-bar-b"><button type="button" class="btn sr-undo">${T('撤销', 'Undo')}</button><button type="button" class="btn cbi-button-apply sr-save">${T('保存并生效', 'Save & apply')}</button></span></div>`;

		root.querySelector('.sr-new').onclick = () => this.add();
		root.querySelector('.sr-undo').onclick = () => { this.load2(parse(this.orig)); this.paint(); };
		root.querySelector('.sr-save').onclick = ev => this.save(ev.currentTarget);
		const list = root.querySelector('.sr-list');
		list.addEventListener('change', ev => {
			const r = this.byEl(ev.target);
			if (r) { r.target = ev.target.value; this.paint(); }
		});
		list.addEventListener('click', ev => {
			const b = ev.target.closest('.sr-x');
			if (b) this.drop(b.closest('.sr-card'));
			else if (ev.target.closest('.sr-empty .btn')) this.add();
		});
		list.addEventListener('pointerdown', ev => { const g = ev.target.closest('.sr-grip'); g && this.drag(ev, g); });
		list.addEventListener('keydown', ev => {
			const g = ev.target.closest('.sr-grip'), d = { ArrowUp: -1, ArrowDown: 1 }[ev.key];
			if (!g || !d) return;
			ev.preventDefault();
			const i = this.list.indexOf(this.byEl(g)), j = i + d;
			if (j < 0 || j >= this.list.length) return;
			[ this.list[i], this.list[j] ] = [ this.list[j], this.list[i] ];
			this.paint();
			list.children[j].querySelector('.sr-grip').focus();
		});
		this.paint();
		return root;
	},

	load2(p) {
		this.p = p;
		this.mirror = Math.max(0, MIRRORS.findIndex(([ , u ]) => Object.values(p.urls).some(x => x.startsWith(u('')))));
		const more = this.root && this.root.querySelector('.sr-more-b');
		if (more) more.innerHTML = '';
		this.seq = 0;
		this.list = p.rules.map(r => Object.assign(r, { k: ++this.seq }));
	},

	byEl(el) {
		const c = el.closest('.sr-card');
		return c && this.list.find(r => r.k == c.dataset.k);
	},

	/* ---------- file ---------- */

	url(name) {
		const s = this.sets.get(name);
		return s ? MIRRORS[this.mirror][1](`${name}/${name}${FILES[s.file]}`) : this.p.urls[MINE + name] || MIRRORS[this.mirror][1](`${name}/${name}.yaml`);
	},

	build() {
		const used = [ ...new Set(this.list.filter(r => r.kind == 'set').map(r => r.value)) ];
		const prov = used.map(n => `  ${n}:\n    type: http\n    behavior: classical\n    format: yaml\n    url: ${this.url(n.slice(MINE.length))}\n    path: ./rule_provider/${n}.yaml\n    interval: 86400`);
		return [ `${HEAD}: ${T('由「分流规则」页面生成，请在那里修改', 'written by the Split rules page; edit it there')}`,
			'rule-providers:', ...prov, ...this.p.kprov,
			'rules:', ...this.list.map(r => `  - ${yq(line(r))}${r.note ? ' # ' + r.note.replace(/\s+/g, ' ') : ''}`),
			...this.p.keep, '' ].join('\n');
	},

	async save(btn) {
		const text = this.build();
		btn.disabled = true;
		try {
			// The first time we take over a hand-written file, keep a copy of it.
			if (this.orig.trim() && !this.orig.startsWith(HEAD))
				await fs.read(FILE + '.bak').catch(() => fs.write(FILE + '.bak', this.orig));
			await fs.write(FILE, text);
			const r = await fs.exec(APPLY);
			this.orig = this.base = text;
			this.on = true;
			this.paint();
			ui.addNotification(null, E('p', /restart/.test(r.stdout)
				? T('已保存。OpenClash 正在重启，大约 10 秒后生效。', 'Saved. OpenClash is restarting; the rules apply in about 10 seconds.')
				: T('已保存。OpenClash 现在没开，下次启动时生效。', 'Saved. OpenClash is off; the rules apply when it starts.')), 'info');
		}
		catch (e) {
			ui.addNotification(null, E('p', T('保存失败：', 'Could not save: ') + e.message), 'danger');
		}
		btn.disabled = false;
	},

	/* ---------- painting ---------- */

	lab(t) {
		return t == 'DIRECT' ? T('直连', 'Direct') : /^REJECT/.test(t) ? T('拦截', 'Block') : t;
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
			return { ic: IC.ip, title: r.value.toUpperCase() == 'CN' ? T('中国大陆 IP', 'Mainland China IPs') : r.value, sub: T('按 IP 归属地', 'By IP location') };
		default:
			return { ic: IC.other, title: r.value || r.type, sub: r.value ? r.type : T('高级规则', 'Advanced rule') };
		}
	},

	card(r) {
		const f = this.face(r), miss = !this.known.has(r.target) && this.conf;
		const opts = [ ...new Set([ 'DIRECT', ...this.groups, 'REJECT', r.target ]) ]
			.map(t => `<option value="${esc(t)}"${t == r.target ? ' selected' : ''}>${esc(this.lab(t))}${t == r.target && miss ? T('（不存在）', ' (missing)') : ''}</option>`).join('');
		const to = r.target == 'DIRECT' ? 'ok' : /^REJECT/.test(r.target) ? 'bad' : 'acc';
		return `<div class="sr-card${miss ? ' miss' : ''}" data-k="${r.k}">
			<button type="button" class="sr-grip" aria-label="${T('拖动排序', 'Drag to reorder')}">${IC.grip}</button>
			<span class="sr-ic k-${r.kind}">${f.ic}</span>
			<div class="sr-t"><b>${esc(f.title)}${f.label ? ` <em>${esc(f.label)}</em>` : ''}</b>
				<small>${esc(f.sub)}${f.chip ? ` <span class="sr-chip ${f.chip[0]}" title="${esc(f.chip[2])}">${esc(f.chip[1])}</span>` : ''}${miss ? ` <span class="sr-chip bad">${T('策略组不存在，会被跳过', 'Group not found; skipped')}</span>` : ''}</small></div>
			<label class="sr-to ${miss ? 'bad' : to}"><select aria-label="${T('走哪里', 'Route')}">${opts}</select></label>
			<button type="button" class="sr-x" aria-label="${T('删除', 'Delete')}">${IC.x}</button></div>`;
	},

	paint() {
		const root = this.root, list = root.querySelector('.sr-list');
		list.innerHTML = this.list.length ? this.list.map(r => this.card(r)).join('')
			: `<div class="sr-empty"><b>${T('还没有规则', 'No rules yet')}</b><p>${T('比如：让 YouTube 走代理、让某台设备全部直连。', 'For example: send YouTube through a proxy, or let one device skip the proxy.')}</p>
				<button type="button" class="btn">${IC.plus}${T('添加第一条', 'Add the first one')}</button></div>`;

		const dirty = this.build() != this.base;
		const notes = [];
		if (this.core == 'Dev' && this.list.some(r => r.type == 'RULE-SET'))
			notes.push([ 'bad', T('当前 OpenClash 用的是 Dev 内核，不支持规则集。请在 OpenClash 设置里换成 Meta 内核。', 'OpenClash uses the Dev core, which has no rule sets. Switch to the Meta core in OpenClash.') ]);
		if (!this.conf)
			notes.push([ 'mute', T('还没找到 OpenClash 的订阅配置，暂时只能选直连或拦截。', 'No OpenClash config found yet, so only Direct and Block are available.') ]);
		if (!this.on && this.list.length && !dirty)
			notes.push([ 'warn', T('OpenClash 的「自定义规则」现在是关的，这些规则还没生效。点「保存并生效」会自动打开。', 'OpenClash custom rules are off, so these rules are not active. Saving turns them on.') ]);
		root.querySelector('.sr-notes').innerHTML = notes.map(([ c, t ]) => `<p class="sr-note ${c}">${esc(t)}</p>`).join('');
		root.querySelector('.sr-bar').hidden = !dirty;

		const more = root.querySelector('.sr-more-b');
		if (!more.firstChild) {
			more.innerHTML = `<label class="sr-row"><span>${T('规则集下载地址', 'Rule set source')}<small>${T('下载慢或失败时换一个', 'Switch if downloads are slow or fail')}</small></span>
					<select class="cbi-input-select">${MIRRORS.map(([ n ], i) => `<option value="${i}"${i == this.mirror ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
				${this.p.kprov.length || this.p.keep.length ? `<div class="sr-row col"><span>${T('原样保留的内容', 'Kept as is')}<small>${T('文件里手写的其他内容，这里不改动它们', 'Other hand-written content in the file; left untouched')}</small></span><pre>${esc([ ...this.p.kprov, ...this.p.keep ].join('\n'))}</pre></div>` : ''}
				<p class="sr-foot">${T('规则集来自', 'Rule sets from')} <a href="https://github.com/${REPO}" target="_blank" rel="noreferrer">blackmatrix7/ios_rule_script</a></p>`;
			more.querySelector('select').onchange = ev => { this.mirror = +ev.target.value; this.paint(); };
		}
	},

	/* ---------- editing ---------- */

	drop(card) {
		const r = this.byEl(card);
		this.list = this.list.filter(x => x != r);
		card.style.overflow = 'hidden';
		const a = glide(card, [ { opacity: 1, height: card.offsetHeight + 'px' }, { opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0, marginTop: '-10px' } ], 220);
		a === true ? this.paint() : a.onfinish = () => this.paint();
	},

	drag(ev, grip) {
		if (ev.button > 0) return;
		ev.preventDefault();
		const card = grip.closest('.sr-card'), list = card.parentNode;
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
			this.list.sort((a, b) => order.indexOf('' + a.k) - order.indexOf('' + b.k));
			const dirty = this.build() != this.base;
			this.root.querySelector('.sr-bar').hidden = !dirty;
		};
		grip.addEventListener('pointermove', move);
		grip.addEventListener('pointerup', up);
		grip.addEventListener('pointercancel', up);
	},

	// Search results: what was typed (a site, an IP), matching devices, then rule sets.
	hits(q) {
		const s = q.trim().toLowerCase(), out = [];
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
				const q = input.value;
				hits = q.trim() ? this.hits(q) : [ ...POPULAR.map(n => this.sets.get(n)).filter(Boolean).map(e => this.setHit(e)), ...this.devices.map(d => this.devHit(d)) ];
				out.innerHTML = q.trim()
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
			const tos = [ 'DIRECT', ...this.groups, 'REJECT' ];
			box.innerHTML = `<div class="sr-picked">${this.hitHtml(h, 0)}</div><p class="sr-cap">${T('走哪里？', 'Route it through')}</p>
				<div class="sr-tos">${tos.map(t => `<button type="button" class="sr-tgt ${t == 'DIRECT' ? 'ok' : t == 'REJECT' ? 'bad' : 'acc'}" data-t="${esc(t)}">${esc(this.lab(t))}</button>`).join('')}</div>
				<button type="button" class="btn sr-back">${IC.back}${T('重新选', 'Back')}</button>`;
			box.querySelector('.sr-back').onclick = step1;
			box.querySelector('.sr-tos').onclick = ev => {
				const b = ev.target.closest('.sr-tgt');
				if (!b) return;
				r.target = b.dataset.t;
				// Adding something that is already listed just re-routes it.
				const same = this.list.find(x => x.type == r.type && x.value == r.value);
				if (same) same.target = r.target;
				else this.list.unshift(Object.assign(r, { k: ++this.seq }));
				ui.hideModal();
				this.paint();
				const el = this.root.querySelector(`.sr-card[data-k="${(same || r).k}"]`);
				el && el.classList.add('new');
			};
		};
		step1();
		ui.showModal(T('添加规则', 'Add a rule'), [ box, E('div', { class: 'right' }, E('button', { class: 'btn', click: ui.hideModal }, T('取消', 'Cancel'))) ]);
	}
});
