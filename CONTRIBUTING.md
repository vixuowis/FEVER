# Contributing to FEVER

感谢您对 FEVER (Fin Event Research) 的关注！我们欢迎各种形式的贡献，包括但不限于提交 Bug、改进文档、增加新功能以及优化现有代码。

## 提交 Issue

如果您在系统中发现了 Bug，或者有新的功能建议，请通过提交 Issue 的方式告知我们。
提交时，请尽量提供以下信息：
- 您的运行环境（操作系统、Node.js/Python 版本等）。
- 触发 Bug 的具体步骤或复现代码。
- 对于功能建议，请说明其应用场景及预期效果。

## 提交 Pull Request (PR)

如果您想直接为项目贡献代码，请遵循以下步骤：

1. **Fork 本仓库** 到您的 GitHub 账户下。
2. **克隆代码** 到本地：
   ```bash
   git clone https://github.com/your-username/FEVER.git
   ```
3. **创建新分支**：
   ```bash
   git checkout -b feature/your-feature-name
   # 或
   git checkout -b fix/your-bugfix-name
   ```
4. **提交代码**：
   请确保您的提交信息清晰明了，并在需要的地方添加必要的注释。我们的代码风格：
   - 前端：遵循 ESLint / Prettier 规范，组件化开发，Tailwind CSS 类名尽量保持整洁。
   - 后端：遵循 PEP 8 规范，使用 Type Hints 增强可读性。
5. **推送到远程仓库**：
   ```bash
   git push origin feature/your-feature-name
   ```
6. **创建 Pull Request**：
   在 GitHub 页面上发起 PR，并详细描述您所做的更改。

## 代码规范与设计准则

- **视觉与 UI/UX**：保持极简主义、深色模式与 960px 中轴阅读流的排版风格。避免过度花哨的装饰，保留高信息密度的学术/专业研究感。
- **状态管理**：前端统一使用 Zustand 管理全局状态，避免不必要的 Context 嵌套。
- **日志规范**：任何新增的 LLM 或核心 API 调用，必须接入 `ConsoleLog` 面板，以方便在右下角进行统一监控与调试。

再次感谢您的贡献与支持！