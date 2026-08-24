# -*- coding: utf-8 -*-
"""书签分类脚本 v2：修复子串匹配bug + 细化分类 + 站点级合并 + 生成HTML"""
import re, html, json, collections

SRC = "/Users/yourname/Documents/bookmarks_2026_8_21.html"
OUT = "/Users/yourname/WorkBuddy/2026-08-21-14-53-08/bookmarks_整理后.html"

# ---------- 解析 ----------
content = open(SRC, encoding="utf-8").read()
lines = content.splitlines()
stack = []
bookmarks = []
for line in lines:
    s = line.strip()
    if s.startswith('<DT><H3'):
        m = re.search(r'<DT><H3([^>]*)>(.*?)</H3>', s)
        if m:
            name = html.unescape(re.sub(r'<[^>]+>', '', m.group(2))).strip()
            stack.append(name)
    elif s.startswith('<DT><A'):
        m = re.search(r'<A HREF="([^"]*)"([^>]*)>(.*?)</A>', s)
        if m:
            url, attrs, t = m.group(1), m.group(2), m.group(3)
            ad = re.search(r'ADD_DATE="([^"]*)"', attrs)
            bookmarks.append({
                "title": html.unescape(re.sub(r'<[^>]+>', '', t)).strip(),
                "url": url,
                "add_date": ad.group(1) if ad else "",
                "path": list(stack),
            })
    elif re.match(r'</DL>', s):
        if stack:
            stack.pop()

# ---------- 垃圾清理 ----------
GARBAGE_URLS = [
    "chrome-native://newtab/",
    "https://go.itab.link/",
    "https://www.cctv.com/news/talkshow/biao.html",
    "https://telegram.org/tour/screenshots",
    "https://support.epson.biz/td/api/doc_check.php",
]
def is_garbage(b):
    return b["url"] in GARBAGE_URLS or b["title"] in ("新标签页", "打开新的标签页")
bookmarks = [b for b in bookmarks if not is_garbage(b)]

# ---------- URL 规范化去重（精确层） ----------
TRACK_PARAMS = re.compile(r'(?:^|&)(?:utm_\w+|spm|_ga|_gcl_au|_gl|continueFlag|srsltid|fbclid|invite_code|ref|source|from_login|page_id|mark_id|pli|show_merge_modal|code|state|page|accounttraceid|dp-logid)(?:=[^&]*)?', re.I)
def norm_url(u):
    u = u.strip()
    u = re.sub(r'^https?://', '', u, flags=re.I)
    u = re.sub(r'^www\.', '', u, flags=re.I)
    if '?' in u:
        base, q = u.split('?', 1)
        q = TRACK_PARAMS.sub('', q)
        q = re.sub(r'^&+|&+$', '', q)
        u = base + ('?' + q if q else '')
    u = re.sub(r'/index\.html$', '/', u)
    u = re.sub(r'/index\.php$', '/', u)
    u = u.rstrip('/')
    return u.lower()

seen = {}
bookmarks2 = []
for b in bookmarks:
    key = norm_url(b["url"])
    if key and key in seen:
        continue
    seen[key] = b
    bookmarks2.append(b)
bookmarks = bookmarks2

# ---------- 站点级合并（人工规则，保留组内第一个） ----------
# 每组用 URL 包含子串标识；value 为可选"例外保留"
SITE_GROUPS = [
    (["makerworld.com/zh"], "删除国际站（保留国区 .com.cn）"),
    (["olevod.com"], "olevod 与 olevod.one 重复"),
    (["cn.tradingview.com/markets", "tradingview.com/markets"], "TradingView 重复页"),
    (["yyets.click/home"], "人人影视同站重复"),
    (["prompterhub.cn/home"], "PrompterHub 重复"),
    (["inferri.com/projects"], "Inferri 保留主页"),
    (["sg-micro.com/index.html"], "圣邦微重复页"),
    (["hellogithub.com/?sort_by"], "HelloGitHub 重复"),
    (["kimi.moonshot.cn/chat/"], "Kimi 会话链接冗余，保留官网"),
    (["tushare.pro/weborder"], "Tushare 重复"),
    (["192.168.31.177:18090/admin"], "1Panel 重复入口"),
    (["bocangku.com/download"], "国创资源库重复"),
    (["monolithicpower.cn/cn/?_gl", "monolithicpower.cn/cn/"], "MPS 重复页"),
    (["gd32mcu.com/cn/product"], "兆易创新重复页"),
    (["stitch.withgoogle.com/projects"], "Stitch 保留主页"),
    (["theblockbeats.info/news/"], "BlockBeats 保留主页"),
    (["chinese.molex.com"], "molex 重复（保留主站）"),
    (["wch.cn"], "沁恒 http/https 重复"),
    (["injoinic.com"], "英集芯 http/https 重复"),
    (["rychip.com"], "蕊源 http/https 重复"),
    (["kicad.eda.cn"], "KiCad 华秋版与主站保留其一"),
]
def merge_sites(bookmarks):
    drop = set()
    for subs, _ in SITE_GROUPS:
        first = None
        for b in bookmarks:
            if any(s in b["url"] for s in subs):
                if first is None:
                    first = b
                else:
                    drop.add(id(b))
    return [b for b in bookmarks if id(b) not in drop]

bookmarks = merge_sites(bookmarks)
print(f"站点级合并后书签数: {len(bookmarks)}")

# ---------- 关键词工具 ----------
def kw(b, *words):
    """独立词匹配（词边界），同时检查 title/url/原路径"""
    t = b["title"].lower(); u = b["url"].lower(); p = " / ".join(b["path"]).lower()
    for w in words:
        if re.search(r'(?<![a-z0-9])' + re.escape(w.lower()) + r'(?![a-z0-9])', t) or \
           re.search(r'(?<![a-z0-9])' + re.escape(w.lower()) + r'(?![a-z0-9])', u) or \
           re.search(r'(?<![a-z0-9])' + re.escape(w.lower()) + r'(?![a-z0-9])', p):
            return True
    return False

def has(b, *words):
    """子串匹配"""
    t = b["title"].lower(); u = b["url"].lower(); p = " / ".join(b["path"]).lower()
    return any(w.lower() in t or w.lower() in u or w.lower() in p for w in words)

def path_has(b, *kws):
    p = " / ".join(b["path"]).lower()
    return any(k in p for k in kws)

def top_path(b):
    p = b["path"]
    return p[1] if len(p) > 1 else ""

# ---------- 分类 ----------
def classify(b):
    u = b["url"].lower()
    t = b["title"].lower()
    top = top_path(b)

    # ===== 1. 私密（成人内容）=====
    if has(b, "jable.tv", "pigav", "helloavgirls", "t66y", "everia", "javrls", "pornhub",
            "javcl", "thisav", "missav", "netflav", "xxxclub", "javbus", "madou",
            "javdb", "av01", "sukebei", "avgood"):
        return ("私密", "私密收藏")

    # ===== 1.5 精确修正（防止兜底误判）=====
    if has(b, "hdlbits", "示波器输入阻抗", "sinat_33742814"):
        return ("电子硬件", "硬件学习笔记")
    if has(b, "powershell 设置网络代理", "juejin.cn/post/7407260232663253042"):
        return ("工具与实用", "网络与代理")
    if has(b, "trackerslist"):
        return ("NAS 与服务器", "影视资源站")
    if has(b, "king_yuanyuan", "飞牛ddns"):
        return ("NAS 与服务器", "教程与文章")
    if has(b, "DSlZmRHNtREpnaFFO", "壹起共享"):
        return ("工具与实用", "在线工具")
    if has(b, "sm.cashewteam", "smartisan os 官方卡刷包"):
        return ("日常娱乐", "小众手机")

    # ===== 2. 电子硬件（强关键词优先）=====
    if path_has(b, "元件商城", "芯片厂商", "连接器厂商", "电源厂家", "无线充电芯片厂商", "找封装网站"):
        return ("电子硬件", "元件与厂商")
    if path_has(b, "3d模型"):
        return ("电子硬件", "3D 打印与模型")
    if path_has(b, "ai电路设计", "开源硬件项目"):
        return ("电子硬件", "电路设计工具")
    if path_has(b, "恒流源", "光电二极管", "阴极保护", "dvss", "串口屏", "fpga笔记", "stm32笔记", "天线设计", "硬件笔记"):
        return ("电子硬件", "硬件学习笔记")
    if path_has(b, "电子维修论坛"):
        return ("电子硬件", "电子论坛与社区")

    # 元件/厂商域名
    if kw(b, "szlcsc", "digikey", "mouser", "hqchip", "ickey", "misumi", "rfz1",
           "emakerzone", "fuse-china", "seeedstudio", "chaihuo", "zxhpcb",
           "jb-display", "i-pex", "molex", "lotes", "we-online", "krhro", "te.com.cn",
           "helloxkb", "hanrun", "f-tone", "txga", "umaxconn", "51pla", "sztmc",
           "jecano", "boomele", "ckmtw", "ti.com", "sg-micro", "gd32mcu", "wch.cn",
           "novosns", "phytium", "anlogic", "realtek", "microchip", "renesas",
           "rohm.com.cn", "onsemi", "silergy", "corpro", "phison", "jmicron",
           "ni.com", "injoinic", "vbsemi", "ingenic", "tdk.com.cn", "xktbdt",
           "misic.com.cn", "hexinhulian", "hmpowersemi", "granchip", "xhsc.com.cn",
           "corechip-sz", "sdicmicro", "xmnewyea", "axiomtek", "rychip", "motor-comm",
           "jfvny", "grt-china", "monolithicpower", "mornsun", "meanwell",
           "evisun", "ylptec", "020power", "bdtic"):
        return ("电子硬件", "元件与厂商")
    # 电路设计工具
    if kw(b, "oshwhub", "flux.ai", "kicad", "freerouting", "altium.com/viewer",
           "wokwi", "quilter", "speed-up", "solderable", "pcbjam", "circuitjs",
           "tools.jlc", "edatop", "qorvo", "mantaro", "stepfpga", "open-verify",
           "cuav", "platformio", "wavedrom", "lvgl", "pcisig", "wirelesspowerconsortium",
           "ohwr", "caniusevia", "eda365libs", "szlcsc.com/toolbox", "jlc.com"):
        return ("电子硬件", "电路设计工具")
    # 封装与器件查询
    if kw(b, "componentsearchengine", "octopart", "ultralibrarian", "snapeda",
           "838dz", "smdmark", "semiee"):
        return ("电子硬件", "封装与器件查询")
    # 3D 打印
    if kw(b, "makerworld", "thingiverse", "printables", "sketchfab", "3dcontentcentral",
           "crealitycloud", "wenext", "3dexport", "3dtotal", "dayin.la", "most3d",
           "3dshe", "pinshape", "grabcad", "tinkercad"):
        return ("电子硬件", "3D 打印与模型")
    # 电子论坛与社区
    if kw(b, "eda365", "21ic", "elecfans", "amobbs", "51hei", "ing10bbs", "cirmall",
           "eetree", "eeworld", "eepw", "ednchina", "mbb.eet", "pcbbar", "robomaster",
           "forum.arduino", "forums.raspberrypi", "usoftchina", "bbs.21ic", "dgzj",
           "vinafix", "badcaps", "chinafix", "ifixit", "mr-wu", "uinio", "elecshrimp",
           "log4cpp", "icwangpu", "shirley"):
        return ("电子硬件", "电子论坛与社区")
    # 硬件学习（原"马了"路径的电子/嵌入式内容）
    if path_has(b, "马了"):
        if kw(b, "github", "gitee") and not has(b, "luat", "stm32", "墨水屏", "eink"):
            if has(b, "peng-zhihui", "稚晖", "frank19900731", "weibocard"):
                return ("开发与编程", "GitHub 项目")
            if has(b, "some-many-books", "dujltqzv"):
                return ("日常娱乐", "电子书")
            return ("开发与编程", "GitHub 项目")
        if has(b, "mirror.xyz", "galaxy", "meta cowboy"):
            return ("金融与投资", "空投与 Web3")
        if has(b, "crakr", "navicat"):
            return ("工具与实用", "系统与软件")
        if has(b, "tiny", "media", "tmm", "tmm"):
            return ("NAS 与服务器", "教程与文章")
        if has(b, "v2ray"):
            return ("工具与实用", "网络与代理")
        if has(b, "免费天气api", "tianqiapi"):
            return ("工具与实用", "在线工具")
        if has(b, "拓竹", "smzdm", "3d打印机"):
            return ("NAS 与服务器", "教程与文章")
        return ("电子硬件", "硬件学习笔记")

    # ===== 3. 金融与投资 =====
    if path_has(b, "空投项目"):
        return ("金融与投资", "空投与 Web3")
    if path_has(b, "投资"):
        return ("金融与投资", "A股与投研")
    if path_has(b, "金融投资"):
        if has(b, "blockbeats", "openbb"):
            return ("金融与投资", "财经资讯" if "blockbeats" in u else "A股与投研")
        return ("金融与投资", "空投与 Web3")
    if kw(b, "binance", "okx", "bitget", "kraken", "pancakeswap", "crypto.com",
           "pump.fun", "bullx", "bscscan", "etherscan", "solscan", "basescan",
           "dexscreener", "gmgn", "rootdata", "opensea", "coinmarketcap", "coingecko",
           "tradingview", "openbb", "sosovalue", "standx", "titan.exchange", "arcion",
           "monad", "monacoin", "hyperdash", "honeypotlive", "mirror.xyz", "msx.com",
           "bingx", "cryptorank", "claim.monad"):
        return ("金融与投资", "加密与链上")
    if kw(b, "xueqiu", "雪球", "tushare", "datayes", "findtruman", "investing.com",
           "sec.gov", "marketwave", "redditalpha", "localhost:8000", "zwdnet",
           "buffett", "mungermodels", "wizzai101", "nvidia.com", "stock-scanner",
           "fin-genius", "fingenius", "每日选股", "ai-stock", "quant", "量化"):
        return ("金融与投资", "A股与投研")
    if kw(b, "blockbeats", "odaily", "zerohedge", "oilprice", "theblockbeats"):
        return ("金融与投资", "财经资讯")
    if has(b, "web3", "空投", "airdrop"):
        return ("金融与投资", "空投与 Web3")

    # ===== 4. AI =====
    if path_has(b, "ai大模型官网"):
        return ("AI 工具", "大模型官网")
    if path_has(b, "模型平台", "官方api", "ai新闻搜索引擎"):
        return ("AI 工具", "模型与 API")
    if path_has(b, "> ai"):
        if has(b, "fin", "trading", "valuecell"):
            return ("金融与投资", "A股与投研")
        if has(b, "飞书开放平台", "open.feishu"):
            return ("工具与实用", "在线工具")
        return ("AI 工具", "AI 开发与智能体")
    if kw(b, "chat.openai", "claude.ai", "gemini.google", "chat.deepseek",
           "kimi.moonshot", "doubao.com", "qianwen.com", "grok.com", "chat.z.ai",
           "agent.minimaxi", "manus.im", "coze.cn", "aistudio.google",
           "notebooklm", "clawd.bot", "openclaw.ai", "chat.antaq", "xiaoyi.huawei",
           "aistudio.xiaomimimo", "flowith.net", "autoglm.zhipuai", "wuli.art",
           "chatglm.cn", "mimo.xiaomi", "leonardo"):
        return ("AI 工具", "大模型官网")
    if kw(b, "openrouter", "siliconflow", "modelscope", "huggingface", "bigmodel",
           "console.anthropic", "platform.deepseek", "api-docs.deepseek",
           "console.x.ai", "build.nvidia", "bailian.console", "volcengine",
           "open.bochaai", "app.tavily", "linoapi", "aihubs", "aliyun.com/product/tongyi",
           "deepseekharness", "z-image", "autoglm-phone"):
        return ("AI 工具", "模型与 API")
    if kw(b, "openclaw", "lobehub", "deepwiki", "lmarena", "mcpmarket", "6551.io",
           "code.claude", "claude-mem", "hello-claw", "dify", "hellodify", "getzep",
           "anthropic.com/engineering"):
        return ("AI 工具", "AI 开发与智能体")
    if kw(b, "synthesia", "runwayml", "ai-bot.cn", "youmind", "prompterhub", "aihot",
           "aibijia", "macai.chat", "inferri", "sopilot", "造相", "waytoagi",
           "agijuejin", "通往agi", "promptingguide", "prompt", "提示词", "deeplearning.ai",
           "captainai", "人工智能", "nof1", "超算互联网", "scnet.cn", "hynix"):
        return ("AI 工具", "AI 应用与导航")

    # ===== 5. NAS 与服务器 =====
    if path_has(b, "飞牛服务", "影视站", "龙虾池子", "nas文章"):
        if path_has(b, "影视站"):
            return ("NAS 与服务器", "影视资源站")
        if path_has(b, "龙虾池子"):
            return ("NAS 与服务器", "服务入口")
        if path_has(b, "nas文章"):
            return ("NAS 与服务器", "教程与文章")
        return ("NAS 与服务器", "服务入口")
    if kw(b, "fnos", "fnnas", "jellyfin", "1panel", "transmission", "wewe",
           "v2raya", "istoreos", "openwrt", "mihomo", "metatube", "hacs",
           "home-assistant", "worldmonitor", "192.168.31", "liuhouliang",
           "awesome-nas", "tiny", "tmm", "hugo", "podcast-bridge", "localhost:8899"):
        if kw(b, "btbtl", "yyets", "ezdmw", "subhd", "mxdm", "dmhy", "agefans",
               "seedhub", "olevod", "iyf", "netflixgc", "halitv", "dygang",
               "hdmoli", "ext.to", "yinfans", "1lou", "webhd", "yt2k", "ainidj",
               "爱壹帆", "短剧", "欧乐", "人人影视", "哈哩哈哩", "电影港", "bt之家", "音范丝"):
            return ("NAS 与服务器", "影视资源站")
        return ("NAS 与服务器", "教程与文章")

    # ===== 6. 日常娱乐 =====
    if path_has(b, "电子书"):
        return ("日常娱乐", "电子书")
    if path_has(b, "漫画网站"):
        return ("日常娱乐", "动漫漫画")
    if path_has(b, "视频网站"):
        return ("日常娱乐", "影视视频")
    if path_has(b, "壁纸"):
        return ("日常娱乐", "壁纸")
    if path_has(b, "游戏网站", "galgame", "ns游戏网站论坛"):
        return ("日常娱乐", "游戏")
    if path_has(b, "小众手机"):
        return ("日常娱乐", "小众手机")
    if path_has(b, "知乎文章阅读"):
        return ("生活与工作", "资讯阅读")
    if path_has(b, "在线文档"):
        return ("生活与工作", "在线文档")

    # 电子书站点
    if kw(b, "z-library", "zlib", "libgen", "annas-archive", "anna's", "jiumodiary",
           "鸠摩", "epubook", "salttiger", "banshujiang", "搬书匠", "dushupai",
           "读书派", "archive.org", "oceanofpdf", "welib", "book.tstrs", "mq59",
           "readest", "koodo", "calibre", "youzack", "宝阳悦读", "安娜", "saltyleo",
           "stitch.withgoogle", "ifun.cool", "趣集", "some-many-books", "个人图书馆"):
        return ("日常娱乐", "电子书")
    # 漫画
    if kw(b, "mhx12", "manhua55", "mox.moe", "mycomic", "dzmanga", "包子漫画",
           "漫自由", "漫画屋"):
        return ("日常娱乐", "动漫漫画")
    # 影视
    if kw(b, "ext.to", "yinfans", "1lou", "webhd", "yt2k", "dmhy", "agefans",
           "seedhub", "olevod", "ainidj", "iyf", "yyets", "halitv", "netflixgc",
           "dygang", "hdmoli", "garden.breadio", "影视", "电影", "短剧", "视频网站"):
        return ("日常娱乐", "影视视频")
    # 游戏
    if kw(b, "acgac", "gamepadviewer", "tetris", "俄罗斯方块", "lichess", "yikm",
           "dos.zczc", "xdgame", "acgs.one", "galgamex", "xiayuge", "soraacg",
           "galzy", "shinnku", "gamer520", "switch618", "vgter", "switchxiazai",
           "52ns", "ns211", "2cyshare", "hullqin", "imisstheoffice", "mazegenerator",
           "emu666", "gamefreer", "splendor", "璀璨宝石", "biligame", "戴森球",
           "itch.io", "fortnite", "aliyundrive", "ns游戏", "switch", "galgame",
           "绮梦", "夏轩阁", "穹之下", "紫缘", "失落小站", "上游世界", "掌游网",
           "ns资源网", "桌游", "模拟办公室", "迷宫生成器", "模拟器游戏"):
        return ("日常娱乐", "游戏")
    # 壁纸
    if kw(b, "snake.timeline", "dpm.org", "chineseposters", "nasa", "壁纸", "故宫",
           "中式海报", "images.nasa"):
        return ("日常娱乐", "壁纸")
    # 小众手机
    if kw(b, "minimalcompany", "unihertz", "clicks.tech", "mybluefox", "nothing.tech",
           "ikko", "tecno", "lightphone", "sidephone", "蓝狐"):
        return ("日常娱乐", "小众手机")

    # ===== 7. 开发与编程 =====
    if path_has(b, "github项目", "接单"):
        return ("开发与编程", "GitHub 项目") if "github" in top_path(b).lower() else ("生活与工作", "工作与接单")
    if kw(b, "github.com", "gitee.com", "gitlab"):
        if has(b, "valuecell", "stock", "fin"):
            return ("金融与投资", "A股与投研")
        if has(b, "hello-claw", "claude-mem", "steel-browser", "openwork", "vibe-kanban",
               "sageread", "dify", "windhawk", "win11debloat", "convertx", "mirofish",
               "bettafish", "trendradar", "bestblogs", "next-ai-draw-io", "github-store",
               "awesome-ceo", "ebook2audiobook", "nanoiconpack", "biu", "peng-zhihui",
               "chinese-independent-developer", "hellogithub", "githubdaily", "weibocard"):
            return ("开发与编程", "GitHub 项目")
        if has(b, "analogdevicesinc", "digilent", "t-head-semi", "francescopace", "espectre"):
            return ("电子硬件", "电路设计工具")
        if has(b, "awesome-nas"):
            return ("NAS 与服务器", "教程与文章")
        if has(b, "get-started-with-web3", "beihaili"):
            return ("金融与投资", "空投与 Web3")
        if has(b, "some-many-books", "dujltqzv"):
            return ("日常娱乐", "电子书")
        if has(b, "react-tetris", "俄罗斯方块"):
            return ("日常娱乐", "游戏")
        if has(b, "coolhue", "webkul"):
            return ("工具与实用", "在线工具")
        if has(b, "dr-lin", "stock-scanner"):
            return ("金融与投资", "A股与投研")
        return ("开发与编程", "GitHub 项目")
    # 编程学习
    if kw(b, "runoob", "w3school", "w3cschool", "codedex", "codecombat", "lanqiao",
           "nndl", "神经网络", "developer.android", "androiddevtools", "freecodecamp",
           "learn the basics", "openmlsys", "hacksplaining", "debian.org", "soc.ustc",
           "quaily", "严肃氛围", "ituring", "epubit", "异步社区", "图灵社区", "51cto",
           "oschina", "bookstack", "书栈", "tuzhidian", "图之典", "musicca", "phet",
           "classcentral", "smartedu", "mathlove", "captainai", "conda", "git in",
           "r2coding", "road 2 coding", "figmachina", "geekros", "ros2", "makeru",
           "创客学院", "nuedc", "电巢学堂", "巢粉引擎", "elecnest", "高等", "学习指南",
           "csdn.net/linshaodan", "扫雷", "c语言", "nandgame", "keil5", "keil"):
        return ("开发与编程", "编程学习")
    # 技术博客与社区
    if kw(b, "coolshell", "cnblogs", "博客园", "segmentfault", "思否", "linux.do",
           "vitalik", "yongmai", "勇麦", "savouer", "夜未央", "steward-fu", "司徒",
           "ghuntley", "shitjournal", "hn.craigary", "reddit", "x.com", "bestblogs",
           "trustmrr", "loot-drop", "zeli", "panwik", "52pojie", "greasyfork",
           "油猴", "tampermonkey", "log4cpp", "海淀小卷王", "sherlock", "wangzhou",
           "zinia", "redditalpha"):
        return ("开发与编程", "技术博客与社区")

    # ===== 8. 学习资源 =====
    if kw(b, "ocw.mit", "deeplearning.ai", "吴恩达", "prompt", "提示词", "通往agi",
           "classcentral", "书栈", "bookstack", "qrbtf", "smartedu", "mathlove",
           "nndl", "实验楼", "lanqiao", "codedex", "philosophy", "教育", "课程"):
        return ("学习资源", "课程与教程")

    # ===== 9. 工具与实用 =====
    if path_has(b, "实用") or top == "实用":
        if kw(b, "upwork"):
            return ("生活与工作", "工作与接单")
        if kw(b, "github"):
            return ("开发与编程", "GitHub 项目")
        if kw(b, "dawangidc", "45.43.31", "机场", "v2ray", "mihomo", "代理"):
            return ("工具与实用", "网络与代理")
        if kw(b, "msdn", "xitongku", "uupdump", "itellyou", "原版软件", "vmware",
               "workstation", "kms", "smartisan", "激活"):
            return ("工具与实用", "系统与软件")
        if kw(b, "tool77", "bejson", "toolonline", "chuangkit", "logomakerr", "bm.md",
               "dllme", "chartcube", "aconvert", "7calendar", "planyourroom", "mult.dev",
               "wormhole", "color", "kigen", "字体", "maoken", "font.icu", "flights",
               "flightradar", "yandex", "tool.browser.qq", "帮小忙", "trackerslist",
               "wanwang", "阿里云万网", "xiaoyuan", "alltool"):
            return ("工具与实用", "在线工具")
        if kw(b, "wokwi", "waveshare", "微雪", "e-paper", "eink"):
            return ("电子硬件", "硬件学习笔记")
        if kw(b, "21ic", "eeworld", "eepw", "pcbbar", "dgzj", "cirmall", "eetree",
               "amobbs", "robomaster", "latticesemi", "莱迪斯", "stepfpga", "ifixit"):
            return ("电子硬件", "电子论坛与社区")
        if kw(b, "mbb.eet", "面包板"):
            return ("电子硬件", "电子论坛与社区")
        if kw(b, "prompt", "提示词", "hellodify", "dify"):
            return ("AI 工具", "AI 开发与智能体")
        if kw(b, "sopilot", "youmind", "inferri", "aihubs", "aibijia", "aihot"):
            return ("AI 工具", "AI 应用与导航")
        if kw(b, "zzb", "ic交易网", "rfz1"):
            return ("电子硬件", "元件与厂商")
        if kw(b, "nvidia", "investor"):
            return ("金融与投资", "A股与投研")
        if kw(b, "hellobtc", "web3", "bingx"):
            return ("金融与投资", "空投与 Web3")
        if kw(b, "kdocs", "金山"):
            return ("生活与工作", "在线文档")
        if kw(b, "newsnow", "sinyalee", "新的原野", "megaglass", "woodtown", "liblib",
               "yeblock", "windows-xp", "xcote", "itclan"):
            return ("生活与工作", "资讯阅读" if kw(b, "newsnow", "sinyalee", "新的原野") else "生活服务")
        return ("工具与实用", "在线工具")

    # ===== 10. 生活与工作 =====
    if kw(b, "kdocs", "feishu.cn", "yuque", "shimo", "flowus", "docs.qq", "在线文档",
           "notion"):
        return ("生活与工作", "在线文档")
    if kw(b, "zentao", "禅道", "tplus", "畅捷通", "pipetc", "工时", "upwork", "sccchina",
           "大连海事", "dlhsdx"):
        return ("生活与工作", "工作与接单")
    if kw(b, "hrss", "hebeea", "12348", "法律服务", "ndrc", "zfcxjs", "cidp",
           "防灾科技", "ehall", "msdmanuals", "默沙东", "outlook", "science.org",
           "cdstm", "darebee", "dribbble", "mf.geekpark", "前沿社", "appinn", "小众软件",
           "appservice.notion", "平替", "cloud.oppo", "跨端文件", "opss", "magicv",
           "魔方简历", "cook.yunyoujun", "食用手册", "nmbxd1", "x岛", "icebergcharts",
           "反季婵", "cbge", "山海之花", "toubiec", "苏晓晴", "hezibuluo", "盒子部落",
           "quark.so", "夸克搜", "miaosou", "秒搜", "panhunt", "alixiaozhan", "阿里小站",
           "pan.baidu", "百度网盘", "quark", "alixiaozhan", "tianqiapi", "城市",
           "odaily", "newsnow", "sinyalee", "新的原野", "yinrss", "隐订阅", "yandex",
           "blivechat", "bilisc", "chat.bilisc", "邮件", "mail"):
        return ("生活与工作", "生活服务")

    # ===== 9.9 兜底前修正：日常路径中的工具类回捞 =====
    if top == "日常":
        if kw(b, "tool.browser.qq", "coolhue", "7calendar", "maoken", "kigen",
               "planyourroom", "aconvert", "font.icu", "mult.dev", "wormhole",
               "lkssite", "ohmybead", "拼豆"):
            return ("工具与实用", "在线工具")
        if kw(b, "uupdump", "kms.ikxin"):
            return ("工具与实用", "系统与软件")
        if kw(b, "oray", "花生壳"):
            return ("工具与实用", "网络与代理")
        if kw(b, "aliyun", "阿里云"):
            return ("生活与工作", "工作与接单")

    # ===== 兜底 =====
    fb = {
        "人工智能网站": ("AI 工具", "AI 应用与导航"),
        "B": ("金融与投资", "加密与链上"),
        "金融投资": ("金融与投资", "空投与 Web3"),
        "已导入": ("工具与实用", "在线工具"),
        "飞牛服务": ("NAS 与服务器", "服务入口"),
        "AI": ("AI 工具", "AI 开发与智能体"),
        "马了": ("电子硬件", "硬件学习笔记"),
        "实用": ("工具与实用", "在线工具"),
        "日常": ("日常娱乐", "日常杂项"),
        "投资": ("金融与投资", "A股与投研"),
        "PIPE": ("生活与工作", "工作与接单"),
        "": ("工具与实用", "在线工具"),
    }
    return fb.get(top, ("工具与实用", "在线工具"))

# ---------- 执行 ----------
result = collections.defaultdict(lambda: collections.defaultdict(list))
for b in bookmarks:
    c = classify(b)
    result[c[0]][c[1]].append(b)

# ---------- 输出统计 ----------
print("\n========== 分类统计 ==========")
total = 0
for top in sorted(result.keys()):
    subtotal = 0
    print(f"\n■ {top}")
    for sub in sorted(result[top].keys()):
        n = len(result[top][sub])
        subtotal += n
        print(f"   └ {sub}: {n}")
    total += subtotal
    print(f"   小计: {subtotal}")
print(f"\n总数: {total} (原始 797，清理+合并后 {len(bookmarks)})")

# 保存分类结果供检查
with open("/Users/yourname/WorkBuddy/2026-08-21-14-53-08/classified_preview.txt", "w", encoding="utf-8") as f:
    for top in sorted(result.keys()):
        f.write(f"\n■ {top}\n")
        for sub in sorted(result[top].keys()):
            f.write(f"  └ {sub}\n")
            for b in result[top][sub]:
                f.write(f"     - [{b['title'][:55]}] {b['url'][:85]}\n")

# ---------- 生成 HTML ----------
def esc(s):
    return s.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;").replace(">", "&gt;")

def clean_title(b):
    """超长标题压缩"""
    t = b["title"]
    if len(t) > 80 and "github" in b["url"]:
        m = re.match(r'https?://github\.com/([^/]+)/([^/]+)', b["url"])
        if m:
            t = f"{m.group(1)}/{m.group(2)}"
    return t

lines_out = []
lines_out.append('<!DOCTYPE NETSCAPE-Bookmark-file-1>')
lines_out.append('<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">')
lines_out.append('<TITLE>Bookmarks</TITLE>')
lines_out.append('<H1>Bookmarks</H1>')
lines_out.append('<DL><p>')

# 顶层文件夹顺序
TOP_ORDER = ["AI 工具", "电子硬件", "金融与投资", "NAS 与服务器", "开发与编程",
             "学习资源", "日常娱乐", "工具与实用", "生活与工作", "私密"]
SUB_ORDER = {}  # 每层子类保持字典插入顺序即可

for top in TOP_ORDER:
    if top not in result:
        continue
    lines_out.append(f'    <DT><H3 ADD_DATE="1785651171">{esc(top)}</H3>')
    lines_out.append('    <DL><p>')
    for sub, items in result[top].items():
        lines_out.append(f'        <DT><H3 ADD_DATE="1785651171">{esc(sub)}</H3>')
        lines_out.append('        <DL><p>')
        for b in items:
            ad = f' ADD_DATE="{b["add_date"]}"' if b["add_date"] else ""
            lines_out.append(f'            <DT><A HREF="{esc(b["url"])}"{ad}>{esc(clean_title(b))}</A>')
        lines_out.append('        </DL><p>')
    lines_out.append('    </DL><p>')
lines_out.append('</DL><p>')

with open(OUT, "w", encoding="utf-8") as f:
    f.write("\n".join(lines_out))

import os
print(f"\n已生成: {OUT} ({os.path.getsize(OUT)/1024:.1f} KB)")
