'use strict';
'require view';
'require fs';
'require uci';
'require ui';

/* YAMLess: paste the subscription link, then make groups. Each group says which nodes it uses
   and what goes through it. The page writes one complete config for OpenClash when you apply.
   Nothing runs in the background; the router only works when you press Save. */

const ZH = /^zh/i.test(document.documentElement.lang || '');
const T = (zh, en) => ZH ? zh : en;
const CONF = '/etc/openclash/config/yamless.yaml';
const DRAFT = '/tmp/yamless.yaml';
const BIN = '/usr/libexec/yamless';
const TAG = '# yamless: ';
const MINE = 'ya-';                    // prefix of the rule sets this page owns
const LINK = /^https?:\/\/\S+$/i;
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
const BRAND = new Set('OpenAI Claude Gemini YouTube Netflix Google Telegram GitHub Twitter Spotify Steam TikTok Apple Microsoft Instagram Facebook Epic Discord Reddit Twitch Whatsapp PayPal BiliBili Amazon Line PlayStation'.split(' '));
const BIG = 512;                       // KB; bigger sets cost the router noticeable memory
// Plain alternations, used as the core's filter on the subscription.
const REGIONS = [
	[ 'hk', T('香港', 'Hong Kong'), '港|HK|Hong ?Kong|🇭🇰' ],
	[ 'tw', T('台湾', 'Taiwan'), '台|TW|Taiwan|Taipei|🇹🇼' ],
	[ 'jp', T('日本', 'Japan'), '日本|JP|Japan|东京|大阪|Tokyo|Osaka|🇯🇵' ],
	[ 'sg', T('新加坡', 'Singapore'), '新加坡|狮城|SG|Singapore|🇸🇬' ],
	[ 'us', T('美国', 'US'), '美|US|United States|America|洛杉矶|硅谷|纽约|Los Angeles|San Jose|Silicon|Seattle|New York|Dallas|Chicago|🇺🇸' ],
	[ 'kr', T('韩国', 'Korea'), '韩|KR|Korea|首尔|Seoul|🇰🇷' ],
	[ 'uk', T('英国', 'UK'), '英国|UK|United Kingdom|London|🇬🇧' ],
	[ 'de', T('德国', 'Germany'), '德国|DE|Germany|Frankfurt|🇩🇪' ]
].map(([ key, name, re ]) => ({ key, name, re }));
const REG = new Map(REGIONS.map(r => [ r.key, r ]));
// Every group type OpenClash's cores know. "smart" only exists in the Smart (and Oix) core builds.
const TYPES = [
	[ 'select', T('手动选', 'Pick'), T('在 OpenClash 面板里自己点选节点', 'You choose the node in the OpenClash dashboard') ],
	[ 'url-test', T('自动选最快', 'Fastest'), T('定时测速，自动用最快的', 'Tests regularly and uses the fastest') ],
	[ 'smart', T('智能选', 'Smart'), T('记住每个网站用哪个节点最顺，自动挑', 'Learns which node works best for each site') ],
	[ 'fallback', T('按顺序备用', 'Failover'), T('用第一个，坏了自动换下一个', 'Uses the first; moves on when it fails') ],
	[ 'load-balance', T('分摊着用', 'Share'), T('几个节点一起分担流量，适合大量下载', 'Spreads traffic over several nodes; good for big downloads') ]
];
const typeName = t => (TYPES.find(x => x[0] == t) || [ , t ])[1];
// Built in to the core, nothing to download.
const GEO = [ [ 'LAN', T('局域网', 'Local network'), 'lan local 局域网 内网 本地' ], [ 'CN', T('国内网站', 'Sites in China'), 'cn china 国内 中国 大陆 直连' ] ];
// Name ideas for a new group, with what they usually hold.
const IDEAS = [ [ 'AI', 'AI', 'OpenAI Claude Gemini' ], [ '流媒体', 'Streaming', 'YouTube Netflix Spotify' ], [ '社交', 'Social', 'Telegram Twitter Instagram Facebook' ],
	[ '游戏', 'Games', 'Steam Epic' ], [ '谷歌', 'Google', 'Google' ], [ '苹果', 'Apple', 'Apple' ] ];
const STEPS = [ T('订阅', 'Subscription'), T('分组', 'Groups') ];
const still = matchMedia('(prefers-reduced-motion: reduce)');
const glide = (el, from, ms = 180) => still.matches || el.animate(from, { duration: ms, easing: 'cubic-bezier(.2,.7,.2,1)' });

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const q = s => `'${String(s).replace(/'/g, "''")}'`;
const clean = s => String(s).replace(/[,'"#\n]/g, '').trim().slice(0, 32);
const svg = d => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const IC = {
	grip: svg('M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01'),
	x: svg('M6 6l12 12M18 6 6 18'),
	plus: svg('M12 5v14M5 12h14'),
	check: svg('m5 12.5 4.5 4.5L19 7.5'),
	next: svg('m9 6 6 6-6 6'),
	site: svg('M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-9 9h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z'),
	dev: svg('M7 3h10a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm4 15h2'),
	ip: svg('M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Zm0-9a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z'),
	dir: svg('M4 12h16m-6-6 6 6-6 6'),
	rest: svg('M5 12h.01M12 12h.01M19 12h.01'),
	search: svg('m20 20-4.5-4.5M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z'),
	select: svg('M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01'),
	'url-test': svg('M13 3 4 14h7l-1 7 9-11h-7l1-7Z'),
	smart: svg('M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7-5.6-1.9L10.1 9 12 3.5Z'),
	fallback: svg('m12 3 9 5-9 5-9-5 9-5Zm-9 10 9 5 9-5'),
	'load-balance': svg('M4 12h5m0 0 4-5h7m-11 5 4 5h7m-3-13 3 3-3 3m0 4 3 3-3 3')
};

/* A rule is [ type, value, note? ]; the group it sits in decides where it goes. */
const key = r => r[0] + ',' + r[1];
// Order in the file: devices, sites, IPs, rule sets, then by IP location. Within each, group order.
const rank = r => [ 'SRC-IP-CIDR', 'DOMAIN-SUFFIX', 'IP-CIDR', 'RULE-SET', 'GEOIP' ].indexOf(r[0]);
const line = (r, to) => r[0] == 'RULE-SET' ? `RULE-SET,${MINE}${r[1]},${to}` : `${r[0]},${r[1]},${to}${r[0] == 'IP-CIDR' ? ',no-resolve' : ''}`;

// Only what everyone needs: home network and China go direct, everything else goes abroad on any node.
// 国外 is the catch-all, so it holds no rules of its own; 'd' among its nodes sends the rest direct.
const ABROAD = T('国外', 'Overseas');
const starter = auto => ({ subs: [ '' ], groups: [], direct: GEO.map(g => [ 'GEOIP', g[0] ]), rest: { type: auto, m: [ '*' ] }, mirror: 0 });
const solo = t => t == '*' || t == 'd';   // node choices that stand alone

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
			if (document.querySelector('link[data-yamless]')) return ok();
			const l = document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: L.resource('yamless/rules.css') }));
			l.setAttribute('data-yamless', '');
			l.onload = l.onerror = ok;
		});
		return Promise.all([
			uci.load('openclash').catch(() => null),
			uci.load('dhcp').catch(() => null),
			fs.read(CONF).catch(() => ''),
			fs.read('/tmp/dhcp.leases').catch(() => ''),
			fetch(L.resource('yamless/sets.json'), { cache: 'no-cache' }).then(r => r.json()).catch(() => ({ s: [] })),
			fs.exec(BIN, [ 'core' ]).then(r => r.stdout || '').catch(() => ''),
			css
		]);
	},

	render([ oc, , conf, leases, sets, core ]) {
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
		this.ocSubs = uci.sections('openclash', 'config_subscribe').filter(s => LINK.test(s.address || ''));
		this.using = uci.get('openclash', 'config', 'config_path') || '';
		// Smart core in place, or switched on in OpenClash (which then fetches it on start)
		this.smart = /smart/.test(core) || uci.get('openclash', 'config', 'smart_enable') == '1';
		this.auto = this.smart ? 'smart' : 'url-test';
		const st = stateOf(conf);
		this.saved = !!st;
		this.load2(st || starter(this.auto));
		this.base = st ? this.build() : null;
		this.step = st ? 1 : 0;

		root.innerHTML = `<div class="sr-head"><div><h2>YAMLess</h2>
				<p>${T('粘贴机场订阅，再建几个分组：每组用哪些节点、哪些网站走它。', 'Paste your subscription, then make groups: which nodes each uses and what goes through it.')}</p></div>
				<span class="sr-chip ok sr-live"${this.using == CONF ? '' : ' hidden'}>${T('使用中', 'In use')}</span></div>
			<ol class="sr-steps"></ol>
			<div class="sr-body"></div>
			<div class="cbi-page-actions sr-bar" hidden><span class="sr-bar-t"></span>
				<span class="sr-bar-b"><button type="button" class="btn sr-undo">${T('撤销', 'Undo')}</button><button type="button" class="btn cbi-button-apply sr-save">${T('保存并生效', 'Save & apply')}</button></span></div>`;

		root.querySelector('.sr-steps').onclick = ev => { const b = ev.target.closest('[data-step]'); b && this.go(+b.dataset.step); };
		root.querySelector('.sr-undo').onclick = () => { this.load2(stateOf(this.base) || starter(this.auto)); this.paint(); };
		root.querySelector('.sr-save').onclick = ev => this.save(ev.currentTarget);
		this.wire(root.querySelector('.sr-body'));
		this.paint();
		return root;
	},

	load2(st) {
		this.seq = 0;
		this.subs = st.subs && st.subs.length ? [ ...st.subs ] : [ '' ];
		this.groups = (st.groups || []).map(g => ({ name: g.name, type: g.type, m: [ ...g.m ], r: (g.r || []).map(r => [ ...r ]), k: ++this.seq }));
		this.direct = (st.direct || []).map(r => [ ...r ]);
		this.rest = st.rest ? { type: st.rest.type, m: [ ...st.rest.m ] } : starter(this.auto).rest;
		this.mirror = st.mirror || 0;
	},

	// Every link filled in is a link, and there is at least one.
	valid() {
		return this.subs.some(Boolean) && this.subs.every(u => !u || LINK.test(u));
	},

	wire(body) {
		body.addEventListener('click', ev => {
			const t = ev.target.closest('button');
			if (!t) return;
			const c = t.classList, card = t.closest('.sr-card');
			if (c.contains('sr-go')) this.go(1);
			else if (c.contains('sr-addsub')) { this.subs.push(''); this.paint(); body.querySelector('.sr-sub:last-of-type input').focus(); }
			else if (c.contains('sr-subx')) { this.subs.splice(+t.dataset.i, 1); this.paint(); }
			else if (c.contains('sr-use')) { const i = this.subs.indexOf(''); i < 0 ? this.subs.push(t.dataset.u) : this.subs[i] = t.dataset.u; this.paint(); }
			else if (c.contains('sr-newg')) this.edit(null);
			else if (c.contains('sr-open')) this.edit(card.dataset.k ? this.item(card) : card.dataset.p);
			else if (c.contains('sr-x')) this.drop(card);
		});
		body.addEventListener('change', ev => {
			const c = ev.target.classList;
			if (c.contains('sr-mirror')) this.mirror = +ev.target.value;
			else return;
			this.paint();
		});
		body.addEventListener('input', ev => {
			const t = ev.target, i = t.dataset.sub;
			if (i == null) return;
			this.subs[i] = t.value.trim();
			t.closest('.sr-sub').querySelector('.sr-info').hidden = !this.subs[i] || LINK.test(this.subs[i]);
			this.root.querySelectorAll('.sr-go, [data-step="1"]').forEach(b => b.disabled = !this.valid());
			this.bar();
		});
		body.addEventListener('keydown', ev => {
			if (ev.key == 'Enter' && ev.target.dataset.sub != null) return this.go(1);
			const g = ev.target.closest('.sr-grip'), d = { ArrowUp: -1, ArrowDown: 1 }[ev.key];
			if (!g || !d) return;
			ev.preventDefault();
			const arr = this.groups, i = arr.indexOf(this.item(g)), j = i + d;
			if (j < 0 || j >= arr.length) return;
			[ arr[i], arr[j] ] = [ arr[j], arr[i] ];
			this.paint();
			body.querySelector(`.sr-card[data-k="${arr[j].k}"] .sr-grip`).focus();
		});
		body.addEventListener('pointerdown', ev => { const g = ev.target.closest('.sr-grip'); g && this.drag(ev, g); });
	},

	item(el) {
		const c = el.closest('.sr-card');
		return c && this.groups.find(x => x.k == c.dataset.k);
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
		return g.m.filter(t => t[0] == 'r' && REG.has(t.slice(2))).map(t => REG.get(t.slice(2)).re).join('|');
	},

	snap() {
		return { subs: this.subs.filter(Boolean), groups: this.groups.map(({ name, type, m, r }) => ({ name, type, m, r })),
			direct: this.direct, rest: this.rest, mirror: this.mirror };
	},

	build() {
		const subs = this.subs.filter(Boolean), use = subs.map((u, i) => 'sub' + (i + 1)).join(', ');
		const prov = subs.map((u, i) => [ `  sub${i + 1}:`, '    type: http', `    url: ${q(u)}`, `    path: ./proxy_provider/yamless-${i + 1}.yaml`,
			'    interval: 21600', `    exclude-filter: ${q('(?i)' + JUNK)}`, '    header:', '      User-Agent: [clash.meta]',
			'    health-check:', '      enable: true', `      url: ${PROBE}`, '      interval: 600', '      lazy: true' ].join('\n'));
		const groups = [ { name: ABROAD, ...this.rest }, ...this.groups ].map(g => {
			const f = this.filterOf(g), out = [ `  - name: ${q(g.name)}`, `    type: ${g.type}` ];
			out.push(...f === '' || !subs.length ? [ '    proxies: [DIRECT]' ] : [ `    use: [${use}]`, ...(f ? [ `    filter: ${q(f)}` ] : []) ]);
			if (g.type != 'select') out.push(`    url: ${PROBE}`, '    interval: 300', ...(g.type == 'url-test' ? [ '    tolerance: 50' ] : []));
			return out.join('\n');
		});
		const all = [ ...this.groups.map(g => [ g.r, g.name ]), [ this.direct, 'DIRECT' ] ]
			.flatMap(([ rs, to ]) => rs.map(r => [ r, to ])).sort((a, b) => rank(a[0]) - rank(b[0]));
		const sets = [ ...new Set(all.filter(([ r ]) => r[0] == 'RULE-SET').map(([ r ]) => r[1])) ];
		return [ TAG + JSON.stringify(this.snap()),
			T('# 由 YAMLess 生成，请在那里修改', '# Written by YAMLess; edit it there'),
			'mode: rule',
			'dns:', '  enable: true', '  default-nameserver: [223.5.5.5, 119.29.29.29]',
			'  nameserver: [https://dns.alidns.com/dns-query, https://doh.pub/dns-query]',
			'proxy-providers:' + (prov.length ? '' : ' {}'), ...prov,
			'proxy-groups:' + (groups.length ? '' : ' []'), ...groups,
			'rule-providers:' + (sets.length ? '' : ' {}'),
			...sets.map(n => `  ${MINE}${n}:\n    type: http\n    behavior: classical\n    format: yaml\n    url: ${this.url(n)}\n    path: ./rule_provider/${MINE}${n}.yaml\n    interval: 86400`),
			'rules:', ...all.map(([ r, to ]) => `  - ${q(line(r, to))}${r[2] ? ' # ' + r[2].replace(/\s+/g, ' ') : ''}`),
			`  - ${q('MATCH,' + ABROAD)}`, '' ].join('\n');
	},

	// [ step, message ] for the first thing that would stop the config from working
	problem() {
		if (!this.valid()) return [ 0, T('先填好订阅链接', 'Fill in the subscription link first') ];
		const g = this.groups.find(g => !g.m.length);
		if (g) return [ 1, T(`「${g.name}」还没选节点`, `"${g.name}" has no nodes`) ];
		const s = !this.smart && [ { name: ABROAD, ...this.rest }, ...this.groups ].find(g => g.type == 'smart');
		if (s) return [ 1, T(`「${s.name}」的智能选要 Smart 内核，换一种选法，或在 OpenClash 里打开 Smart 内核`, `"${s.name}" uses Smart, which needs the Smart core; pick another way or turn the Smart core on in OpenClash`) ];
	},

	async save(btn) {
		const bad = this.problem();
		if (bad) { this.go(bad[0]); return ui.addNotification(null, E('p', bad[1]), 'warning'); }
		const text = this.build();
		btn.disabled = true;
		try {
			await fs.write(DRAFT, text);
			const r = await fs.exec(BIN, [ 'apply' ]);
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
		if (step == this.step || step && !this.valid()) return;
		this.step = step;
		this.paint();
		glide(this.root.querySelector('.sr-body'), [ { opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' } ], 240);
		this.root.getBoundingClientRect().top < 0 && this.root.scrollIntoView({ behavior: still.matches ? 'auto' : 'smooth' });
	},

	paint() {
		const R = this.root, ok = this.valid();
		R.querySelector('.sr-steps').innerHTML = STEPS.map((s, i) => `<li><button type="button" data-step="${i}"${i == this.step ? ' aria-current="step"' : i ? ok ? '' : ' disabled' : ok ? ' class="done"' : ''}>
			<i>${i != this.step && !i && ok ? IC.check : i + 1}</i>${s}</button></li>`).join('');
		R.querySelector('.sr-body').innerHTML = this.step ? this.pGroups() : this.pSubs();
		this.bar();
	},

	bar() {
		const text = this.build(), show = this.valid() && text != this.base;
		const bar = this.root.querySelector('.sr-bar');
		bar.hidden = !show;
		bar.querySelector('.sr-undo').hidden = !this.saved;
		const other = this.using && this.using != CONF && this.using.replace(/^.*\/|\.ya?ml$/g, '');
		bar.querySelector('.sr-bar-t').textContent = other
			? T(`生效后 OpenClash 改用这份配置，原来的「${other}」还在，随时能在 OpenClash 里切回去。会断网几秒。`, `Applying switches OpenClash to this config. "${other}" stays and you can switch back in OpenClash. The internet drops for a few seconds.`)
			: T('有改动还没生效。生效时 OpenClash 会重启，断网几秒。', 'Unsaved changes. Applying restarts OpenClash; the internet drops for a few seconds.');
	},

	pSubs() {
		const rows = this.subs.map((u, i) => `<div class="sr-sub"><div class="sr-sub-r"><input class="cbi-input-text" type="url" data-sub="${i}" value="${esc(u)}" placeholder="https://…" autocomplete="off" spellcheck="false" aria-label="${T('订阅链接', 'Subscription link')}">
				${this.subs.length > 1 ? `<button type="button" class="sr-x sr-subx" data-i="${i}" aria-label="${T('删除', 'Delete')}">${IC.x}</button>` : ''}</div>
				<small class="sr-info bad"${!u || LINK.test(u) ? ' hidden' : ''}>${T('这不是一个链接，应以 https:// 开头', 'Not a link; it should start with https://')}</small></div>`).join('');
		const offer = this.ocSubs.filter(s => !this.subs.includes(s.address));
		return `<section class="sr-sec">
				<div class="sr-cap2"><b>${T('订阅链接', 'Subscription link')}</b><small>${T('机场给你的订阅地址', 'The link your provider gave you')}</small></div>
				${rows}
				${this.subs.every(Boolean) ? `<div class="sr-acts"><button type="button" class="btn sr-addsub">${IC.plus}${T('再加一个订阅', 'Add another')}</button></div>` : ''}
				${offer.length ? `<div class="sr-acts"><small>${T('OpenClash 里已有的订阅：', 'Already in OpenClash:')}</small>${offer.map(s => `<button type="button" class="sr-m add sr-use" data-u="${esc(s.address)}">${IC.plus}${esc(s.name || s.address.replace(/^https?:\/\/([^/]+).*/, '$1'))}</button>`).join('')}</div>` : ''}
			</section>
			<div class="sr-next"><button type="button" class="btn cbi-button-action important sr-go"${this.valid() ? '' : ' disabled'}>${T('下一步：分组', 'Next: groups')}${IC.next}</button></div>`;
	},

	pGroups() {
		return `<section class="sr-sec">
				<div class="sr-cap2 row"><span><b>${T('分组', 'Groups')}</b><small>${T('拖动调整顺序，越靠上越优先', 'Drag to reorder; higher groups win')}</small></span>
					<button type="button" class="btn cbi-button-action sr-newg">${IC.plus}${T('新建分组', 'New group')}</button></div>
				${this.groups.length ? `<div class="sr-list">${this.groups.map(g => this.gCard(g)).join('')}</div>`
					: `<div class="sr-empty"><b>${T('还没有分组', 'No groups yet')}</b><p>${T('比如建一个「AI」分组，选美国节点，再把 ChatGPT、Claude 放进去。', 'For example, make an "AI" group with US nodes and put ChatGPT and Claude in it.')}</p>
						<button type="button" class="btn sr-newg">${IC.plus}${T('新建分组', 'New group')}</button></div>`}
				<div class="sr-card sr-g sr-dir" data-p="direct"><button type="button" class="sr-open"><span class="sr-ic">${IC.dir}</span>
					<span class="sr-t"><b>${T('直连', 'Direct')}</b><small>${T('不走代理', 'No proxy')}</small>${this.chips(T('规则', 'Rules'), this.direct)}</span></button></div>
				<div class="sr-card sr-g sr-rest" data-p="rest"><button type="button" class="sr-open"><span class="sr-ic">${IC.rest}</span>
					<span class="sr-t"><b>${ABROAD}</b><small>${this.rest.m.includes('d') ? '' : typeName(this.rest.type) + ' · '}${T('上面都没对上的，都走这里', 'Whatever nothing above matches')}</small>${this.chips(T('节点', 'Nodes'), this.rest.m)}</span></button></div>
			</section>
			<details class="sr-more"><summary>${T('更多', 'More')}</summary>
				<label class="sr-row"><span>${T('规则集下载地址', 'Rule set source')}<small>${T('下载慢或失败时换一个', 'Switch if downloads are slow or fail')}</small></span>
					<select class="cbi-input-select sr-mirror">${MIRRORS.map(([ n ], i) => `<option value="${i}"${i == this.mirror ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
				<p class="sr-foot">${T('规则集来自', 'Rule sets from')} <a href="https://github.com/${REPO}" target="_blank" rel="noreferrer">${REPO}</a></p></details>`;
	},

	mLabel(t) {
		return t == '*' ? T('全部节点', 'All nodes') : t == 'd' ? T('直连', 'Direct') : (REG.get(t.slice(2)) || { name: t.slice(2) }).name;
	},

	// "节点  香港 日本" / "规则  OpenAI Claude +3"
	chips(label, list, empty) {
		const max = 6, more = list.length - max;
		return `<span class="sr-l"><em>${label}</em>${list.length ? list.slice(0, max).map(x => `<span class="sr-m">${esc(typeof x == 'string' ? this.mLabel(x) : this.face(x).title)}</span>`).join('')
			+ (more > 0 ? `<span class="sr-m">+${more}</span>` : '') : `<span class="sr-none">${empty || T('还没有', 'None yet')}</span>`}</span>`;
	},

	gCard(g) {
		return `<div class="sr-card sr-g" data-k="${g.k}">
			<button type="button" class="sr-grip" aria-label="${T('拖动排序', 'Drag to reorder')}">${IC.grip}</button>
			<button type="button" class="sr-open"><span class="sr-ic k-g">${IC[g.type]}</span>
				<span class="sr-t"><b>${esc(g.name)}</b><small>${typeName(g.type)}</small>
					${this.chips(T('节点', 'Nodes'), g.m, `<span class="sr-chip bad">${T('还没选', 'Not chosen')}</span>`)}${this.chips(T('规则', 'Rules'), g.r)}</span></button>
			<button type="button" class="sr-x" aria-label="${T('删除', 'Delete')}">${IC.x}</button></div>`;
	},

	face(r) {
		const [ t, v, n ] = r;
		if (t == 'RULE-SET') {
			const s = this.sets.get(v);
			return { kind: BRAND.has(v) ? 'set brand' : 'set', ic: BRAND.has(v) ? `<svg class="b"><use href="${L.resource('yamless/icons.svg')}#${v}"/></svg>` : `<i>${esc(v[0])}</i>`, title: v, label: s && s.label, sub: T('规则集', 'Rule set') + (s && s.kb >= BIG ? T(` · 较大（${s.kb} KB），多占些内存`, ` · large (${s.kb} KB)`) : '') };
		}
		if (t == 'GEOIP') {
			const g = GEO.find(g => g[0] == v);
			return { kind: 'geo', ic: IC.ip, title: g ? g[1] : v, sub: T('按 IP 归属地，不用下载', 'By IP location, nothing to download') };
		}
		if (t == 'SRC-IP-CIDR') {
			const ip = v.replace(/\/32$/, ''), d = this.devices.find(d => d.ip == ip);
			return { kind: 'dev', ic: IC.dev, title: n || d && d.name || ip, sub: T('设备 · ', 'Device · ') + ip + (this.fixed.has(ip) ? '' : T('，建议在 DHCP 里设为静态', '; give it a static lease')) };
		}
		if (t == 'IP-CIDR') return { kind: 'ip', ic: IC.ip, title: v, sub: T('IP 地址', 'IP address') };
		return { kind: 'site', ic: IC.site, title: v, sub: T('网站（含子域名）', 'Site and subdomains') };
	},

	/* ---------- one group: its nodes on top, what goes through it below ---------- */

	taken(name, g) {
		return [ ...BUILTIN, ABROAD ].some(b => b.toLowerCase() == name.toLowerCase()) || this.groups.some(h => h != g && h.name == name);
	},

	// Who else holds this rule: a group name, 直连, or nothing.
	owner(k, g) {
		const h = this.groups.find(h => h != g && h.r.some(r => key(r) == k));
		return h ? h.name : g != 'direct' && this.direct.some(r => key(r) == k) ? T('直连', 'Direct') : '';
	},

	opt(t, label, on, data = 't') {
		return `<button type="button" class="sr-opt" data-${data}="${esc(t)}" aria-pressed="${!!on}">${esc(label)}</button>`;
	},

	hits(s, dir) {
		s = s.trim().toLowerCase();
		const dev = d => [ 'SRC-IP-CIDR', d.ip + '/32', d.name ];
		if (!s) return [ ...(dir ? GEO.map(g => [ 'GEOIP', g[0] ]) : []), ...POPULAR.filter(n => this.sets.has(n)).map(n => [ 'RULE-SET', n ]), ...this.devices.map(dev) ];
		const out = [];
		let host = '';
		try { host = new URL(/:\/\//.test(s) ? s : 'http://' + s).hostname.replace(/^www\./, ''); } catch (e) {}
		if (/^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(s)) out.push([ 'IP-CIDR', s.includes('/') ? s : s + '/32' ]);
		else if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(host)) out.push([ 'DOMAIN-SUFFIX', host ]);
		for (const g of GEO) if ((g[1] + ' ' + g[2]).toLowerCase().includes(s)) out.push([ 'GEOIP', g[0] ]);
		for (const d of this.devices) if ((d.name + ' ' + d.ip + ' ' + d.mac).toLowerCase().includes(s)) out.push(dev(d));
		const score = e => {
			const n = e.name.toLowerCase();
			return n == s || e.label.toLowerCase() == s ? 4 : n.startsWith(s) ? 3 : e.words.split(' ').some(w => w.startsWith(s)) ? 2 : e.words.includes(s) ? 1 : 0;
		};
		const found = [];
		for (const e of this.sets.values()) { const k = score(e); if (k) found.push([ k + (e.label || e.words.length > e.name.length + 3 ? .5 : 0), e ]); }
		found.sort((a, b) => b[0] - a[0] || a[1].name.length - b[1].name.length);
		return out.concat(found.slice(0, 40).map(([ , e ]) => [ 'RULE-SET', e.name ]));
	},

	// g: a group to edit, null for a new one, 'direct' for the 直连 list, 'rest' for 国外 (nodes only).
	edit(g) {
		const dir = g == 'direct', rest = g == 'rest', fresh = !g;
		const d = dir ? { r: this.direct.map(r => [ ...r ]) } : rest ? { type: this.rest.type, m: [ ...this.rest.m ] }
			: fresh ? { name: '', type: 'select', m: [ '*' ], r: [] } : { name: g.name, type: g.type, m: [ ...g.m ], r: g.r.map(r => [ ...r ]) };
		const box = document.createElement('div');
		box.className = 'sr sr-ed';
		box.innerHTML = (dir ? '' : `${rest ? '' : `<label class="sr-q sr-nm"><input value="${esc(d.name)}" placeholder="${T('名字，比如 AI、流媒体', 'Name, e.g. AI, Streaming')}" maxlength="32" autocomplete="off"></label>
				${fresh ? `<div class="sr-opts sr-ideas">${IDEAS.map(i => T(i[0], i[1])).concat(REGIONS.slice(0, 5).map(r => r.name)).filter(n => !this.group(n)).map(n => this.opt(n, n, false, 'n')).join('')}</div>` : ''}`}
				<p class="sr-cap">${T('用哪些节点', 'Which nodes')}</p><div class="sr-opts sr-mem"></div>
				<div class="sr-how"><p class="sr-cap">${T('怎么选', 'How to choose')}</p><div class="sr-opts sr-types"></div><p class="sr-foot sr-tip"></p></div>`)
			+ (rest ? '' : `<p class="sr-cap">${dir ? T('这些不走代理', 'These skip the proxy') : T('哪些走这个分组', 'What goes through it')}</p>
			<div class="sr-ms sr-chosen"></div>
			<label class="sr-q">${IC.search}<input type="search" class="sr-find" placeholder="${T('搜索服务、粘贴网址或输入设备名', 'Search a service, paste a URL or a device name')}" autocomplete="off"></label>
			<div class="sr-hits"></div>`) + '<p class="sr-err" hidden></p>';
		const $ = s => box.querySelector(s), name = $('.sr-nm input'), find = $('.sr-find'), err = $('.sr-err');
		const paintM = () => {
			if (dir) return;
			$('.sr-mem').innerHTML = [ '*', ...REGIONS.map(r => 'r:' + r.key), ...rest ? [ 'd' ] : [] ].map(t => this.opt(t, this.mLabel(t), d.m.includes(t))).join('');
			$('.sr-how').hidden = d.m.includes('d');
			$('.sr-types').innerHTML = TYPES.filter(([ v ]) => v != 'smart' || this.smart || v == d.type).map(([ v, l ]) => this.opt(v, l, v == d.type, 'y')).join('');
			$('.sr-tip').textContent = (TYPES.find(t => t[0] == d.type) || [])[2] || '';
		};
		let list = [];
		const paintR = () => {
			if (rest) return;
			const has = new Set(d.r.map(key));
			$('.sr-chosen').innerHTML = d.r.map((r, i) => `<span class="sr-m"><span>${esc(this.face(r).title)}</span><button type="button" class="sr-mx" data-i="${i}" aria-label="${T('移除', 'Remove')}">${IC.x}</button></span>`).join('')
				|| `<span class="sr-none">${T('还没有，在下面搜索添加', 'Nothing yet; search below')}</span>`;
			const s = find.value.trim();
			list = this.hits(s, dir);
			const hit = (r, i) => {
				const f = this.face(r), on = has.has(key(r)), o = !on && this.owner(key(r), dir ? 'direct' : g);
				return `<button type="button" class="sr-hit" data-i="${i}" aria-pressed="${on}"><span class="sr-ic k-${f.kind}">${f.ic}</span>
					<span class="sr-t"><b>${esc(f.title)}${f.label ? ` <em>${esc(f.label)}</em>` : ''}</b><small>${esc(o ? T(`现在在「${o}」，选了就移过来`, `Now in "${o}"; picking moves it here`) : f.sub)}</small></span>${on ? IC.check : ''}</button>`;
			};
			const html = list.map(hit);
			$('.sr-hits').innerHTML = s ? html.join('') || `<p class="sr-none">${T('没找到。可以试试英文名，或者直接粘贴网址。', 'Nothing found. Try the English name, or paste a URL.')}</p>`
				: `<p class="sr-cap">${T('常用', 'Popular')}</p><div class="sr-pop">${html.filter((h, i) => list[i][0] != 'SRC-IP-CIDR').join('')}</div>`
					+ (this.devices.length ? `<p class="sr-cap">${T('设备', 'Devices')}</p>` + html.filter((h, i) => list[i][0] == 'SRC-IP-CIDR').join('') : '');
		};
		box.onclick = ev => {
			const b = ev.target.closest('button');
			if (!b) return;
			const t = b.dataset.t, y = b.dataset.y, n = b.dataset.n;
			if (t) {
				const on = d.m.includes(t);
				// "all nodes" and "direct" stand alone; regions combine
				d.m = on ? d.m.filter(x => x != t) : solo(t) ? [ t ] : [ ...d.m.filter(x => !solo(x)), t ];
				paintM();
			}
			else if (y) { d.type = y; paintM(); }
			else if (n) {
				name.value = n;
				const r = REGIONS.find(r => r.name == n), idea = IDEAS.find(i => T(i[0], i[1]) == n);
				if (r) { d.m = [ 'r:' + r.key ]; d.type = this.auto; }
				if (idea) for (const s of idea[2].split(' ')) this.sets.has(s) && !d.r.some(x => x[1] == s) && d.r.push([ 'RULE-SET', s ]);
				paintM(); paintR();
			}
			else if (b.classList.contains('sr-mx')) { d.r.splice(+b.dataset.i, 1); paintR(); }
			else if (b.classList.contains('sr-hit')) {
				const r = list[b.dataset.i], i = d.r.findIndex(x => key(x) == key(r));
				i < 0 ? d.r.push(r) : d.r.splice(i, 1);
				paintR();
			}
			else return;
			err.hidden = true;
		};
		if (find) find.oninput = paintR;
		if (name) name.oninput = () => err.hidden = true;
		const done = () => {
			const v = name ? clean(name.value) : '';
			const bad = dir ? '' : !rest && !v ? T('起个名字', 'Give it a name') : !rest && this.taken(v, g) ? T('这个名字已经用过了', 'That name is taken') : !d.m.length ? T('至少选一项节点', 'Choose at least one') : '';
			if (bad) { err.textContent = bad; err.hidden = false; return err.scrollIntoView({ block: 'nearest' }); }
			if (rest) {
				this.rest = { type: d.m.includes('d') ? 'select' : d.type, m: d.m };
				ui.hideModal();
				this.paint();
				return this.flash('rest');
			}
			// a rule lives in one place: picking it here takes it out of the others
			const mine = new Set(d.r.map(key)), keep = r => !mine.has(key(r));
			for (const h of this.groups) if (h != g) h.r = h.r.filter(keep);
			if (dir) this.direct = d.r;
			else {
				this.direct = this.direct.filter(keep);
				if (fresh) {
					g = { name: v, k: ++this.seq };
					this.groups.push(g);
				}
				Object.assign(g, { name: v, type: d.type, m: d.m, r: d.r });
			}
			ui.hideModal();
			this.paint();
			this.flash(dir ? 'direct' : g.k);
		};
		if (name) name.onkeydown = ev => ev.key == 'Enter' && done();
		paintM();
		paintR();
		ui.showModal(dir ? T('直连', 'Direct') : rest ? ABROAD : fresh ? T('新建分组', 'New group') : g.name, [ box, E('div', { class: 'right' }, [
			E('button', { class: 'btn', click: ui.hideModal }, T('取消', 'Cancel')), ' ',
			E('button', { class: 'btn cbi-button-action', click: done }, fresh ? T('创建', 'Create') : T('完成', 'Done')) ]) ]);
		fresh && requestAnimationFrame(() => name.focus());
	},

	flash(k) {
		const el = this.root.querySelector(`.sr-card[data-${+k ? 'k' : 'p'}="${k}"]`);
		if (!el) return;
		el.classList.add('new');
		el.scrollIntoView({ block: 'nearest', behavior: still.matches ? 'auto' : 'smooth' });
	},

	/* ---------- the list ---------- */

	// Its rules go with it; what they matched falls through to 国外.
	drop(card) {
		const x = this.item(card);
		this.groups = this.groups.filter(g => g != x);
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
			this.groups.sort((a, b) => order.indexOf('' + a.k) - order.indexOf('' + b.k));
			this.bar();
		};
		grip.addEventListener('pointermove', move);
		grip.addEventListener('pointerup', up);
		grip.addEventListener('pointercancel', up);
	}
});
