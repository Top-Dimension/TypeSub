const stage = document.getElementById('stage');
const caption = document.getElementById('caption');
const measure = document.getElementById('measure');
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
let frame = { typed: '', syllables: [], cursor: false, visible: true, settings: {} };

function glyphsForFrame(settings) {
  const glyphs = [];
  let index = 0;
  for (const { segment } of graphemes.segment(frame.typed)) {
    const glyph = document.createElement('span');
    glyph.className = 'glyph';
    if (settings.pinyin !== false) {
      const syllable = document.createElement('span');
      syllable.className = 'syllable';
      syllable.textContent = frame.syllables[index] || '';
      glyph.append(syllable);
    }
    const character = document.createElement('span');
    character.className = 'character';
    character.textContent = segment;
    glyph.append(character);
    glyphs.push(glyph);
    index += [...segment].length;
  }
  if (frame.cursor && settings.cursorBlink !== false) {
    const cursor = document.createElement('span');
    cursor.className = 'cursor';
    glyphs.push(cursor);
  }
  return glyphs;
}

function wrap(glyphs, boxes, vertical, lineLimit, pageLimit) {
  const lines = [];
  let items = [];
  let length = 0;
  let depth = 0;
  for (let index = 0; index < glyphs.length; index++) {
    const box = boxes[index];
    const advance = vertical ? box.height : box.width;
    if (items.length && length + advance > lineLimit) {
      lines.push({ items, depth });
      items = [];
      length = 0;
      depth = 0;
    }
    items.push(glyphs[index]);
    length += advance;
    depth = Math.max(depth, vertical ? box.width : box.height);
  }
  if (items.length) lines.push({ items, depth });

  // Slide by complete lines or columns as new text fills the source.
  let start = lines.length;
  let used = 0;
  while (start > 0 && used + lines[start - 1].depth <= pageLimit) {
    used += lines[--start].depth;
  }
  return lines.slice(start);
}

function render() {
  const settings = frame.settings;
  stage.hidden = !frame.visible;
  stage.style.background = ({
    green: '#18d27b', black: '#060908', custom: settings.backgroundColor || '#18d27b'
  })[settings.backgroundMode] || 'transparent';
  if (!frame.visible) return;

  const { clientWidth: width, clientHeight: height } = stage;
  if (!width || !height) return;
  const vertical = settings.orientation === 'vertical';
  const size = Math.min(Math.max(1, Number(settings.fontSize) || 64), width, height);
  const padding = Math.min(6, width * .035, height * .035);
  const contentWidth = width - padding * 2;
  const contentHeight = height - padding * 2;
  const outline = Math.max(0, settings.outlineWidth ?? 3);
  const pinyinSize = Math.max(.35, Math.min(.75, (Number(settings.pinyinSize) || 55) / 100));
  stage.style.setProperty('--padding', `${padding}px`);
  stage.style.setProperty('--pinyin-size', `${pinyinSize}em`);
  stage.style.fontFamily = `${JSON.stringify(settings.fontFamily || 'Microsoft YaHei UI')}, sans-serif`;
  stage.style.color = settings.textColor || '#ffffff';
  const setFont = (value) => {
    stage.style.fontSize = `${value}px`;
    stage.style.setProperty('--stroke', `${Math.min(outline, padding, value * .08)}px ${settings.outlineColor || '#081019'}`);
  };
  setFont(size);
  stage.classList.toggle('vertical', vertical);
  const direction = ['left', 'right'].includes(settings.direction) ? settings.direction : 'center';
  const anchor = ['center', 'bottom'].includes(settings.verticalAnchor) ? settings.verticalAnchor : 'top';
  caption.className = `${direction} ${anchor}-anchor ${settings.centerMode === 'line' ? 'per-line' : 'block'}`;

  const glyphs = glyphsForFrame(settings);
  measure.replaceChildren(...glyphs);
  let boxes = glyphs.map((glyph) => glyph.getBoundingClientRect());
  const scale = boxes.reduce((ratio, box) => Math.min(ratio, contentWidth / (box.width || 1),
    contentHeight / (box.height || 1)), 1);
  if (scale < 1) {
    setFont(size * scale * .97);
    boxes = glyphs.map((glyph) => glyph.getBoundingClientRect());
  }

  const tracks = document.createElement('div');
  tracks.className = 'tracks';
  const lineLimit = vertical ? contentHeight : contentWidth;
  const pageLimit = vertical ? contentWidth : contentHeight;
  for (const line of wrap(glyphs, boxes, vertical, lineLimit, pageLimit)) {
    const track = document.createElement('div');
    track.className = 'track';
    track.append(...line.items);
    tracks.append(track);
  }
  caption.replaceChildren(tracks);
  measure.replaceChildren();
}

let pendingRender = false;
function scheduleRender() {
  if (pendingRender) return;
  pendingRender = true;
  requestAnimationFrame(() => {
    pendingRender = false;
    render();
  });
}

const events = new EventSource('./events');
events.onmessage = (event) => {
  frame = JSON.parse(event.data);
  scheduleRender();
};
events.onerror = () => {
  frame = { ...frame, typed: '', syllables: [], cursor: false, visible: false };
  scheduleRender();
};
new ResizeObserver(render).observe(document.body);
