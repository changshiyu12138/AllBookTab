/* My Nav · 书签智能分类引擎（通用版）
 * 仅依据「标题 + URL」判断，不依赖任何个人文件夹命名，人人可用。
 * 可在浏览器与 Node.js 两种环境运行。
 */
(function (global) {
  'use strict';

  // ============ 匹配工具 ============
  function kw(text, words) { // 子串匹配
    for (var i = 0; i < words.length; i++) if (text.indexOf(words[i]) !== -1) return true;
    return false;
  }

  // ============ 分类体系（顺序即优先级） ============
  var CAT_ORDER = [
    ['AI 工具', '#6366f1'],
    ['开发与编程', '#2563eb'],
    ['电子硬件', '#0d9488'],
    ['金融与投资', '#e11d48'],
    ['学习资源', '#16a34a'],
    ['影视视频', '#f97316'],
    ['音乐播客', '#db2777'],
    ['游戏动漫', '#8b5cf6'],
    ['社交网络', '#0ea5e9'],
    ['新闻资讯', '#64748b'],
    ['购物比价', '#f59e0b'],
    ['效率办公', '#0891b2'],
    ['设计素材', '#d946ef'],
    ['生活服务', '#059669'],
    ['自建服务', '#7c3aed'],
    ['私密', '#475569'],
    ['其他', '#9ca3af']
  ];
  var CAT_THEME = {};
  CAT_ORDER.forEach(function (c) { CAT_THEME[c[0]] = c[1]; });

  // 特殊规则（正则）
  var RE_PRIVATE = /pornhub|xvideos|xnxx\.|xhamster|javdb|javbus|missav|netflav|thisav|avgle|onlyfans|stripchat|chaturbate|brazzers|redtube|youporn|spankbang|eporner|91porn|jable|sukebei|t66y|1024|pigav|avgirls|av01|avgood|everia|fc2|caribbean|\bporn\b|\bxxx\b|\bsex\.|里番|黄站|东京热|一本道/i;
  var RE_SELFHOST = /localhost|127\.0\.0\.1|192\.168\.|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.|\.local[:/]|jellyfin|emby|plex\.tv|qbit|aria2|alist|transmission|portainer|heimdall|dashy|n8n|openwrt|istoreos|fnos|fnnas|proxmox|esxi|\/pve\b|群晖|synology|威联通|qnap|\bnas\b|内网穿透|frp\b/i;
  var RE_REPO = /(github|gitee|gitlab|codeberg|bitbucket|coding\.net)\/[^/\s]+\/[^/\s]+/i;

  // 兜底启发式（规则表全部未命中时）
  var RE_HW_GENERIC = /electronics|electronic|connector|interconnect|capacitor|resistor|inductor|semiconductor|oscillator|crystal|coaxial|harness|电(子|子科技|子有限|子股份|子技术|子制品)|微电子|光电|线材|五金|模具/i;
  var RE_AI_GENERIC = /\bai\b|\bllm\b|\bgpt\b|人工智能|大模型|智能体|机器人/i;

  // 优先修正：常见易误判站点的精确路由（在通用规则之前命中）
  var SPECIALS = [
    [/weread|微信读书/i, '学习资源', '电子书库'],
    [/docs\.qq\.com|腾讯文档/i, '效率办公', '在线文档'],
    [/mail\.qq\.com|mail\.163\.com|mail\.126\.com|mail\.sina/i, '效率办公', '邮箱'],
    [/netflix|disneyplus|disney\+/i, '影视视频', '影视资源'],
    [/^(https?:\/\/)?([a-z0-9-]+\.)*x\.com\//i, '社交网络', '社交平台']
  ];

  // [分类, 子分类, 关键词数组] —— 按顺序命中即返回
  var RULES = [
    // ---------- AI 工具 ----------
    ['AI 工具', '大模型对话', ['chatgpt', 'chat.openai', 'claude.ai', 'claude.com', 'gemini.google', 'kimi', 'moonshot', 'deepseek', '豆包', 'doubao', '通义', 'qwen.com', 'qianwen', '文心', 'yiyan', 'chatglm', '智谱清言', 'grok.com', 'copilot', 'poe.com', 'perplexity', '元宝', 'hunyuan', '腾讯元宝', 'pika', '阶跃', 'new-api', 'one-api', 'openclaw', 'lobehub', 'chat.', 'mimo']],
    ['AI 工具', '模型与API', ['huggingface', 'openrouter', 'siliconflow', 'modelscope', 'bigmodel', '火山方舟', 'volcengine', 'bailian', 'dashscope', 'ollama', 'civitai', 'openai.com', 'anthropic', 'api.deepseek', 'aistudio', 'tiangong', 'replicate', 'together.ai', 'groq', 'nvidia', 'dify', 'minimax', 'lmarena', 'bocha', 'zep', 'x.fish']],
    ['AI 工具', 'AI 绘画与视频', ['midjourney', 'stable-diffusion', 'stablediffusion', 'leonardo.ai', '即梦', 'jimeng', 'liblib', '哩布', 'dall-e', 'runwayml', 'runway', 'pika.art', '可灵', 'klingai', 'heygen', 'suno', 'viggle', 'flux', 'synthesia', 'notebooklm']],
    ['AI 工具', 'AI 编程', ['cursor.com', 'cursor.sh', 'windsurf', 'codeium', 'v0.dev', 'bolt.new', 'lovable', 'tabnine', 'sourcegraph', 'codeium', 'continue.dev', 'aider', 'trae']],
    ['AI 工具', 'Agent 智能体', ['coze', '扣子', 'manus', 'mcp', 'agent', '智能体', 'autoglm', 'flowith', '小艺', 'xiaoyi', '海螺', 'captainai', 'clawd']],
    ['AI 工具', 'AI 导航与资讯', ['ai-bot', 'toolify', 'aihub', 'waytoagi', '通往agi', 'prompt', '提示词', 'ai导航', 'ai工具', 'ainav', 'gpt3', 'ai资讯', '量子位', '机器之心', 'aibijia', 'macai']],

    // ---------- 开发与编程 ----------
    ['开发与编程', '代码仓库', ['github.com', 'github.io', 'githubusercontent', 'gitee.com', 'gitee.io', 'gitlab', 'bitbucket', 'codeberg', 'sourceforge', 'coding.net', 'gitcode', 'atomgit', 'pages.dev', 'vercel', 'netlify']],
    ['开发与编程', '技术文档', ['developer.mozilla', 'mdn', 'docs.python', 'nodejs.org', 'devdocs', 'w3.org', 'whatwg', 'runoob', 'w3school', 'w3cschool', '菜鸟教程', 'cppreference', 'java docs', 'php.net', 'rust-lang', 'go.dev', 'golang.org', 'kubernetes', 'docker docs', 'nginx', 'apache docs', 'webpack', 'vitejs', 'vuejs', 'react.dev', 'reactjs', 'angular', 'svelte', 'nextjs', 'laravel', 'spring.io', 'mysql', 'postgresql', 'mongodb', 'redis', 'sqlite', 'developer.android', 'debian', 'lvgl', 'platformio', 'openwrt docs']],
    ['开发与编程', '社区问答', ['stackoverflow', 'stackexchange', 'csdn', '掘金', 'juejin', '博客园', 'cnblogs', 'segmentfault', '思否', 'v2ex', '51cto', 'oschina', '开源中国', 'linux.do', 'infoq', 'javaranch', 'cnodejs', 'ruby-china', 'golang中国', 'learnku', 'v2ray', 'greasyfork', 'tampermonkey', '52pojie', '吾爱破解', 'coolshell', 'bestblogs', 'hostloc']],
    ['开发与编程', '编程学习', ['leetcode', '力扣', '牛客', 'nowcoder', 'freecodecamp', 'codecademy', 'codewars', 'exercism', 'hackerrank', '洛谷', 'luogu', 'acwing', 'imooc', '慕课', '极客时间', 'time.geekbang', '蓝桥', 'lanqiao', 'nandgame', 'flexbox froggy', 'css-tricks', 'javascript.info', 'codedex', 'hacksplaining', 'hdlbits', 'openmlsys', 'datawhale', 'nndl']],
    ['开发与编程', '开发工具', ['npmjs', 'pypi', 'hub.docker', 'regex101', 'caniuse', 'postman', 'jsonlint', 'vercel', 'netlify', 'cloudflare', 'workers.dev', 'git-scm', 'gitkraken', 'sourcetree', 'insomnia', 'hoppscotch', 'uiverse', 'shields.io', 'gitignore', 'carbon.now', 'ray.so', 'codepen', 'jsfiddle', 'jsbin', 'playcode', 'stackblitz', 'codesandbox', 'replit', 'vscode.dev', 'vim', 'neovim', 'emacs', 'ohmyzsh', 'fig.io', 'aliyun', '阿里云', 'androiddevtools']],

    // ---------- 电子硬件 ----------
    ['电子硬件', '元件与厂商', ['szlcsc', '立创商城', 'digikey', 'mouser', 'hqchip', '华秋', 'ickey', 'ti.com', 'analog.com', 'adi官网', 'st.com', '意法半导体', 'nxp', 'infineon', '英飞凌', 'microchip', 'renesas', '瑞萨', 'rohm', '东微', 'onsemi', 'silergy', '矽力杰', 'sg-micro', '圣邦', '兆易', 'gd32', 'wch.cn', '沁恒', '汇顶', 'tdk', 'murata', '村田', 'kemet', 'avx', '国巨', 'yageo', '风华', '厚声', '三星电机', 'monolithicpower', 'mps官网', 'mornsun', 'meanwell', '明纬', 'molex', 'lotes', 'i-pex', 'we-online', 'phison', 'jmicron', 'realtek', '瑞昱', 'phytium', '飞腾', 'latticesemi', 'lattice', 'anlogic', '安路', 'ingenic', '君正', 'misumi', 'seeed', 'waveshare', 'hanrun', 'injoinic', '英集芯', 'semiee', 'octopart', 'snapeda', 'componentsearchengine', 'iccircle', 'smdmark', '838dz', '元器件', '连接器', '接插件', '端子', '线束', '排针', '排母', '继电器', '传感器', '晶振', '磁珠', '蜂鸣器', '适配器', '开关电源', '电源模块', '二极管', '三极管', 'mos管', 'mosfet', '贴片', '电感', '电容', '电阻', '电源', '光模块', '纤通', 'f-tone', 'umaxconn', '灿科盟', 'ckmtw', '振芯', 'corpro', '核芯', '工控', 'axiomtek', '无线供电', '恒流源', '光润通', 'ni.com']],
    ['电子硬件', '开发板与DIY', ['arduino', '树莓派', 'raspberry', 'esp32', 'esp8266', 'esp-home', 'esphome', 'stm32', '单片机', 'microbit', 'micro:bit', 'edison', 'jetson', 'k210', 'maix', 'litchi', '平衡车', '舵机', '机械臂', 'robomaster', '大疆', '四轴', '无人机', 'diygod', '创客', '柴火', 'thingiverse', 'makerworld', 'printables', 'grabcad', 'tinkercad', 'creality', '创想三维', '3dcontentcentral', '3d打印', '3dexport', '3dtotal', 'dayin', 'most3d', 'pinshape', '拼豆', 'cuav', 'wit-motion', 'geekros']],
    ['电子硬件', '电路与PCB', ['kicad', 'altium', '立创eda', 'oshwhub', 'jlc.com', '嘉立创', 'pcb', '原理图', 'schematic', 'freerouting', 'wokwi', 'circuitjs', 'multisim', 'proteus', 'spice', 'pcbbar', '华秋dfm', 'diptrace', 'eagle.', 'hdlbits', 'zipcpu', 'opencores', 'ohwr', 'wavedrom', 'fpga', 'verilog', '小脚丫', 'liangkangnan', 'granchip', 'jfvny']],
    ['电子硬件', '电子论坛', ['eda365', 'elecfans', '电子发烧友', '21ic', 'eeworld', 'eepw', 'ednchina', 'amobbs', '矿坛', 'radio', '收音机', '维修', '示波器', '万用表', '电烙铁', '焊台', '电子工程专辑', 'tsmc', '半导体', '电源网', 'dianyuan', 'eetree', 'cirmall', 'badcaps', 'microwaves101', 'pcisig', 'usb.org', 'bom', 'datasheet', '规格书', 'elecshrimp', 'pcba', 'smt', 'solder', '焊接', '锂电池', '电池', '充电', '液晶', '显示屏', '触摸屏', 'led', '灯珠', '光电', 'vinafix', 'bios', 'wiki-power', '吴川斌', '摄像头']],

    // ---------- 金融与投资 ----------
    ['金融与投资', '行情与数据', ['eastmoney', '东方财富', '同花顺', '10jqka', 'xueqiu', '雪球', 'tradingview', 'tushare', 'akshare', 'baostock', '巨潮', 'cninfo', 'wind.com', 'datayes', '聚宽', 'joinquant', '米筐', 'ricequant', '果仁网', 'wenhua', '文华财经', '掌上生活', '通达信', 'tdx', 'futu', '富途', 'tigerbrokers', '老虎证券', '长桥', 'longbridge', 'yahoo finance', 'screener', '估值', '财报', '市盈率', 'k线', '行情', 'sosovalue', 'openbb', 'buffett']],
    ['金融与投资', '财经资讯', ['财新', 'caixin', '华尔街见闻', 'wallstreetcn', 'bloomberg', '彭博', 'reuters', '路透', 'ft.com', '金融时报', 'economist', '经济学人', '韭菜说', '价值大师', '格隆汇', 'ipo早知道', '晨星', 'morningstar', 'zerohedge', 'oilprice']],
    ['金融与投资', '加密货币', ['binance', '币安', 'okx', '欧易', 'okex', 'coingecko', 'coinmarketcap', 'etherscan', 'bscscan', 'solscan', 'uniswap', 'pancakeswap', '火币', 'huobi', 'gate.io', 'bybit', 'bitget', 'dexscreener', 'gmgn', '空投', 'airdrop', 'web3', 'metamask', 'opensea', 'nft', 'defi', '质押', 'staked', 'blockbeats', 'odaily', '律动', 'f2pool', 'eth.pool', 'crypto', 'bullx', 'pump.fun', 'rootdata', 'titan.exchange', 'monad', 'claim.', 'mirror.xyz', 'vitalik']],
    ['金融与投资', '银行与理财', ['招商银行', 'cmbchina', 'icbc', '工行', '建设银行', 'ccb.com', '农行', 'abchina', '中国银行', 'boc.cn', '交通银行', 'bankcomm', '浦发', 'spdb', '中信银行', 'ecitic', '广发银行', 'cgbchina', '民生银行', 'mbc', '光大银行', 'cebbank', '平安银行', 'pingan.com/bank', '支付宝', 'alipay', '蚂蚁财富', '天天基金', '1234567.com', '且慢', '盈米', '蛋卷基金', 'danjuanapp', '银行', '信用卡', '征信', '贷款', '保险', '理财']],

    // ---------- 学习资源 ----------
    ['学习资源', '在线课程', ['coursera', 'edx.org', 'udemy', 'mooc', '中国大学', 'icourse163', '学堂在线', 'xuetangx', 'khan', '可汗学院', 'doyoudo', 'skillshare', 'masterclass', 'ted.com', '网易公开课', 'open.163', '腾讯课堂', 'ke.qq', '超星', 'chaoxing', '学习通', 'b站课堂', 'classcentral', 'mit.edu', 'ocw', 'smartedu', '国家中小学', 'phet', 'edu.cn', 'ustc']],
    ['学习资源', '电子书库', ['微信读书', 'weread', 'zlibrary', 'z-lib', 'z-lib', 'libgen', 'annas-archive', '安娜', '鸠摩', 'jiumodiary', '书单', '书库', '书栈', 'bookstack', 'gutenberg', 'archive.org', 'salttiger', '搬书匠', 'banshujiang', '图灵社区', 'ituring', '异步社区', 'epubit', '人邮', 'readest', 'koodo', 'calibre', 'epub', 'slideshare', '百科', 'baike', '论文', 'thesis', 'uda.cn', '360doc']],
    ['学习资源', '语言学习', ['duolingo', '多邻国', '扇贝', 'shanbay', '百词斩', 'baicizhan', '沪江', 'hujiang', '英语流利说', 'liulishuo', 'cambridge dict', 'dictionary', '词典', '欧路', 'eudic', '每日英语', 'ted-ed', '语法', 'musicca']],

    // ---------- 影视视频 ----------
    ['影视视频', '视频平台', ['bilibili', '哔哩', 'b23.tv', 'youtube', '油管', 'youku', '优酷', 'iqiyi', '爱奇艺', 'v.qq.com', '腾讯视频', 'mgtv', '芒果tv', 'sohu.com/tv', '搜狐视频', 'letv', '乐视', '西瓜视频', 'ixigua', '抖音', 'douyin', '快手', 'kuaishou', 'tiktok', 'twitch', 'niconico', 'vimeo', 'dailymotion', 'openrec']],
    ['影视视频', '影视资源', ['电影', '美剧', '日剧', '韩剧', '人人影视', 'yyets', '片库', 'pianku', '茶杯狐', 'cupfox', '低端影视', 'ddrk', '奈菲', 'nfmovie', 'libvio', '影视', '追剧', '豆瓣电影', 'movie.douban', 'imdb', '烂番茄', 'rottentomatoes', 'tmdb', '蓝光', '4k', 'remux', 'bt之家', 'torrent', '磁力', 'subhd', '字幕', 'ezdmw', 'mxdm', 'metatube', '动画']],
    ['影视视频', '直播', ['斗鱼', 'douyu', '虎牙', 'huya', 'yy.com', '哔哩哔哩直播', 'live.bilibili', '抖音直播', '直播间']],

    // ---------- 音乐播客 ----------
    ['音乐播客', '音乐', ['music.163', '网易云音乐', 'y.qq.com', 'qq音乐', 'kugou', '酷狗', 'kuwo', '酷我', 'spotify', 'applemusic', 'apple.com/music', '咪咕', 'migu', '汽水', 'qishui', 'soundcloud', 'bandcamp', 'genius', '歌词', 'lyrics', '歌单', '音乐']],
    ['音乐播客', '播客', ['喜马拉雅', 'ximalaya', '小宇宙', 'xiaoyuzhou', 'podcast', '播客', 'anchor.fm', 'overcast', 'pocketcasts', 'castro', 'nrcast', '声破天']],

    // ---------- 游戏动漫 ----------
    ['游戏动漫', '游戏平台', ['steampowered', 'steamcommunity', 'steam', 'epicgames', 'epic.', 'unrealengine', 'ubisoft', '育碧', 'gog.com', 'humble', 'indiegala', 'fanatical', 'taptap', '3dmgame', '3dm', '游侠网', 'ali213', '游民星空', 'gamersky', 'ign.com', '机核', 'gcores', 'indienova', '独立游戏', 'itch.io']],
    ['游戏动漫', '动漫漫画', ['bangumi', '番组计划', 'bilibili漫画', '哔哩哔哩漫画', 'manga', '漫画', 'manhua', '动漫之家', 'dmzj', '拷贝漫画', 'copymanga', 'mox.moe', '樱花动漫', 'agefans', 'anime', '番剧', '轻小说', '梧桐', 'acg', 'galgame', 'visual novel', '夏轩阁', 'konachan', 'pixiv', 'danbooru', 'yande.re', 'exhentai', 'ehviewer', 'nhentai', '本子']],
    ['游戏动漫', '掌机与模拟器', ['switch', 'ryujinx', 'yuzu', 'cemu', 'rpcs3', 'ppsspp', 'dolphin-emu', '模拟器', 'psn', 'playstation', 'xbox', 'nintendo', '任天堂', '塞尔达', '马里奥', '宝可梦', 'pokemon']],
    ['游戏动漫', '休闲小游戏', ['lichess', 'chess.com', 'tetris', '2048', 'sudoku', '数独', 'puzzle', 'minesweeper', '扫雷', 'geoguessr', 'wordle', '小游戏', 'game', 'chess']],

    // ---------- 社交网络 ----------
    ['社交网络', '问答社区', ['zhihu', '知乎', 'reddit', 'quora', '贴吧', 'tieba', '天涯', '豆瓣', 'douban', 'nga', '虎扑', 'hupu', 'hostloc', '全球主机交流']],
    ['社交网络', '社交平台', ['weibo', '微博', 'twitter', 'instagram', 'facebook', '脸书', 'discord', 'telegram', '电报', 't.me/', 'whatsapp', 'qq空间', 'qzone', '小红书', 'xiaohongshu', 'xhslink', 'linkedin', '领英', 'pinterest', 'tumblr', 'threads', 'mastodon', 'sns']],
    ['社交网络', '即时通讯', ['wx.qq.com', 'web.wechat', 'weixin.qq.com', '钉钉', 'dingtalk', 'slack', 'zoom.us', 'skype', 'line.me', 'kakaotalk']],

    // ---------- 新闻资讯 ----------
    ['新闻资讯', '科技媒体', ['36kr', '36氪', '虎嗅', 'huxiu', '少数派', 'sspai', '爱范儿', 'ifanr', 'techcrunch', 'theverge', 'engadget', 'wired', 'arstechnica', 'hackernews', 'news.ycombinator', 'slashdot', 'solidot', 'cnbeta', 'ithome', 'IT之家', '快科技', 'mydrivers', 'zealer', '爱否']],
    ['新闻资讯', '综合资讯', ['澎湃', 'thepaper', '界面', 'jiemian', '新浪新闻', 'news.sina', '网易新闻', 'news.163', '腾讯新闻', 'new.qq', '搜狐新闻', 'news.sohu', '凤凰网', 'ifeng', '观察者网', 'guancha', '环球网', 'huanqiu', 'bbc', 'cnn', 'nytimes', '纽约时报', '卫报', 'theguardian', '华盛顿邮报', 'washingtonpost', '德国之声', 'rfi', '联合早报', 'zaobao', 'cctv', '央视', 'sohu']],

    // ---------- 购物比价 ----------
    ['购物比价', '购物平台', ['taobao', '淘宝', '天猫', 'tmall', '京东', 'jd.com', '拼多多', 'pinduoduo', 'yangkeduo', '亚马逊', 'amazon', '苏宁', 'suning', '唯品会', 'vip.com', '得物', 'poizon', '闲鱼', 'goofish', '转转', 'zhuanzhuan', 'smzdm', '什么值得买', '阿里巴巴', '1688', '.alibaba', 'wish.com', 'ebay', 'aliexpress', '速卖通', 'shein', 'temu', '购物车']],

    // ---------- 效率办公 ----------
    ['效率办公', '在线文档', ['docs.qq', '腾讯文档', 'yuque', '语雀', 'notion', 'shimo', '石墨', 'wps', '金山文档', 'kdocs', 'docs.google', '飞书文档', '飞书', 'feishu', 'lark', 'office.com', 'microsoft365', 'live.com', 'zoho', 'onlyoffice', '一起写', 'quip', 'markdown']],
    ['效率办公', '笔记知识库', ['flomo', '幕布', 'mubu', 'obsidian', '印象笔记', 'yinxiang', '有道云', 'note.youdao', 'flowus', 'wolai', '我来', 'logseq', 'roamresearch', 'remnote', 'anki', 'joplin', 'trello', 'kanban', '看板', 'todoist', '滴答清单', 'ticktick', 'omnifocus', '日历', 'calendar']],
    ['效率办公', '邮箱', ['gmail', 'mail.google', 'outlook', 'hotmail', 'live.mail', '163.com', '126.com', 'sina mail', 'mail.sina', '139.com', '189.cn', 'protonmail', 'proton.me', 'foxmail', 'email', '邮箱']],
    ['效率办公', '在线工具', ['translate', '翻译', 'deepl', '有道翻译', 'fanyi', 'tool.lu', 'bejson', '在线工具', 'convert', '转换', 'remove.bg', 'tinypng', 'tinyjpg', '压缩', '合并', 'pdf24', 'ilovepdf', 'smallpdf', '加水印', '二维码', 'qrcode', '短链接', 'shorturl', 'speedtest', '测速', 'ip查询', 'ip138', 'whois', 'ping.pe', 'tool', '网盘', 'pan.baidu', 'sms-activate', '虚拟号码', '超算']],
    ['效率办公', '密码与安全', ['1password', 'bitwarden', 'lastpass', 'keepass', 'password', '密码', 'authy', '验证器', 'totp', 'vaultwarden', '2fa']],

    // ---------- 设计素材 ----------
    ['设计素材', '设计工具', ['figma', '即时设计', 'jsdesign', 'mastergo', 'pixso', 'canva', '创客贴', 'chuangkit', 'sketch.com', 'adobe', 'photoshop', 'illustrator', 'indesign', 'aftereffects', 'premiere', 'blender', 'c4d', 'cinema4d', 'davinci', '剪映', 'capcut', 'vegas', 'final cut', 'framer', 'stitch', '产品设计', 'pmframe']],
    ['设计素材', '图库素材', ['unsplash', 'pexels', 'pixabay', 'freepik', 'shutterstock', 'gettyimages', '视觉中国', 'vcg', '站酷', 'zcool', 'ui中国', 'ui.cn', '花瓣', 'huaban', 'iconfont', 'iconfinder', 'flaticon', 'icons8', 'iconify', 'dribbble', 'behance', 'artstation', 'deviantart', 'lofter', 'lottiefiles', 'sketchfab', '海报', 'poster', 'chineseposters', 'qrbtf', 'refero', '壁纸']],
    ['设计素材', '字体配色', ['font', '字体', 'fonts.google', 'fontsquirrel', '思源', 'source han', 'maoken', '猫啃', '配色', 'colorhunt', 'coolors', 'colorspace', '中国色', 'zhongguose', 'nippon colors', 'gradient', '渐变', 'uigradients', 'webgradient']],

    // ---------- 生活服务 ----------
    ['生活服务', '出行地图', ['高德', 'amap', '百度地图', 'map.baidu', '谷歌地图', 'google.com/maps', 'maps.google', '12306', '铁路', '携程', 'ctrip', '去哪儿', 'qunar', '飞猪', 'fliggy', '同程', 'ly.com', '滴滴', 'didi', '哈啰', 'hellobike', '美团打车', '航旅纵横', 'variflight', 'flightaware', 'flightradar', '马蜂窝', 'mafengwo', '穷游', 'qyer', 'airbnb', 'booking', 'agoda']],
    ['生活服务', '政务办事', ['gov.cn', '政府', '学信', 'chsi', '社保', '公积金', '12333', '12345', '政务', '税务局', 'chinatax', '发票', '查验', '交管', '12123', '车管所', '驾校', '驾照', '出入境', '护照', '签证', '户籍']],
    ['生活服务', '快递外卖', ['美团', 'meituan', '饿了么', 'ele.me', '口碑', '饿了', '顺丰', 'sf-express', '快递100', 'kuaidi100', '快递鸟', 'kdniao', '菜鸟', 'cainiao', '圆通', 'yto', '中通', 'zto', '申通', 'sto', '韵达', 'yunda', '京东物流', 'jdl', 'ems', '邮政']],
    ['生活服务', '健康医疗', ['挂号', '好大夫', 'haodf', '丁香园', 'dxy', '微医', 'guahao', '平安好医生', 'jk.baidu', '百度健康', '有来医生', 'youlai', '寻医问药', '默沙东', 'msdmanuals', 'webmd', 'mayoclinic', '用药', ' pharmacy', '药房', '体检']],
    ['生活服务', '天气环境', ['天气', 'weather', 'moji', '墨迹', '中国天气', 'weather.com', 'windy', 'aqi', '空气质量']],
    ['生活服务', '生活缴费', ['缴费', '话费', '充值', '流量', '水费', '电费', '燃气费', '物业', '宽带', '营业厅', '中国移动', '10086', '中国联通', '10010', '中国电信', '189.cn']]
  ];

  // ---------- 内容标签（与分类正交，可多条命中） ----------
  var TAG_RULES = [
    ['教程课程', [/教程/, /入门/, /指南(?!针)/, /课程/, /学习/, /零基础/, /实战/, /路线/, /教学/, /速成/, /小白/, /课堂/, /训练/, /tutorial/i, /course/i, /learn/i, /study/i, /camp\b/i]],
    ['文档手册', [/文档/, /手册/, /规范/, /说明书/, /参考/, /datasheet/i, /docs\b/i, /document/i, /wiki/i, /reference/i, /\bspec\b/i, /manual/i]],
    ['在线工具', [/工具/, /转换/, /生成/, /计算/, /编辑/, /压缩/, /格式化/, /在线/, /检测/, /识别/, /\btool/i, /converter/i, /generator/i, /editor/i, /util/i]],
    ['代码仓库', []], // URL 结构判断
    ['自建服务', []], // URL 结构判断
    ['社区问答', [/论坛/, /社区/, /问答/, /交流/, /讨论/, /forum/i, /\bbbs\b/i, /v2ex/i, /reddit/i, /知乎/, /zhihu/i, /segmentfault/i, /stackoverflow/i, /csdn/i, /博客园/, /掘金/, /juejin/i]],
    ['博客文章', [/博客/, /\bblog/i, /文章/, /专栏/, /随笔/, /日志/, /笔记/, /post\b/i, /essay/i, /blogspot/i, /wordpress/i, /ghost\b/i]],
    ['视频影视', [/bilibili/, /哔哩/, /youtube/i, /视频/, /video/i, /电影/, /影视/, /追剧/, /美剧/, /日剧/, /动漫/, /番剧/, /anime/i, /movie/i, /纪录片/, /直播/, /live\b/i]],
    ['电子书', [/电子书/, /书库/, /图书馆/, /阅读器/, /读书/, /文库/, /\bpdf\b/i, /z-?lib/i, /zlibrary/i, /libgen/i, /annas/i, /kindle/i, /小说/, /漫画/, /manga/i, /epub/i, /书单/]],
    ['资讯新闻', [/新闻/, /资讯/, /快讯/, /日报/, /周报/, /热点/, /时事/, /news/i, /headline/i, /36kr/i, /晚点/, /财新/, /报道/]],
    ['下载资源', [/下载/, /download/i, /网盘/, /\bpan\b/i, /资源/, /软件站/, /绿色软件/, /便携/, /portable/i, /磁力/, /种子/, /torrent/i, /镜像/, /mirror/i, / releases?\b/i, /破解/]],
    ['设计素材', [/设计/, /design/i, /图标/, /\bicon/i, /字体/, /font/i, /配色/, /色卡/, /color/i, /素材/, /图库/, /壁纸/, /wallpaper/i, /插画/, /\bui\b/i, /figma/i, /sketch/i, /behance/i, /dribbble/i, /\blogo\b/i, /摄影/, /图片/]],
    ['行情数据', [/行情/, /k线/i, /走势/, /市值/, /持仓/, /quote/i, /chart/i, /图表/, /数据平台/, /\bapi\b/i, /dashboard/i, /监控/, /explorer/i, /scan\b/i, /链上/, /指数/, /财报/, /筛选器/, /screener/i, /数据/]],
    ['游戏娱乐', [/游戏/, /\bgame/i, /steam/i, /itch\.io/i, /象棋/, /chess/i, /俄罗斯方块/, /tetris/i, /2048/, /puzzle/i, /数独/, /sudoku/i]],
    ['AI 对话', [/claude/i, /chatgpt/i, /openai/i, /gemini/i, /\bkimi\b/i, /moonshot/i, /\bgrok\b/i, /deepseek/i, /豆包/, /doubao/i, /qwen/i, /通义/, /chat/i, /聊天/, /copilot/i, /\bpoe\b/i, /对话/]],
    ['AI 应用', [/(?<![a-z0-9])ai(?![a-z0-9])/i, /人工智能/, /大模型/, /\bllm\b/i, /\bgpt/i, /机器学习/, /machine.?learning/i, /deep.?learning/i, /prompt/i, /提示词/, /diffusion/i, /midjourney/i, /绘画/, /生图/, /视频生成/, /数字人/, /语音/, /voice/i, /\btts\b/i, /\basr\b/i, /字幕/]],
    ['求职接单', [/招聘/, /求职/, /接单/, /外包/, /远程工作/, /兼职/, /\bjob/i, /hire/i, /freelance/i, /简历/, /面试/, /薪资/, /upwork/i, /猪八戒/, /程序员客栈/, /电鸭/]],
    ['硬件资料', [/单片机/, /\bmcu\b/i, /stm32/i, /芯片/, /原理图/, /schematic/i, /\bpcb/i, /电路/, /元器件/, /电容/, /电阻/, /电感/, /\bmos\b/i, /运放/, /示波器/, /焊接/, /embedded/i, /嵌入式/, /esp32/i, /arduino/i, /\brisc/i, /射频/, /\brf\b/i, /电源/, /电池/, /充电/]],
    ['娱乐休闲', [/音乐/, /歌单/, /\bmusic/i, /spotify/i, /电台/, /podcast/i, /播客/, /笑话/, /体育/, /足球/, /\bnba\b/i, /旅游/, /美食/, /菜谱/]],
    ['生活服务', [/快递/, /物流/, /缴费/, /银行/, /天气/, /地图/, /外卖/, /健康/, /医疗/, /学信/, /社保/, /公积金/, /政务/, /驾校/, /驾照/, /考试报名/, /学校/, /校园/, /话费/, /流量充值/]]
  ];

  var CAT_FALLBACK_TAG = {
    'AI 工具': 'AI 应用',
    '电子硬件': '硬件资料',
    '金融与投资': '行情数据',
    '开发与编程': '文档手册',
    '学习资源': '教程课程',
    '影视视频': '视频影视',
    '音乐播客': '娱乐休闲',
    '游戏动漫': '游戏娱乐',
    '社交网络': '社区问答',
    '新闻资讯': '资讯新闻',
    '工具与实用': '在线工具',
    '生活服务': '生活服务',
    '私密': null
  };
  var MAX_TAGS = 4;

  // ============ URL 规范化（去重用） ============
  var TRACK_PARAMS = /(?:^|&)(?:utm_\w+|spm|_ga|_gcl_au|_gl|continueflag|srsltid|fbclid|invite_code|ref|source|from_login|page_id|mark_id|pli|show_merge_modal|code|state|page|accounttraceid|dp-logid)(?:=[^&]*)?/ig;
  function normUrl(u) {
    u = (u || '').trim().toLowerCase();
    u = u.replace(/^https?:\/\//, '');
    u = u.replace(/^www\./, '');
    var qi = u.indexOf('?');
    if (qi !== -1) {
      var base = u.slice(0, qi), q = u.slice(qi + 1);
      q = q.replace(TRACK_PARAMS, '');
      q = q.replace(/^&+|&+$/g, '');
      u = base + (q ? '?' + q : '');
    }
    u = u.replace(/\/index\.(html|php)$/, '/');
    u = u.replace(/\/+$/, '');
    return u;
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch (e) { return (url || '').replace(/^[a-z]+:\/\//i, '').split('/')[0]; }
  }

  // ============ 无效书签判断 ============
  function isInvalidUrl(url) {
    if (!url) return true;
    return /^(chrome|edge|about|brave|vivaldi|opera|javascript|place|view-source):/i.test(url);
  }
  function isGarbage(b) {
    return isInvalidUrl(b.url) || b.title === '新标签页' || b.title === '打开新的标签页';
  }

  // ============ 主分类 ============
  function classify(b) {
    var text = (b.title + ' ' + b.url).toLowerCase();

    // 1. 私密
    if (RE_PRIVATE.test(text)) return ['私密', '私密收藏'];
    // 2. 自建服务 / 内网
    if (RE_SELFHOST.test(text)) {
      return ['自建服务', /jellyfin|emby|plex|qbit|aria2|alist|transmission|portainer|heimdall|dashy|n8n/i.test(text) ? '服务面板' : 'NAS 与内网'];
    }
    // 2.5 特殊精确修正
    for (var s = 0; s < SPECIALS.length; s++) {
      if (SPECIALS[s][0].test(b.url) || SPECIALS[s][0].test(b.title)) return [SPECIALS[s][1], SPECIALS[s][2]];
    }
    // 3. 规则表顺序命中
    for (var i = 0; i < RULES.length; i++) {
      var r = RULES[i];
      if (kw(text, r[2])) return [r[0], r[1]];
    }
    // 4. 兜底启发式
    if (RE_HW_GENERIC.test(text)) return ['电子硬件', '元件与厂商'];
    if (RE_AI_GENERIC.test(text)) return ['AI 工具', 'AI 导航与资讯'];
    return ['其他', '未分类'];
  }

  // ============ 标签 ============
  function tagsOf(b, cat) {
    if (cat === '私密') return [];
    var text = (b.title + ' ' + b.url);
    var matched = [];
    if (RE_REPO.test(b.url)) matched.push('代码仓库');
    if (RE_SELFHOST.test((b.title + ' ' + b.url).toLowerCase())) matched.push('自建服务');
    TAG_RULES.forEach(function (tr) {
      if (tr[1].length === 0) return;
      for (var i = 0; i < tr[1].length; i++) {
        if (tr[1][i].test(text)) { matched.push(tr[0]); break; }
      }
    });
    // 保持规则表顺序 + 去重 + 截断
    var tags = [];
    TAG_RULES.forEach(function (tr) {
      if (matched.indexOf(tr[0]) !== -1 && tags.indexOf(tr[0]) === -1) tags.push(tr[0]);
    });
    tags = tags.slice(0, MAX_TAGS);
    if (tags.length === 0) {
      var fb = CAT_FALLBACK_TAG[cat];
      if (fb) tags = [fb];
    }
    return tags;
  }

  // ============ 品牌色 ============
  var BRAND = {
    'claude.ai': '#d97757', 'openai.com': '#10a37f', 'chatgpt.com': '#10a37f', 'google.com': '#4285f4',
    'x.ai': '#111114', 'moonshot.cn': '#4d4dff', 'kimi.moonshot.cn': '#4d4dff', 'deepseek.com': '#4d6bfe',
    'huggingface.co': '#e8b30c', 'modelscope.cn': '#7b3fe4', 'openrouter.ai': '#4f46e5',
    'siliconflow.cn': '#3b82f6', 'poe.com': '#5e5ce6', 'perplexity.ai': '#20808d',
    'github.com': '#24292f', 'gitee.com': '#c71d23', 'csdn.net': '#fc5531', 'cnblogs.com': '#2a6dd4',
    'segmentfault.com': '#00965e', 'zhihu.com': '#0084ff', 'juejin.cn': '#1e80ff', 'runoob.com': '#4caf50',
    'hellogithub.com': '#30bf6b', 'stackoverflow.com': '#f48024', 'leetcode.cn': '#ffa116', 'nowcoder.com': '#25bb9b',
    'szlcsc.com': '#ff6a00', 'jlc.com': '#ff6a00', 'oshwhub.com': '#00b42a', 'elecfans.com': '#d7192c',
    'microchip.com': '#cc0000', 'wch.cn': '#e60012', 'gd32mcu.com': '#0059b3', 'waveshare.net': '#d92d20',
    'semiee.com': '#f59e0b', 'eda365.com': '#e34d3c', '51hei.com': '#ef4444', 'ti.com': '#cc0000',
    'digikey.cn': '#cc0000', 'mouser.cn': '#004a80',
    'binance.com': '#f0b90b', 'coinmarketcap.com': '#3f6cff', 'coingecko.com': '#8dc63f', 'okx.com': '#787e87',
    'dexscreener.com': '#3b82f6', 'opensea.io': '#2081e2', 'pump.fun': '#8bc34a', 'gmgn.ai': '#10b981',
    'etherscan.io': '#21325b', 'bscscan.com': '#21325b', 'solscan.io': '#06b6d4', 'basescan.org': '#21325b',
    'tushare.pro': '#3a6ff2', 'tradingview.com': '#2962ff', 'eastmoney.com': '#e0311e', '10jqka.com.cn': '#e0311e',
    'xueqiu.com': '#1daef3', 'futu5.com': '#0045ff', 'futunn.com': '#0045ff',
    'fnnas.com': '#3b6ff5', 'tencent.com': '#0052d9', 'feishu.cn': '#3370ff', 'qq.com': '#12b7f5',
    'mp.weixin.qq.com': '#07c160', 'baidu.com': '#2932e1', 'bejson.com': '#f5a623', '360doc.com': '#3366cc',
    'reddit.com': '#ff4500', 'smzdm.com': '#e02424', 'artstation.com': '#13aff0', 'cctv.com': '#d81e06',
    'bilibili.com': '#fb7299', 'youtube.com': '#ff0033', 'douyin.com': '#161823', 'netflix.com': '#e50914',
    'spotify.com': '#1db954', 'music.163.com': '#e60026', 'y.qq.com': '#31c27c', 'kugou.com': '#169af3',
    'ximalaya.com': '#d33c33', 'steampowered.com': '#66c0f4', 'epicgames.com': '#2a2a2a', 'itch.io': '#fa5c5c',
    'taptap.cn': '#2773fa', 'gamersky.com': '#e94620', '3dmgame.com': '#cc2a1d',
    'weibo.com': '#e6162d', 'xiaohongshu.com': '#ff2442', 'instagram.com': '#d6249f', 'facebook.com': '#1877f2',
    'discord.com': '#5865f2', 'telegram.org': '#2aabee', 't.me': '#2aabee', 'linkedin.com': '#0a66c2',
    '36kr.com': '#0064ff', 'huxiu.com': '#e8380d', 'sspai.com': '#d71a18', 'ithome.com': '#dd3622',
    'taobao.com': '#ff5000', 'tmall.com': '#ff0036', 'jd.com': '#e2231a', 'pinduoduo.com': '#e02e24',
    'amazon.cn': '#ff9900', 'meituan.com': '#ffc300', 'ele.me': '#0085ff', 'sf-express.com': '#dc1e32',
    'amap.com': '#00b4ff', 'ctrip.com': '#0086f6', 'qunar.com': '#1ec796', '12306.cn': '#3b99fc',
    'notion.so': '#111114', 'yuque.com': '#25b864', 'shimo.im': '#2d7ff9', 'kdocs.cn': '#1e7bff',
    'figma.com': '#a259ff', 'canva.cn': '#00c4cc', 'dribbble.com': '#ea4c89', 'behance.net': '#1769ff',
    'iconfont.cn': '#ff6a00', 'unsplash.com': '#111214', 'pexels.com': '#05a081', 'pixabay.com': '#2ec66d',
    'unsplash': '#111214', 'flomo.app': '#3072f2', 'obsidian.md': '#7c3aed', 'wolai.com': '#3b5bff',
    'weread.qq.com': '#2ac864', 'douban.com': '#007722', 'imdb.com': '#f5c518', 'imdb.cn': '#f5c518',
    'archive.org': '#98b3d3', 'coursera.org': '#0056d2', 'edx.org': '#02262b', 'duolingo.com': '#58cc02',
    'gemini.google.com': '#4285f4', 'chat.deepseek.com': '#4d6bfe'
  };
  function hashHue(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; }
    return h % 360;
  }
  function brandColor(host) {
    var h = (host || '').toLowerCase().split(':')[0];
    var parts = h.split('.');
    for (var i = 0; i < parts.length; i++) {
      var suffix = parts.slice(i).join('.');
      if (BRAND[suffix]) return BRAND[suffix];
    }
    return 'hsl(' + hashHue(h) + ',62%,47%)';
  }

  var api = {
    CAT_ORDER: CAT_ORDER,
    CAT_THEME: CAT_THEME,
    TAG_NAMES: TAG_RULES.map(function (t) { return t[0]; }),
    classify: classify,
    tagsOf: tagsOf,
    normUrl: normUrl,
    hostOf: hostOf,
    brandColor: brandColor,
    isGarbage: isGarbage,
    isLocal: function (host) { return /^\d+\.\d+\.\d+\.\d+/.test(host) || (host || '').indexOf('localhost') !== -1; }
  };

  global.NavClassifier = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
