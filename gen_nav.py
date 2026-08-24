# -*- coding: utf-8 -*-
"""生成个人网址导航站（苹果简约风，单文件 HTML）
复用 classify_bookmarks.py 的解析/清理/去重/分类逻辑。
"""
import os, re, html, json, collections
from urllib.parse import urlparse

VERSION = "v0.2.1"
GEN_DATE = "2026-08-24"

HERE = os.path.dirname(os.path.abspath(__file__))

# ---------- 复用分类脚本核心逻辑（截断到输出统计之前） ----------
src = open(os.path.join(HERE, "classify_bookmarks.py"), encoding="utf-8").read()
cut = src.index("# ---------- 输出统计 ----------")
ns = {}
exec(compile(src[:cut], "classify_bookmarks.py", "exec"), ns)
bookmarks = ns["bookmarks"]
classify = ns["classify"]

result = collections.defaultdict(lambda: collections.defaultdict(list))
for b in bookmarks:
    c = classify(b)
    result[c[0]][c[1]].append(b)
    b["_cat"] = c[0]

# ---------- 内容类型标签（v0.2：多标签体系，与分类正交） ----------
# 每条规则: (标签名, [正则模式...])，对 标题+URL+原路径 的合并文本匹配
TAG_RULES = [
    ("教程课程", [r"教程", r"入门", r"指南", r"课程", r"学习", r"零基础", r"实战", r"路线",
                r"教学", r"速成", r"小白", r"课堂", r"训练", r"tutorial", r"course", r"learn", r"study", r"camp"]),
    ("文档手册", [r"文档", r"手册", r"规范", r"说明书", r"参考", r"datasheet", r"docs\b", r"document",
                r"wiki", r"reference", r"\bspec\b", r"manual", r"指南针"]),
    ("在线工具", [r"工具", r"转换", r"生成", r"计算", r"编辑", r"压缩", r"格式化", r"在线", r"检测", r"识别",
                r"\btool", r"converter", r"generator", r"editor", r"util", r"\bcli\b"]),
    ("代码仓库", []),  # 特殊规则：按 URL 结构判断
    ("自建服务", []),  # 特殊规则：按 URL/路径判断
    ("社区问答", [r"论坛", r"社区", r"问答", r"交流", r"讨论", r"forum", r"\bbbs\b", r"v2ex", r"reddit",
                r"知乎", r"zhihu", r"segmentfault", r"stackoverflow", r"csdn", r"博客园", r"掘金", r"juejin"]),
    ("博客文章", [r"博客", r"\bblog", r"文章", r"专栏", r"随笔", r"日志", r"笔记", r"post", r"essay",
                r"blogspot", r"wordpress", r"ghost"]),
    ("视频影视", [r"bilibili", r"哔哩", r"\bb站\b", r"youtube", r"视频", r"video", r"电影", r"影视", r"追剧",
                r"美剧", r"日剧", r"动漫", r"番剧", r"anime", r"movie", r"纪录片", r"直播", r"live\b"]),
    ("电子书",   [r"电子书", r"书库", r"图书馆", r"阅读器", r"读书", r"文库", r"\bpdf\b", r"z-?lib", r"zlibrary",
                r"libgen", r"annas", r"kindle", r"小说", r"漫画", r"manga", r"epub", r"书单"]),
    ("资讯新闻", [r"新闻", r"资讯", r"快讯", r"日报", r"周报", r"热点", r"时事", r"news", r"headline",
                r"36kr", r"晚点", r"财新", r"报道", r"专栏作家"]),
    ("下载资源", [r"下载", r"download", r"网盘", r"\bpan\b", r"资源", r"软件站", r"绿色软件", r"便携",
                r"portable", r"磁力", r"种子", r"torrent", r"镜像", r"mirror", r" releases\b", r"破解"]),
    ("设计素材", [r"设计", r"design", r"图标", r"\bicon", r"字体", r"font", r"配色", r"色卡", r"color",
                r"素材", r"图库", r"壁纸", r"wallpaper", r"插画", r"\bui\b", r"figma", r"sketch",
                r"behance", r"dribbble", r"logo", r"摄影", r"图片"]),
    ("行情数据", [r"行情", r"k线", r"走势", r"市值", r"持仓", r"quote", r"chart", r"图表", r"数据平台",
                r"\bapi\b", r"dashboard", r"监控", r"explorer", r"scan\b", r"链上", r"指数", r"财报",
                r"筛选器", r"screener", r"数据"]),
    ("游戏娱乐", [r"游戏", r"\bgame", r"steam", r"itch\.io", r"象棋", r"chess", r"俄罗斯方块", r"tetris",
                r"2048", r"puzzle", r"数独", r"sudoku"]),
    ("AI 对话",  [r"claude", r"chatgpt", r"openai", r"gemini", r"\bkimi\b", r"moonshot", r"\bgrok\b",
                r"deepseek", r"豆包", r"doubao", r"qwen", r"通义", r"chat", r"聊天", r"copilot",
                r"\bpoe\b", r"对话", r"grok", r"脑洞", r"assistant"]),
    ("AI 应用",  [r"(?<![a-z0-9])ai(?![a-z0-9])", r"人工智能", r"大模型", r"\bllm\b", r"\bgpt", r"机器学习",
                r"machine.?learning", r"deep.?learning", r"prompt", r"提示词", r"diffusion", r"midjourney",
                r"绘画", r"生图", r"视频生成", r"数字人", r"语音", r"voice", r"tts", r"asr", r"字幕"]),
    ("求职接单", [r"招聘", r"求职", r"接单", r"外包", r"远程工作", r"兼职", r"\bjob", r"hire", r"freelance",
                r"简历", r"面试", r"薪资", r"upwork", r"猪八戒", r"程序员客栈", r"电鸭"]),
    ("硬件资料", [r"单片机", r"\bmcu\b", r"stm32", r"芯片", r"原理图", r"schematic", r"\bpcb", r"电路",
                r"元器件", r"电容", r"电阻", r"电感", r"\bmos\b", r"运放", r"示波器", r"焊接", r"embedded",
                r"嵌入式", r"esp32", r"arduino", r"\brisc", r"射频", r"\brf\b", r"电源", r"电池", r"充电"]),
    ("娱乐休闲", [r"音乐", r"歌单", r"\bmusic", r"spotify", r"电台", r"podcast", r"播客", r"笑话", r"体育",
                r"足球", r"\bnba\b", r"旅游", r"美食", r"菜谱", r"菜鸟教程|菜谱"]),
    ("生活服务", [r"快递", r"物流", r"缴费", r"银行", r"天气", r"地图", r"外卖", r"健康", r"医疗", r"学信",
                r"社保", r"公积金", r"政务", r"驾校", r"驾照", r"考试报名", r"学校", r"校园", r"话费", r"流量充值"]),
]
TAG_RE = [(name, [re.compile(p, re.I) for p in pats]) for name, pats in TAG_RULES]

# 代码仓库 / 自建服务 用 URL 结构判断；自建服务额外参考原始路径（飞牛/内网等强信号）
RE_REPO = re.compile(r"github\.com/[^/\s]+/[^/\s]+|gitee\.com/[^/\s]+/[^/\s]+")
RE_SELFHOST = re.compile(
    r"jellyfin|emby|plex|qbit|aria2|alist|transmission|portainer|navidrome|"
    r"heimdall|dashy|homepage|n8n|frp|ddns|内网|自建|192\.168\.|10\.0\.|172\.(1[6-9]|2\d|3[01])\.|localhost|:\d{4,5}")
RE_SELFHOST_PATH = re.compile(r"飞牛|内网|自建|远程连接|服务部署")

# 无匹配时的分类兜底标签
CAT_FALLBACK_TAG = {
    "AI 工具": "AI 应用",
    "电子硬件": "硬件资料",
    "金融与投资": "行情数据",
    "NAS 与服务器": "自建服务",
    "开发与编程": "文档手册",
    "学习资源": "教程课程",
    "日常娱乐": "娱乐休闲",
    "工具与实用": "在线工具",
    "生活与工作": "生活服务",
    "私密": None,  # 私密内容不打标签，不进标签筛选
}
MAX_TAGS = 4  # 每条书签最多标签数，避免卡片臃肿

def tags_of(b):
    top = b.get("_cat", "")
    if top == "私密":
        return []
    # 标签只依据标题+URL 判断（原始文件夹路径命名混乱，会引入噪声）
    text = b["title"] + " " + b["url"]
    matched = set()
    if RE_REPO.search(b["url"]):
        matched.add("代码仓库")
    if RE_SELFHOST.search(text) or RE_SELFHOST_PATH.search(" / ".join(b["path"])):
        matched.add("自建服务")
    for name, regs in TAG_RE:
        if any(r.search(text) for r in regs):
            matched.add(name)
    tags = [n for n, _ in TAG_RULES if n in matched][:MAX_TAGS]
    if not tags:
        fb = CAT_FALLBACK_TAG.get(top)
        if fb:
            tags = [fb]
    return tags

for b in bookmarks:
    b["_tags"] = tags_of(b)

tag_counts = collections.Counter()
for b in bookmarks:
    for t in b["_tags"]:
        tag_counts[t] += 1
# 按标签在规则表中的顺序输出（无匹配的标签不展示）
TAGS_JSON = [[name, tag_counts[name]] for name, _ in TAG_RULES if tag_counts.get(name)]

TOP_ORDER = ["AI 工具", "电子硬件", "金融与投资", "NAS 与服务器", "开发与编程",
             "学习资源", "日常娱乐", "工具与实用", "生活与工作", "私密"]

# 分类主题色
CAT_THEME = {
    "AI 工具":        {"accent": "#6366f1", "soft": "#eef2ff"},
    "电子硬件":       {"accent": "#0d9488", "soft": "#f0fdfa"},
    "金融与投资":     {"accent": "#e11d48", "soft": "#fff1f2"},
    "NAS 与服务器":   {"accent": "#7c3aed", "soft": "#f5f3ff"},
    "开发与编程":     {"accent": "#2563eb", "soft": "#eff6ff"},
    "学习资源":       {"accent": "#16a34a", "soft": "#f0fdf4"},
    "日常娱乐":       {"accent": "#ea580c", "soft": "#fff7ed"},
    "工具与实用":     {"accent": "#0891b2", "soft": "#ecfeff"},
    "生活与工作":     {"accent": "#4f46e5", "soft": "#eef2ff"},
    "私密":           {"accent": "#64748b", "soft": "#f1f5f9"},
}

# 快捷入口：默认为空，由用户在页面上自行添加（localStorage 持久化，上限 12 个）
QUICK = []

def esc(s):
    return s.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;").replace(">", "&gt;")

def host_of(url):
    try:
        return urlparse(url).netloc.replace("www.", "")
    except Exception:
        return url

# ---------- 网站品牌色 ----------
BRAND = {
    # AI
    "claude.ai": "#d97757", "openai.com": "#10a37f", "google.com": "#4285f4",
    "x.ai": "#111114", "moonshot.cn": "#4d4dff", "deepseek.com": "#4d6bfe",
    "huggingface.co": "#e8b30c", "modelscope.cn": "#7b3fe4", "openrouter.ai": "#4f46e5",
    "siliconflow.cn": "#3b82f6", "poe.com": "#5e5ce6", "perplexity.ai": "#20808d",
    # 开发
    "github.com": "#24292f", "gitee.com": "#c71d23", "csdn.net": "#fc5531",
    "cnblogs.com": "#2a6dd4", "segmentfault.com": "#00965e", "zhihu.com": "#0084ff",
    "juejin.cn": "#1e80ff", "runoob.com": "#4caf50", "hellogithub.com": "#30bf6b",
    "stackoverflow.com": "#f48024", "lichess.org": "#161512",
    # 硬件
    "szlcsc.com": "#ff6a00", "jlc.com": "#ff6a00", "oshwhub.com": "#00b42a",
    "elecfans.com": "#d7192c", "microchip.com": "#cc0000", "wch.cn": "#e60012",
    "gd32mcu.com": "#0059b3", "waveshare.net": "#d92d20", "semiee.com": "#f59e0b",
    "eda365.com": "#e34d3c", "51hei.com": "#ef4444", "ti.com": "#cc0000",
    "monolithicpower.cn": "#c8102e", "makerworld.com.cn": "#00ae42",
    # 金融
    "binance.com": "#f0b90b", "coinmarketcap.com": "#3f6cff", "coingecko.com": "#8dc63f",
    "okx.com": "#787e87", "dexscreener.com": "#3b82f6", "opensea.io": "#2081e2",
    "pump.fun": "#8bc34a", "gmgn.ai": "#10b981", "etherscan.io": "#21325b",
    "bscscan.com": "#21325b", "solscan.io": "#06b6d4", "basescan.org": "#21325b",
    "tushare.pro": "#3a6ff2", "tradingview.com": "#2962ff", "crypto.com": "#2f6fed",
    # NAS / 工具 / 服务
    "fnnas.com": "#3b6ff5", "tencent.com": "#0052d9", "feishu.cn": "#3370ff",
    "qq.com": "#12b7f5", "mp.weixin.qq.com": "#07c160", "baidu.com": "#2932e1",
    "bejson.com": "#f5a623", "360doc.com": "#3366cc", "reddit.com": "#ff4500",
    "smzdm.com": "#e02424", "artstation.com": "#13aff0", "cctv.com": "#d81e06",
    # 娱乐
    "bilibili.com": "#fb7299", "youtube.com": "#ff0033", "douyin.com": "#161823",
    "netflix.com": "#e50914", "spotify.com": "#1db954", "lichess.org": "#161512",
    # 私密
    "javdb.com": "#d6246e", "javbus.com": "#7c3aed", "missav.ai": "#ec4899",
    "pornhub.com": "#ff9000", "jable.tv": "#db2777",
}

def brand_color(host):
    """域名 -> 品牌色；未收录的域名用哈希生成稳定色"""
    h = (host or "").lower().strip()
    parts = h.split(":")[0].split(".")
    # 先精确匹配，再逐级去掉子域匹配（blog.csdn.net -> csdn.net）
    for i in range(len(parts)):
        suffix = ".".join(parts[i:])
        if suffix in BRAND:
            return BRAND[suffix]
    import hashlib
    hue = int(hashlib.md5(h.encode()).hexdigest(), 16) % 360
    return f"hsl({hue},62%,47%)"

# 内网地址不加载 favicon
def is_local(host):
    import re as _re
    return bool(_re.match(r"^\d+\.\d+\.\d+\.\d+", host)) or "localhost" in host

def favicon_img(host, cls=""):
    """生成 favicon <img>，失败回退 duckduckgo，再失败隐藏（露出字母圆标）"""
    if not host or is_local(host):
        return ""
    h = esc(host.split(":")[0])
    return (f'<img class="favi{cls}" src="https://favicon.im/{h}?larger=true" loading="lazy" alt="" '
            f'referrerpolicy="no-referrer" '
            f'onerror="if(this.dataset.f){{this.style.display=\'none\'}}else{{this.dataset.f=1;'
            f'this.src=\'https://icons.duckduckgo.com/ip3/{h}.ico\'}}">')

def short_title(b):
    t = b["title"]
    if len(t) > 46:
        t = t[:45].rstrip() + "…"
    return t

# ---------- 快捷入口 ----------
quick_items = []
for sub, name in QUICK:
    for b in bookmarks:
        if sub in b["url"]:
            h = host_of(b["url"])
            quick_items.append((b["url"], name, h, brand_color(h)))
            break

# ---------- 统计 ----------
total = len(bookmarks)
cat_count = {t: sum(len(v) for v in result[t].values()) for t in TOP_ORDER if t in result}
quick_json = json.dumps(quick_items, ensure_ascii=False)
total_str = str(total)

# ---------- 组装 HTML ----------
parts = []
parts.append('''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>My Nav · 我的导航站</title>
<style>
:root{
  --bg:#f5f5f7; --card:#ffffff; --text:#1d1d1f; --muted:#86868b;
  --border:rgba(0,0,0,.06); --shadow:0 1px 3px rgba(0,0,0,.05),0 8px 24px rgba(0,0,0,.05);
  --accent:#0071e3; --radius:18px;
}
[data-theme="dark"]{
  --bg:#0b0b0f; --card:#1c1c22; --text:#f5f5f7; --muted:#86868b;
  --border:rgba(255,255,255,.08); --shadow:0 1px 3px rgba(0,0,0,.4),0 8px 24px rgba(0,0,0,.35);
  --accent:#2997ff;
}
*{box-sizing:border-box;margin:0;padding:0}
body{
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Helvetica Neue",Arial,sans-serif;
  background:var(--bg); color:var(--text);
  -webkit-font-smoothing:antialiased; transition:background .3s,color .3s;
}
a{color:inherit;text-decoration:none}

/* ---------- 顶栏 ---------- */
.topbar{
  position:sticky;top:0;z-index:50;display:flex;align-items:center;gap:16px;
  padding:14px 28px;background:color-mix(in srgb,var(--bg) 82%,transparent);
  backdrop-filter:saturate(180%) blur(20px);border-bottom:1px solid var(--border);
}
.brand{display:flex;align-items:center;gap:9px;font-weight:700;font-size:17px;letter-spacing:-.2px;flex-shrink:0}
.brand .logo{width:26px;height:26px;border-radius:8px;background:linear-gradient(135deg,#2997ff,#0071e3);
  display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;font-weight:800}
.search{flex:1;max-width:520px;margin:0 auto;position:relative}
.search input{
  width:100%;padding:9px 40px 9px 38px;border-radius:12px;border:1px solid var(--border);
  background:var(--card);color:var(--text);font-size:14px;outline:none;transition:box-shadow .2s;
}
.search input:focus{box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 25%,transparent)}
.search .sicon{position:absolute;left:13px;top:50%;transform:translateY(-50%);opacity:.45}
.search kbd{
  position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:11px;color:var(--muted);
  border:1px solid var(--border);border-radius:6px;padding:1px 6px;background:var(--bg);font-family:inherit;
}
#themeBtn{
  border:1px solid var(--border);background:var(--card);color:var(--text);width:34px;height:34px;
  border-radius:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;
  transition:transform .15s;
}
#themeBtn:hover{transform:scale(1.06)}
#themeBtn svg{width:16px;height:16px}

/* ---------- 快捷入口 ---------- */
.quick-wrap{padding:26px 28px 4px;max-width:1400px;margin:0 auto}
.quick-label{font-size:13px;color:var(--muted);margin-bottom:12px;letter-spacing:.5px;display:flex;align-items:center;gap:8px}
.quick-label .qcount{font-size:11px;color:var(--muted);background:var(--card);border:1px solid var(--border);padding:1px 8px;border-radius:99px}
.quick{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.quick-empty{
  grid-column:1/-1;font-size:12.5px;color:var(--muted);padding:14px;border:1.5px dashed var(--border);
  border-radius:12px;text-align:center
}
.qw{position:relative}
.qdel{
  position:absolute;top:-7px;right:-7px;width:20px;height:20px;border-radius:99px;border:none;cursor:pointer;
  background:var(--text);color:var(--bg);font-size:10px;line-height:1;display:none;align-items:center;justify-content:center;
  box-shadow:0 2px 8px rgba(0,0,0,.25);z-index:2;padding:0
}
.qw:hover .qdel{display:flex}
.q{
  display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--card);
  border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);
  transition:transform .15s,box-shadow .15s;min-width:0;
}
.q:hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--brand,#0071e3) 45%,transparent);
  box-shadow:0 4px 14px color-mix(in srgb,var(--brand,#0071e3) 20%,transparent)}
.q .fav{flex-shrink:0}
.q .n{font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* ---------- 圆标 ---------- */
.fav{
  position:relative;width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;
  font-size:13px;font-weight:800;color:#fff;flex-shrink:0;letter-spacing:0;
  background:linear-gradient(135deg,var(--brand,#2997ff),color-mix(in srgb,var(--brand,#2997ff) 76%,#000));
}
.fav .favi{
  position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:inherit;
  background:#fff;box-shadow:inset 0 0 0 1px rgba(0,0,0,.05);
}

/* ---------- 布局：侧边栏 + 主内容 ---------- */
.layout{max-width:1400px;margin:0 auto;padding:20px 28px 40px;display:flex;gap:34px;align-items:flex-start}
.sidebar{
  width:196px;flex-shrink:0;position:sticky;top:78px;max-height:calc(100vh - 98px);
  overflow-y:auto;padding:4px 0;scrollbar-width:none;
}
.sidebar::-webkit-scrollbar{display:none}
.side-label{font-size:11px;font-weight:700;color:var(--muted);letter-spacing:1.2px;margin:4px 12px 9px}
.side-group{margin:1px 0}
.side-item{
  display:flex;align-items:center;gap:9px;padding:7px 12px;border-radius:10px;cursor:pointer;
  font-size:13.5px;font-weight:600;color:var(--muted);transition:background .15s,color .15s,box-shadow .15s;
}
.side-item:hover{background:var(--card);color:var(--text)}
.side-item.active{background:var(--card);color:var(--text);box-shadow:var(--shadow)}
.side-item .dot{width:8px;height:8px;border-radius:3px;flex-shrink:0}
.side-item .nm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.side-item .n{margin-left:auto;font-size:11px;color:var(--muted);font-weight:500;flex-shrink:0}
.side-item.active .n{color:var(--accent)}
.side-item .chev{flex-shrink:0;opacity:.45;transition:transform .2s;display:flex;margin-left:1px}
.side-group.open .chev{transform:rotate(90deg)}
.side-subs{display:none;padding:2px 0 5px 15px}
.side-group.open .side-subs{display:block}
.side-sub{
  display:flex;align-items:center;gap:7px;padding:5px 10px;border-radius:8px;cursor:pointer;
  font-size:12.5px;font-weight:500;color:var(--muted);transition:background .15s,color .15s;
}
.side-sub::before{content:'';width:4px;height:4px;border-radius:50%;background:currentColor;opacity:.5;flex-shrink:0}
.side-sub:hover{background:var(--card);color:var(--text)}
.side-sub.active{background:var(--card);color:var(--text)}
.side-sub .snm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.side-sub .sn{margin-left:auto;font-size:10.5px;color:var(--muted);flex-shrink:0}

/* ---------- 窄屏：横滑标签条 ---------- */
.chips{
  display:none;position:sticky;top:61px;z-index:40;gap:8px;overflow-x:auto;
  padding:10px 16px 12px;-webkit-overflow-scrolling:touch;scrollbar-width:none;
  background:color-mix(in srgb,var(--bg) 82%,transparent);backdrop-filter:saturate(180%) blur(20px);
}
.chips::-webkit-scrollbar{display:none}
.chip{
  display:flex;align-items:center;gap:6px;padding:6px 13px;background:var(--card);
  border:1px solid var(--border);border-radius:99px;font-size:12.5px;font-weight:600;
  color:var(--muted);white-space:nowrap;cursor:pointer;box-shadow:var(--shadow);flex-shrink:0;
  transition:color .15s,border-color .15s;
}
.chip .cdot{width:7px;height:7px;border-radius:50%}
.chip.active{color:var(--text);border-color:color-mix(in srgb,var(--accent) 45%,transparent)}
@media (max-width:1100px){
  .sidebar{display:none}
  .chips{display:flex}
}

/* ---------- 分类区块 ---------- */
main{flex:1;min-width:0;padding:0}
.cat{margin-bottom:26px}
.cat-head{
  display:flex;align-items:center;gap:11px;cursor:pointer;user-select:none;
  padding:10px 4px;border-radius:12px;transition:background .15s;
}
.cat-head:hover{background:var(--card)}
.cat-head .dot{width:10px;height:10px;border-radius:3.5px;flex-shrink:0}
.cat-head .t{font-size:19px;font-weight:700;letter-spacing:-.3px}
.cat-head .count{
  font-size:12px;color:var(--muted);background:var(--card);border:1px solid var(--border);
  padding:1px 9px;border-radius:99px;font-weight:600;
}
.cat-head .arrow{margin-left:auto;color:var(--muted);transition:transform .25s;flex-shrink:0}
.cat.collapsed .arrow{transform:rotate(-90deg)}
.cat.collapsed .subs{display:none}
.cat.collapsed .cat-head .count{display:none}

.sub{margin:4px 0 20px}
.sub-title{font-size:13px;font-weight:700;color:var(--muted);letter-spacing:.8px;margin:0 2px 10px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:10px}
.link{
  display:flex;align-items:center;gap:11px;padding:11px 13px;background:var(--card);
  border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);min-width:0;
  transition:transform .15s,box-shadow .15s,border-color .15s;position:relative;
}
.link .qadd{
  position:absolute;top:6px;right:6px;width:24px;height:24px;border-radius:8px;border:none;cursor:pointer;
  display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .15s,background .15s;padding:0;
  background:color-mix(in srgb,var(--brand,#0071e3) 13%,transparent);color:var(--muted);z-index:2;
}
.link:hover .qadd{opacity:1}
.link .qadd.on{opacity:1;color:#f5a623;background:rgba(245,166,35,.16)}
.link .qadd:hover{transform:scale(1.12)}
.link:hover{transform:translateY(-2px);box-shadow:0 6px 18px color-mix(in srgb,var(--brand,#0071e3) 22%,transparent);
  border-color:color-mix(in srgb,var(--brand,#0071e3) 55%,transparent)}
.link .fav{width:32px;height:32px;border-radius:10px;font-size:14px}
.link .info{min-width:0;flex:1}
.link .t{font-size:13.5px;font-weight:600;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-all}
.link .d{font-size:11px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* ---------- 私密分类 ---------- */
.cat[data-private="1"] .subs{filter:blur(7px);pointer-events:none;transition:filter .3s}
.cat[data-private="1"].unlocked .subs{filter:none;pointer-events:auto}
.cat[data-private="1"].collapsed .subs{filter:none}
.lock-hint{display:none}
.cat[data-private="1"].collapsed .lock-hint{display:inline-flex}

/* ---------- 空状态 / toast ---------- */
#empty{display:none;text-align:center;padding:60px 0;color:var(--muted)}
#empty.show{display:block}
#toast{
  position:fixed;left:50%;bottom:30px;transform:translateX(-50%) translateY(16px);opacity:0;
  background:var(--text);color:var(--bg);padding:9px 18px;border-radius:12px;font-size:13px;font-weight:600;
  transition:all .25s;z-index:99;pointer-events:none;box-shadow:0 6px 20px rgba(0,0,0,.2);max-width:80vw
}
#toast.show{opacity:1;transform:translateX(-50%) translateY(0)}

/* ---------- 标签筛选 ---------- */
.tagbar-wrap{max-width:1400px;margin:0 auto;padding:18px 28px 4px}
.tagbar-head{display:flex;align-items:center;gap:12px;margin-bottom:10px;flex-wrap:wrap}
.tagbar-tip{font-size:11.5px;font-weight:500;color:var(--muted)}
.tagbar-ops{margin-left:auto;display:flex;gap:8px}
.tag-op{
  font-size:12px;font-weight:600;padding:5px 13px;border-radius:999px;cursor:pointer;
  border:1px solid var(--border);background:var(--card);color:var(--muted);
  transition:all .15s;font-family:inherit;
}
.tag-op:hover{color:var(--text);border-color:color-mix(in srgb,var(--accent) 40%,transparent)}
.tag-op.on{color:#fff;background:linear-gradient(135deg,var(--accent),#0071e3);border-color:transparent}
.tagbar{
  display:flex;flex-wrap:wrap;gap:8px;padding:14px 16px;border-radius:16px;
  background:var(--card);box-shadow:var(--shadow);border:1px solid var(--border);
}
.tag-chip{
  font-size:12.5px;font-weight:600;padding:5px 12px;border-radius:999px;cursor:pointer;
  border:1px solid var(--border);background:var(--bg);color:var(--muted);
  transition:all .15s;user-select:none;display:inline-flex;align-items:center;gap:5px;
}
.tag-chip:hover{color:var(--text);border-color:color-mix(in srgb,var(--accent) 45%,transparent);transform:translateY(-1px)}
.tag-chip .tc{font-size:10.5px;font-weight:700;opacity:.55}
.tag-chip.sel{background:linear-gradient(135deg,var(--accent),#0071e3);color:#fff;border-color:transparent}
.tag-chip.sel .tc{opacity:.85}

/* ---------- footer ---------- */
footer{
  text-align:center;color:var(--muted);font-size:12.5px;padding:26px 0 40px;
  border-top:1px solid var(--border);margin-top:10px;
}
footer b{color:var(--text)}

.hide{display:none!important}

@media (max-width:640px){
  .layout{padding:14px 16px 32px;gap:0}
  .quick-wrap{padding:20px 16px 4px}
  .tagbar-wrap{padding:16px 16px 4px}
  .topbar{padding:12px 16px}
  .search kbd{display:none}
  .chips{top:57px}
}
</style>
</head>
<body>
<div class="topbar">
  <div class="brand"><span class="logo">N</span><span>My Nav</span></div>
  <div class="search">
    <svg class="sicon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
    <input id="q" type="text" placeholder="搜索全部书签…（名称 / 域名）" autocomplete="off">
    <kbd>⌘K</kbd>
  </div>
  <button id="themeBtn" title="切换深色/浅色">
    <svg id="iconMoon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>
    <svg id="iconSun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="display:none"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg>
  </button>
</div>

<div class="quick-wrap">
  <div class="quick-label">快捷入口 <span class="qcount" id="qCount">0/12</span><span style="font-size:11px">悬停任意书签卡片，点 ☆ 收藏到这里</span></div>
  <div class="quick" id="quick"></div>
</div>

<div class="tagbar-wrap">
  <div class="tagbar-head">
    <span class="quick-label">标签筛选 <span class="tagbar-tip">多选标签，跨分类精准锁定书签</span></span>
    <div class="tagbar-ops">
      <button id="tagMode" class="tag-op" title="切换匹配模式：任意一个标签命中 / 必须同时具备全部标签">匹配任意</button>
      <button id="tagClear" class="tag-op" title="清空已选标签">清空</button>
    </div>
  </div>
  <div class="tagbar" id="tagbar"></div>
</div>

<div class="chips" id="chips"></div>

<div class="layout">
<aside class="sidebar" id="sidebar"><div class="side-label">分类导航</div></aside>
<main id="cats">
<div id="empty">没有找到匹配的书签</div>
''')

# 每类渲染
for top in TOP_ORDER:
    if top not in result:
        continue
    theme = CAT_THEME[top]
    accent = theme["accent"]
    n = cat_count[top]
    private = ' data-private="1"' if top == "私密" else ""
    collapsed = ' collapsed' if top == "私密" else ""
    parts.append(
        f'<section class="cat{collapsed}"{private} data-cat="{esc(top)}" style="--cat:{accent}">\n'
        f'  <div class="cat-head">\n'
        f'    <span class="dot" style="background:{accent}"></span>\n'
        f'    <span class="t">{esc(top)}</span>\n'
        f'    <span class="count">{n}</span>\n'
        f'    <span class="lock-hint" style="font-size:12px;color:var(--muted)">🔒 已锁定，点击展开</span>\n'
        f'    <svg class="arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>\n'
        f'  </div>\n  <div class="subs">\n')
    for sub, items in result[top].items():
        parts.append(f'    <div class="sub" data-sub="{esc(sub)}">\n      <div class="sub-title">{esc(sub)}</div>\n      <div class="grid">\n')
        for b in items:
            host = host_of(b["url"])
            letter = (b["title"].strip() or host)[0].upper()
            color = brand_color(host)
            tag_str = ",".join(b.get("_tags", []))
            title_attr = f' title="{esc(short_title(b))} · {esc(host)}'
            if tag_str:
                title_attr += f' · 标签: {esc(tag_str)}"'
            else:
                title_attr += '"'
            parts.append(
                f'        <a class="link" href="{esc(b["url"])}" target="_blank" rel="noopener" '
                f'data-w="{esc((b["title"] + " " + b["url"] + " " + host).lower())}" '
                f'data-tags="{esc(tag_str)}"{title_attr} '
                f'style="--brand:{color}">\n'
                f'          <span class="fav">{esc(letter)}{favicon_img(host)}</span>\n'
                f'          <span class="info"><span class="t">{esc(short_title(b))}</span><span class="d">{esc(host)}</span></span>\n'
                f'        </a>\n')
        parts.append('      </div>\n    </div>\n')
    parts.append('  </div>\n</section>\n')

parts.append('''</main>
</div>

<footer>
  <b>%TOTAL%</b> 个站点 · <b>My Nav %VERSION%</b> · 生成于 <b>%GEN_DATE%</b> · ⌘K 快速搜索
</footer>

<script>
// ---------- 快捷入口（用户自定义 · localStorage 持久化 · 上限 12 个） ----------
const QUICK_MAX = 12;
const LS_QUICK = 'myNavQuickV1';
const QUICK_SEED = __QUICK_JSON__;
let quickData = null;
try{ quickData = JSON.parse(localStorage.getItem(LS_QUICK) || 'null'); }catch(e){}
if(!Array.isArray(quickData)) quickData = QUICK_SEED.slice();
const qWrap = document.getElementById('quick');
const qCount = document.getElementById('qCount');
function favImg(host){
  if(!host || /^\\d+\\.\\d+\\.\\d+\\.\\d+/.test(host) || host.indexOf('localhost') !== -1) return '';
  const d = host.split(':')[0];
  return '<img class="favi" src="https://favicon.im/' + d + '?larger=true" loading="lazy" alt="" referrerpolicy="no-referrer" '
    + "onerror=\\"if(this.dataset.f){this.style.display='none'}else{this.dataset.f=1;this.src='https://icons.duckduckgo.com/ip3/" + d + ".ico'}\\">";
}
function saveQuick(){ try{ localStorage.setItem(LS_QUICK, JSON.stringify(quickData)); }catch(e){} }
function escQ(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
let toastTimer = null;
function toast(msg){
  let t = document.getElementById('toast');
  if(!t){ t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(function(){ t.classList.remove('show'); }, 1800);
}
function quickRender(){
  qCount.textContent = quickData.length + '/' + QUICK_MAX;
  if(quickData.length === 0){
    qWrap.innerHTML = '<div class="quick-empty">暂无快捷入口 · 悬停任意书签卡片点击 ☆ 即可收藏到这里（最多 ' + QUICK_MAX + ' 个，保存在本机浏览器）</div>';
    return;
  }
  qWrap.innerHTML = quickData.map(function(it, idx){
    const url = it[0], name = it[1], host = it[2], color = it[3] || '#0071e3';
    const h = (host || '').charAt(0).toUpperCase() || name.charAt(0);
    return '<div class="qw" style="--brand:' + color + '">'
      + '<a class="q" href="' + escQ(url) + '" target="_blank" rel="noopener" title="' + escQ(name) + ' · ' + escQ(host) + '">'
      + '<span class="fav">' + h + favImg(host) + '</span>'
      + '<span class="n">' + escQ(name) + '</span></a>'
      + '<button class="qdel" data-i="' + idx + '" title="移除该快捷入口">✕</button></div>';
  }).join('');
}
qWrap.addEventListener('click', function(e){
  const btn = e.target.closest('.qdel');
  if(!btn) return;
  e.preventDefault();
  quickData.splice(+btn.dataset.i, 1);
  saveQuick(); quickRender(); syncStars();
  toast('已从快捷入口移除');
});
function quickIndexOf(url){ return quickData.findIndex(function(it){ return it[0] === url; }); }
function syncStars(){
  document.querySelectorAll('.link').forEach(function(a){ if(a._qsync) a._qsync(); });
}
const STAR = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2l2.9 6.26 6.85.7-5.1 4.6 1.43 6.72L12 16.9 5.92 20.28l1.43-6.72-5.1-4.6 6.85-.7z"/></svg>';
document.querySelectorAll('.link').forEach(function(a){
  const btn = document.createElement('button');
  btn.className = 'qadd'; btn.type = 'button';
  btn.title = '添加到快捷入口'; btn.innerHTML = STAR;
  a._qsync = function(){
    const on = quickIndexOf(a.getAttribute('href')) !== -1;
    btn.classList.toggle('on', on);
    btn.title = on ? '从快捷入口移除' : '添加到快捷入口';
  };
  btn.addEventListener('click', function(e){
    e.preventDefault(); e.stopPropagation();
    const url = a.getAttribute('href');
    const i = quickIndexOf(url);
    if(i !== -1){
      quickData.splice(i, 1); saveQuick(); quickRender(); a._qsync();
      toast('已从快捷入口移除'); return;
    }
    if(quickData.length >= QUICK_MAX){ toast('快捷入口已满（上限 ' + QUICK_MAX + ' 个），先移除一个吧'); return; }
    const host = (a.querySelector('.d') || {}).textContent || '';
    const name = (a.querySelector('.t') || {}).textContent || host || url;
    const color = (a.style.getPropertyValue('--brand') || '').trim() || '#0071e3';
    quickData.push([url, name, host, color]);
    saveQuick(); quickRender(); a._qsync();
    toast('已添加到快捷入口（' + quickData.length + '/' + QUICK_MAX + '）');
  });
  a.appendChild(btn); a._qsync();
});
quickRender();

// ---------- 侧边栏 / 分类快速导航（含二级子分类） ----------
const catEls = document.querySelectorAll('.cat');
const sb = document.getElementById('sidebar');
const chipsWrap = document.getElementById('chips');
const navMap = {};
function scrollToEl(el){
  window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - 70, behavior: 'smooth' });
}
catEls.forEach(function(cat){
  const name = cat.dataset.cat;
  const color = (cat.style.getPropertyValue('--cat') || '').trim() || '#0071e3';
  const priv = cat.dataset.private === '1';
  const n = cat.querySelectorAll('.link').length;

  const group = document.createElement('div');
  group.className = 'side-group';

  const item = document.createElement('div');
  item.className = 'side-item';
  const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = color;
  const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = priv ? '🔒 ' + name : name;
  item.appendChild(dot); item.appendChild(nm);
  const hasSubs = !priv && cat.querySelectorAll('.sub').length > 0;
  if(hasSubs){
    const chev = document.createElement('span'); chev.className = 'chev';
    chev.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
    item.appendChild(chev);
  }
  const cnt = document.createElement('span'); cnt.className = 'n'; cnt.textContent = n;
  item.appendChild(cnt);
  item.addEventListener('click', function(){
    const wasOpen = group.classList.contains('open');
    document.querySelectorAll('.side-group.open').forEach(function(g){ g.classList.remove('open'); });
    if(!wasOpen) group.classList.add('open');
    scrollToEl(cat);
  });
  group.appendChild(item);

  if(hasSubs){
    const subsWrap = document.createElement('div');
    subsWrap.className = 'side-subs';
    cat.querySelectorAll('.sub').forEach(function(subEl){
      const si = document.createElement('div');
      si.className = 'side-sub';
      const snm = document.createElement('span'); snm.className = 'snm'; snm.textContent = subEl.dataset.sub;
      const sn = document.createElement('span'); sn.className = 'sn'; sn.textContent = subEl.querySelectorAll('.link').length;
      si.appendChild(snm); si.appendChild(sn);
      subEl._nav = si;
      si.addEventListener('click', function(e){ e.stopPropagation(); scrollToEl(subEl); });
      subsWrap.appendChild(si);
    });
    group.appendChild(subsWrap);
  }
  sb.appendChild(group);

  const chip = document.createElement('div');
  chip.className = 'chip';
  const cdot = document.createElement('span'); cdot.className = 'cdot'; cdot.style.background = color;
  chip.appendChild(cdot);
  chip.appendChild(document.createTextNode(priv ? '🔒 ' + name : name));
  chip.addEventListener('click', function(){ scrollToEl(cat); });
  chipsWrap.appendChild(chip);

  navMap[name] = [group, chip];
});

// 滚动高亮：当前分类（手风琴自动展开）+ 当前子分类
function clearNavActive(){
  document.querySelectorAll('.side-item.active, .chip.active').forEach(function(el){ el.classList.remove('active'); });
}
const io = new IntersectionObserver(function(entries){
  entries.forEach(function(en){
    if(!en.isIntersecting) return;
    const name = en.target.dataset.cat;
    clearNavActive();
    const nv = navMap[name];
    if(nv){
      nv[0].querySelector('.side-item').classList.add('active');
      nv[1].classList.add('active');
      document.querySelectorAll('.side-group.open').forEach(function(g){ if(g !== nv[0]) g.classList.remove('open'); });
      nv[0].classList.add('open');
      // 清掉其他分类下的子分类高亮
      document.querySelectorAll('.side-sub.active').forEach(function(el){ if(!nv[0].contains(el)) el.classList.remove('active'); });
      const it = nv[0].querySelector('.side-item');
      const r = it.getBoundingClientRect(), pr = sb.getBoundingClientRect();
      if(r.top < pr.top || r.bottom > pr.bottom) it.scrollIntoView({ block: 'nearest' });
    }
  });
}, { rootMargin: '-25% 0px -65% 0px' });
catEls.forEach(function(cat){ io.observe(cat); });
const ioSub = new IntersectionObserver(function(entries){
  entries.forEach(function(en){
    if(!en.isIntersecting || !en.target._nav) return;
    document.querySelectorAll('.side-sub.active').forEach(function(el){ el.classList.remove('active'); });
    en.target._nav.classList.add('active');
  });
}, { rootMargin: '-25% 0px -65% 0px' });
document.querySelectorAll('.sub').forEach(function(s){ ioSub.observe(s); });

// ---------- 标签筛选（v0.2：多选标签，与分类并存） ----------
const TAGS = __TAGS_JSON__;
const tagbar = document.getElementById('tagbar');
const tagModeBtn = document.getElementById('tagMode');
const tagClearBtn = document.getElementById('tagClear');
const selTags = new Set();
let tagMode = 'or';  // 'or' 任意命中 | 'and' 同时具备
TAGS.forEach(function(t){
  const chip = document.createElement('div');
  chip.className = 'tag-chip';
  chip.dataset.tag = t[0];
  const nm = document.createElement('span'); nm.textContent = t[0];
  const tc = document.createElement('span'); tc.className = 'tc'; tc.textContent = t[1];
  chip.appendChild(nm); chip.appendChild(tc);
  chip.addEventListener('click', function(){
    if(selTags.has(t[0])){ selTags.delete(t[0]); chip.classList.remove('sel'); }
    else{ selTags.add(t[0]); chip.classList.add('sel'); }
    doSearch();
  });
  tagbar.appendChild(chip);
});
tagModeBtn.addEventListener('click', function(){
  tagMode = (tagMode === 'or') ? 'and' : 'or';
  tagModeBtn.textContent = (tagMode === 'or') ? '匹配任意' : '匹配全部';
  tagModeBtn.classList.toggle('on', tagMode === 'and');
  tagModeBtn.title = (tagMode === 'or') ? '当前：命中任意一个选中标签即显示。点击切换为“必须同时具备全部选中标签”'
    : '当前：必须同时具备全部选中标签。点击切换为“命中任意一个即显示”';
  if(selTags.size) doSearch();
});
tagClearBtn.addEventListener('click', function(){
  selTags.clear();
  document.querySelectorAll('.tag-chip.sel').forEach(function(c){ c.classList.remove('sel'); });
  doSearch();
});
function tagOk(a){
  if(selTags.size === 0) return true;
  const t = (a.dataset.tags || '').split(',');
  if(tagMode === 'and'){
    let ok = true;
    selTags.forEach(function(tag){ if(t.indexOf(tag) === -1) ok = false; });
    return ok;
  }
  let ok = false;
  selTags.forEach(function(tag){ if(t.indexOf(tag) !== -1) ok = true; });
  return ok;
}

// ---------- 搜索（与标签筛选联动） ----------
const q = document.getElementById('q');
const empty = document.getElementById('empty');
function doSearch(){
  const s = q.value.trim().toLowerCase();
  let shown = 0;
  document.querySelectorAll('.link').forEach(function(a){
    const hit = (!s || a.dataset.w.indexOf(s) !== -1) && tagOk(a);
    a.classList.toggle('hide', !hit);
    if(hit) shown++;
  });
  document.querySelectorAll('.sub').forEach(function(sub){
    const any = Array.prototype.some.call(sub.querySelectorAll('.link'), function(a){ return !a.classList.contains('hide'); });
    sub.classList.toggle('hide', !any);
  });
  document.querySelectorAll('.cat').forEach(function(cat){
    const any = Array.prototype.some.call(cat.querySelectorAll('.sub'), function(s){ return !s.classList.contains('hide'); });
    cat.classList.toggle('hide', !any);
    const nv = navMap[cat.dataset.cat];
    if(nv) nv.forEach(function(el){ el.classList.toggle('hide', !any); });
  });
  empty.classList.toggle('show', (s || selTags.size) && shown === 0);
}
q.addEventListener('input', doSearch);
document.addEventListener('keydown', function(e){
  if((e.metaKey || e.ctrlKey) && e.key === 'k'){ e.preventDefault(); q.focus(); }
  if(e.key === 'Escape'){ q.value = ''; doSearch(); q.blur(); }
});

// ---------- 折叠 ----------
document.querySelectorAll('.cat-head').forEach(function(h){
  h.addEventListener('click', function(){
    const cat = h.parentElement;
    if(cat.dataset.private === '1' && cat.classList.contains('collapsed')){
      cat.classList.remove('collapsed');
      cat.classList.add('unlocked');
    } else if(cat.dataset.private === '1' && cat.classList.contains('unlocked')){
      cat.classList.add('collapsed');
      cat.classList.remove('unlocked');
    } else {
      cat.classList.toggle('collapsed');
    }
  });
});

// ---------- 主题 ----------
const root = document.documentElement;
const btn = document.getElementById('themeBtn');
const moon = document.getElementById('iconMoon'), sun = document.getElementById('iconSun');
function setTheme(d){
  root.setAttribute('data-theme', d);
  moon.style.display = (d === 'dark') ? 'none' : '';
  sun.style.display = (d === 'dark') ? '' : 'none';
  try{ localStorage.setItem('nav-theme', d); }catch(e){}
}
btn.addEventListener('click', function(){
  setTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
});
try{
  const saved = localStorage.getItem('nav-theme');
  setTheme(saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
}catch(e){ setTheme('light'); }
</script>
</body>
</html>
''')

OUT = os.path.join(HERE, "index.html")
html_doc = "".join(parts)
html_doc = html_doc.replace("__QUICK_JSON__", quick_json)
html_doc = html_doc.replace("__TAGS_JSON__", json.dumps(TAGS_JSON, ensure_ascii=False))
html_doc = html_doc.replace("__TOTAL__", total_str)
html_doc = html_doc.replace("%TOTAL%", total_str)
html_doc = html_doc.replace("%VERSION%", VERSION)
html_doc = html_doc.replace("%GEN_DATE%", GEN_DATE)
html_doc = html_doc.replace("%CATS%", str(len(cat_count)))
html_doc = html_doc.replace("%TAGTOTAL%", str(len(TAGS_JSON)))
with open(OUT, "w", encoding="utf-8") as f:
    f.write(html_doc)
print(f"已生成: {OUT} ({os.path.getsize(OUT)/1024:.1f} KB, {total} 个站点, {len(quick_items)} 个快捷入口)")
print("标签分布:", ", ".join(f"{n}({c})" for n, c in TAGS_JSON))
