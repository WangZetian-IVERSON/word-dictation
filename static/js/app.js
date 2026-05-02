/* ────────────────────────────────────────────────
   单词听写系统 — app.js
   ──────────────────────────────────────────────── */

'use strict';

// ═══════════════════════════════════════════════
//  State
// ═══════════════════════════════════════════════
const State = {
  words: [],          // word library
  checked: new Set(), // checked words in library

  listen: {
    words: [],
    idx: 0,
    playing: false,
    paused: false,
    speed: 1.0,
    interval: 3,
    loop: 'none',   // 'none' | 'one' | 'all'
    voice: '',
    timer: null,
    autoInfo: false,
    hideWord: false,
    sidebarVisible: true,
  },

  dict: {
    words: [],
    idx: 0,
    results: [],    // [{word, answer, correct}]
    method: 'keyboard',
    range: 'all',
    voice: '',
    interval: 3,
    phase: 'setup', // 'setup' | 'active' | 'result'
    hasPlayed: false,
  },
};

// ═══════════════════════════════════════════════
//  Toast helper
// ═══════════════════════════════════════════════
function toast(msg, type = 'primary') {
  const el = document.getElementById('appToast');
  el.className = `toast align-items-center border-0 text-white bg-${type}`;
  document.getElementById('toastMsg').textContent = msg;
  bootstrap.Toast.getOrCreateInstance(el, { delay: 2500 }).show();
}

// ═══════════════════════════════════════════════
//  API helpers
// ═══════════════════════════════════════════════
async function apiFetch(url, options = {}) {
  const r = await fetch(url, options);
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error || `HTTP ${r.status}`);
  }
  return r.json();
}

// ═══════════════════════════════════════════════
//  Word Library
// ═══════════════════════════════════════════════
async function loadLibrary() {
  try {
    State.words = await apiFetch('/api/words');
    renderLibrary();
  } catch (e) {
    toast('加载单词库失败: ' + e.message, 'danger');
  }
}

function renderLibrary() {
  const grid = document.getElementById('wordList');
  const empty = document.getElementById('emptyHint');
  document.getElementById('wordCount').textContent = State.words.length;

  if (!State.words.length) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  grid.innerHTML = State.words.map((w, i) => {
    const chk = State.checked.has(w) ? 'checked' : '';
    const selCls = State.checked.has(w) ? 'selected' : '';
    return `<div class="word-item ${selCls}" data-word="${esc(w)}">
      <input type="checkbox" ${chk} data-idx="${i}" />
      <span class="word-text">${esc(w)}</span>
      <button class="del-word" data-word="${esc(w)}" title="删除"><i class="bi bi-x"></i></button>
    </div>`;
  }).join('');

  // bind checkbox
  grid.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const word = cb.closest('.word-item').dataset.word;
      if (cb.checked) State.checked.add(word); else State.checked.delete(word);
      cb.closest('.word-item').classList.toggle('selected', cb.checked);
    });
  });

  // bind delete
  grid.querySelectorAll('.del-word').forEach(btn => {
    btn.addEventListener('click', async () => {
      const word = btn.dataset.word;
      await deleteWord(word);
    });
  });

  refreshListenList();
}

async function addWordsFromTextarea() {
  const raw = document.getElementById('manualInput').value;
  if (!raw.trim()) return;
  const words = raw.split(/[\n,\s]+/).map(w => w.trim()).filter(Boolean);
  if (!words.length) return;
  try {
    const r = await apiFetch('/api/words', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ words }),
    });
    document.getElementById('manualInput').value = '';
    toast(`已添加 ${r.added.length} 个单词`, 'success');
    State.words = await apiFetch('/api/words');
    renderLibrary();
  } catch (e) {
    toast('添加失败: ' + e.message, 'danger');
  }
}

async function deleteWord(word) {
  try {
    await apiFetch(`/api/words/${encodeURIComponent(word)}`, { method: 'DELETE' });
    State.checked.delete(word);
    State.words = await apiFetch('/api/words');
    renderLibrary();
  } catch (e) {
    toast('删除失败', 'danger');
  }
}

async function deleteSelected() {
  if (!State.checked.size) { toast('请先选中单词', 'warning'); return; }
  const toDelete = [...State.checked];
  for (const w of toDelete) {
    await apiFetch(`/api/words/${encodeURIComponent(w)}`, { method: 'DELETE' });
    State.checked.delete(w);
  }
  State.words = await apiFetch('/api/words');
  renderLibrary();
  toast('已删除选中单词', 'success');
}

async function clearAll() {
  if (!confirm('确定清空全部单词吗？')) return;
  await apiFetch('/api/words/clear', { method: 'POST' });
  State.checked.clear();
  State.words = [];
  renderLibrary();
  toast('已清空单词库');
}

function selectAll() {
  State.words.forEach(w => State.checked.add(w));
  renderLibrary();
}

function deselectAll() {
  State.checked.clear();
  renderLibrary();
}

// ═══════════════════════════════════════════════
//  PDF Upload
// ═══════════════════════════════════════════════
// ═══════════════════════════════════════════════
//  PDF Upload  (完全重写)
// ═══════════════════════════════════════════════
function initPdfDrop() {
  const zone = document.getElementById('pdfDropZone');
  const inp  = document.getElementById('pdfInput');

  // 防止浏览器打开文件导致黑屏
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop',     e => e.preventDefault());

  document.getElementById('pdfPickBtn').addEventListener('click', () => inp.click());
  inp.addEventListener('change', () => {
    if (inp.files[0]) { _startPdfImport(inp.files[0]); inp.value = ''; }
  });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('dragover');
    if (e.dataTransfer.files[0]) _startPdfImport(e.dataTransfer.files[0]);
  });
}

async function _startPdfImport(file) {
  // 显示进度区域
  const panel = document.getElementById('pdfResultPanel');
  const status = document.getElementById('pdfStatusMsg');
  panel.style.display = 'block';
  status.innerHTML = '<span class="text-muted"><i class="bi bi-hourglass-split"></i> 上传中…</span>';
  document.getElementById('pdfWordCheckboxes').innerHTML = '';
  document.getElementById('pdfImportActions').style.display = 'none';

  const fd = new FormData();
  fd.append('file', file);

  let jobId = null;
  try {
    const resp = await fetch('/api/upload-pdf', { method: 'POST', body: fd });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      status.innerHTML = `<span class="text-danger"><i class="bi bi-x-circle"></i> ${esc(err.error || '上传失败')}</span>`;
      return;
    }
    const data = await resp.json();
    if (data.error) {
      status.innerHTML = `<span class="text-danger"><i class="bi bi-x-circle"></i> ${esc(data.error)}</span>`;
      return;
    }
    // docx returns words directly; pdf returns job_id
    if (data.words) {
      _renderPdfWords(data.words, status);
      return;
    }
    jobId = data.job_id;
  } catch (e) {
    status.innerHTML = `<span class="text-danger"><i class="bi bi-x-circle"></i> 上传失败: ${esc(e.message)}</span>`;
    return;
  }

  // Poll for job completion
  status.innerHTML = '<span class="text-muted"><i class="bi bi-cpu"></i> AI 正在识别单词（0/?）…</span>';
  let failed = 0;
  while (true) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const r = await fetch(`/api/pdf-job/${jobId}`);
      if (!r.ok) { failed++; if (failed >= 5) { status.innerHTML = '<span class="text-danger"><i class="bi bi-x-circle"></i> 查询任务状态失败</span>'; return; } continue; }
      failed = 0;
      const job = await r.json();
      if (job.status === 'processing') {
        const prog = job.total > 0 ? `${job.progress}/${job.total}` : '…';
        status.innerHTML = `<span class="text-muted"><i class="bi bi-cpu"></i> AI 正在识别单词（${prog} 块）…</span>`;
      } else if (job.status === 'done') {
        _renderPdfWords(job.words || [], status);
        return;
      } else if (job.status === 'error') {
        status.innerHTML = `<span class="text-danger"><i class="bi bi-x-circle"></i> ${esc(job.error || '处理失败')}</span>`;
        return;
      }
    } catch { failed++; if (failed >= 5) { status.innerHTML = '<span class="text-danger"><i class="bi bi-x-circle"></i> 网络错误</span>'; return; } }
  }
}

function _renderPdfWords(words, status) {
  if (words.length === 0) {
    status.innerHTML = '<span class="text-warning"><i class="bi bi-exclamation-triangle"></i> 未提取到英文单词，请换一个PDF试试</span>';
    return;
  }
  status.innerHTML = `<span class="text-success"><i class="bi bi-check-circle"></i> 提取到 <strong>${words.length}</strong> 个单词，勾选后点击"添加到单词库"</span>`;
  const box = document.getElementById('pdfWordCheckboxes');
  box.innerHTML = words.map(w =>
    `<label class="pdf-check-item"><input type="checkbox" checked value="${esc(w)}"> ${esc(w)}</label>`
  ).join('');
  document.getElementById('pdfImportActions').style.display = 'flex';
}

function _closePdfPanel() {
  document.getElementById('pdfResultPanel').style.display = 'none';
}

async function _addCheckedPdfWords() {
  const checked = [...document.querySelectorAll('#pdfWordCheckboxes input:checked')].map(i => i.value);
  if (!checked.length) { toast('请至少勾选一个单词', 'warning'); return; }
  try {
    const r = await apiFetch('/api/words', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ words: checked }),
    });
    toast(`已添加 ${r.added.length} 个单词`, 'success');
    _closePdfPanel();
    State.words = await apiFetch('/api/words');
    renderLibrary();
  } catch (e) {
    toast('添加失败: ' + e.message, 'danger');
  }
}



// ═══════════════════════════════════════════════
//  Audio Player
// ═══════════════════════════════════════════════
const Audio$ = {
  el: null,
  _onEnded: null,

  init() {
    this.el = document.getElementById('mainAudio');
  },

  load(word, voice) {
    this.el.src = `/api/tts?word=${encodeURIComponent(word)}&voice=${encodeURIComponent(voice)}`;
    this.el.playbackRate = State.listen.speed;
  },

  play(word, voice, onEnded) {
    this._clearEnded();
    this.el.src = `/api/tts?word=${encodeURIComponent(word)}&voice=${encodeURIComponent(voice)}`;
    this.el.playbackRate = State.listen.speed;
    this._onEnded = onEnded;
    if (onEnded) this.el.addEventListener('ended', this._onEnded, { once: true });
    return this.el.play().catch(err => console.warn('Audio play error:', err));
  },

  pause() { this.el.pause(); },
  resume() { this.el.play(); },
  stop() {
    this._clearEnded();
    this.el.pause();
    this.el.src = '';
  },

  _clearEnded() {
    if (this._onEnded) {
      this.el.removeEventListener('ended', this._onEnded);
      this._onEnded = null;
    }
  },

  setSpeed(s) {
    State.listen.speed = s;
    this.el.playbackRate = s;
  },
};

// ═══════════════════════════════════════════════
//  Listen Mode
// ═══════════════════════════════════════════════
function refreshListenList() {
  const L = State.listen;
  L.words = State.words.slice();
  renderListenSidebar();
  updateListenUI();
}

function renderListenSidebar() {
  const L = State.listen;
  const el = document.getElementById('listenWordList');
  el.innerHTML = L.words.map((w, i) => {
    const cur = i === L.idx ? 'current' : '';
    const played = (!L.playing && i < L.idx) ? 'played' : '';
    return `<div class="listen-word-item ${cur} ${played}" data-idx="${i}">${esc(w)}</div>`;
  }).join('');
  el.querySelectorAll('.listen-word-item').forEach(item => {
    item.addEventListener('click', () => {
      L.idx = parseInt(item.dataset.idx);
      if (L.playing) playCurrentWord();
      else updateListenUI();
    });
  });
  // scroll current into view
  const cur = el.querySelector('.current');
  if (cur) cur.scrollIntoView({ block: 'nearest' });
}

function updateListenUI() {
  const L = State.listen;
  const word = L.words[L.idx] || '—';
  const wordEl = document.getElementById('listenWord');
  wordEl.textContent = word === '—' ? '—' : word;
  wordEl.classList.toggle('masked', !!L.hideWord);
  document.getElementById('listenWordNum').textContent =
    L.words.length ? `${L.idx + 1} / ${L.words.length}` : '0 / 0';
  // play/pause icon
  const btn = document.getElementById('playPauseBtn');
  if (L.playing && !L.paused) {
    btn.innerHTML = '<i class="bi bi-pause-fill"></i>';
    btn.classList.add('playing');
  } else {
    btn.innerHTML = '<i class="bi bi-play-fill"></i>';
    btn.classList.remove('playing');
  }
  renderListenSidebar();
  if (L.autoInfo && word !== '—') fetchWordInfo(word);
}

async function playCurrentWord() {
  const L = State.listen;
  if (!L.words.length) { toast('单词库为空', 'warning'); return; }
  L.playing = true; L.paused = false;
  clearTimeout(L.timer);
  updateListenUI();

  const word = L.words[L.idx];
  const wordEl2 = document.getElementById('listenWord');
  wordEl2.textContent = word;
  wordEl2.classList.toggle('masked', !!L.hideWord);

  await Audio$.play(word, L.voice, () => {
    if (!L.playing || L.paused) return;
    if (L.loop === 'one') {
      L.timer = setTimeout(playCurrentWord, L.interval * 1000);
    } else {
      L.timer = setTimeout(advanceWord, L.interval * 1000);
    }
  });
}

function advanceWord() {
  const L = State.listen;
  if (!L.playing) return;
  if (L.idx < L.words.length - 1) {
    L.idx++;
    playCurrentWord();
  } else if (L.loop === 'all') {
    L.idx = 0;
    playCurrentWord();
  } else {
    stopPlayback();
    toast('播放完毕 🎉', 'success');
  }
}

function stopPlayback() {
  const L = State.listen;
  L.playing = false; L.paused = false;
  Audio$.stop();
  clearTimeout(L.timer);
  updateListenUI();
}

function togglePlayPause() {
  const L = State.listen;
  if (!L.words.length) { toast('单词库为空', 'warning'); return; }
  if (!L.playing) {
    playCurrentWord();
  } else if (L.paused) {
    L.paused = false;
    Audio$.resume();
    // resume interval if audio already ended
    updateListenUI();
  } else {
    L.paused = true;
    Audio$.pause();
    clearTimeout(L.timer);
    updateListenUI();
  }
}

// Word info
async function fetchWordInfo(word) {
  const panel = document.getElementById('wordInfoPanel');
  const content = document.getElementById('wordInfoContent');
  panel.style.display = 'block';
  content.innerHTML = '<span class="text-muted small"><i class="bi bi-hourglass-split"></i> 获取中…</span>';
  try {
    const r = await apiFetch('/api/word-info', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word }),
    });
    if (!r.configured) {
      content.innerHTML = `<span class="text-muted small"><i class="bi bi-info-circle"></i> ${esc(r.message)}</span>`;
    } else {
      content.innerHTML = renderWordInfoHTML(r);
    }
  } catch {
    content.innerHTML = '<span class="text-muted small">获取失败</span>';
  }
}

function renderWordInfoHTML(data) {
  let html = '';
  // Source badge
  if (data.source === 'local') {
    html += '<div class="mb-1"><span class="badge bg-success" style="font-size:.7rem">📚 本地词典</span></div>';
  } else if (data.source === 'ai') {
    html += '<div class="mb-1"><span class="badge bg-primary" style="font-size:.7rem">🤖 AI在线查词</span></div>';
  }
  if (data.phonetic) html += `<div class="info-section"><span class="info-label">发音</span> ${esc(data.phonetic)}</div>`;
  if (data.definitions?.length) {
    html += '<div class="info-section"><div class="info-label">释义</div>';
    data.definitions.forEach(d => {
      html += `<div><span class="info-tag">${esc(d.pos || '')}</span> ${esc(d.def || '')}</div>`;
      if (d.example) html += `<div class="text-muted small" style="margin-left:12px">e.g. ${esc(d.example)}</div>`;
    });
    html += '</div>';
  }
  if (data.synonyms?.length) {
    html += `<div class="info-section"><div class="info-label">近义词</div>${data.synonyms.map(s => `<span class="info-tag">${esc(s)}</span>`).join('')}</div>`;
  }
  if (data.phrases?.length) {
    // phrases can be {phrase, meaning} objects (ECDICT) or plain strings (AI)
    html += '<div class="info-section"><div class="info-label">词形变化 / 短语</div>';
    data.phrases.forEach(p => {
      if (typeof p === 'string') {
        html += `<span class="info-tag">${esc(p)}</span>`;
      } else {
        html += `<div class="text-muted small">${esc(p.phrase || '')}</div>`;
      }
    });
    html += '</div>';
  }
  if (data.etymology) html += `<div class="info-section"><div class="info-label">词源</div><span class="text-muted small">${esc(data.etymology)}</span></div>`;
  return html || '<span class="text-muted small">暂无详情</span>';
}

function initListenControls() {
  const L = State.listen;

  document.getElementById('playPauseBtn').addEventListener('click', togglePlayPause);
  document.getElementById('stopBtn').addEventListener('click', stopPlayback);
  document.getElementById('replayBtn').addEventListener('click', () => {
    if (L.words.length) { clearTimeout(L.timer); playCurrentWord(); }
  });
  document.getElementById('prevBtn').addEventListener('click', () => {
    if (L.idx > 0) { L.idx--; clearTimeout(L.timer); playCurrentWord(); }
  });
  document.getElementById('nextBtn').addEventListener('click', () => {
    if (L.idx < L.words.length - 1) { L.idx++; clearTimeout(L.timer); playCurrentWord(); }
    else if (L.loop === 'all') { L.idx = 0; clearTimeout(L.timer); playCurrentWord(); }
  });

  // Speed
  const speedSlider = document.getElementById('speedSlider');
  const speedVal = document.getElementById('speedVal');
  speedSlider.addEventListener('input', () => {
    const s = parseFloat(speedSlider.value);
    speedVal.textContent = s.toFixed(1) + 'x';
    Audio$.setSpeed(s);
  });

  // Interval
  const intSlider = document.getElementById('intervalSlider');
  const intVal = document.getElementById('intervalVal');
  intSlider.addEventListener('input', () => {
    L.interval = parseInt(intSlider.value);
    intVal.textContent = L.interval + ' 秒';
  });

  // Loop
  document.querySelectorAll('.loop-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.loop-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      L.loop = btn.dataset.loop;
    });
  });

  // Voice
  const voiceSel = document.getElementById('listenVoice');
  L.voice = voiceSel.value;
  voiceSel.addEventListener('change', () => { L.voice = voiceSel.value; });

  // Auto info
  document.getElementById('autoShowInfo').addEventListener('change', e => {
    L.autoInfo = e.target.checked;
  });

  // Hide word toggle
  document.getElementById('hideWordToggle').addEventListener('change', e => {
    L.hideWord = e.target.checked;
    const el = document.getElementById('listenWord');
    el.classList.toggle('masked', e.target.checked);
  });

  // Sidebar toggle
  const sidebar = document.getElementById('listenSidebar');
  const toggleBtn = document.getElementById('toggleSidebarBtn');
  const closeBtn  = document.getElementById('sidebarCloseBtn');
  function setSidebar(show) {
    sidebar.classList.toggle('hidden', !show);
    L.sidebarVisible = show;
    toggleBtn.innerHTML = show
      ? '<i class="bi bi-layout-sidebar-reverse"></i> 隐藏播放列表'
      : '<i class="bi bi-layout-sidebar-reverse"></i> 显示播放列表';
  }
  toggleBtn.addEventListener('click', () => setSidebar(!L.sidebarVisible));
  closeBtn.addEventListener('click',  () => setSidebar(false));
  L.sidebarVisible = true;

  // Toggle info button
  document.getElementById('toggleInfoBtn').addEventListener('click', () => {
    const panel = document.getElementById('wordInfoPanel');
    const show = panel.style.display === 'none';
    panel.style.display = show ? 'block' : 'none';
    if (show && L.words[L.idx]) fetchWordInfo(L.words[L.idx]);
  });
}

// ═══════════════════════════════════════════════
//  Dictation Mode
// ═══════════════════════════════════════════════
function initDictationControls() {
  const D = State.dict;

  // Setup controls
  document.querySelectorAll('.range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      D.range = btn.dataset.range;
      // If "selected" is chosen, immediately open the word picker modal
      if (D.range === 'selected') openDictWordModal();
    });
  });

  document.querySelectorAll('.method-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.method-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      D.method = btn.dataset.method;
    });
  });

  const dictVoice = document.getElementById('dictVoice');
  D.voice = dictVoice.value;
  dictVoice.addEventListener('change', () => { D.voice = dictVoice.value; });

  const dIntSlider = document.getElementById('dictIntervalSlider');
  const dIntVal = document.getElementById('dictIntervalVal');
  dIntSlider.addEventListener('input', () => {
    D.interval = parseInt(dIntSlider.value);
    dIntVal.textContent = D.interval + ' 秒';
  });

  document.getElementById('startDictBtn').addEventListener('click', startDictation);

  // Active controls
  document.getElementById('dictPlayBtn').addEventListener('click', () => playDictWord());
  document.getElementById('dictReplayBtn').addEventListener('click', () => playDictWord());
  document.getElementById('dictExitBtn').addEventListener('click', async () => {
    if (confirm('确定退出本次听写？已错误的单词会记录到错题本。')) {
      Audio$.stop();
      // Save wrong answers so far (including current unanswered word)
      const wrongSoFar = D.results.filter(r => !r.correct).map(r => r.word);
      if (wrongSoFar.length) await MistakeBook.addWords(wrongSoFar);
      showDictPhase('setup');
    }
  });
  document.getElementById('nextWordBtn').addEventListener('click', advanceDictWord);

  // Keyboard submit
  document.getElementById('submitKeyboard').addEventListener('click', submitKeyboard);
  document.getElementById('dictKeyboard').addEventListener('keydown', e => {
    if (e.key === 'Enter') submitKeyboard();
  });

  // Result buttons
  document.getElementById('retryBtn').addEventListener('click', retryDictation);
  document.getElementById('backSetupBtn').addEventListener('click', () => showDictPhase('setup'));
}

function startDictation() {
  const D = State.dict;
  if (D.range === 'selected') {
    // Opening the modal handles the actual start
    openDictWordModal();
    return;
  }
  // 'all' — keep original library order, no shuffle
  const words = State.words.slice();
  if (!words.length) { toast('单词库为空，请先添加单词', 'warning'); return; }
  _launchDictation(words);
}

function _launchDictation(words) {
  const D = State.dict;
  D.words = words;
  D.idx = 0;
  D.results = [];
  D.hasPlayed = false;
  showDictPhase('active');
  updateDictUI();
  showInputPanel(D.method);
  setTimeout(() => playDictWord(), 600);
}

// ── Dict word picker modal ──
let _dwSort = 'original';
let _dwSelected = new Set();

function openDictWordModal() {
  const all = State.words;
  if (!all.length) { toast('单词库为空，请先添加单词', 'warning'); return; }

  _dwSort = 'original';
  _dwSelected = new Set();

  document.querySelectorAll('#dwSortGroup button').forEach(b => {
    b.classList.toggle('active', b.dataset.sort === 'original');
  });
  document.getElementById('dwSearch').value = '';
  document.getElementById('dwSelCount').textContent = '0';

  function dwSorted() {
    const arr = all.slice();
    if (_dwSort === 'alpha')  arr.sort((a, b) => a.localeCompare(b));
    if (_dwSort === 'random') { for (let i = arr.length-1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; } }
    return arr;
  }

  function renderDwGrid(filter = '') {
    const grid = document.getElementById('dwWordGrid');
    const f = filter.toLowerCase();
    const filtered = dwSorted().filter(w => !f || w.toLowerCase().includes(f));
    grid.innerHTML = filtered.map(w =>
      `<span class="pdf-word-tag ${_dwSelected.has(w) ? 'sel' : ''}" data-word="${esc(w)}">${esc(w)}</span>`
    ).join('');
    document.getElementById('dwSelCount').textContent = _dwSelected.size;
    grid.querySelectorAll('.pdf-word-tag').forEach(tag => {
      tag.onclick = () => {
        const w = tag.dataset.word;
        if (_dwSelected.has(w)) { _dwSelected.delete(w); tag.classList.remove('sel'); }
        else { _dwSelected.add(w); tag.classList.add('sel'); }
        document.getElementById('dwSelCount').textContent = _dwSelected.size;
      };
    });
  }

  renderDwGrid();

  document.getElementById('dwSelAll').onclick = () => { all.forEach(w => _dwSelected.add(w)); renderDwGrid(document.getElementById('dwSearch').value); };
  document.getElementById('dwDesAll').onclick = () => { _dwSelected.clear(); renderDwGrid(document.getElementById('dwSearch').value); };
  document.getElementById('dwSearch').oninput = e => renderDwGrid(e.target.value);

  document.querySelectorAll('#dwSortGroup button').forEach(btn => {
    btn.onclick = () => {
      _dwSort = btn.dataset.sort;
      document.querySelectorAll('#dwSortGroup button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderDwGrid(document.getElementById('dwSearch').value);
    };
  });

  document.getElementById('dwConfirmBtn').onclick = () => {
    if (!_dwSelected.size) { toast('请至少选择一个单词', 'warning'); return; }
    // Apply sort order to the selected words
    const ordered = dwSorted().filter(w => _dwSelected.has(w));
    bootstrap.Modal.getInstance(document.getElementById('dictWordModal')).hide();
    _launchDictation(ordered);
  };

  bootstrap.Modal.getOrCreateInstance(document.getElementById('dictWordModal')).show();
}

function retryDictation() {
  const D = State.dict;
  D.words = shuffle(D.words.slice());
  D.idx = 0;
  D.results = [];
  D.hasPlayed = false;
  showDictPhase('active');
  updateDictUI();
  showInputPanel(D.method);
  setTimeout(() => playDictWord(), 600);
}

function showDictPhase(phase) {
  document.getElementById('dictSetup').style.display  = phase === 'setup'  ? '' : 'none';
  document.getElementById('dictActive').style.display = phase === 'active' ? '' : 'none';
  document.getElementById('dictResult').style.display = phase === 'result' ? '' : 'none';
  State.dict.phase = phase;
}

function updateDictUI() {
  const D = State.dict;
  const correct = D.results.filter(r => r.correct).length;
  const wrong   = D.results.filter(r => !r.correct).length;
  const pct = D.words.length ? Math.round((D.idx / D.words.length) * 100) : 0;

  document.getElementById('dictFill').style.width = pct + '%';
  document.getElementById('dictProgressTxt').textContent = `${D.idx} / ${D.words.length}`;
  document.getElementById('scoreCorrect').textContent = correct;
  document.getElementById('scoreWrong').textContent = wrong;
  document.getElementById('dictFeedback').style.display = 'none';
  document.getElementById('dictFeedback').className = 'dict-feedback';

  // Reset input
  document.getElementById('dictKeyboard').value = '';
}

async function playDictWord() {
  const D = State.dict;
  if (D.idx >= D.words.length) return;
  const word = D.words[D.idx];
  D.hasPlayed = true;

  const btn = document.getElementById('dictPlayBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="bi bi-hourglass-split"></i> 加载中…';

  try {
    await Audio$.play(word, D.voice, null);
  } catch (e) {
    toast('音频加载失败', 'danger');
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="bi bi-volume-up-fill"></i> 播放单词';
  document.getElementById('dictKeyboard').focus();
}

function showInputPanel(method) {
  document.getElementById('panelKeyboard').style.display = method === 'keyboard' ? '' : 'none';
  if (method === 'keyboard') document.getElementById('dictKeyboard').focus();
}

async function submitKeyboard() {
  const D = State.dict;
  if (D.idx >= D.words.length) return;
  const answer = document.getElementById('dictKeyboard').value.trim();
  if (!answer) { toast('请输入单词', 'warning'); return; }

  try {
    const r = await apiFetch('/api/check-answer', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word: D.words[D.idx], answer }),
    });
    recordResult(D.words[D.idx], answer, r.correct);
  } catch (e) {
    toast('提交失败', 'danger');
  }
}

function recordResult(word, answer, correct) {
  State.dict.results.push({ word, answer, correct });
  showFeedback(word, answer, correct);
  document.getElementById('scoreCorrect').textContent = State.dict.results.filter(r => r.correct).length;
  document.getElementById('scoreWrong').textContent   = State.dict.results.filter(r => !r.correct).length;
}

function showFeedback(word, answer, correct) {
  const fb = document.getElementById('dictFeedback');
  const inner = document.getElementById('feedbackInner');
  fb.style.display = 'block';
  fb.className = `dict-feedback ${correct ? 'correct-fb' : 'wrong-fb'}`;

  if (correct) {
    inner.innerHTML = `
      <div class="fb-icon">✅</div>
      <div class="fb-word-correct">${esc(word)}</div>
      <div class="text-muted small mt-1">回答正确！</div>`;
  } else {
    inner.innerHTML = `
      <div class="fb-icon">❌</div>
      <div class="fb-word-wrong">你的答案：${esc(answer) || '（空）'}</div>
      <div class="mt-1">正确答案：<span class="fb-correct-word">${esc(word)}</span></div>`;
  }
}

function advanceDictWord() {
  const D = State.dict;
  D.idx++;
  if (D.idx >= D.words.length) {
    showDictResult();
    return;
  }
  D.hasPlayed = false;
  updateDictUI();
  // auto-play next word
  setTimeout(() => playDictWord(), 400);
}

function showDictResult() {
  const D = State.dict;
  const correct = D.results.filter(r => r.correct).length;
  const total = D.results.length;
  const pct = total ? Math.round((correct / total) * 100) : 0;

  document.getElementById('finalPct').textContent = pct + '%';
  document.getElementById('finalDetail').textContent = `${correct} / ${total} 正确`;
  document.getElementById('resultIcon').textContent = pct === 100 ? '🏆' : pct >= 60 ? '🎉' : '📝';
  document.getElementById('resultTitle').textContent =
    pct === 100 ? '全部正确！太棒了！' : pct >= 60 ? '听写完成！' : '继续加油！';

  const list = document.getElementById('resultWordList');
  list.innerHTML = D.results.map(r =>
    `<span class="result-word-tag ${r.correct ? 'ok' : 'fail'}">${esc(r.word)}</span>`
  ).join('');

  showDictPhase('result');
}

// ═══════════════════════════════════════════════
//  Handwriting Canvas
// ═══════════════════════════════════════════════
const hwCanvas = (() => {
  let canvas, ctx, drawing = false, lx, ly;

  function init() {
    canvas = document.getElementById('hwCanvas');
    ctx = canvas.getContext('2d');
    style();

    // Mouse
    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    canvas.addEventListener('mouseup', end);
    canvas.addEventListener('mouseleave', end);
    // Touch
    canvas.addEventListener('touchstart', e => { e.preventDefault(); start(touch2mouse(e)); }, { passive: false });
    canvas.addEventListener('touchmove',  e => { e.preventDefault(); move(touch2mouse(e));  }, { passive: false });
    canvas.addEventListener('touchend',   end);
  }

  function style() {
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  function touch2mouse(e) {
    const rect = canvas.getBoundingClientRect();
    const t = e.touches[0];
    return { offsetX: t.clientX - rect.left, offsetY: t.clientY - rect.top };
  }

  function start(e) { drawing = true; lx = e.offsetX; ly = e.offsetY; }
  function end() { drawing = false; }
  function move(e) {
    if (!drawing) return;
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(e.offsetX, e.offsetY);
    ctx.stroke();
    lx = e.offsetX; ly = e.offsetY;
  }

  return {
    init,
    clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); },
    getImage() { return canvas.toDataURL('image/png'); },
  };
})();

// ═══════════════════════════════════════════════
//  Tab navigation
// ═══════════════════════════════════════════════
function initTabs() {
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${tab}`).classList.add('active');
      if (tab === 'listen')   refreshListenList();
      if (tab === 'mistakes') MistakeBook.load();
    });
  });
}

// ═══════════════════════════════════════════════
//  Theme toggle
// ═══════════════════════════════════════════════
function initTheme() {
  const saved = localStorage.getItem('theme') || 'light';
  setTheme(saved);
  document.getElementById('themeToggle').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme;
    setTheme(cur === 'dark' ? 'light' : 'dark');
  });
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('theme', theme);
  const icon = document.querySelector('#themeToggle i');
  icon.className = theme === 'dark' ? 'bi bi-sun-fill' : 'bi bi-moon-stars-fill';
  // Fix canvas stroke for dark
  if (hwCanvas) {
    const canvas = document.getElementById('hwCanvas');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.strokeStyle = theme === 'dark' ? '#eee' : '#222';
    }
  }
}

// ═══════════════════════════════════════════════
//  Utilities
// ═══════════════════════════════════════════════
function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ═══════════════════════════════════════════════
//  Mistake Book
// ═══════════════════════════════════════════════
const MistakeBook = {
  data: [],

  async load() {
    try {
      this.data = await apiFetch('/api/mistakes');
    } catch {
      this.data = [];
    }
    this.render();
  },

  render(sortBy) {
    const list  = document.getElementById('mistakeList');
    const empty = document.getElementById('mistakeEmptyHint');
    document.getElementById('mistakeCount').textContent = this.data.length;

    if (!this.data.length) {
      list.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';

    let items = this.data.slice();
    if (sortBy === 'alpha') items.sort((a, b) => a.word.localeCompare(b.word));
    if (sortBy === 'count') items.sort((a, b) => (b.count || 1) - (a.count || 1));

    list.innerHTML = items.map(m =>
      `<div class="word-item">
        <span class="word-text">${esc(m.word)}</span>
        <span class="mistake-count">错 ${m.count || 1} 次</span>
        <button class="del-word" data-word="${esc(m.word)}" title="从错题本移除">
          <i class="bi bi-x"></i>
        </button>
      </div>`
    ).join('');

    list.querySelectorAll('.del-word').forEach(btn => {
      btn.addEventListener('click', async () => {
        await apiFetch(`/api/mistakes/${encodeURIComponent(btn.dataset.word)}`, { method: 'DELETE' });
        await this.load();
      });
    });
  },

  async addWords(words) {
    if (!words.length) return;
    try {
      await apiFetch('/api/mistakes/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words }),
      });
    } catch (e) {
      console.warn('错题本记录失败', e);
    }
  },

  getWords() { return this.data.map(m => m.word); },
};

function initMistakeBook() {
  document.getElementById('clearMistakesBtn').addEventListener('click', async () => {
    if (!MistakeBook.data.length) { toast('错题本已经是空的', 'warning'); return; }
    if (!confirm('确定清空全部错题记录？')) return;
    await apiFetch('/api/mistakes/clear', { method: 'POST' });
    MistakeBook.data = [];
    MistakeBook.render();
    toast('已清空错题本', 'success');
  });

  document.getElementById('mistakeSortAlpha').addEventListener('click', () => MistakeBook.render('alpha'));
  document.getElementById('mistakeSortCount').addEventListener('click', () => MistakeBook.render('count'));

  document.getElementById('exportMistakePdfBtn').addEventListener('click', () => {
    if (!MistakeBook.data.length) { toast('错题本为空，无法导出', 'warning'); return; }
    window.location.href = '/api/mistakes/export-pdf';
  });

  document.getElementById('mistakeDictBtn').addEventListener('click', () => {
    const words = MistakeBook.getWords();
    if (!words.length) { toast('错题本为空', 'warning'); return; }
    State.dict.words = shuffle(words.slice());
    State.dict.idx = 0;
    State.dict.results = [];
    State.dict.hasPlayed = false;
    State.dict.method = State.dict.method || 'keyboard';
    document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    document.querySelector('[data-tab="dictation"]').classList.add('active');
    document.getElementById('tab-dictation').classList.add('active');
    showDictPhase('active');
    updateDictUI();
    showInputPanel(State.dict.method);
    setTimeout(() => playDictWord(), 600);
  });

  document.getElementById('mistakeListenBtn').addEventListener('click', () => {
    const words = MistakeBook.getWords();
    if (!words.length) { toast('错题本为空', 'warning'); return; }
    State.listen.words = words.slice();
    State.listen.idx = 0;
    document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    document.querySelector('[data-tab="listen"]').classList.add('active');
    document.getElementById('tab-listen').classList.add('active');
    refreshListenList();
    setTimeout(() => playCurrentWord(), 400);
  });

  document.getElementById('addToMistakesBtn').addEventListener('click', async () => {
    const wrong = State.dict.results.filter(r => !r.correct).map(r => r.word);
    if (!wrong.length) { toast('没有错误单词，无需记录', 'success'); return; }
    await MistakeBook.addWords(wrong);
    await MistakeBook.load();
    toast(`已将 ${wrong.length} 个错误单词加入错题本`, 'success');
  });
}
// ═══════════════════════════════════════════════
//  Boot
// ═══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  try { Audio$.init(); }            catch(e) { console.error('Audio init:', e); }
  try { initTheme(); }              catch(e) { console.error('Theme init:', e); }
  try { initTabs(); }               catch(e) { console.error('Tabs init:', e); }
  try { initPdfDrop(); }            catch(e) { console.error('PdfDrop init:', e); }
  try { initListenControls(); }     catch(e) { console.error('Listen init:', e); }
  try { initDictationControls(); }  catch(e) { console.error('Dict init:', e); }
  try { initMistakeBook(); }        catch(e) { console.error('MistakeBook init:', e); }

  // Library toolbar
  document.getElementById('addWordsBtn').addEventListener('click', addWordsFromTextarea);
  document.getElementById('selectAllBtn').addEventListener('click', selectAll);
  document.getElementById('deselectAllBtn').addEventListener('click', deselectAll);
  document.getElementById('deleteSelectedBtn').addEventListener('click', deleteSelected);
  document.getElementById('clearAllBtn').addEventListener('click', clearAll);

  // Set initial voice
  State.listen.voice = document.getElementById('listenVoice').value;
  State.dict.voice   = document.getElementById('dictVoice').value;

  loadLibrary();
  checkDictStatus();
  // Dict settings modal: init button
  document.getElementById('dictInitBtn').addEventListener('click', async () => {
    const progressEl = document.getElementById('dictInitProgress');
    const btn = document.getElementById('dictInitBtn');
    btn.disabled = true;
    progressEl.style.display = '';
    try {
      const r = await apiFetch('/api/dict/init', { method: 'POST' });
      if (r.ok) {
        toast(`词典初始化完成！共 ${r.count.toLocaleString()} 条词`,'success');
        checkDictStatus();
      } else {
        toast(r.error || '初始化失败', 'danger');
      }
    } catch {
      toast('初始化失败', 'danger');
    }
    progressEl.style.display = 'none';
    btn.disabled = false;
  });
});

async function checkDictStatus() {
  const badge = document.getElementById('dictBadge');
  const statusEl = document.getElementById('dictStatusMsg');
  const csvEl    = document.getElementById('dictCsvStatus');
  const initBtn  = document.getElementById('dictInitBtn');
  if (!badge) return;
  try {
    const r = await apiFetch('/api/dict/status');
    if (r.loaded) {
      badge.textContent = `📚 ${r.count.toLocaleString()} 词`;
      badge.className = 'api-badge ok';
      if (statusEl) statusEl.innerHTML = `<i class="bi bi-check-circle-fill text-success"></i> 词典已加载，共 <strong>${r.count.toLocaleString()}</strong> 条词条目`;
      if (initBtn) initBtn.textContent = '重新构建词典数据库';
    } else {
      badge.textContent = '📚 未加载';
      badge.className = 'api-badge warn';
      if (statusEl) statusEl.innerHTML = '<i class="bi bi-x-circle text-danger"></i> 未加载本地词典';
    }
    if (csvEl)   csvEl.innerHTML   = r.has_csv
      ? '<i class="bi bi-file-earmark-check text-success"></i> 检测到 <code>data/ecdict.csv</code>，可以初始化'
      : '<i class="bi bi-file-earmark-x text-danger"></i> 未检测到 <code>data/ecdict.csv</code>';
    if (initBtn) initBtn.disabled = !r.has_csv;
  } catch { /* ignore */ }
}
