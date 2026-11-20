const ENGLISH = {
  '直播字幕工作台': 'Live caption studio',
  '字幕工作台': 'Caption studio',
  '组件管理': 'Components',
  '预设方案': 'Presets',
  '诊断与日志': 'Diagnostics & logs',
  '系统就绪': 'System ready',
  '界面语言': 'Interface language',
  '等待识别': 'Waiting for speech',
  '普通权限运行': 'Standard access',
  '管理员权限运行': 'Administrator access',
  '打开日志目录': 'Open log folder',
  '请求管理员权限': 'Request administrator access',
  '请求权限': 'Request access',
  '实时预览': 'Live preview',
  '预览': 'Preview',
  '清屏': 'Clear',
  'OBS 浏览器来源': 'OBS Browser Source',
  '实时': 'Live',
  '开始识别或点击「试一试」': 'Start recognition or select Try it',
  '字幕画布预览': 'Caption canvas preview',
  '待机': 'Idle',
  'OBS 浏览器来源 URL': 'OBS Browser Source URL',
  '复制 URL': 'Copy URL',
  '开始识别': 'Start recognition',
  '暂停识别': 'Pause recognition',
  '试一试': 'Try it',
  '字幕画布': 'Caption canvas',
  '测试字幕': 'Test caption',
  '在这里输入文字，直播软件中实时显示': 'Type a caption to show it live in OBS',
  '重播': 'Replay',
  '麦克风电平': 'Mic level',
  '浏览器来源': 'Browser source',
  '启动中': 'Starting',
  '随来源宽度自动换行': 'Wraps to source width',
  '字幕参数': 'Caption settings',
  '恢复默认': 'Reset defaults',
  '字幕参数分类': 'Caption settings categories',
  '输入': 'Input',
  '排版': 'Layout',
  '样式': 'Style',
  '动画': 'Animation',
  'AI 优化': 'AI correction',
  '识别输入': 'Speech input',
  '麦克风': 'Microphone',
  '系统默认麦克风': 'System default microphone',
  '刷新设备': 'Refresh devices',
  '下载模型（134 MB）': 'Download model (134 MB)',
  '拼音轨道': 'Pinyin',
  '显示拼音': 'Show pinyin',
  '开启': 'On',
  '关闭': 'Off',
  '声调': 'Tones',
  '带声调': 'With tones',
  '无声调': 'Without tones',
  '拼音字号比例 ': 'Pinyin size ',
  '排版方向': 'Text direction',
  '横排': 'Horizontal',
  '竖排': 'Vertical',
  '左起': 'Left',
  '从左向右': 'Expand right',
  '居中': 'Center',
  '向两侧展开': 'Expand both ways',
  '右起': 'Right',
  '从右向左': 'Expand left',
  '纵向锚点': 'Vertical position',
  '顶部': 'Top',
  '底部': 'Bottom',
  '折行策略': 'Line alignment',
  '整块居中': 'Center as a block',
  '逐行居中': 'Center each line',
  '字体': 'Font',
  '字号': 'Font size',
  '背景': 'Background',
  '透明': 'Transparent',
  '纯绿抠像': 'Chroma green',
  '纯黑': 'Black',
  '自定义颜色': 'Custom color',
  '文字颜色': 'Text color',
  '描边颜色': 'Outline color',
  '背景色': 'Background color',
  '描边宽度 ': 'Outline width ',
  '动画节奏': 'Animation timing',
  '最小字间隔 ': 'Minimum character interval ',
  '光标闪烁': 'Blinking cursor',
  '停顿时提示下一字位置': 'Show the next character position while paused',
  'AI 字幕优化（可选）': 'AI caption correction (optional)',
  '未设置时直接使用原文': 'Uses raw captions until configured',
  '已保存；留空保持不变': 'Saved; leave blank to keep the current key',
  '模型名称': 'Model name',
  '例如 gpt-4.1-nano': 'e.g. gpt-4.1-nano',
  '支持兼容 Chat Completions 的 API。启用后只将每段已辨识文字发送到你设置的服务。': 'Supports Chat Completions-compatible APIs. Each completed utterance is sent only to the service you configure.',
  '保存 AI 设置': 'Save AI settings',
  '清除 Key': 'Clear key',
  '未设置，使用原文': 'Not configured; using raw captions',
  '已启用': 'Enabled',
  '首次下载后，TypeSub 会在本机离线识别麦克风音频。': 'Download the model once to recognize speech offline on this device.',
  'TypeSub 语音模型': 'TypeSub speech model',
  '检测中': 'Checking',
  '普通话和英语 · Zipformer': 'Mandarin and English · Zipformer',
  '模型下载进度': 'Model download progress',
  '管理员权限': 'Administrator access',
  '根据直播场景快速切换排版与样式。参数会立即应用到预览画布。': 'Choose a layout and style for your stream. Changes appear in the preview immediately.',
  '游戏娱乐': 'Gaming & chat',
  '横排 · 居中 · 高对比': 'Horizontal · centered · high contrast',
  '语音房': 'Voice chat',
  '横排 · 左起 · 轻描边': 'Horizontal · left aligned · light outline',
  '教学竖排': 'Vertical teaching',
  '竖排 · 右起 · 带拼音': 'Vertical · right aligned · pinyin',
  '居中展开的双轨字幕，适合游戏、闲聊和短句互动。': 'Centered captions with pinyin for games, casual chat, and short exchanges.',
  '左起横排字幕，关闭拼音轨，适合连续聊天和连麦。': 'Left aligned captions without pinyin for continuous conversation.',
  '右起竖排字幕，保留拼音轨，适合知识讲解与板书。': 'Right aligned vertical captions with pinyin for teaching.',
  '应用预设': 'Apply preset',
  '用于排查音频设备、组件和输出状态。诊断包不包含音频和字幕内容。': 'Check audio devices, components, and output. Exported diagnostics contain no audio or caption content.',
  '主程序': 'Application',
  '运行正常': 'Running normally',
  '配置目录': 'Configuration folder',
  '读取中': 'Loading',
  '打开': 'Open',
  '日志文件': 'Log file',
  '导出诊断信息': 'Export diagnostics',
  '把每句话打在直播画面上': 'Put every word on screen',
  '下载语音模型后，点击「开始识别」接收麦克风字幕。把工作台的 URL 复制到 OBS 浏览器来源。': 'Download the speech model, then start recognition. Copy the studio URL into an OBS Browser Source.',
  '复制工作台 URL 到 OBS': 'Paste the studio URL into OBS',
  '已就绪': 'Ready',
  '普通话和英语 · 离线识别': 'Mandarin and English · offline recognition',
  '进入工作台': 'Open studio',
  '上次选择的麦克风（暂不可用）': 'Previously selected microphone (unavailable)',
  '正在读取麦克风列表…': 'Loading microphones…',
  '暂停识别后可以切换麦克风。': 'Pause recognition to change microphones.',
  '如果列表只有系统默认，请点击「刷新设备」以读取设备名称。': 'Select Refresh devices to load microphone names.',
  '请在系统隐私设置中允许 TypeSub 使用麦克风。': 'Allow TypeSub to use the microphone in your system privacy settings.',
  '找不到所选麦克风。请重新连接，或在「输入」中改选其他设备。': 'The selected microphone was not found. Reconnect it or choose another device under Input.',
  '无法打开麦克风。请检查连接，以及设备是否被其他程序占用。': 'Could not open the microphone. Check its connection and whether another app is using it.',
  '无法读取麦克风。': 'Could not access the microphone.',
  '已授权': 'Authorized',
  '未提权': 'Standard access',
  '当前已以管理员权限运行。': 'TypeSub is running with administrator access.',
  '普通权限运行；点击请求权限会弹出 Windows 授权窗口。': 'Standard access. Request access to open the Windows authorization prompt.',
  '已是管理员': 'Administrator access active',
  '已下载': 'Installed',
  '正在校验与解包…': 'Verifying and extracting…',
  '未下载': 'Not installed',
  '语音模型已下载，可离线识别': 'Speech model installed. Offline recognition is ready.',
  '模型下载失败，请重试': 'Model download failed. Please try again.',
  '欢迎来到 TypeSub，字幕正在逐个出现。': 'Welcome to TypeSub. Captions appear one character at a time.',
  '示例字幕': 'Sample caption',
  '正在播放示例': 'Playing sample',
  '手动测试': 'Manual test',
  '字幕已发送至画布': 'Caption sent to canvas',
  '正在暂停': 'Pausing',
  '正在关闭麦克风': 'Closing microphone',
  '已暂停': 'Paused',
  '识别已暂停': 'Recognition paused',
  '请先下载语音模型': 'Download the speech model first.',
  '正在启动': 'Starting',
  '正在打开麦克风': 'Opening microphone',
  '识别已停止': 'Recognition stopped',
  '麦克风已断开，可在「输入」中切换': 'Microphone disconnected. Choose another device under Input.',
  '字幕画布已清空': 'Caption canvas cleared',
  'OBS URL 已复制': 'OBS URL copied',
  'API Key 已清除': 'API key cleared',
  'AI 设置已保存': 'AI settings saved',
  '字幕画布已显示': 'Caption canvas shown',
  '字幕画布已隐藏': 'Caption canvas hidden',
  '已恢复默认参数': 'Default settings restored',
  '预设已应用': 'Preset applied',
  '此诊断信息不包含音频和字幕内容': 'This diagnostic report contains no audio or caption content',
  '诊断信息已导出': 'Diagnostics exported',
  '等待系统授权…': 'Waiting for authorization…',
  '正在等待 Windows 管理员授权窗口…': 'Waiting for the Windows administrator prompt…',
  '当前已以管理员权限运行': 'TypeSub already has administrator access',
  '授权成功，正在以管理员权限重新启动…': 'Access granted. Restarting as administrator…',
  '管理员权限请求未完成': 'Administrator access request did not complete',
  '管理员权限请求失败': 'Administrator access request failed',
  '监听中': 'Listening',
  '等待语音': 'Waiting for speech',
  '请检查语音输入': 'Check speech input',
  '不可用': 'Unavailable',
  '管理员提权只支持 Windows': 'Administrator access is supported only on Windows.',
  '缺少 Rust 提权助手；请先运行 npm run build:engine': 'Rust elevation helper is missing. Run npm run build:engine.',
  '字幕引擎未启动，请重新启动 TypeSub。': 'Caption engine is not running. Restart TypeSub.',
  '麦克风采样率不受支持。': 'Microphone sample rate is unsupported.',
  '语音识别已在运行。': 'Speech recognition is already running.',
  '当前安装包不包含此系统架构的语音引擎。': 'This installation does not include a speech engine for your system architecture.',
  '本地语音引擎已退出，请查看日志后重新开始。': 'Local speech engine stopped. Check the logs and start again.',
  '本地模型加载超时，请重新开始。': 'The local model took too long to load. Start again.',
  '无法启动本地语音引擎，请查看日志。': 'Could not start the local speech engine. Check the logs.',
  '本地识别无法跟上当前音频，请关闭占用 CPU 的程序后重新开始。': 'Recognition cannot keep up with the audio. Close CPU-intensive apps and start again.',
  '系统加密存储不可用，无法保存 API Key。': 'System encryption is unavailable, so the API key cannot be saved.',
  'API Base URL 无效': 'Invalid API Base URL.',
  '远程 API 必须使用 HTTPS': 'Remote APIs must use HTTPS.',
  '模型下载大小不符。': 'The model download size does not match.',
  '模型校验失败，请重新下载。': 'Model verification failed. Download it again.'
};

let language = 'zh-CN';
const sourceText = new WeakMap();
const sourceAttributes = new WeakMap();
const translated = new Set(Object.values(ENGLISH));

function englishText(text) {
  if (Object.hasOwn(ENGLISH, text)) return ENGLISH[text];
  const microphone = /^麦克风 (\d+)$/.exec(text);
  if (microphone) return `Microphone ${microphone[1]}`;
  const download = /^下载中 (\d+)%$/.exec(text);
  if (download) return `Downloading ${download[1]}%`;
  const failed = /^模型下载失败（HTTP (\d+)）。$/.exec(text);
  if (failed) return `Model download failed (HTTP ${failed[1]}).`;
  const admin = /^管理员权限请求未完成：(.*)$/.exec(text);
  if (admin) return `Administrator access request did not complete: ${admin[1]}`;
  return text;
}

function t(text) {
  return language === 'en' ? englishText(text) : text;
}

function translateNode(node) {
  if (node.parentElement?.closest('#caption-stage')) return;
  const current = node.nodeValue;
  let source = sourceText.get(node);
  if (source === undefined || (current !== source && current !== englishText(source))) {
    if (translated.has(current) && source === undefined) return;
    source = current;
    sourceText.set(node, source);
  }
  const next = t(source);
  if (current !== next) node.nodeValue = next;
}

function translateElement(element) {
  if (element.closest('#caption-stage')) return;
  for (const attr of ['placeholder', 'title', 'aria-label']) {
    if (!element.hasAttribute(attr)) continue;
    const current = element.getAttribute(attr);
    const sources = sourceAttributes.get(element) || {};
    if (sources[attr] === undefined || (current !== sources[attr] && current !== englishText(sources[attr]))) {
      sources[attr] = current;
      sourceAttributes.set(element, sources);
    }
    const next = t(sources[attr]);
    if (current !== next) element.setAttribute(attr, next);
  }
  for (const child of element.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) translateNode(child);
    else if (child.nodeType === Node.ELEMENT_NODE) translateElement(child);
  }
}

function setLanguage(next) {
  language = next === 'en' ? 'en' : 'zh-CN';
  document.documentElement.lang = language;
  document.querySelectorAll('[data-language-select]').forEach((select) => { select.value = language; });
  translateElement(document.body);
}

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.type === 'characterData') translateNode(mutation.target);
    else if (mutation.type === 'attributes') translateElement(mutation.target);
    else for (const node of mutation.addedNodes) {
      if (node.nodeType === Node.TEXT_NODE) translateNode(node);
      else if (node.nodeType === Node.ELEMENT_NODE) translateElement(node);
    }
  }
});
observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'title', 'aria-label'] });
