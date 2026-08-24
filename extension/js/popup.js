/* My Nav · 工具栏弹窗：快速查看书签健康度 */
(function () {
  'use strict';
  var C = window.NavClassifier;
  chrome.bookmarks.getTree(function (tree) {
    var all = [], invalid = [];
    (function walk(nodes) {
      nodes.forEach(function (n) {
        if (n.url) {
          var b = { title: (n.title || '').trim() || n.url, url: n.url };
          if (C.isGarbage(b)) invalid.push(b); else all.push(b);
        } else if (n.children) walk(n.children);
      });
    })(tree);
    var seen = {}, dup = 0;
    all.forEach(function (b) { var k = C.normUrl(b.url); if (seen[k]) dup++; else seen[k] = true; });
    document.getElementById('nAll').textContent = all.length;
    document.getElementById('nDup').textContent = dup;
    document.getElementById('nInv').textContent = invalid.length;
    document.getElementById('stat').style.display = 'flex';
    document.getElementById('sub').textContent = '你的书签健康度一览';
  });
  document.getElementById('open').onclick = function () {
    chrome.tabs.create({ url: 'newtab.html' });
  };
})();
