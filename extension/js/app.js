/* My Nav · 新标签页主逻辑
 * 数据源：chrome.bookmarks（实时读取本机书签，不上传）
 */
(function () {
  'use strict';
  var C = window.NavClassifier;
  var QUICK_MAX = 12;
  var LS_QUICK = 'myNavQuickV1';
  var LS_THEME = 'myNavThemeV1';

  // ============ 全局状态 ============
  var ALL = [];          // 全部有效书签 [{id,title,url,cat,sub,tags,dup,host}]
  var INVALID = [];      // 无效书签（chrome:// 等）
  var DUPS = [];         // 重复书签（每组保留首个，其余在此）
  var quick = [];        // 快捷入口 [{t,u}]
  var selTags = [];      // 已选标签
  var tagModeAny = true; // true=任一命中 false=全部命中
  var kw = '';           // 搜索词
  var observer = null;

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._tm);
    t._tm = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  // ============ 读取书签 ============
  function getTree() {
    return new Promise(function (res) { chrome.bookmarks.getTree(res); });
  }
  function flatten(nodes, out, invalid) {
    nodes.forEach(function (n) {
      if (n.url) {
        var b = { id: n.id, title: (n.title || '').trim() || n.url, url: n.url, dateAdded: n.dateAdded || 0 };
        if (C.isGarbage(b)) { invalid.push(b); return; }
        var cs = C.classify(b);
        b.cat = cs[0]; b.sub = cs[1];
        b.tags = C.tagsOf(b, b.cat);
        b.host = C.hostOf(b.url);
        out.push(b);
      } else if (n.children) flatten(n.children, out, invalid);
    });
  }
  function markDups() {
    DUPS = [];
    var seen = {};
    ALL.forEach(function (b) {
      var k = C.normUrl(b.url);
      if (seen[k]) DUPS.push(b); else seen[k] = true;
    });
  }

  // ============ favicon ============
  /* 三级加载链（解决低分辨率）：
   * 1. favicon.im 高清源（最高 128px）  2. DuckDuckGo 图标  3. 本地 _favicon 缓存（仅 16/32px）
   * 全部失败保留品牌色字母圆标。结果按 host 记忆缓存，筛选重渲染不重复请求。
   * 不用内联 onerror（MV3 CSP 禁止内联事件），用 new Image() 探测。 */
  var FAV_MEM = {};
  try { FAV_MEM = JSON.parse(localStorage.getItem('myNavFavUrl') || '{}') || {}; } catch (e) { FAV_MEM = {}; }
  var FAV_MEM_TIMER = null;
  function favMemSave() {
    clearTimeout(FAV_MEM_TIMER);
    FAV_MEM_TIMER = setTimeout(function () {
      try { localStorage.setItem('myNavFavUrl', JSON.stringify(FAV_MEM)); } catch (e) {}
    }, 800);
  }
  function probeImg(src) {
    return new Promise(function (res) {
      var im = new Image();
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; res(null); } }, 6000);
      im.onload = function () {
        if (done) return; done = true; clearTimeout(t);
        res(im.naturalWidth >= 16 ? src : null); // 过滤 1x1 占位图
      };
      im.onerror = function () { if (!done) { done = true; clearTimeout(t); res(null); } };
      im.src = src;
    });
  }
  function loadFavUrl(host, pageUrl) {
    if (!host) return Promise.resolve(null);
    if (FAV_MEM[host] !== undefined) return Promise.resolve(FAV_MEM[host]);
    var local = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
      ? chrome.runtime.getURL('_favicon/?pageUrl=' + encodeURIComponent(pageUrl) + '&size=32')
      : null;
    var chain = [
      'https://favicon.im/' + host + '?larger=true',
      'https://icons.duckduckgo.com/ip3/' + host + '.ico'
    ];
    if (local) chain.push(local);
    var p = chain.reduce(function (prev, src) {
      return prev.then(function (u) { return u ? u : probeImg(src); });
    }, Promise.resolve(null));
    p.then(function (u) { FAV_MEM[host] = u || null; favMemSave(); });
    FAV_MEM[host] = p; // 并发去重：同 host 的卡片共用一次探测
    return p;
  }
  function favHtml(host, url, brand) {
    var letter = (host || '?').replace(/^www\./, '').charAt(0).toUpperCase() || '?';
    return '<span class="fav" style="--brand:' + brand + '" data-bh="' + esc(host || '') + '" data-bu="' + esc(url) + '">' + letter + '</span>';
  }
  function attachFavicons(root) {
    (root || document).querySelectorAll('.fav[data-bu]').forEach(function (span) {
      var u = span.getAttribute('data-bu');
      var h = span.getAttribute('data-bh');
      span.removeAttribute('data-bu');
      span.removeAttribute('data-bh');
      loadFavUrl(h, u).then(function (src) {
        if (!src || !span.isConnected) return;
        var img = new Image();
        img.className = 'favi';
        img.onload = function () {
          if (!span.isConnected) return;
          span.textContent = '';
          span.appendChild(img);
        };
        img.src = src;
      });
    });
  }

  // ============ 筛选 ============
  function visible(b) {
    if (kw) {
      var hay = (b.title + ' ' + b.url).toLowerCase();
      if (hay.indexOf(kw) === -1) return false;
    }
    if (selTags.length) {
      if (tagModeAny) {
        var hit = false;
        for (var i = 0; i < selTags.length; i++) if (b.tags.indexOf(selTags[i]) !== -1) { hit = true; break; }
        if (!hit) return false;
      } else {
        for (var j = 0; j < selTags.length; j++) if (b.tags.indexOf(selTags[j]) === -1) return false;
      }
    }
    return true;
  }

  // ============ 渲染 ============
  function renderStats() {
    var cats = {};
    ALL.forEach(function (b) { cats[b.cat] = 1; });
    var tagSet = {};
    ALL.forEach(function (b) { b.tags.forEach(function (t) { tagSet[t] = 1; }); });
    $('statsLine').innerHTML = '共 <b>' + ALL.length + '</b> 个站点 · <b>' + Object.keys(cats).length +
      '</b> 个分类 · <b>' + Object.keys(tagSet).length + '</b> 个标签 · 检测到 <b>' + DUPS.length +
      '</b> 个重复 · <b>' + INVALID.length + '</b> 个无效';
  }

  function renderQuick() {
    $('qCount').textContent = quick.length + '/' + QUICK_MAX;
    var el = $('quick');
    if (!quick.length) {
      el.innerHTML = '<div class="quick-empty">还没有快捷入口 —— 悬停任意书签卡片点 ☆ 即可添加（最多 ' + QUICK_MAX + ' 个）</div>';
      return;
    }
    el.innerHTML = quick.map(function (q, i) {
      var host = C.hostOf(q.u);
      return '<div class="qw"><button class="qdel" data-qi="' + i + '" title="移除">✕</button>' +
        '<a class="q" href="' + esc(q.u) + '" target="_blank" rel="noopener" style="--brand:' + C.brandColor(host) + '">' +
        favHtml(host, q.u, C.brandColor(host)) + '<span class="n">' + esc(q.t) + '</span></a></div>';
    }).join('');
    attachFavicons(el);
    el.querySelectorAll('.qdel').forEach(function (btn) {
      btn.onclick = function (e) {
        e.preventDefault();
        quick.splice(+btn.dataset.qi, 1);
        saveQuick();
        renderQuick(); renderMain();
      };
    });
  }
  function saveQuick() {
    chrome.storage.local.set({ n: LS_QUICK, v: quick });
    localStorage.setItem(LS_QUICK, JSON.stringify(quick));
  }
  function isQuick(url) {
    for (var i = 0; i < quick.length; i++) if (quick[i].u === url) return true;
    return false;
  }

  function renderTagbar() {
    var counts = {};
    ALL.forEach(function (b) { b.tags.forEach(function (t) { counts[t] = (counts[t] || 0) + 1; }); });
    var names = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
    $('tagbar').innerHTML = names.map(function (t) {
      var sel = selTags.indexOf(t) !== -1;
      return '<span class="tag-chip' + (sel ? ' sel' : '') + '" data-tag="' + esc(t) + '">' + esc(t) + '<span class="tc">' + counts[t] + '</span></span>';
    }).join('');
    $('tagbar').querySelectorAll('.tag-chip').forEach(function (chip) {
      chip.onclick = function () {
        var t = chip.dataset.tag;
        var i = selTags.indexOf(t);
        if (i === -1) selTags.push(t); else selTags.splice(i, 1);
        renderTagbar(); renderMain();
      };
    });
    $('tagModeBtn').textContent = tagModeAny ? '匹配任一' : '匹配全部';
    $('tagModeBtn').classList.toggle('on', !tagModeAny);
    $('tagClearBtn').classList.toggle('on', selTags.length > 0);
  }

  function renderSidebar(catStats, subStats) {
    var html = '';
    catStats.forEach(function (cs) {
      var open = cs.cat === 'AI 工具' || catStats.length <= 3;
      html += '<div class="side-group' + (open ? ' open' : '') + '" data-cat="' + esc(cs.cat) + '">' +
        '<div class="side-item" data-cat="' + esc(cs.cat) + '"><span class="dot" style="background:' + C.CAT_THEME[cs.cat] + '"></span>' +
        '<span class="nm">' + esc(cs.cat) + '</span><span class="n">' + cs.n + '</span>' +
        '<span class="chev"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg></span></div>' +
        '<div class="side-subs">';
      (subStats[cs.cat] || []).forEach(function (ss) {
        html += '<div class="side-sub" data-sub="' + esc(ss.sub) + '"><span class="snm">' + esc(ss.sub) + '</span><span class="sn">' + ss.n + '</span></div>';
      });
      html += '</div></div>';
    });
    $('sideList').innerHTML = html;

    $('sideList').querySelectorAll('.side-item').forEach(function (it) {
      it.onclick = function () { it.parentElement.classList.toggle('open'); };
    });
    $('sideList').querySelectorAll('.side-sub').forEach(function (it) {
      it.onclick = function () {
        var sec = document.querySelector('.sub-title[data-sub="' + CSS.escape(it.dataset.sub) + '"]');
        if (sec) {
          var cat = sec.closest('.cat');
          if (cat && cat.classList.contains('collapsed')) cat.querySelector('.cat-head').click();
          sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
          setActiveSub(it.dataset.sub);
        }
      };
    });

    // 窄屏 chips
    $('chips').innerHTML = catStats.map(function (cs) {
      return '<span class="chip" data-cat="' + esc(cs.cat) + '"><span class="cdot" style="background:' + C.CAT_THEME[cs.cat] + '"></span>' + esc(cs.cat) + '</span>';
    }).join('');
    $('chips').querySelectorAll('.chip').forEach(function (c) {
      c.onclick = function () {
        var sec = document.querySelector('.cat[data-cat="' + CSS.escape(c.dataset.cat) + '"]');
        if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    });
  }

  function cardHtml(b) {
    var brand = C.brandColor(b.host);
    var on = isQuick(b.url);
    return '<a class="link" href="' + esc(b.url) + '" target="_blank" rel="noopener" style="--brand:' + brand + '" data-tags="' + esc(b.tags.join(',')) + '">' +
      '<button class="qadd' + (on ? ' on' : '') + '" data-url="' + esc(b.url) + '" data-title="' + esc(b.title) + '" title="' + (on ? '从快捷入口移除' : '加入快捷入口') + '">' + (on ? '★' : '☆') + '</button>' +
      favHtml(b.host, b.url, brand) +
      '<span class="info"><span class="t">' + esc(b.title) + '</span><span class="d">' + esc(b.host) + '</span></span>' +
      (b.dup ? '<span class="dupflag" title="检测到重复书签">重复</span>' : '') +
      '</a>';
  }

  function renderMain() {
    var catStats = [], subStats = {}, shown = 0;
    var byCat = {};
    ALL.forEach(function (b) {
      if (!visible(b)) return;
      shown++;
      (byCat[b.cat] = byCat[b.cat] || {})[b.sub] = (byCat[b.cat][b.sub] || 0) + 1;
    });
    C.CAT_ORDER.forEach(function (co) {
      var cat = co[0];
      if (!byCat[cat]) return;
      var subs = Object.keys(byCat[cat]);
      var n = 0;
      subs.forEach(function (s) { n += byCat[cat][s]; });
      catStats.push({ cat: cat, n: n });
      subStats[cat] = subs.sort(function (a, b) { return byCat[cat][b] - byCat[cat][a]; })
        .map(function (s) { return { sub: s, n: byCat[cat][s] }; });
    });

    var html = '';
    catStats.forEach(function (cs) {
      var priv = cs.cat === '私密' ? ' data-private="1"' : '';
      html += '<section class="cat" data-cat="' + esc(cs.cat) + '"' + priv + ' id="cat-' + hashId(cs.cat) + '">' +
        '<div class="cat-head"><span class="dot" style="background:' + C.CAT_THEME[cs.cat] + '"></span>' +
        '<span class="t">' + esc(cs.cat) + '</span><span class="count">' + cs.n + '</span>' +
        '<span class="lock-hint" style="font-size:11px;color:var(--muted)">🔒 点击解锁</span>' +
        '<span class="arrow"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg></span></div><div class="subs">';
      subStats[cs.cat].forEach(function (ss) {
        html += '<div class="sub"><div class="sub-title" data-sub="' + esc(ss.sub) + '" id="sub-' + hashId(cs.cat + '/' + ss.sub) + '">' + esc(ss.sub) + ' · ' + ss.n + '</div><div class="grid">';
        ALL.forEach(function (b) { if (b.cat === cs.cat && b.sub === ss.sub && visible(b)) html += cardHtml(b); });
        html += '</div></div>';
      });
      html += '</div></section>';
    });
    $('main').innerHTML = html;
    attachFavicons($('main'));
    $('empty').classList.toggle('show', shown === 0);

    // 折叠
    document.querySelectorAll('.cat-head').forEach(function (h) {
      h.onclick = function (ev) {
        var cat = h.closest('.cat');
        if (cat.dataset.private === '1' && !cat.classList.contains('unlocked') && !cat.classList.contains('collapsed')) {
          cat.classList.add('unlocked');
          ev.stopPropagation();
          return;
        }
        cat.classList.toggle('collapsed');
      };
    });
    // 快捷入口开关
    document.querySelectorAll('.qadd').forEach(function (btn) {
      btn.onclick = function (e) {
        e.preventDefault(); e.stopPropagation();
        var url = btn.dataset.url;
        if (isQuick(url)) {
          quick = quick.filter(function (q) { return q.u !== url; });
          toast('已从快捷入口移除');
        } else {
          if (quick.length >= QUICK_MAX) { toast('快捷入口已满（' + QUICK_MAX + ' 个）'); return; }
          quick.push({ t: btn.dataset.title, u: url });
          toast('已加入快捷入口 ' + quick.length + '/' + QUICK_MAX);
        }
        saveQuick(); renderQuick();
        btn.textContent = isQuick(url) ? '★' : '☆';
        btn.classList.toggle('on', isQuick(url));
        btn.title = isQuick(url) ? '从快捷入口移除' : '加入快捷入口';
      };
    });

    renderSidebar(catStats, subStats);
    setupObserver();
  }

  function hashId(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = ((h * 31) + s.charCodeAt(i)) >>> 0;
    return 'x' + h.toString(36);
  }
  function setActiveSub(sub) {
    document.querySelectorAll('.side-sub').forEach(function (s) {
      s.classList.toggle('active', s.dataset.sub === sub);
    });
  }
  function setupObserver() {
    if (observer) observer.disconnect();
    var subs = document.querySelectorAll('.sub');
    if (!subs.length) return;
    observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) setActiveSub(en.target.querySelector('.sub-title').dataset.sub);
      });
    }, { rootMargin: '-80px 0px -70% 0px', threshold: 0 });
    subs.forEach(function (s) { observer.observe(s); });
  }

  // ============ 整理面板 ============
  function openOrganize() {
    $('mStats').innerHTML =
      '<div class="mstat"><b>' + ALL.length + '</b><span>有效书签</span></div>' +
      '<div class="mstat"><b style="color:#f59e0b">' + DUPS.length + '</b><span>重复书签</span></div>' +
      '<div class="mstat"><b style="color:#e11d48">' + INVALID.length + '</b><span>无效书签</span></div>';
    $('dupDesc').textContent = DUPS.length
      ? '保留每组最早加入的一个，删除其余 ' + DUPS.length + ' 个（按 URL 去参数后完全相同才算重复）'
      : '未发现重复书签';
    $('invalidDesc').textContent = INVALID.length
      ? '浏览器内部页面等无法访问的书签，共 ' + INVALID.length + ' 个'
      : '未发现无效书签';
    $('btnDup').disabled = !DUPS.length;
    $('btnInvalid').disabled = !INVALID.length;
    $('modalMask').classList.add('show');
  }

  function rmBookmark(id) {
    return new Promise(function (res) { chrome.bookmarks.remove(id, function () { res(!chrome.runtime.lastError); }); });
  }
  function bmCreate(parentId, title, url) {
    return new Promise(function (res) {
      chrome.bookmarks.create(url ? { parentId: parentId, title: title, url: url } : { parentId: parentId, title: title },
        function (n) { res(chrome.runtime.lastError ? null : n); });
    });
  }
  async function findOtherBookmarksRoot() {
    var tree = await getTree();
    var roots = tree[0].children || [];
    for (var i = 0; i < roots.length; i++) {
      if (/other/i.test(roots[i].title) || roots[i].title === '其他书签') return roots[i].id;
    }
    return roots.length > 1 ? roots[1].id : roots[0].id;
  }

  async function dedupe() {
    if (!DUPS.length) return;
    if (!confirm('确定删除 ' + DUPS.length + ' 个重复书签吗？\n（每组保留最早加入的一个，删除前建议先导出备份）')) return;
    var ok = 0;
    for (var i = 0; i < DUPS.length; i++) if (await rmBookmark(DUPS[i].id)) ok++;
    toast('已删除 ' + ok + ' 个重复书签');
    await reload();
    openOrganize();
  }
  async function cleanInvalid() {
    if (!INVALID.length) return;
    if (!confirm('确定删除 ' + INVALID.length + ' 个无效书签吗？（浏览器内部页面等）')) return;
    var ok = 0;
    for (var i = 0; i < INVALID.length; i++) if (await rmBookmark(INVALID[i].id)) ok++;
    toast('已删除 ' + ok + ' 个无效书签');
    await reload();
    openOrganize();
  }
  async function buildOrganizedFolder() {
    toast('正在生成整理文件夹…');
    var root = await findOtherBookmarksRoot();
    var d = new Date();
    var pad = function (x) { return (x < 10 ? '0' : '') + x; };
    var top = await bmCreate(root, 'My Nav 整理 ' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()));
    if (!top) { toast('生成失败'); return; }
    var subCache = {};
    var count = 0;
    var sorted = ALL.slice().sort(function (a, b) { return a.dateAdded - b.dateAdded; });
    for (var i = 0; i < sorted.length; i++) {
      var b = sorted[i];
      var key = b.cat + '/' + b.sub;
      if (!subCache[key]) subCache[key] = await bmCreate(top.id, b.cat + ' / ' + b.sub);
      if (subCache[key]) { await bmCreate(subCache[key].id, b.title, b.url); count++; }
    }
    toast('已生成「My Nav 整理」文件夹，共复制 ' + count + ' 个书签');
  }
  function exportHtml() {
    var rows = {};
    var order = [];
    ALL.forEach(function (b) {
      var key = b.cat + '/' + b.sub;
      if (!rows[key]) { rows[key] = []; order.push(key); }
      rows[key].push(b);
    });
    var d = new Date();
    var s = '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n' +
      '<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n';
    order.forEach(function (key) {
      var parts = key.split('/');
      s += '    <DT><H3>' + esc(parts[0]) + ' / ' + esc(parts[1]) + '</H3>\n    <DL><p>\n';
      rows[key].forEach(function (b) {
        s += '        <DT><A HREF="' + esc(b.url) + '">' + esc(b.title) + '</A>\n';
      });
      s += '    </DL><p>\n';
    });
    s += '</DL><p>\n';
    var blob = new Blob([s], { type: 'text/html' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'my-nav-' + d.getFullYear() + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1) + '-' + (d.getDate() < 10 ? '0' : '') + d.getDate() + '.html';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
    toast('已导出整理后的书签 HTML');
  }

  // ============ 主题 ============
  function applyTheme(dark) {
    document.documentElement.dataset.theme = dark ? 'dark' : '';
    $('iconMoon').style.display = dark ? 'none' : '';
    $('iconSun').style.display = dark ? '' : 'none';
    chrome.storage.local.set({ n: LS_THEME, v: dark });
    localStorage.setItem(LS_THEME, dark ? '1' : '');
  }

  // ============ 初始化 ============
  async function reload() {
    var tree = await getTree();
    ALL = []; INVALID = [];
    flatten(tree, ALL, INVALID);
    ALL.sort(function (a, b) { return (a.dateAdded || 0) - (b.dateAdded || 0); });
    markDups();
    renderStats(); renderTagbar(); renderMain(); renderQuick();
  }

  function init() {
    $('ver').textContent = 'v' + chrome.runtime.getManifest().version;

    // 主题（storage 优先，localStorage 兜底）
    var dark = false;
    try { dark = !!JSON.parse(localStorage.getItem(LS_THEME) || 'null'); } catch (e) {}
    chrome.storage.local.get([LS_THEME, LS_QUICK], function (cfg) {
      if (cfg && cfg[LS_THEME]) dark = true;
      applyTheme(dark);
      if (cfg && Array.isArray(cfg[LS_QUICK])) {
        quick = cfg[LS_QUICK].slice(0, QUICK_MAX);
      } else {
        try { quick = JSON.parse(localStorage.getItem(LS_QUICK) || '[]') || []; } catch (e) {}
      }
      reload();
    });
    // 书签变化实时刷新
    chrome.bookmarks.onCreated.addListener(reload);
    chrome.bookmarks.onRemoved.addListener(reload);
    chrome.bookmarks.onChanged.addListener(reload);
    chrome.bookmarks.onMoved.addListener(reload);

    // 搜索
    var tm = null;
    $('q').addEventListener('input', function () {
      clearTimeout(tm);
      tm = setTimeout(function () { kw = $('q').value.trim().toLowerCase(); renderMain(); }, 120);
    });
    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('q').focus(); $('q').select(); }
      if (e.key === 'Escape') { $('modalMask').classList.remove('show'); }
    });

    // 标签操作
    $('tagModeBtn').onclick = function () { tagModeAny = !tagModeAny; renderTagbar(); renderMain(); };
    $('tagClearBtn').onclick = function () { selTags = []; renderTagbar(); renderMain(); };

    // 主题
    $('themeBtn').onclick = function () {
      applyTheme(document.documentElement.dataset.theme !== 'dark');
    };

    // 整理面板
    $('organizeBtn').onclick = openOrganize;
    $('mClose').onclick = function () { $('modalMask').classList.remove('show'); };
    $('modalMask').onclick = function (e) { if (e.target === $('modalMask')) $('modalMask').classList.remove('show'); };
    $('btnDup').onclick = dedupe;
    $('btnInvalid').onclick = cleanInvalid;
    $('btnOrganize').onclick = buildOrganizedFolder;
    $('btnExport').onclick = exportHtml;
  }
  document.addEventListener('DOMContentLoaded', init);
})();
