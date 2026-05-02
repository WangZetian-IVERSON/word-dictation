# 单词听写 📚 · English Word Dictation

> 一个基于 Flask 的英语单词听写练习 Web 应用，支持本地运行与云端部署。  
> A Flask-based English vocabulary dictation web app — works locally and on the cloud.

---

## 📸 截图 · Screenshots

<table>
  <tr>
    <td align="center"><b>单词库 · Word Library</b></td>
    <td align="center"><b>听写练习 · Dictation</b></td>
  </tr>
  <tr>
    <td><img src="https://github.com/user-attachments/assets/080a25b9-fedf-4810-9934-e4c8dd235211" alt="单词库" /></td>
    <td><img src="https://github.com/user-attachments/assets/93035e68-819f-4510-919f-d2eb8542a9cf" alt="听写练习" /></td>
  </tr>
  <tr>
    <td align="center"><b>跟读模式 · Listen Mode</b></td>
    <td align="center"><b>错题本 · Mistake Book</b></td>
  </tr>
  <tr>
    <td><img src="https://github.com/user-attachments/assets/1ed70623-852a-41a9-85f1-6e6f3cb23d18" alt="跟读模式" /></td>
    <td><img src="https://github.com/user-attachments/assets/e9ebdd88-f2c4-43da-8763-9fe5aefa2f2e" alt="错题本" /></td>
  </tr>
</table>

---

## ✨ 功能特色 · Features

| 功能 Feature | 说明 Description |
|---|---|
| 📂 单词库管理 Word Library | 手动添加或批量导入 PDF / Word，支持拖拽上传 · Manually add or bulk-import from PDF / Word, drag & drop supported |
| 🤖 AI 智能提取 AI Extraction | DeepSeek AI 自动识别词汇，大文件分块异步处理不超时 · DeepSeek AI extracts vocabulary; large files processed in async chunks — no timeout |
| 🎧 听写练习 Dictation | 播放发音后输入拼写，实时判断对错 · Hear the word, type the spelling, get instant feedback |
| 🔊 跟读模式 Listen Mode | 顺序播放单词音频，支持暂停 / 上一个 / 下一个 / 循环 · Sequential audio playback with pause / prev / next / loop |
| 📒 错题本 Mistake Book | 自动记录错误单词，支持排序、导出 PDF、专项练习 · Auto-records mistakes; sort, export PDF, or practice from mistakes |
| 🔍 AI 在线查词 Online Dictionary | 无本地词典时调用 DeepSeek 查询音标、中文释义、词形变化 · Falls back to DeepSeek for phonetics, Chinese meanings & word forms |
| 🗣️ 多音色 TTS | 基于 edge-tts，支持美式 / 英式男女多种发音人 · Multiple US / UK voices via edge-tts |
| 🔐 密码保护 Password | 登录后才能使用，密码通过环境变量配置 · Login required; password configured via environment variable |

---

## 🛠️ 技术栈 · Tech Stack

| 层 Layer | 技术 Technology |
|---|---|
| 后端 Backend | Python 3.11 + Flask |
| AI | DeepSeek API (`deepseek-chat`) |
| 语音合成 TTS | edge-tts |
| PDF 解析 PDF Parsing | PyMuPDF (fitz) |
| 前端 Frontend | Bootstrap 5.3 + Vanilla JS |
| 生产服务器 Production | gunicorn |

---

## 🚀 本地运行 · Local Setup

```bash
# 克隆项目 Clone the repo
git clone https://github.com/WangZetian-IVERSON/word-dictation.git
cd word-dictation

# 创建虚拟环境 Create virtual environment
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS / Linux

# 安装依赖 Install dependencies
pip install -r requirements.txt

# 启动 Run
python app.py
```

浏览器访问 · Open in browser: `http://localhost:5000`  
默认密码 Default password: `20040311`

---

## ☁️ 云端部署 · Cloud Deployment (Railway)

1. Fork 本项目到自己的 GitHub · Fork this repo to your GitHub  
2. 在 [Railway](https://railway.app) 新建项目，选择 **Deploy from GitHub repo** · Create a new project on Railway  
3. 在 Railway → Variables 中添加以下环境变量 · Add environment variables:

| 变量名 Variable | 说明 Description |
|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 · DeepSeek API key |
| `APP_PASSWORD` | 登录密码 · Login password |
| `SECRET_KEY` | Flask Session 密钥（可随机字符串）· Flask session secret |

4. 部署完成后：Railway → Settings → Networking → **Generate Domain** 获取公网地址  
   After deploy: generate a public domain under Railway → Settings → Networking

---

## ⚙️ 环境变量 · Environment Variables

```
APP_PASSWORD      登录密码 · Login password (default: 20040311)
DEEPSEEK_API_KEY  DeepSeek API Key（必须 Required — used for PDF extraction & online dictionary）
SECRET_KEY        Flask session 加密密钥 · Session encryption key (optional)
```

---

## 📁 项目结构 · Project Structure

```
word-dictation/
├── app.py              # Flask 主程序 · Main server
├── requirements.txt    # Python 依赖 · Dependencies
├── Procfile            # gunicorn 启动命令 · Production start command
├── runtime.txt         # Python 版本 · Python version
├── static/
│   ├── js/app.js       # 前端逻辑 · Frontend logic
│   ├── css/            # 样式 · Styles
│   └── vendor/         # Bootstrap 本地文件 · Local Bootstrap
├── templates/
│   └── index.html      # 主页面 · Main page
└── data/               # 运行时数据（不入 git）· Runtime data (gitignored)
```
