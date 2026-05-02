import sys
import os
import json
import re
import asyncio
import hashlib
import base64
import sqlite3
import csv
import io
from pathlib import Path
from flask import Flask, render_template, request, jsonify, send_file, session, redirect, url_for

import edge_tts
import fitz  # PyMuPDF
import docx as _docx  # python-docx
from openai import OpenAI as _OpenAI

# Windows asyncio fix
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

# ── Config ──────────────────────────────────────────────
# 密码支持环境变量 APP_PASSWORD，未设置则使用默认密码
_APP_PASSWORD = os.environ.get('APP_PASSWORD', '20040311')
_APP_PASSWORD_HASH = hashlib.sha256(_APP_PASSWORD.encode()).hexdigest()

# DeepSeek API — 使用环境变量 DEEPSEEK_API_KEY，未设置则回落到内置密鑰
_DEEPSEEK_API_KEY = os.environ.get('DEEPSEEK_API_KEY', 'sk-d5a28e7c8333417c9e3990a379c41d39')
_deepseek = _OpenAI(api_key=_DEEPSEEK_API_KEY, base_url='https://api.deepseek.com/v1')

app = Flask(__name__)
# Secret key 支持环境变量 SECRET_KEY，未设置则由密码哈希派生
app.secret_key = os.environ.get(
    'SECRET_KEY',
    hashlib.sha256((_APP_PASSWORD_HASH + 'session_key').encode()).hexdigest()
)
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
AUDIO_DIR = BASE_DIR / "static" / "audio"
UPLOAD_DIR = BASE_DIR / "uploads"

for d in [DATA_DIR, AUDIO_DIR, UPLOAD_DIR]:
    d.mkdir(exist_ok=True)

WORDS_FILE    = DATA_DIR / "words.json"
MISTAKES_FILE = DATA_DIR / "mistakes.json"
DICT_DB       = DATA_DIR / "ecdict.db"
ECDICT_CSV    = DATA_DIR / "ecdict.csv"

TTS_VOICES = {
    "en-US-AriaNeural": "Aria (美式英语·女)",
    "en-US-GuyNeural": "Guy (美式英语·男)",
    "en-GB-SoniaNeural": "Sonia (英式英语·女)",
    "en-GB-RyanNeural": "Ryan (英式英语·男)",
    "en-AU-NatashaNeural": "Natasha (澳式英语·女)",
    "en-AU-WilliamNeural": "William (澳式英语·男)",
}
DEFAULT_VOICE = "en-US-AriaNeural"

STOP_WORDS = {
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
    'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
    'would', 'could', 'should', 'may', 'might', 'shall', 'can', 'it', 'its',
    'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'we', 'they',
    'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'our', 'their',
    'who', 'which', 'what', 'when', 'where', 'why', 'how', 'all', 'each',
    'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
    'not', 'only', 'same', 'so', 'than', 'too', 'very', 'just', 'because',
    'if', 'while', 'although', 'though', 'even', 'after', 'before', 'since',
    'until', 'into', 'through', 'during', 'about', 'against', 'between',
    'then', 'also', 'there', 'here', 'now', 'up', 'out', 'off', 'over',
    'under', 'again', 'further', 'once', 'any', 'own', 'said', 'one', 'two',
    'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'per', 'etc', 'via', 'fig', 'ref', 'vs', 'ie', 'eg',
}


def load_words():
    if WORDS_FILE.exists():
        try:
            with open(WORDS_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if isinstance(data, list):
                return data
        except (json.JSONDecodeError, IOError):
            pass
    return []


def save_words(words):
    with open(WORDS_FILE, 'w', encoding='utf-8') as f:
        json.dump(words, f, ensure_ascii=False, indent=2)


async def _generate_tts(text, voice, output_path):
    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(str(output_path))


# ── Auth helpers ────────────────────────────────────────────

def _check_password(pw: str) -> bool:
    return hashlib.sha256(pw.encode()).hexdigest() == _APP_PASSWORD_HASH

def _logged_in() -> bool:
    return session.get('auth') is True


# ── Routes ──────────────────────────────────────────────

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        pw = request.form.get('password', '')
        if _check_password(pw):
            session['auth'] = True
            return redirect(url_for('index'))
        return render_template('login.html', error='密码错误')
    return render_template('login.html', error=None)


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))


@app.route('/')
def index():
    if not _logged_in():
        return redirect(url_for('login'))
    import time
    return render_template('index.html', voices=TTS_VOICES, default_voice=DEFAULT_VOICE, _js_ver=int(time.time()))


@app.route('/api/words', methods=['GET'])
def get_words():
    if not _logged_in():
        return jsonify({'error': '未授权'}), 401
    return jsonify(load_words())


@app.route('/api/words', methods=['POST'])
def add_words():
    data = request.get_json()
    if not data:
        return jsonify({'error': '无效请求'}), 400
    words = load_words()
    existing_lower = {w.lower() for w in words}
    added = []
    for word in data.get('words', []):
        word = word.strip()
        if word and word.lower() not in existing_lower:
            words.append(word)
            existing_lower.add(word.lower())
            added.append(word)
    save_words(words)
    return jsonify({'success': True, 'added': added, 'total': len(words)})


@app.route('/api/words/<path:word>', methods=['DELETE'])
def delete_word(word):
    words = load_words()
    words = [w for w in words if w.lower() != word.lower()]
    save_words(words)
    return jsonify({'success': True, 'total': len(words)})


@app.route('/api/words/clear', methods=['POST'])
def clear_words():
    save_words([])
    return jsonify({'success': True})


@app.route('/api/words/reorder', methods=['POST'])
def reorder_words():
    data = request.get_json()
    words = data.get('words', [])
    save_words(words)
    return jsonify({'success': True})


@app.route('/api/upload-pdf', methods=['POST'])
def upload_pdf():
    if 'file' not in request.files:
        return jsonify({'error': '请选择文件'}), 400
    file = request.files['file']
    fname = (file.filename or '').lower()

    if fname.endswith('.pdf'):
        file_type = 'pdf'
    elif fname.endswith('.docx'):
        file_type = 'docx'
    else:
        return jsonify({'error': '仅支持 PDF 和 Word（.docx）格式'}), 400

    # Read file bytes into memory immediately to avoid Unicode path issues on Windows
    file_bytes = file.read()

    text = ''
    used_ai = False
    try:
        if file_type == 'pdf':
            # Open from bytes stream — avoids Windows non-ASCII path problems with fitz
            doc = fitz.open(stream=file_bytes, filetype='pdf')
            pages_text = [page.get_text() for page in doc]
            text = '\n'.join(pages_text)

            # If no text extracted → scanned PDF, cannot process
            if len(text.strip()) < 20:
                doc.close()
                return jsonify({'error': '该PDF为扫描图片版，无法直接提取文字。请使用可复制文字的电子版PDF，或手动输入单词。'}), 400

            doc.close()

            # Use DeepSeek to intelligently extract vocabulary words from raw text
            # Split into chunks to handle large PDFs (no 6000-char limit)
            CHUNK_SIZE = 12000
            chunks = [text[i:i+CHUNK_SIZE] for i in range(0, len(text), CHUNK_SIZE)]
            ai_words_all = []
            for chunk in chunks:
                if not chunk.strip():
                    continue
                resp = _deepseek.chat.completions.create(
                    model='deepseek-chat',
                    messages=[{
                        'role': 'user',
                        'content': (
                            '以下是从PDF中提取的原始文字，请从中找出所有英文词汇单词，'
                            '每行输出一个单词（只要单词本身，小写，不要编号、不要中文、不要发音符号），'
                            '去掉明显的非词汇内容（如页码、标题、语法标注等）。\n\n'
                            + chunk
                        )
                    }],
                    max_tokens=4096,
                )
                ai_words_all.append(resp.choices[0].message.content or '')
            used_ai = True
            # Merge all chunk results for regex extraction below
            text = '\n'.join(ai_words_all)
        else:  # docx
            wdoc = _docx.Document(io.BytesIO(file_bytes))
            text = '\n'.join(p.text for p in wdoc.paragraphs)
    except Exception as e:
        return jsonify({'error': f'文件解析失败: {e}'}), 500

    # If we have substantial text, also ask DeepSeek to help filter real vocabulary words
    print(f'[upload] file={fname} type={file_type} used_ai={used_ai} text_len={len(text)} preview={repr(text[:200])}', flush=True)

    raw = re.findall(r'\b[a-zA-Z]{3,}\b', text)
    # preserve extraction order, deduplicate, remove stop words
    seen = set()
    unique = []
    for w in raw:
        wl = w.lower()
        if wl not in seen and wl not in STOP_WORDS:
            seen.add(wl)
            unique.append(wl)

    return jsonify({'words': unique, 'total': len(unique)})


@app.route('/api/tts')
def get_tts():
    word = request.args.get('word', '').strip()
    voice = request.args.get('voice', DEFAULT_VOICE)
    if not word:
        return jsonify({'error': '请提供单词'}), 400
    if voice not in TTS_VOICES:
        voice = DEFAULT_VOICE

    # Safe file name: only word chars + underscore for voice tag
    safe_word = re.sub(r'[^\w]', '_', word)
    voice_tag = voice.split('-')[2] if '-' in voice else voice
    filename = f"{safe_word}_{voice_tag}.mp3"
    audio_path = AUDIO_DIR / filename

    if not audio_path.exists():
        try:
            asyncio.run(_generate_tts(word, voice, audio_path))
        except Exception as e:
            return jsonify({'error': f'TTS生成失败: {e}'}), 500

    return send_file(str(audio_path), mimetype='audio/mpeg')


@app.route('/api/word-info', methods=['POST'])
def word_info():
    """Return word details: local dict first, AI fallback only if user requests."""
    if not _logged_in():
        return jsonify({'error': '未授权'}), 401
    data = request.get_json() or {}
    word = data.get('word', '').strip()
    if not word:
        return jsonify({'error': '请提供单词'}), 400

    # ── Try local ECDICT first ──
    if DICT_DB.exists():
        info = _lookup_local_dict(word)
        if info:
            return jsonify(info)

    # ── Not found locally ──
    return jsonify({
        'word': word, 'configured': False, 'source': 'not_found',
        'message': '本地词典未找到该单词'
    })


@app.route('/api/check-answer', methods=['POST'])
def check_answer():
    """Keyboard dictation check — no AI needed, direct string compare."""
    data = request.get_json() or {}
    word = data.get('word', '').strip().lower()
    answer = data.get('answer', '').strip().lower()
    if not word:
        return jsonify({'error': '无效请求'}), 400
    return jsonify({'correct': word == answer, 'word': word, 'answer': answer})


@app.route('/api/voices')
def get_voices():
    return jsonify(TTS_VOICES)


# ════════════════════════════════════════════════
# 错题本 API
# ════════════════════════════════════════════════

def load_mistakes():
    if MISTAKES_FILE.exists():
        try:
            with open(MISTAKES_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if isinstance(data, list):
                return data
        except (json.JSONDecodeError, IOError):
            pass
    return []


def save_mistakes(mistakes):
    with open(MISTAKES_FILE, 'w', encoding='utf-8') as f:
        json.dump(mistakes, f, ensure_ascii=False, indent=2)


@app.route('/api/mistakes', methods=['GET'])
def get_mistakes():
    if not _logged_in():
        return jsonify({'error': '未授权'}), 401
    return jsonify(load_mistakes())


@app.route('/api/mistakes/add', methods=['POST'])
def add_mistakes():
    """Add words to mistake book (called after dictation session)."""
    if not _logged_in():
        return jsonify({'error': '未授权'}), 401
    data = request.get_json() or {}
    words = data.get('words', [])
    mistakes = load_mistakes()
    existing = {m['word'].lower() for m in mistakes}
    for word in words:
        word = word.strip()
        if not word:
            continue
        wl = word.lower()
        if wl in existing:
            # increment count
            for m in mistakes:
                if m['word'].lower() == wl:
                    m['count'] = m.get('count', 1) + 1
        else:
            mistakes.append({'word': word, 'count': 1})
            existing.add(wl)
    save_mistakes(mistakes)
    return jsonify({'success': True, 'total': len(mistakes)})


@app.route('/api/mistakes/<path:word>', methods=['DELETE'])
def delete_mistake(word):
    if not _logged_in():
        return jsonify({'error': '未授权'}), 401
    mistakes = load_mistakes()
    mistakes = [m for m in mistakes if m['word'].lower() != word.lower()]
    save_mistakes(mistakes)
    return jsonify({'success': True, 'total': len(mistakes)})


@app.route('/api/mistakes/clear', methods=['POST'])
def clear_mistakes():
    if not _logged_in():
        return jsonify({'error': '未授权'}), 401
    save_mistakes([])
    return jsonify({'success': True})


@app.route('/api/mistakes/export-pdf')
def export_mistakes_pdf():
    """Generate a PDF of the mistake book and return it for download."""
    if not _logged_in():
        return jsonify({'error': '未授权'}), 401
    mistakes = load_mistakes()
    if not mistakes:
        return jsonify({'error': '错题本为空'}), 400

    import datetime as _dt
    now_str = _dt.datetime.now().strftime('%Y-%m-%d %H:%M')

    doc = fitz.open()

    # Try CJK font
    try:
        fitz.Font('china-s')
        fn = 'china-s'
    except Exception:
        fn = 'helv'

    # ── Layout constants ──────────────────────────
    PW, PH      = 595, 842          # A4
    MX          = 40                # horizontal margin
    HEADER_H    = 90                # height reserved for header block
    FOOTER_H    = 30
    ROW_H       = 28                # row height
    COL_GAP     = 20                # gap between columns
    COL_W       = (PW - 2 * MX - COL_GAP) // 2   # ≈ 257
    col_x       = [MX, MX + COL_W + COL_GAP]
    CONTENT_TOP = HEADER_H + 8
    ROWS_PER_PG = (PH - CONTENT_TOP - FOOTER_H) // ROW_H   # ≈ 26
    ITEMS_PER_PG = ROWS_PER_PG * 2

    # ── Draw page header ──────────────────────────
    def draw_header(pg, page_num, total_pages):
        pg.insert_text((MX, 52),
                       '错题本',
                       fontsize=22, fontname=fn, color=(0.2, 0.35, 0.9))
        sub = f'共 {len(mistakes)} 个单词    导出时间: {now_str}'
        if total_pages > 1:
            sub += f'    第 {page_num}/{total_pages} 页'
        pg.insert_text((MX, 76),
                       sub,
                       fontsize=9, fontname=fn, color=(0.55, 0.55, 0.55))
        pg.draw_line((MX, HEADER_H), (PW - MX, HEADER_H),
                     color=(0.78, 0.78, 0.78), width=0.8)

    # ── Pre-calculate total pages ─────────────────
    total_pages = max(1, -(-len(mistakes) // ITEMS_PER_PG))  # ceil div

    # ── Render all items ──────────────────────────
    page      = None
    cur_page  = 0

    for i, m in enumerate(mistakes):
        page_idx  = i // ITEMS_PER_PG
        page_item = i  % ITEMS_PER_PG

        # New page needed?
        if page_item == 0:
            cur_page += 1
            page = doc.new_page(width=PW, height=PH)
            draw_header(page, cur_page, total_pages)

        # Position: left-right alternating within each page
        row = page_item // 2
        col = page_item  % 2
        x   = col_x[col]
        y   = CONTENT_TOP + row * ROW_H + ROW_H - 6   # baseline at bottom of row cell

        # Alternating row stripe for readability
        if row % 2 == 0:
            stripe_rect = fitz.Rect(x - 4, y - ROW_H + 6, x + COL_W, y + 7)
            page.draw_rect(stripe_rect, color=None, fill=(0.955, 0.955, 0.975))

        # Serial number
        page.insert_text(
            (x, y),
            f'{i+1}.',
            fontsize=9, fontname=fn, color=(0.68, 0.68, 0.68))

        # Word (centred vertically in cell)
        page.insert_text(
            (x + 24, y),
            m['word'],
            fontsize=12, fontname=fn, color=(0.1, 0.12, 0.22))

        # Error count — right-aligned within the column
        cnt_txt = f"×{m.get('count', 1)}"
        page.insert_text(
            (x + COL_W - 30, y),
            cnt_txt,
            fontsize=9, fontname=fn, color=(0.88, 0.22, 0.38))

    pdf_bytes = doc.tobytes()
    doc.close()

    from io import BytesIO
    return send_file(
        BytesIO(pdf_bytes),
        mimetype='application/pdf',
        as_attachment=True,
        download_name='错题本.pdf'
    )


# ═══════════════════════════════════════════
#  LOCAL DICTIONARY  (ECDICT / SQLite)
# ═══════════════════════════════════════════

_POS_LABEL_RE = re.compile(r'^([a-z]{1,5}\.)\s*')
_EXCHANGE_KEYS = {
    'p': '过去式', 'd': '过去分词', 'i': '现在分词', 's': '复数',
    'r': '比较级', 't': '最高级', '3': '第三人称单数',
}


def _parse_ecdict_lines(raw, limit=6):
    """Split raw ECDICT definition/translation block into [{pos, def}] list."""
    results = []
    for line in (raw or '').split('\\n'):
        line = line.strip().lstrip('\ufeff')
        if not line:
            continue
        m = _POS_LABEL_RE.match(line)
        if m:
            results.append({'pos': m.group(1), 'def': line[m.end():].strip(), 'example': ''})
        else:
            results.append({'pos': '', 'def': line, 'example': ''})
        if len(results) >= limit:
            break
    return results


def _lookup_local_dict(word: str):
    """Query local ECDICT SQLite. Returns word-info dict or None."""
    conn = sqlite3.connect(str(DICT_DB))
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute(
            'SELECT word, phonetic, definition, translation, exchange '
            'FROM ecdict WHERE word=?',
            (word.lower(),)
        ).fetchone()
        if row is None:
            # Try original capitalisation
            row = conn.execute(
                'SELECT word, phonetic, definition, translation, exchange '
                'FROM ecdict WHERE word=?',
                (word,)
            ).fetchone()
        if row is None:
            return None
        return _ecdict_row_to_info(dict(row))
    finally:
        conn.close()


def _ecdict_row_to_info(row: dict) -> dict:
    """Convert an ECDICT DB row into the standard word-info response format."""
    phonetic = (row.get('phonetic') or '').strip()
    if phonetic and not phonetic.startswith('/'):
        phonetic = f'/{phonetic}/'

    # Chinese translations first, then English defs
    definitions = _parse_ecdict_lines(row.get('translation'), 5)
    definitions += _parse_ecdict_lines(row.get('definition'), 4)

    # Word-form table from 'exchange' field (e.g. "p:went/d:gone/i:going")
    phrases = []
    exchange = (row.get('exchange') or '').strip()
    if exchange:
        forms = []
        for part in exchange.split('/'):
            if ':' in part:
                k, v = part.split(':', 1)
                forms.append(f'{_EXCHANGE_KEYS.get(k, k)}: {v}')
        if forms:
            phrases = [{'phrase': '  |  '.join(forms), 'meaning': '词形变化'}]

    return {
        'word': row.get('word', ''),
        'phonetic': phonetic,
        'definitions': definitions[:8],
        'synonyms': [],
        'phrases': phrases,
        'etymology': '',
        'source': 'local',
        'configured': True,
    }


@app.route('/api/dict/status')
def dict_status():
    """Return whether the local ECDICT database is loaded and its word count."""
    if not _logged_in():
        return jsonify({'error': '未授权'}), 401
    if not DICT_DB.exists():
        has_csv = ECDICT_CSV.exists()
        return jsonify({'loaded': False, 'count': 0, 'has_csv': has_csv})
    conn = sqlite3.connect(str(DICT_DB))
    try:
        count = conn.execute('SELECT COUNT(*) FROM ecdict').fetchone()[0]
        return jsonify({'loaded': True, 'count': count, 'has_csv': ECDICT_CSV.exists()})
    except Exception:
        return jsonify({'loaded': False, 'count': 0, 'has_csv': ECDICT_CSV.exists()})
    finally:
        conn.close()


@app.route('/api/dict/init', methods=['POST'])
def dict_init():
    """Import ecdict.csv from the data/ folder into the local SQLite database."""
    if not _logged_in():
        return jsonify({'error': '未授权'}), 401
    if not ECDICT_CSV.exists():
        return jsonify({'error': f'请先将 ecdict.csv 放入 {DATA_DIR} 文件夹'}), 404

    conn = sqlite3.connect(str(DICT_DB))
    try:
        conn.execute('DROP TABLE IF EXISTS ecdict')
        conn.execute(
            'CREATE TABLE ecdict '
            '(word TEXT PRIMARY KEY, phonetic TEXT, definition TEXT, '
            ' translation TEXT, exchange TEXT)'
        )
        conn.execute('CREATE INDEX idx_ecdict_word ON ecdict (word)')

        batch, count = [], 0
        with open(ECDICT_CSV, encoding='utf-8', newline='') as f:
            reader = csv.DictReader(f)
            for row in reader:
                w = (row.get('word') or '').strip()
                if not w:
                    continue
                batch.append((
                    w,
                    row.get('phonetic', ''),
                    row.get('definition', ''),
                    row.get('translation', ''),
                    row.get('exchange', ''),
                ))
                if len(batch) >= 5000:
                    conn.executemany('INSERT OR REPLACE INTO ecdict VALUES (?,?,?,?,?)', batch)
                    count += len(batch)
                    batch = []
        if batch:
            conn.executemany('INSERT OR REPLACE INTO ecdict VALUES (?,?,?,?,?)', batch)
            count += len(batch)
        conn.commit()
        return jsonify({'ok': True, 'count': count})
    except Exception as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()


if __name__ == '__main__':
    import socket

    # 获取本机局域网 IP，方便同 WiFi 的手机访问
    try:
        lan_ip = socket.gethostbyname(socket.gethostname())
    except Exception:
        lan_ip = '127.0.0.1'

    port = 5000
    print('=' * 50)
    print('  单词听写系统 已启动')
    print(f'  本机访问: http://localhost:{port}')
    if lan_ip != '127.0.0.1':
        print(f'  同WiFi手机/电脑: http://{lan_ip}:{port}')
    print('=' * 50)

    # 打包成 exe 时自动打开浏览器
    if getattr(sys, 'frozen', False):
        import threading, webbrowser
        threading.Timer(1.5, lambda: webbrowser.open(f'http://localhost:{port}')).start()

    # 监听所有网口，局域网内的手机/电脑也能访问
    app.run(debug=False, port=port, host='0.0.0.0', threaded=True)
