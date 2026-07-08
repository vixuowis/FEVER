# FEVER (Fin Event Research)

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![React](https://img.shields.io/badge/React-18.x-blue.svg)
![Python](https://img.shields.io/badge/Python-3.10+-blue.svg)
![Status](https://img.shields.io/badge/status-active-success.svg)

> **FEVER = 捕获高置信度市场信号，结构化解析事件传导的金融事件研究终端。**

基于 `scan -> shortlist -> dive` 逻辑的深色模式极简阅读流，结合 LLM 动态推演与事实验证网络（Evidence Graph），构建下一代智能投资研究工作台。

## 🎯 核心特性

- **Global Fever 信号扫描**：实时监控高强度、高时效事件，过滤低置信度市场噪音。
- **Heat Shifts 热度突变追踪**：追踪短时间内热度异常波动的突发事件与趋势逆转。
- **沉浸式深度阅读流**：摒弃传统 Dashboard 的拼凑感，采用 960px 中轴阅读流，沉浸式解析事件快照、情景推演与监控清单。
- **证据图谱 (Evidence Graph)**：集成基于 LLM 的事实验证与逻辑推演网络（支持 React Flow 拓扑可视化），追踪信号传导路径。
- **突发事件仿真推演**：利用多维环境参数（波动率、流动性、情绪）进行随机压力测试。
- **全链路监控日志**：提供内置折叠 Console，支持对大模型（如 Volcengine Ark API / QVeris）及执行引擎（Argus）交互链路的调试分析。

## 📂 目录结构

```text
FEVER/
├── frontend/          # 核心前端 (React + Vite + Tailwind CSS + Zustand + React Flow)
├── backend/           # API 与图谱验证服务 (Python + aiohttp + Argus reproduction)
├── docs/              # 项目相关文档
├── archive/           # 早期版本与废弃代码归档
├── .env.example       # 环境变量配置模板
├── .gitignore         # Git 忽略配置
├── LICENSE            # 开源协议
└── README.md          # 项目说明文档
```

## 🚀 快速开始

### 1. 环境准备

复制环境变量模板并填入您的 API 密钥：

```bash
cp .env.example .env
```

配置 `.env` 文件，确保包含您使用的 LLM 与 QVeris 相关的 API Key。

### 2. 启动前端服务

前端采用 Vite 构建，主要依赖于 Tailwind CSS 与 React Flow：

```bash
cd frontend
npm install
npm run dev
```
> 前端默认运行于: `http://localhost:5173` 或 `5174`

### 3. 启动后端 (Argus) 服务

后端负责处理跨域请求并与 LLM 交互以生成验证节点数据：

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python3 -m argus_repro.frontend.server --port 7860 --host 0.0.0.0
```
> 后端 API 默认运行于: `http://localhost:7860/api`

## 🛠️ 技术栈

- **Frontend**: React, Vite, TypeScript, Tailwind CSS, Zustand, React Flow, Framer Motion, Lucide-React
- **Backend**: Python 3.10+, aiohttp, aiohttp-cors, Pydantic
- **AI Integration**: DeepSeek V4 (via Volcengine Ark API), QVeris

## 🤝 参与贡献

欢迎提交 Issue 和 Pull Request！参与开发前，请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md) 了解代码规范与提交流程。

## 📄 协议

本项目基于 [MIT License](./LICENSE) 开源。
