/* AllBookTab · 新标签页主逻辑
 * 数据源：chrome.bookmarks（实时读取本机书签，不上传）
 */
(function () {
  'use strict';
  var C = window.NavClassifier;
  var QUICK_MAX = 12;
  var RECENT_MAX = 18; // 最近收藏时间线上限（固定 18 条，靠右侧上下箭头滚动查看，每次 3 条）
  var RECENT_PAGE = 3; // 一屏展示条数 / 单次滚动条数
  var LS_QUICK = 'myNavQuickV1';
  var LS_THEME = 'myNavThemeV1';
  var LS_OVERRIDE = 'myNavOverrideV1'; // {bookmarkId: [cat, sub]} 拖拽自定义分类

  // ============ 全局状态 ============
  var ALL = [];          // 全部有效书签 [{id,title,url,cat,sub,tags,dup,host,custom,path}]
  var INVALID = [];      // 无效书签（chrome:// 等）
  var DUPS = [];         // 重复书签（每组保留首个，其余在此）
  var DUP_GROUPS = [];   // 重复分组 [{key,kept,dups[]}]，用于「查看」明细
  var quick = [];        // 快捷入口/收藏 [{t,u,ts}]；ts=收藏时间戳（用于「最近收藏」时间线），老数据缺省 0
  var selTags = [];      // 已选标签（交集/AND：多选逐层收窄，仅此一种模式）
  var kw = '';           // 搜索词
  var observer = null;
  var OVERRIDES = {};    // 用户拖拽指定的分类 {id: [cat, sub]}
  var FAV_OVERRIDES = {}; // 用户自定义 logo {id: dataURL}
  var DRAG_ID = null;    // 正在拖拽的书签 id
  var MOVE_ID = null;    // 「移动到分类」面板当前操作的书签 id
  var CTX_ID = null;     // 右键菜单当前操作的书签 id

  // 触屏检测：hover 不可用 → 按钮常显、用面板替代拖拽
  var IS_TOUCH = !!(window.matchMedia && matchMedia('(hover: none)').matches) || 'ontouchstart' in window;

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
  function flatten(nodes, out, invalid, path) {
    path = path || [];
    nodes.forEach(function (n) {
      if (n.url) {
        var b = { id: n.id, title: (n.title || '').trim() || n.url, url: n.url, dateAdded: n.dateAdded || 0, path: path.join(' / ') };
        if (C.isGarbage(b)) { invalid.push(b); return; }
        var cs = C.classify(b);
        b.cat = cs[0]; b.sub = cs[1];
        var ov = OVERRIDES[b.id]; // 用户拖拽指定的分类优先于自动分类
        if (ov && ov[0]) { b.cat = ov[0]; b.sub = ov[1] || '未分类'; b.custom = true; }
        b.tags = C.tagsOf(b, b.cat);
        b.host = C.hostOf(b.url);
        out.push(b);
      } else if (n.children) {
        flatten(n.children, out, invalid, n.title ? path.concat([n.title]) : path);
      }
    });
  }
  function markDups() {
    DUPS = []; DUP_GROUPS = [];
    var groups = {};
    var order = [];
    ALL.forEach(function (b) {
      var k = C.normUrl(b.url);
      if (!groups[k]) {
        groups[k] = { key: k, kept: b, dups: [] };
        order.push(groups[k]);
        b.dup = false;
      } else {
        b.dup = true; // 卡片右上角「重复」角标
        groups[k].dups.push(b);
        DUPS.push(b);
      }
    });
    DUP_GROUPS = order.filter(function (g) { return g.dups.length; });
  }

  // ============ favicon ============
  /* 三级加载链（解决低分辨率）：
   * 1. favicon.im 高清源（最高 128px）  2. DuckDuckGo 图标  3. 本地 _favicon 缓存（仅 16/32px）
   * 全部失败保留品牌色字母圆标。
   * 远程源走 fetch → blob → objectURL：一次请求同时完成「探测 + 显示 + 白色检测」。
   * 持久缓存升级为 IndexedDB 存图片字节本身：旧方案 localStorage 只存 URL 字符串，
   * 下次会话仍要对 favicon.im 发网络请求，几百个 host 同时发图 → 瞬时 429 → 部分
   * 图标随机加载失败（表现为"时有时无"）。现在首次探测成功即把 blob 落盘，
   * 之后所有会话直接本地读 blob 显示，零网络请求；
   * 瞬时失败只做本会话内存标记，不落盘，下个会话自动重试。
   * 所有远程请求经全局队列限流（并发上限 + 最小间隔），避免触发 429。 */
  var FAV_MEM = {};   // 内存级：host -> null（本会话全链失败的临时标记，不落盘）
  var FAV_OBJ = {};   // host -> blob:objectURL 或本地 URL（本会话显示用）
  var FAV_WAIT = {};  // 并发去重：host -> 在途 Promise
  try { localStorage.removeItem('myNavFavUrl'); localStorage.removeItem('myNavFavWhite'); } catch (e) {} // 清掉旧版缓存
  var FAV_DB = null;
  function favDb() {
    if (FAV_DB) return Promise.resolve(FAV_DB);
    return new Promise(function (res) {
      if (!window.indexedDB) return res(null);
      var rq;
      try { rq = indexedDB.open('myNavFav', 1); } catch (e) { return res(null); }
      rq.onupgradeneeded = function () { rq.result.createObjectStore('fav'); };
      rq.onsuccess = function () { FAV_DB = rq.result; res(FAV_DB); };
      rq.onerror = function () { res(null); };
    });
  }
  function dbGet(host) {
    return favDb().then(function (db) {
      if (!db) return null;
      return new Promise(function (res) {
        try {
          var rq = db.transaction('fav', 'readonly').objectStore('fav').get(host);
          rq.onsuccess = function () { res(rq.result || null); };
          rq.onerror = function () { res(null); };
        } catch (e) { res(null); }
      });
    });
  }
  function dbPut(host, val) {
    favDb().then(function (db) {
      if (!db || !val) return;
      try { db.transaction('fav', 'readwrite').objectStore('fav').put(val, host); } catch (e) {}
    });
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

  /* ---------- 远程请求限流队列 ---------- */
  var FAV_Q = [], FAV_N = 0;
  var FAV_MAX = 6;    // 最大并发
  var FAV_GAP = 120;  // 两个远程请求最小间隔 ms（≈8 req/s，防止 favicon.im 429）
  var FAV_LAST = 0;
  function favQueue(task) {
    return new Promise(function (res) {
      FAV_Q.push({ t: task, r: res });
      favPump();
    });
  }
  function favPump() {
    if (!FAV_Q.length) return;
    var wait = FAV_LAST + FAV_GAP - Date.now();
    if (wait > 0) { setTimeout(favPump, wait); return; }
    if (FAV_N >= FAV_MAX) return;
    FAV_LAST = Date.now();
    FAV_N++;
    (function () {
      var j = FAV_Q.shift();
      Promise.resolve().then(j.t).then(function (v) { FAV_N--; favPump(); j.r(v); },
        function () { FAV_N--; favPump(); j.r(null); });
    })();
    favPump();
  }
  function fetchBlob(src) {
    return favQueue(function () {
      return fetch(src).then(function (r) { return r.ok ? r.blob() : null; })
        .catch(function () { return null; });
    });
  }

  function loadFavUrl(host, pageUrl) {
    if (!host) return Promise.resolve(null);
    if (FAV_OBJ[host] !== undefined) return Promise.resolve(FAV_OBJ[host]);
    if (FAV_WAIT[host]) return FAV_WAIT[host]; // 同 host 的卡片共用一次探测
    var local = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
      ? chrome.runtime.getURL('_favicon/?pageUrl=' + encodeURIComponent(pageUrl) + '&size=32')
      : null;
    var chain = [
      'https://favicon.im/' + host + '?larger=true',
      'https://icons.duckduckgo.com/ip3/' + host + '.ico'
    ];
    if (local) chain.push(local);
    var p = dbGet(host).then(function (cached) {
      if (cached) { // 本地持久缓存命中：零网络请求，秒出
        if (typeof cached === 'string') { FAV_OBJ[host] = cached; return cached; }
        var cu = URL.createObjectURL(cached);
        FAV_OBJ[host] = cu;
        return cu;
      }
      if (FAV_MEM[host] !== undefined) return FAV_MEM[host]; // 本会话已失败，不再重试
      return chain.reduce(function (prev, src) {
        return prev.then(function (u) {
          if (u) return u;
          if (src.indexOf('chrome-extension:') === 0) {
            // 本地 _favicon 是同源资源，img 探测即可（无 CORS、无控制台噪音）
            return probeImg(src).then(function (ok) {
              if (ok) { FAV_OBJ[host] = src; dbPut(host, src); }
              return ok;
            });
          }
          return fetchBlob(src).then(function (blob) {
            if (!blob) return null;
            return new Promise(function (res) {
              var objUrl = URL.createObjectURL(blob);
              var im = new Image();
              var done = false;
              var t = setTimeout(function () { if (!done) { done = true; URL.revokeObjectURL(objUrl); res(null); } }, 6000);
              im.onload = function () {
                if (done) return; done = true; clearTimeout(t);
                if (im.naturalWidth < 16) { URL.revokeObjectURL(objUrl); return res(null); } // 1x1 占位图
                dbPut(host, blob); // 图片字节落盘：之后所有会话本地直读，不再请求 favicon.im
                FAV_OBJ[host] = objUrl;
                res(objUrl); // 白色检测统一在显示时（attachFavicons）做
              };
              im.onerror = function () { if (!done) { done = true; clearTimeout(t); URL.revokeObjectURL(objUrl); res(null); } };
              im.src = objUrl;
            });
          });
        });
      }, Promise.resolve(null));
    });
    FAV_WAIT[host] = p;
    p.then(function (u) {
      delete FAV_WAIT[host];
      if (!u) FAV_MEM[host] = null; // 仅内存标记，下个会话自动重试
    });
    return p;
  }
  function favHtml(host, url, brand, bid) {
    var letter = (host || '?').replace(/^www\./, '').charAt(0).toUpperCase() || '?';
    return '<span class="fav' + (isWhiteHost(host) ? ' fav-white' : '') + '" style="--brand:' + brand + '" data-h="' + esc(host || '') + '" data-bu="' + esc(url) + '"' + (bid ? ' data-bid="' + esc(bid) + '"' : '') + '>' + letter + '</span>';
  }

  /* ---------- 白色图标检测 ----------
   * 部分 logo 是纯白色（如通义千问），放在白色底衬上会隐形。
   * 图标加载后用 canvas 采样像素：近白不透明像素占比 > 90% 判定为白色图标，
   * 给圆标换深色底衬。检测在显示时进行（img 已加载好，blob/本地 URL 同源可读 canvas），
   * 无论图标来自首次探测还是 IndexedDB 缓存都会被检测到。
   * 缓存 key 带 v2：v0.4.6 CORS 报错时代曾把大量白色图标误记为"非白"并永久缓存，
   * 换 key 让全部 host 重新检测一次（纯本地操作，零成本）。内置清单兜底。 */
  var WHITE_HOSTS = ['tongyi.aliyun.com', 'tongyi.com', 'www.tongyi.com', 'qwen.com',
    'www.qwen.com', 'chat.qwen.ai', 'qwen.ai', 'qianwen.com', 'www.qianwen.com'];
  var FAV_WHITE = {};
  try { FAV_WHITE = JSON.parse(localStorage.getItem('myNavFavWhite2') || '{}') || {}; } catch (e) { FAV_WHITE = {}; }
  var FAV_WHITE_TIMER = null;
  function favWhiteSave() {
    clearTimeout(FAV_WHITE_TIMER);
    FAV_WHITE_TIMER = setTimeout(function () {
      try { localStorage.setItem('myNavFavWhite2', JSON.stringify(FAV_WHITE)); } catch (e) {}
    }, 800);
  }
  function isWhiteHost(host) {
    return FAV_WHITE[host] === 1 || WHITE_HOSTS.indexOf(host) !== -1;
  }
  function analyzeWhite(im) {
    try {
      var cv = document.createElement('canvas');
      cv.width = cv.height = 24;
      var cx = cv.getContext('2d');
      cx.drawImage(im, 0, 0, 24, 24);
      var d = cx.getImageData(0, 0, 24, 24).data;
      var n = 0, white = 0;
      for (var i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 200) {
          n++;
          if (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235) white++;
        }
      }
      return n > 10 && white / n > 0.9;
    } catch (e) { return false; } // 异常兜底：内置清单仍生效
  }
  function attachFavicons(root) {
    (root || document).querySelectorAll('.fav[data-bu]').forEach(function (span) {
      var u = span.getAttribute('data-bu');
      var h = span.getAttribute('data-h');
      var bid = span.getAttribute('data-bid');
      span.removeAttribute('data-bu');
      // 自定义 logo 优先（用户上传的图片）
      if (bid && FAV_OVERRIDES[bid]) {
        var oimg = new Image();
        oimg.className = 'favi';
        oimg.onload = function () {
          if (!span.isConnected) return;
          span.textContent = '';
          span.appendChild(oimg);
        };
        oimg.src = FAV_OVERRIDES[bid];
        return;
      }
      loadFavUrl(h, u).then(function (src) {
        if (!src || !span.isConnected) return;
        var img = new Image();
        img.className = 'favi';
        img.onload = function () {
          if (!span.isConnected) return;
          span.textContent = '';
          span.appendChild(img);
          if (FAV_WHITE[h] === 1) { span.classList.add('fav-white'); return; }
          if (FAV_WHITE[h] === undefined) {
            // 显示时直接分析已加载的 img：覆盖首次探测 / IDB 缓存 / 本地 _favicon 全部来源
            var w = analyzeWhite(img);
            FAV_WHITE[h] = w ? 1 : 0;
            favWhiteSave();
            if (w) span.classList.add('fav-white');
          }
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
      for (var j = 0; j < selTags.length; j++) if (b.tags.indexOf(selTags[j]) === -1) return false;
    }
    return true;
  }

  // ============ 分类覆盖（拖拽自定义） ============
  function saveOverrides() {
    try { chrome.storage.local.set({ myNavOverrideV1: OVERRIDES }); } catch (e) {}
    try { localStorage.setItem(LS_OVERRIDE, JSON.stringify(OVERRIDES)); } catch (e) {}
  }
  function assignOverride(id, cat, sub) {
    var b = null;
    for (var i = 0; i < ALL.length; i++) if (ALL[i].id === id) { b = ALL[i]; break; }
    if (!b || !cat) return;
    OVERRIDES[id] = [cat, sub || '未分类'];
    saveOverrides();
    toast('已将「' + b.title.slice(0, 16) + '」移到 ' + cat + ' / ' + (sub || '未分类'));
    reload();
  }
  // ============ 自定义 logo ============
  function saveFavOverrides() {
    try { chrome.storage.local.set({ myNavFavOverridesV1: FAV_OVERRIDES }); } catch (e) {}
  }
  function setFavOverride(id, dataUrl) {
    FAV_OVERRIDES[id] = dataUrl;
    saveFavOverrides();
  }
  function clearFavOverride(id) {
    delete FAV_OVERRIDES[id];
    saveFavOverrides();
  }
  function promptNewCat(id) {
    var name = prompt('新分类名称（可用「分类/子分类」格式，如：学习资源/竞赛）');
    if (!name) return;
    name = name.trim();
    if (!name) return;
    var i = name.indexOf('/');
    var cat = (i > 0 ? name.slice(0, i) : name).trim();
    var sub = (i > 0 ? name.slice(i + 1) : '').trim() || '未分类';
    if (!cat) return;
    assignOverride(id, cat, sub);
  }

  // ============ 移动到分类（右键菜单 / 触屏 ⋯ 按钮） ============
  function openMovePanel(id) {
    MOVE_ID = id;
    var b = null;
    for (var i = 0; i < ALL.length; i++) if (ALL[i].id === id) { b = ALL[i]; break; }
    $('mMoveDesc').textContent = b ? '将「' + b.title.slice(0, 18) + '」移动到：' : '';
    // 用分类统计构建选择列表（含子分类）
    var byCat = {};
    ALL.forEach(function (x) { (byCat[x.cat] = byCat[x.cat] || {})[x.sub] = (byCat[x.cat][x.sub] || 0) + 1; });
    var inOrder = {};
    C.CAT_ORDER.forEach(function (co) { inOrder[co[0]] = 1; });
    var cats = [];
    C.CAT_ORDER.forEach(function (co) { if (byCat[co[0]]) cats.push(co[0]); });
    Object.keys(byCat).filter(function (c) { return !inOrder[c]; })
      .sort(function (a, b) {
        var na = 0, nb = 0;
        Object.keys(byCat[a]).forEach(function (s) { na += byCat[a][s]; });
        Object.keys(byCat[b]).forEach(function (s) { nb += byCat[b][s]; });
        return nb - na;
      })
      .forEach(function (c) { cats.push(c); });
    var html = '';
    cats.forEach(function (cat) {
      var subs = Object.keys(byCat[cat]).sort(function (a, b) { return byCat[cat][b] - byCat[cat][a]; });
      // 当前所在分类高亮（知道书签现在在哪）
      var cur = b && b.cat === cat;
      html += '<div class="mv-group">' +
        '<div class="mv-item' + (cur ? ' cur' : '') + '" data-cat="' + esc(cat) + '"><span class="dot" style="background:' + themeColor(cat) + '"></span><span class="nm">' + esc(cat) + '</span><span class="n">' + (cur ? '当前' : (subs.length ? '整个分类' : byCat[cat][subs[0]])) + '</span></div>';
      if (subs.length > 1) {
        subs.forEach(function (sub) {
          var csub = cur && b.sub === sub;
          html += '<div class="mv-sub' + (csub ? ' cur' : '') + '" data-cat="' + esc(cat) + '" data-sub="' + esc(sub) + '"><span class="snm">' + esc(sub) + '</span><span class="sn">' + (csub ? '当前' : byCat[cat][sub]) + '</span></div>';
        });
      }
      html += '</div>';
    });
    html += '<div class="mv-new" id="mvNew"><span class="plus">＋</span>新建分类<small>分类/子分类</small></div>';
    $('mMoveList').innerHTML = html;
    // 分类/子分类点击
    $('mMoveList').querySelectorAll('.mv-item, .mv-sub').forEach(function (it) {
      it.onclick = function () {
        assignOverride(MOVE_ID, it.dataset.cat, it.dataset.sub || '未分类');
        closeMovePanel();
      };
    });
    // 新建分类
    $('mvNew').onclick = function () {
      var id = MOVE_ID;
      closeMovePanel();
      promptNewCat(id);
    };
    $('moveMask').classList.add('show');
  }
  function closeMovePanel() {
    MOVE_ID = null;
    $('moveMask').classList.remove('show');
  }

  // ============ 右键菜单（编辑 / 移动到级联） ============
  var ctxSubTimer = null;
  function showCtxSub() { clearTimeout(ctxSubTimer); $('ctxSub').style.display = 'block'; }
  function hideCtxSub() { ctxSubTimer = setTimeout(function () { $('ctxSub').style.display = 'none'; }, 220); }
  function openCtxMenu(id, x, y) {
    CTX_ID = id;
    var b = null;
    for (var i = 0; i < ALL.length; i++) if (ALL[i].id === id) { b = ALL[i]; break; }
    // 渲染「移动到」级联子菜单（一级目录 + 二级子分类）
    var byCat = {};
    ALL.forEach(function (x) { (byCat[x.cat] = byCat[x.cat] || {})[x.sub] = (byCat[x.cat][x.sub] || 0) + 1; });
    var inOrder = {};
    C.CAT_ORDER.forEach(function (co) { inOrder[co[0]] = 1; });
    var cats = [];
    C.CAT_ORDER.forEach(function (co) { if (byCat[co[0]]) cats.push(co[0]); });
    Object.keys(byCat).filter(function (c) { return !inOrder[c]; })
      .sort(function (a, b) {
        var na = 0, nb = 0;
        Object.keys(byCat[a]).forEach(function (s) { na += byCat[a][s]; });
        Object.keys(byCat[b]).forEach(function (s) { nb += byCat[b][s]; });
        return nb - na;
      })
      .forEach(function (c) { cats.push(c); });
    var subHtml = '';
    cats.forEach(function (cat) {
      var subs = Object.keys(byCat[cat]).sort(function (a, b) { return byCat[cat][b] - byCat[cat][a]; });
      if (subs.length > 1) {
        subHtml += '<div class="ctx-cat"><span class="dot" style="background:' + themeColor(cat) + '"></span><span>' + esc(cat) + '</span>' +
          '<svg class="carrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>' +
          '<div class="ctx-sub2">' +
          subs.map(function (sub) {
            return '<div class="ctx-leaf" data-cat="' + esc(cat) + '" data-sub="' + esc(sub) + '"><span>' + esc(sub) + '</span><span class="cnt">' + byCat[cat][sub] + '</span></div>';
          }).join('') +
          '</div></div>';
      } else {
        subHtml += '<div class="ctx-leaf" data-cat="' + esc(cat) + '" data-sub="' + esc(subs[0]) + '"><span>' + esc(cat) + '</span><span class="cnt">' + byCat[cat][subs[0]] + '</span></div>';
      }
    });
    $('ctxSub').innerHTML = subHtml;
    // 绑定移动
    $('ctxSub').querySelectorAll('.ctx-leaf').forEach(function (it) {
      it.onclick = function (e) {
        e.stopPropagation();
        assignOverride(CTX_ID, it.dataset.cat, it.dataset.sub || '未分类');
        closeCtxMenu();
      };
    });
    $('ctxSub').querySelectorAll('.ctx-cat').forEach(function (it) {
      it.onclick = function (e) { e.stopPropagation(); }; // 有二级的一级目录本身不直接移动
      it.addEventListener('mouseenter', function () {
        var s2 = it.querySelector('.ctx-sub2');
        if (!s2) return;
        // 强制显示以测量真实尺寸（display:none 时 offsetWidth 恒为 0，是之前从不翻左侧的根因）；测完复位，显隐仍交给 :hover
        s2.style.display = 'block';
        var w = s2.offsetWidth, h = s2.offsetHeight;
        s2.style.display = '';
        var catRect = it.getBoundingClientRect();
        var vw = window.innerWidth, vh = window.innerHeight, GAP = 4;
        // 默认紧贴一级目录右侧（0 间隙，避免移动途中消失）；右侧放不下 → 紧贴其左侧
        var left = catRect.right;
        if (left + w > vw - GAP) left = catRect.left - w;
        if (left < GAP) left = GAP;
        if (left + w > vw - GAP) left = vw - GAP - w;
        if (left < GAP) left = GAP;
        var top = catRect.top; // 默认与该行顶部对齐
        if (top + h > vh - GAP) top = vh - GAP - h; // 底部放不下 → 上移
        if (top < GAP) top = GAP;                    // 顶部放不下 → 下移
        s2.style.left = left + 'px';
        s2.style.top = top + 'px';
        s2.style.right = 'auto';
        s2.style.bottom = 'auto';
      });
    });
    // 编辑（先保存 id，closeCtxMenu 会清空 CTX_ID）
    $('ctxEdit').onclick = function (e) {
      e.stopPropagation();
      var id = CTX_ID;
      closeCtxMenu();
      openEdit(id);
    };
    // 一级「移动到」菜单：显隐交给 JS 缓冲控制，避免从「移动到」移到子菜单途中消失
    $('ctxSub').style.display = 'none';
    $('ctxMove').onmouseenter = showCtxSub;
    $('ctxMove').onmouseleave = hideCtxSub;
    $('ctxSub').onmouseenter = showCtxSub;
    $('ctxSub').onmouseleave = hideCtxSub;
    // 定位：主菜单贴近鼠标（只防自身溢出）
    var m = $('ctxMenu');
    m.classList.add('show');
    var r = m.getBoundingClientRect();
    var px = Math.min(x, window.innerWidth - r.width - 8);
    var py = Math.min(y, window.innerHeight - r.height - 8);
    m.style.left = Math.max(4, px) + 'px';
    m.style.top = Math.max(4, py) + 'px';
    r = m.getBoundingClientRect(); // 设好位置后重新测量，避免用到上一轮残留的旧坐标（修复菜单位置跳变/远离）
    // 「移动到」一级子菜单：紧贴主菜单自适应定位
    //  - 水平：紧贴主菜单右侧（0 间隙）；右侧放不下才紧贴其左侧（始终贴着主菜单，绝不飞到屏幕另一端）
    //  - 垂直：对齐「移动到」行，夹紧在视口内（上下都不超界）
    var subEl = $('ctxSub');
    var moveRect = $('ctxMove').getBoundingClientRect();
    var oldDisp = subEl.style.display;
    subEl.style.display = 'block'; // 同帧测量（立即恢复，不闪烁）
    var subW = subEl.offsetWidth || 170;
    var subH = subEl.offsetHeight || 0;
    subEl.style.display = oldDisp;
    var vw = window.innerWidth, vh = window.innerHeight, GAP = 4;
    var left = (r.right + subW > vw - GAP) ? (r.left - subW) : r.right; // 0 间隙紧贴
    if (left < GAP) left = GAP;                         // 防止越过左边界
    if (left + subW > vw - GAP) left = vw - GAP - subW; // 防止越过右边界
    if (left < GAP) left = GAP;                         // 极窄窗口兜底：贴左边缘
    subEl.style.right = 'auto';
    subEl.style.left = left + 'px';
    var vTop = moveRect.top; // 默认与「移动到」行顶部对齐
    if (vTop + subH > vh - GAP) vTop = vh - GAP - subH; // 底部放不下 → 上移
    if (vTop < GAP) vTop = GAP; // 顶部放不下 → 下移
    subEl.style.top = vTop + 'px';
    subEl.style.bottom = 'auto';
  }
  function closeCtxMenu() {
    CTX_ID = null;
    $('ctxMenu').classList.remove('show');
  }

  // ============ 书签编辑面板 ============
  var EDIT_ID = null;
  function openEdit(id) {
    EDIT_ID = id;
    var b = null;
    for (var i = 0; i < ALL.length; i++) if (ALL[i].id === id) { b = ALL[i]; break; }
    if (!b) return;
    $('eDesc').textContent = '编辑「' + b.title.slice(0, 24) + '」的标题、网址与图标';
    $('eTitle').value = b.title;
    $('eUrl').value = b.url;
    renderEditLogo();
    $('editMask').classList.add('show');
  }
  function closeEdit() {
    EDIT_ID = null;
    $('editMask').classList.remove('show');
  }
  // 编辑面板 Logo 预览：自定义优先，否则显示当前 favicon
  function renderEditLogo() {
    var box = $('eLogoPrev');
    box.innerHTML = '';
    if (FAV_OVERRIDES[EDIT_ID]) {
      var i1 = new Image();
      i1.onload = function () { if (box.isConnected) box.appendChild(i1); };
      i1.src = FAV_OVERRIDES[EDIT_ID];
      return;
    }
    var b = null;
    for (var i = 0; i < ALL.length; i++) if (ALL[i].id === EDIT_ID) { b = ALL[i]; break; }
    // 先显示占位字母，图片加载成功后再替换（避免字母与图片共存破坏居中）
    box.innerHTML = '<span class="no">' + (b.host || '?').charAt(0).toUpperCase() + '</span>';
    loadFavUrl(b.host, b.url).then(function (src) {
      if (!src || !box.isConnected) return;
      var i2 = new Image();
      i2.onload = function () {
        if (!box.isConnected) return;
        box.innerHTML = '';
        box.appendChild(i2);
      };
      i2.src = src;
    });
  }
  function saveEdit() {
    var title = $('eTitle').value.trim();
    var url = $('eUrl').value.trim();
    if (!title) { toast('标题不能为空'); return; }
    if (!url) { toast('网址不能为空'); return; }
    chrome.bookmarks.update(EDIT_ID, { title: title, url: url }, function () {
      if (chrome.runtime.lastError) { toast('保存失败：' + chrome.runtime.lastError.message); return; }
      toast('已保存书签');
      closeEdit();
      reload();
    });
  }

  // 自定义分类的主题色（内置没有的颜色按名字哈希取色）
  var CUSTOM_PALETTE = ['#7c3aed', '#0ea5e9', '#f97316', '#e11d48', '#16a34a', '#0891b2', '#db2777', '#8b5cf6', '#d97706'];
  function themeColor(cat) {
    if (C.CAT_THEME[cat]) return C.CAT_THEME[cat];
    var h = 0;
    for (var i = 0; i < cat.length; i++) h = (h * 31 + cat.charCodeAt(i)) >>> 0;
    return CUSTOM_PALETTE[h % CUSTOM_PALETTE.length];
  }

  // ============ 渲染 ============
  function renderStats() {
    var cats = {};
    ALL.forEach(function (b) { cats[b.cat] = 1; });
    var tagSet = {};
    ALL.forEach(function (b) { b.tags.forEach(function (t) { tagSet[t] = 1; }); });
    $('statsLine').innerHTML = '共 <b>' + ALL.length + '</b> 个站点 · <b>' + Object.keys(cats).length +
      '</b> 个分类 · <b>' + Object.keys(tagSet).length + '</b> 个标签';
  }

  function renderQuick() {
    $('qCount').textContent = quick.length + '/' + QUICK_MAX;
    var el = $('quick');
    if (!quick.length) {
      el.innerHTML = '<div class="quick-empty">' + (IS_TOUCH ? '还没有快捷入口 —— 点书签卡片右上角 ☆ 即可添加（最多 ' : '还没有快捷入口 —— 悬停任意书签卡片点 ☆ 即可添加（最多 ') + QUICK_MAX + ' 个）</div>';
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
    chrome.storage.local.set({ myNavQuickV1: quick });
    localStorage.setItem(LS_QUICK, JSON.stringify(quick));
  }
  function isQuick(url) {
    for (var i = 0; i < quick.length; i++) if (quick[i].u === url) return true;
    return false;
  }

  // 相对时间（最近收藏时间线用）
  function relTime(ts) {
    if (!ts) return '';
    var d = Date.now() - ts, s = Math.floor(d / 1000);
    if (s < 60) return '刚刚';
    var m = Math.floor(s / 60); if (m < 60) return m + '分钟前';
    var h = Math.floor(m / 60); if (h < 24) return h + '小时前';
    var day = Math.floor(h / 24); if (day < 7) return day + '天前';
    var dt = new Date(ts);
    return (dt.getMonth() + 1) + '月' + dt.getDate() + '日';
  }

  // 最近收藏：直接读本机浏览器书签的 dateAdded，按「加入时间」倒序取最近 RECENT_MAX 条，与 ☆ 星标无关
  function renderRecent() {
    var el = $('recent');
    if (!el) return;
    var list = ALL.filter(function (b) { return b.dateAdded; })
      .sort(function (a, b) { return b.dateAdded - a.dateAdded; })
      .slice(0, RECENT_MAX);
    $('rCount').textContent = list.length ? (list.length + ' 条') : '';
    if (!list.length) {
      el.innerHTML = '<div class="recent-empty">还没有检测到带加入时间的书签 —— 当你在浏览器里新增书签，这里会按加入时间展示最近 ' + RECENT_MAX + ' 条</div>';
      el.style.maxHeight = '';
      updateRecentNav();
      return;
    }
    el.innerHTML = list.map(function (b) {
      var host = C.hostOf(b.url);
      return '<div class="rt-item">' +
        '<span class="rt-dot"></span>' +
        '<a class="rt-card" href="' + esc(b.url) + '" target="_blank" rel="noopener" style="--brand:' + C.brandColor(host) + '">' +
          favHtml(host, b.url, C.brandColor(host)) +
          '<span class="rt-meta"><span class="rt-title">' + esc(b.title) + '</span><span class="rt-host">' + esc(host) + '</span></span>' +
        '</a>' +
        '<span class="rt-time">' + relTime(b.dateAdded) + '</span>' +
      '</div>';
    }).join('');
    attachFavicons(el);
    sizeRecentBox();
  }

  /* ---------- 最近收藏滚动：一屏 RECENT_PAGE 条，上下箭头一次滚 3 条 ----------
   * 上限高度按「前 RECENT_PAGE 条的实际高度」动态算，避免写死像素值在
   * 不同字号/缩放下露出半条；不足一屏时不设限高（不出现滚动）。 */
  function sizeRecentBox() {
    var el = $('recent');
    if (!el) return;
    var items = el.querySelectorAll('.rt-item');
    if (items.length > RECENT_PAGE) {
      var first = items[0], last = items[RECENT_PAGE - 1];
      el.style.maxHeight = (last.offsetTop + last.offsetHeight - first.offsetTop) + 'px';
    } else {
      el.style.maxHeight = '';
    }
    el.scrollTop = 0;
    updateRecentNav();
  }

  function updateRecentNav() {
    var el = $('recent'), up = $('recUp'), dn = $('recDown');
    if (!el || !up || !dn) return;
    var scrollable = el.scrollHeight - el.clientHeight > 2;
    up.disabled = !scrollable || el.scrollTop <= 2;
    dn.disabled = !scrollable || (el.scrollTop + el.clientHeight >= el.scrollHeight - 2);
  }

  // 一次滚动 RECENT_PAGE 条：按首条实际高度推算步长，避免硬编码
  function recentScrollStep() {
    var el = $('recent');
    var it = el && el.querySelector('.rt-item');
    if (!it) return 0;
    return RECENT_PAGE * (it.offsetHeight + 8); // 8 = .recent 的 gap
  }

  function renderTagbar() {
    // 全局计数（用于未筛选时展示全部标签及总数）
    var g = {};
    ALL.forEach(function (b) { b.tags.forEach(function (t) { g[t] = (g[t] || 0) + 1; }); });

    // 已选中标签时，按「当前筛选结果」重算每个标签的命中数
    var counts;
    if (selTags.length) {
      counts = {};
      ALL.filter(visible).forEach(function (b) { b.tags.forEach(function (t) { counts[t] = (counts[t] || 0) + 1; }); });
    } else {
      counts = g;
    }

    // 排序始终按全局计数（g），保证筛选前后标签位置不变，仅数字与灰化状态更新
    var names = Object.keys(g).sort(function (a, b) { return g[b] - g[a]; });
    $('tagbar').innerHTML = names.map(function (t) {
      var sel = selTags.indexOf(t) !== -1;
      // 选中态之外的标签：在当前筛选结果里命中数为 0 → 灰色不可选
      var off = !sel && selTags.length > 0 && (counts[t] || 0) === 0;
      return '<span class="tag-chip' + (sel ? ' sel' : '') + (off ? ' off' : '') + '" data-tag="' + esc(t) + '">' + esc(t) + '<span class="tc">' + (counts[t] || 0) + '</span></span>';
    }).join('');
    $('tagbar').querySelectorAll('.tag-chip').forEach(function (chip) {
      chip.onclick = function () {
        if (chip.classList.contains('off')) return; // 灰色标签不可选
        var t = chip.dataset.tag;
        var i = selTags.indexOf(t);
        if (i === -1) selTags.push(t); else selTags.splice(i, 1);
        renderTagbar(); renderMain();
      };
    });
    $('tagClearBtn').classList.toggle('on', selTags.length > 0);
  }

  // 拖拽放置目标绑定
  function bindDrop(el, getCatSub) {
    el.addEventListener('dragover', function (e) {
      if (!DRAG_ID) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.classList.add('drop-hover');
    });
    el.addEventListener('dragleave', function () { el.classList.remove('drop-hover'); });
    el.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('drop-hover');
      if (!DRAG_ID) return;
      var cs = getCatSub();
      if (cs) assignOverride(DRAG_ID, cs[0], cs[1]);
      DRAG_ID = null;
    });
  }

  function renderSidebar(catStats, subStats) {
    var html = '';
    catStats.forEach(function (cs) {
      var open = cs.cat === 'AI 工具' || catStats.length <= 3;
      html += '<div class="side-group' + (open ? ' open' : '') + '" data-cat="' + esc(cs.cat) + '">' +
        '<div class="side-item" data-cat="' + esc(cs.cat) + '"><span class="dot" style="background:' + themeColor(cs.cat) + '"></span>' +
        '<span class="nm">' + esc(cs.cat) + '</span><span class="n">' + cs.n + '</span>' +
        '<span class="chev"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg></span></div>' +
        '<div class="side-subs"><div class="side-subs-inner">';
      (subStats[cs.cat] || []).forEach(function (ss) {
        html += '<div class="side-sub" data-cat="' + esc(cs.cat) + '" data-sub="' + esc(ss.sub) + '"><span class="snm">' + esc(ss.sub) + '</span><span class="sn">' + ss.n + '</span></div>';
      });
      html += '</div></div></div>';
    });
    html += '<div class="side-new" id="sideNew"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>新建分类<small>拖到此处</small></div>';
    $('sideList').innerHTML = html;

    $('sideList').querySelectorAll('.side-item').forEach(function (it) {
      it.onclick = function () { it.parentElement.classList.toggle('open'); };
      bindDrop(it, function () { return [it.dataset.cat, '未分类']; });
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
      bindDrop(it, function () { return [it.dataset.cat, it.dataset.sub]; });
    });
    // sideNew：拖拽高亮 + 放置弹窗新建分类
    var sideNew = $('sideNew');
    sideNew.addEventListener('dragover', function (e) {
      if (!DRAG_ID) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      sideNew.classList.add('drop-hover');
    });
    sideNew.addEventListener('dragleave', function () { sideNew.classList.remove('drop-hover'); });
    sideNew.addEventListener('drop', function (e) {
      e.preventDefault();
      sideNew.classList.remove('drop-hover');
      if (!DRAG_ID) return;
      var id = DRAG_ID;
      DRAG_ID = null;
      promptNewCat(id);
    });

    // 窄屏 chips
    $('chips').innerHTML = catStats.map(function (cs) {
      return '<span class="chip" data-cat="' + esc(cs.cat) + '"><span class="cdot" style="background:' + themeColor(cs.cat) + '"></span>' + esc(cs.cat) + '</span>';
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
    return '<a class="link" draggable="true" data-bid="' + esc(b.id) + '" href="' + esc(b.url) + '" target="_blank" rel="noopener" style="--brand:' + brand + '" data-tags="' + esc(b.tags.join(',')) + '" title="' + (IS_TOUCH ? '点击 ⋯ 可调整分类' : '按住可拖拽到左侧侧边栏调整分类') + '">' +
      '<button class="qadd' + (on ? ' on' : '') + '" data-url="' + esc(b.url) + '" data-title="' + esc(b.title) + '" title="' + (on ? '从快捷入口移除' : '加入快捷入口') + '">' + (on ? '★' : '☆') + '</button>' +
      (IS_TOUCH ? '<button class="mvbtn" data-bid="' + esc(b.id) + '" data-title="' + esc(b.title) + '" title="移动到分类">⋯</button>' : '') +
      '<button class="delbtn" data-bid="' + esc(b.id) + '" title="删除书签"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6"/></svg></button>' +
      favHtml(b.host, b.url, brand, b.id) +
      '<span class="info"><span class="t-wrap"><span class="t">' + esc(b.title) + '</span></span><span class="d">' + esc(b.host) + '</span></span>' +
      (b.custom ? '<button class="reauto" data-bid="' + esc(b.id) + '" title="这个分类是我手动指定的，点击恢复自动分类">↺</button>' : '') +
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
    var inOrder = {};
    C.CAT_ORDER.forEach(function (co) { inOrder[co[0]] = 1; });
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
    // 用户拖拽创建的自定义分类（不在内置顺序表里的）追加在后面，按数量排序
    var customs = Object.keys(byCat).filter(function (c) { return !inOrder[c]; })
      .sort(function (a, b) {
        var na = 0, nb = 0;
        Object.keys(byCat[a]).forEach(function (s) { na += byCat[a][s]; });
        Object.keys(byCat[b]).forEach(function (s) { nb += byCat[b][s]; });
        return nb - na;
      });
    customs.forEach(function (cat) {
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
        '<div class="cat-head"><span class="dot" style="background:' + themeColor(cs.cat) + '"></span>' +
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
    // 拖拽：卡片为拖拽源（触屏设备无 HTML5 拖拽，改用「移动到分类」面板）
    if (!IS_TOUCH) {
      document.querySelectorAll('.link[draggable]').forEach(function (a) {
        a.addEventListener('dragstart', function (e) {
          DRAG_ID = a.dataset.bid;
          try {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', 'allbooktab:' + a.dataset.bid);
          } catch (err) {}
          document.body.classList.add('dragging');
          a.classList.add('drag-src');
        });
        a.addEventListener('dragend', function () {
          DRAG_ID = null;
          document.body.classList.remove('dragging');
          a.classList.remove('drag-src');
          document.querySelectorAll('.drop-hover').forEach(function (el) { el.classList.remove('drop-hover'); });
        });
      });
    }
    // 触屏：卡片「⋯」按钮 → 移动到分类面板
    document.querySelectorAll('.mvbtn').forEach(function (btn) {
      btn.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        openMovePanel(btn.dataset.bid);
      };
    });
    // 桌面：书签卡片右键 → 自定义菜单（编辑 / 移动到级联）
    document.querySelectorAll('.link').forEach(function (a) {
      a.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openCtxMenu(a.dataset.bid, e.clientX, e.clientY);
      });
    });
    // 恢复自动分类
    document.querySelectorAll('.reauto').forEach(function (btn) {
      btn.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        delete OVERRIDES[btn.dataset.bid];
        saveOverrides();
        toast('已恢复自动分类');
        reload();
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
    // 删除书签（两段式确认：第一次点击变深红，3 秒内再点一次才真正删除）
    document.querySelectorAll('.link .delbtn').forEach(function (btn) {
      bindDelBtn(btn);
    });

    renderSidebar(catStats, subStats);
    setupObserver();
  }

  /* 删除按钮通用绑定（两段式确认：第一次点击变深红，3 秒内再点一次才真正删除）
   * 首页卡片与整理面板明细共用；afterDel 为删除成功后的额外动作（默认 reload） */
  function bindDelBtn(btn, afterDel) {
    btn.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (!btn.classList.contains('armed')) {
        btn.classList.add('armed');
        btn.title = '再点一次确认删除';
        btn._tm = setTimeout(function () {
          btn.classList.remove('armed');
          btn.title = '删除书签';
        }, 3000);
        return;
      }
      clearTimeout(btn._tm);
      var id = btn.dataset.bid;
      rmBookmark(id).then(function (ok) {
        if (ok) {
          toast('已删除书签');
          if (afterDel) afterDel(); else reload();
        } else {
          toast('删除失败');
          btn.classList.remove('armed');
          btn.title = '删除书签';
        }
      });
    };
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
  var SCAN_RESULTS = []; // 扫描发现的失效书签 [{id,title,url,path}]
  var SCANNING = false;  // 扫描进行中

  /* 探测单个 URL 的网络可达性：
   * no-cors + HEAD：服务器可达（含 404/403/登录页）→ resolve；
   * DNS 解析失败 / 连接被拒 / 超时 → reject。只标记"完全无法连接"的死链，
   * 不误报需要登录或反爬拦截的站点；无需任何额外权限。 */
  function probeReach(url) {
    return new Promise(function (res) {
      if (!/^https?:\/\//i.test(url)) return res(false);
      var ctrl = new AbortController();
      var t = setTimeout(function () { ctrl.abort(); res(false); }, 8000);
      fetch(url, { method: 'HEAD', mode: 'no-cors', cache: 'no-store', signal: ctrl.signal })
        .then(function () { clearTimeout(t); res(true); })
        .catch(function () { clearTimeout(t); res(false); });
    });
  }

  // 扫描后把仍存在的失效书签并入 INVALID（reload 后也要保持，避免扫描结果丢失）
  function mergeScanIntoInvalid() {
    var ids = {};
    ALL.forEach(function (b) { ids[b.id] = 1; });
    var inInvalid = {};
    INVALID.forEach(function (b) { inInvalid[b.id] = 1; });
    SCAN_RESULTS.forEach(function (b) {
      if (ids[b.id] && !inInvalid[b.id]) { b.scan = true; INVALID.push(b); }
    });
    SCAN_RESULTS = SCAN_RESULTS.filter(function (b) { return ids[b.id]; }); // 清理已被删除的
  }

  async function scanInvalid() {
    if (SCANNING) return;
    if (!ALL.length) { toast('没有可扫描的书签'); return; }
    var n = ALL.length;
    var msg = '即将对全部 ' + n + ' 个书签的网址发起连通性探测。\n\n' +
      '⚠️ 注意事项：\n' +
      '1. 仅能检测「完全无法连接」的书签（网站关闭、域名失效、连接超时）\n' +
      '2. 需要登录、被反爬拦截或返回 404 的网站可能无法准确识别，不会误报\n' +
      '3. 网络波动可能造成个别误报，结果仅供参考，删除前请逐条查看确认\n' +
      '4. 为降低对网站的打扰，扫描会限速进行，约需 1 分钟\n\n确定开始扫描吗？';
    if (!confirm(msg)) return;
    SCANNING = true;
    var btn = $('btnScan');
    btn.disabled = true;
    btn.textContent = '扫描中…';
    $('scanDesc').textContent = '正在扫描 0/' + n;
    SCAN_RESULTS = [];
    var done = 0;
    var queue = ALL.slice();
    async function worker() {
      while (queue.length) {
        var b = queue.shift();
        var ok = await probeReach(b.url);
        if (!ok) SCAN_RESULTS.push(b);
        done++;
        if (done % 10 === 0 || done === n) {
          $('scanDesc').textContent = '正在扫描 ' + done + '/' + n + '，发现 ' + SCAN_RESULTS.length + ' 个';
        }
        await new Promise(function (r) { setTimeout(r, 60); }); // 限速
      }
    }
    var workers = [];
    for (var i = 0; i < 8; i++) workers.push(worker()); // 8 路并发
    await Promise.all(workers);
    SCANNING = false;
    btn.disabled = false;
    btn.textContent = '重新扫描';
    mergeScanIntoInvalid();
    $('scanDesc').textContent = '扫描完成：发现 ' + SCAN_RESULTS.length + ' 个可能失效（已并入下方无效书签，查看后确认清理）';
    toast('扫描完成，发现 ' + SCAN_RESULTS.length + ' 个可能失效的书签');
    openOrganize();
  }

  function openOrganize() {
    var scanN = 0;
    INVALID.forEach(function (b) { if (b.scan) scanN++; });
    $('mStats').innerHTML =
      '<div class="mstat"><b>' + ALL.length + '</b><span>有效书签</span></div>' +
      '<div class="mstat"><b style="color:#f59e0b">' + DUPS.length + '</b><span>重复书签</span></div>' +
      '<div class="mstat"><b style="color:#e11d48">' + INVALID.length + '</b><span>无效书签</span></div>';
    $('dupDesc').textContent = DUPS.length
      ? '保留每组最早加入的一个，删除其余 ' + DUPS.length + ' 个（按 URL 去参数后完全相同才算重复）'
      : '未发现重复书签';
    $('invalidDesc').textContent = INVALID.length
      ? '共 ' + INVALID.length + ' 个（' + (INVALID.length - scanN) + ' 个内部页面 + ' + scanN + ' 个扫描失效）'
      : '未发现无效书签';
    $('btnDup').disabled = !DUPS.length;
    $('btnInvalid').disabled = !INVALID.length;
    $('btnViewDup').disabled = !DUPS.length;
    $('btnViewInvalid').disabled = !INVALID.length;
    $('btnScan').disabled = SCANNING;
    $('btnScan').textContent = SCANNING ? '扫描中…' : (SCAN_RESULTS.length ? '重新扫描' : '开始扫描');
    // 重新打开时收起上次的明细
    [['dupList', 'btnViewDup'], ['invalidList', 'btnViewInvalid']].forEach(function (p) {
      $(p[0]).classList.remove('show'); $(p[0]).innerHTML = '';
      $(p[1]).textContent = '查看';
    });
    $('modalMask').classList.add('show');
  }

  /* ---------- 「查看」明细：去重/清理前先过目 ---------- */
  function bmItem(b, badge, cls) {
    return '<div class="ditem"><span class="dbadge ' + cls + '">' + badge + '</span>' +
      '<a href="' + esc(b.url) + '" target="_blank" rel="noopener" title="' + esc(b.title) + '\n' + esc(b.url) + '">' + esc(b.title) + '</a>' +
      '<span class="dpath" title="' + esc(b.path) + '">' + esc(b.path || '—') + '</span></div>';
  }
  function renderDupList() {
    if (!DUP_GROUPS.length) return '<div class="dempty">没有重复书签</div>';
    return DUP_GROUPS.map(function (g, i) {
      return '<div class="dgroup">' +
        '<div class="dgurl">#' + (i + 1) + ' · ' + esc(g.kept.url) + '</div>' +
        bmItem(g.kept, '保留', 'keep') +
        g.dups.map(function (b) { return bmItem(b, '将删除', 'del'); }).join('') +
        '</div>';
    }).join('');
  }
  function renderInvalidList() {
    if (!INVALID.length) return '<div class="dempty">没有无效书签</div>';
    return INVALID.map(function (b) {
      return '<div class="dgroup"><div class="dgurl">' + esc(b.url) + '</div>' +
        bmItem(b, b.scan ? '扫描失效' : '无效', b.scan ? 'scan' : 'del') +
        '<button class="mdel" data-bid="' + esc(b.id) + '" title="删除书签">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6"/></svg></button>' +
        '</div>';
    }).join('');
  }
  function toggleView(kind) {
    var box = $(kind === 'dup' ? 'dupList' : 'invalidList');
    var btn = $(kind === 'dup' ? 'btnViewDup' : 'btnViewInvalid');
    if (box.classList.contains('show')) {
      box.classList.remove('show'); box.innerHTML = '';
      btn.textContent = '查看';
      return;
    }
    box.innerHTML = kind === 'dup' ? renderDupList() : renderInvalidList();
    if (kind === 'invalid') {
      // 明细里每条无效书签的删除按钮（两段式确认，删除后保持面板打开并刷新明细）
      var bindInvalidDels = function () {
        box.querySelectorAll('.mdel').forEach(function (b) {
          bindDelBtn(b, function () {
            reload().then(function () {
              openOrganize();
              $('invalidList').innerHTML = renderInvalidList();
              $('invalidList').classList.add('show');
              $('btnViewInvalid').textContent = '收起';
              bindInvalidDels();
            });
          });
        });
      };
      bindInvalidDels();
    }
    box.classList.add('show');
    btn.textContent = '收起';
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
    var scanN = 0;
    INVALID.forEach(function (b) { if (b.scan) scanN++; });
    if (!confirm('确定删除 ' + INVALID.length + ' 个无效书签吗？\n' +
      '（其中 ' + scanN + ' 个来自扫描标记，可能为误报，删除前建议先「查看」逐个确认）')) return;
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
    var top = await bmCreate(root, 'AllBookTab 整理 ' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()));
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
    toast('已生成「AllBookTab 整理」文件夹，共复制 ' + count + ' 个书签');
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
    a.download = 'allbooktab-' + d.getFullYear() + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1) + '-' + (d.getDate() < 10 ? '0' : '') + d.getDate() + '.html';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
    toast('已导出整理后的书签 HTML');
  }

  // ============ 主题 ============
  function applyTheme(dark) {
    document.documentElement.dataset.theme = dark ? 'dark' : '';
    $('iconMoon').style.display = dark ? 'none' : '';
    $('iconSun').style.display = dark ? '' : 'none';
    chrome.storage.local.set({ myNavThemeV1: dark });
    localStorage.setItem(LS_THEME, dark ? '1' : '');
  }

  // ============ 初始化 ============
  async function reload() {
    var tree = await getTree();
    ALL = []; INVALID = [];
    flatten(tree, ALL, INVALID);
    ALL.sort(function (a, b) { return (a.dateAdded || 0) - (b.dateAdded || 0); });
    markDups();
    // 清理已删除书签的孤儿覆盖记录
    var ids = {};
    ALL.forEach(function (b) { ids[b.id] = 1; });
    var dirty = false;
    Object.keys(OVERRIDES).forEach(function (k) { if (!ids[k]) { delete OVERRIDES[k]; dirty = true; } });
    if (dirty) saveOverrides();
    mergeScanIntoInvalid(); // 扫描标记的失效书签在书签刷新后保持
    renderStats(); renderTagbar(); renderMain(); renderQuick(); renderRecent();
  }

  function init() {
    $('ver').textContent = 'v' + chrome.runtime.getManifest().version;
    if (IS_TOUCH) document.body.classList.add('touch');

    // 主题（storage 优先，localStorage 兜底）
    var dark = false;
    try { dark = !!JSON.parse(localStorage.getItem(LS_THEME) || 'null'); } catch (e) {}
    try {
      var ov = JSON.parse(localStorage.getItem(LS_OVERRIDE) || 'null');
      if (ov && typeof ov === 'object') OVERRIDES = ov;
    } catch (e) {}
    // 清理 v0.5.2.9 及以前误存的垃圾键（当时用 {n, v} 而非真实 key 写入）
    // myNavRecentNV1 = v0.6.0.16 的「最近收藏数量」手动设置，v0.6.0.18 起改为固定上限+滚动，一并清除
    try { chrome.storage.local.remove(['n', 'v', 'myNavRecentNV1']); } catch (e) {}
    chrome.storage.local.get([LS_THEME, LS_QUICK, 'myNavOverrideV1', 'myNavFavOverridesV1'], function (cfg) {
      if (cfg && cfg[LS_THEME]) dark = true;
      applyTheme(dark);
      if (cfg && cfg.myNavOverrideV1 && typeof cfg.myNavOverrideV1 === 'object') {
        OVERRIDES = cfg.myNavOverrideV1;
      }
      if (cfg && cfg.myNavFavOverridesV1 && typeof cfg.myNavFavOverridesV1 === 'object') {
        FAV_OVERRIDES = cfg.myNavFavOverridesV1;
      }
      if (cfg && Array.isArray(cfg[LS_QUICK])) {
        quick = cfg[LS_QUICK].slice(0, QUICK_MAX).map(function (q) {
          return { t: q.t, u: q.u, ts: q.ts || 0 }; // 老数据缺省 ts=0（排最旧）
        });
      } else {
        try {
          quick = (JSON.parse(localStorage.getItem(LS_QUICK) || '[]') || []).map(function (q) {
            return { t: q.t, u: q.u };
          });
        } catch (e) {}
      }
      reload();
    });
    // 书签变化实时刷新（onImportEnded 覆盖 HTML 批量导入：导入期间事件可能被合并，结束时统一刷新）
    chrome.bookmarks.onCreated.addListener(reload);
    chrome.bookmarks.onRemoved.addListener(reload);
    chrome.bookmarks.onChanged.addListener(reload);
    chrome.bookmarks.onMoved.addListener(reload);
    chrome.bookmarks.onChildrenReordered.addListener(reload);
    chrome.bookmarks.onImportEnded.addListener(reload);

    // 搜索
    var tm = null;
    function syncQClear() {
      $('q').parentElement.classList.toggle('has-q', $('q').value.length > 0);
    }
    $('q').addEventListener('input', function () {
      syncQClear();
      clearTimeout(tm);
      tm = setTimeout(function () { kw = $('q').value.trim().toLowerCase(); renderMain(); updateSuggest(); }, 120);
    });
    // 清除搜索
    $('qClear').onclick = function () {
      $('q').value = '';
      syncQClear();
      kw = '';
      $('suggest').classList.remove('show');
      renderMain();
      $('q').focus();
    };
    // 搜索框输入 → 实时渲染外部搜索（百度/谷歌）候选项（无论有无书签结果）
    function updateSuggest() {
      var box = $('suggest');
      var raw = $('q').value.trim();
      if (!raw) { box.classList.remove('show'); box.innerHTML = ''; return; }
      var e = esc(raw);
      var q = encodeURIComponent(raw);
      box.innerHTML =
        '<div class="s-head">外部搜索</div>' +
        '<a href="https://www.baidu.com/s?wd=' + q + '" target="_blank" rel="noopener" title="百度搜索 ' + e + '"><span class="sico s-bd" aria-hidden="true"></span><span class="s-t">百度搜索<span class="s-kw">“' + e + '”</span></span></a>' +
        '<a href="https://www.google.com/search?q=' + q + '" target="_blank" rel="noopener" title="谷歌搜索 ' + e + '"><span class="sico s-g" aria-hidden="true"></span><span class="s-t">谷歌搜索<span class="s-kw">“' + e + '”</span></span></a>';
      box.classList.add('show');
    }
    document.addEventListener('click', function (e) {
      var s = $('suggest');
      if (!s.classList.contains('show')) return;
      if (e.target.closest && (e.target.closest('#suggest') || e.target === $('q'))) return;
      s.classList.remove('show');
    });
    // 点击其他位置取消删除按钮的确认态
    document.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('.delbtn, .mdel')) return;
      document.querySelectorAll('.delbtn.armed, .mdel.armed').forEach(function (b) {
        clearTimeout(b._tm);
        b.classList.remove('armed');
        b.title = '删除书签';
      });
    }, true);
    // 点击菜单外关闭右键菜单
    document.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('#ctxMenu')) return;
      closeCtxMenu();
    }, true);
    document.addEventListener('contextmenu', function (e) {
      if (e.target.closest && e.target.closest('#ctxMenu')) return;
      closeCtxMenu();
    }, true);
    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('q').focus(); $('q').select(); }
      if (e.key === 'Escape') {
        $('modalMask').classList.remove('show');
        closeMovePanel();
        closeCtxMenu();
        closeEdit();
        $('suggest').classList.remove('show');
      }
    });

    // 标签操作
    $('tagClearBtn').onclick = function () { selTags = []; renderTagbar(); renderMain(); };

    // 主题
    $('themeBtn').onclick = function () {
      applyTheme(document.documentElement.dataset.theme !== 'dark');
    };

    // 整理面板
    $('organizeBtn').onclick = openOrganize;
    $('mClose').onclick = function () { $('modalMask').classList.remove('show'); };
    $('modalMask').onclick = function (e) { if (e.target === $('modalMask')) $('modalMask').classList.remove('show'); };
    // 最近收藏时间线：上下箭头滚动（一次 3 条）
    if ($('recUp')) {
      $('recUp').onclick = function () {
        var el = $('recent');
        el.scrollBy({ top: -recentScrollStep(), behavior: 'smooth' });
      };
      $('recDown').onclick = function () {
        var el = $('recent');
        el.scrollBy({ top: recentScrollStep(), behavior: 'smooth' });
      };
      $('recent').addEventListener('scroll', updateRecentNav);
      window.addEventListener('resize', sizeRecentBox);
    }
    // 移动到分类面板
    $('mMoveClose').onclick = closeMovePanel;
    $('moveMask').onclick = function (e) { if (e.target === $('moveMask')) closeMovePanel(); };
    // 右键菜单
    $('ctxMenu').addEventListener('contextmenu', function (e) { e.preventDefault(); e.stopPropagation(); });
    // 编辑面板
    $('eClose').onclick = closeEdit;
    $('eCancel').onclick = closeEdit;
    $('editMask').onclick = function (e) { if (e.target === $('editMask')) closeEdit(); };
    $('eSave').onclick = saveEdit;
    $('eLogoReset').onclick = function () {
      if (!EDIT_ID) return;
      clearFavOverride(EDIT_ID);
      renderEditLogo();
      refreshCardFav(EDIT_ID);
      toast('已重置为网站默认图标');
    };
    $('eLogoFile').onchange = function () {
      var f = this.files && this.files[0];
      this.value = '';
      if (!f || !EDIT_ID) return;
      if (!/^image\//.test(f.type)) { toast('请选择图片文件'); return; }
      if (f.size > 1024 * 1024) { toast('图片需小于 1MB'); return; }
      var r = new FileReader();
      r.onload = function () {
        setFavOverride(EDIT_ID, r.result);
        renderEditLogo();
        refreshCardFav(EDIT_ID);
        toast('已应用自定义 Logo');
      };
      r.onerror = function () { toast('读取图片失败'); };
      r.readAsDataURL(f);
    };
    $('btnViewDup').onclick = function () { toggleView('dup'); };
    $('btnViewInvalid').onclick = function () { toggleView('invalid'); };
    $('btnDup').onclick = dedupe;
    $('btnInvalid').onclick = cleanInvalid;
    $('btnScan').onclick = scanInvalid;
    $('btnOrganize').onclick = buildOrganizedFolder;
    $('btnExport').onclick = exportHtml;
  }

  // 编辑保存后刷新单张卡片的 favicon（无需整页 reload）
  function refreshCardFav(id) {
    var span = document.querySelector('.link[data-bid="' + id + '"] .fav');
    if (!span) { reload(); return; }
    var b = null;
    for (var i = 0; i < ALL.length; i++) if (ALL[i].id === id) { b = ALL[i]; break; }
    if (!b) { reload(); return; }
    span.innerHTML = (b.host || '?').charAt(0).toUpperCase();
    span.classList.remove('fav-white');
    span.setAttribute('data-h', b.host);
    span.setAttribute('data-bu', b.url); // attachFavicons 会消费并移除
    span.setAttribute('data-bid', b.id);
    attachFavicons(span.closest('.grid'));
  }
  document.addEventListener('DOMContentLoaded', init);
})();
