# 单词听写 📚

一个基于 Flask 的英语单词听写练习 Web 应用，支持本地运行和云端部署。

## 功能特色

- **单词库管理** — 手动添加、批量导入（PDF / Word），支持拖拽上传
- **AI 智能提取** — 上传 PDF 后由 DeepSeek AI 自动识别并提取词汇，大文件分块处理、后台异步运行，不会超时
- **听写练习** — 播放单词发音，输入拼写，实时判断对错
- **跟读模式** — 按顺序播放单词音频，支持暂停 / 上一个 / 下一个 / 循环
- **错题本** — 自动记录拼错的单词，支持按字母/频次排序、导出 PDF、专项练习
- **AI 在线查词** — 无本地词典时自动调用 DeepSeek 查询音标、中文释义、词形变化
- **多音色 TTS** — 基于 edge-tts，支持美式/英式男女多种发音人
- **密码保护** — 登录后才能使用，支持环境变量配置密码

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Python 3.11 + Flask |
| AI | DeepSeek API (`deepseek-chat`) |
| 语音合成 | edge-tts |
| PDF 解析 | PyMuPDF (fitz) |
| 前端 | Bootstrap 5.3 + 原生 JS |
| 生产服务器 | gunicorn |

## 本地运行

```bash
# 1. 克隆项目
git clone https://github.com/WangZetian-IVERSON/word-dictation.git
cd word-dictation

# 2. 创建虚拟环境
python -m venv venv
venv\Scripts\activate      # Windows
# source venv/bin/activate  # macOS/Linux

# 3. 安装依赖
pip install -r requirements.txt

# 4. 运行
python app.py
```

浏览器访问 `http://localhost:5000`，默认密码：`20040311`

## 云端部署（Railway）

1. Fork 本项目到自己的 GitHub
2. 在 [Railway](https://railway.app) 新建项目，选择 "Deploy from GitHub repo"
3. 在 Railway → Variables 中添加环境变量：

| 变量名 | 说明 |
|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 |
| `APP_PASSWORD` | 登录密码（不设则用默认值） |
| `SECRET_KEY` | Flask Session 密钥（可随机字符串） |

4. 部署完成后，Railway → Settings → Networking → Generate Domain 获取公网地址

## 环境变量说明

```
APP_PASSWORD     登录密码，默认 20040311
DEEPSEEK_API_KEY DeepSeek API Key（必须，用于 PDF 提取和在线查词）
SECRET_KEY       Flask session 加密密钥（可选）
```

## 项目结构

```
单词听写/
├── app.py              # Flask 主程序
├── requirements.txt    # Python 依赖
├── Procfile            # gunicorn 启动命令（Railway/Render 用）
├── runtime.txt         # Python 版本声明
├── static/
│   ├── js/app.js       # 前端逻辑
│   ├── css/            # 样式
│   └── vendor/         # Bootstrap 本地文件
├── templates/
│   └── index.html      # 主页面
└── data/               # 运行时数据（单词库、错题本，不入 git）
```
