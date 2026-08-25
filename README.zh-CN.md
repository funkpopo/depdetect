<p align="center">
  <img src="./res/logo.png" width="112" alt="DepDetect 标志">
</p>

<h1 align="center">DepDetect</h1>

<p align="center">
  <a href="./README.md">English</a> | 简体中文
</p>

<p align="center">
  无需离开 VS Code，即可检查和更新 npm、PyPI、Go Module 与 Maven 依赖版本。
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=funkpopo.depdetect"><img src="https://img.shields.io/badge/VS%20Code%20Marketplace-Install-007ACC?logo=visual-studio-code&logoColor=white" alt="从 Visual Studio Marketplace 安装 DepDetect"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT 许可证"></a>
</p>

DepDetect 会在受支持的依赖文件中直接显示版本状态标记。将鼠标悬停在依赖项上，即可浏览已发布版本、打开对应的软件包页面，或单击版本号完成替换。

![DepDetect 在 VS Code 中显示依赖版本](./screenshots/preview.gif)

## 功能亮点

- 在编辑依赖文件时直接查看版本状态。
- 通过悬停窗口浏览已发布的稳定版本。
- 单击任意版本即可立即替换当前版本。
- 遵循当前 npm registry 配置，包括作用域 registry。
- 通过会话内缓存和持久化缓存减少重复网络请求。

## 支持的文件

| 生态 | 文件 | 可检测的依赖声明 | 版本数据来源 |
| --- | --- | --- | --- |
| Node.js | `package.json` | `dependencies`、`devDependencies` | 当前配置的 npm registry |
| Python | `requirements.txt` | 带版本约束的 PEP 508 风格依赖 | PyPI |
| Python | `pyproject.toml` | PEP 621 依赖、可选依赖、依赖组、构建依赖和 Poetry 依赖 | PyPI |
| Go | `go.mod` | 单行与块状 `require` 指令 | Go Module Proxy |
| Java | `pom.xml` | 包含显式 `<version>` 的依赖 | Maven Central |

DepDetect 会排除预发布版本，同时排除已废弃的 npm 版本和已撤回的 PyPI 版本。

## 快速开始

1. 从 [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=funkpopo.depdetect) 安装 **DepDetect**。
2. 打开任意受支持的依赖文件。
3. 等待状态栏显示 `DepDetect: OK`。
4. 将鼠标悬停在依赖项的状态标记上，查看可用版本。
5. 选择一个版本替换当前版本。

单独更新 npm 依赖时，DepDetect 会保留版本约束开头的 `^` 或 `~`。对于纯文本格式，DepDetect 只替换版本文本，保留声明中的其余内容。

## 状态标记

| 标记 | 含义 |
| --- | --- |
| `✅` | 当前版本约束与最新稳定版兼容。 |
| `❌ <版本号>` | 最新稳定版不在当前版本约束范围内。 |
| `❗` | 无法获取版本信息，或当前版本无效。 |

你可以在 VS Code 设置中自定义这些标记的文本。

## 命令

打开命令面板并搜索 `DepDetect`：

| 命令 | 说明 |
| --- | --- |
| **DepDetect: Retry to fetch the active dependency file** | 绕过已缓存的元数据，重新获取依赖版本。 |

依赖项悬停窗口中的版本链接使用内部命令实现，不需要从命令面板手动调用。

## 刷新机制

首次打开受支持的文件时，DepDetect 会获取版本元数据。编辑或保存文件只会重新解析文档并更新状态标记的位置，不会反复请求软件包 registry。在源代码管理的差异视图中也不会主动发起 registry 请求。

添加新依赖后，或需要获取最新的 registry 数据时，请运行 **DepDetect: Retry to fetch the active dependency file**。Registry 响应会被缓存，以加快后续检查速度。

## Registry 与鉴权行为

PyPI、Go Module Proxy 和 Maven Central 请求使用 Node.js 运行时的原生 `fetch`，共用 10 秒超时、明确的 `User-Agent`、响应状态码检查和响应解析检查。npm 请求仍然使用 `npm-registry-fetch`，以保留现有的 npm registry、代理、证书和请求行为。

对于 npm，默认 registry 通过 `npm config get registry` 读取；作用域包还会读取 `npm config get @scope:registry`。扩展目前不会将 npm auth token 或其他凭据读取并注入请求选项。公共 registry 以及不要求鉴权的私有 registry 可以正常工作；需要私有 registry 鉴权的软件包可能显示 `❗`，直到后续明确加入 npm 鉴权支持。

## 设置

| 设置项 | 默认值 | 说明 |
| --- | --- | --- |
| `depdetect.compatibleDecorator` | `✅` | 依赖兼容时显示的标记模板。可使用 `${version}` 插入最新版本号。 |
| `depdetect.incompatibleDecorator` | `❌ ${version}` | 最新版本不在当前版本约束范围内时显示的标记模板。 |
| `depdetect.errorDecorator` | `❗` | 无法获取依赖信息时显示的标记。 |

这些设置既可以全局配置，也可以按工作区配置。将标记文本设置为空字符串即可隐藏对应标记。

## 当前限制

- 新增的依赖只会在手动执行重试后，或在新的 VS Code 会话中重新打开文件后得到检查。
- Maven 中通过 `${revision}` 等属性引用的版本不会被直接修改。
- 无版本依赖、本地路径、Git URL、workspace 引用及其他非 registry 依赖声明不会作为更新目标。

## 反馈与源代码

如果发现问题或希望增加新功能，欢迎前往 GitHub [提交 Issue](https://github.com/funkpopo/dep-packages/issues)。项目源代码位于 [DepDetect 仓库](https://github.com/funkpopo/dep-packages)。

DepDetect 的设计受到 [crates](https://github.com/serayuzgur/crates) 启发，并基于 [Riri 的 vscode-ext-packages](https://github.com/Daydreamer-riri/vscode-ext-packages) 修改而来。原始作品 Copyright © 2023 Riri；后续修改 Copyright © 2026 funkpopo。完整版权声明保留在 [MIT 许可证](./LICENSE)中。
