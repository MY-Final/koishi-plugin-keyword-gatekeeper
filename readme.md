# koishi-plugin-message-guard

[![npm](https://img.shields.io/npm/v/koishi-plugin-message-guard?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-message-guard)

> 检测并撤回包含关键词的消息，进行禁言或踢出群聊，支持正则表达式匹配。

## 功能特点

- 🛡️ **关键词过滤**：自动检测消息中的敏感词汇
- 🔄 **正则表达式支持**：可使用正则表达式进行更灵活的匹配
- 🚫 **自动撤回**：检测到敏感内容时自动撤回消息
- ⏱️ **自动禁言**：可对发送敏感内容的用户进行禁言
- 📝 **自定义提示**：可自定义触发后的提示消息

## 安装方法

```bash
# 使用 npm
npm install koishi-plugin-message-guard

# 使用 yarn
yarn add koishi-plugin-message-guard

# 使用 Koishi 插件市场
# 在插件市场中搜索"message-guard"并安装
```

## 配置说明

```yaml
message-guard:
  keywords:          # 需要检测的关键词列表
    - '敏感词1'
    - '敏感词2'
  useRegex: false    # 是否将关键词作为正则表达式处理
  regexFlags: 'i'    # 正则表达式标志（i-忽略大小写, g-全局匹配, m-多行匹配）
  recall: true       # 是否撤回包含关键词的消息
  mute: true         # 是否禁言发送包含关键词消息的用户
  muteDuration: 600  # 禁言时长（秒）
  customMessage: '检测到违规内容，已进行处理'  # 检测到关键词后的提示消息
```

## 适配器支持

该插件已在以下适配器上测试通过：
- OneBot (QQ机器人)

其他适配器可能需要额外配置或不完全支持所有功能。

## 使用示例

设置关键词列表并启用正则表达式匹配：
```yaml
message-guard:
  keywords:
    - '敏感词1'
    - '[0-9]{11}'  # 匹配11位数字
  useRegex: true
  regexFlags: 'i'
  recall: true
  mute: true
  muteDuration: 300  # 5分钟
```

## 许可证

使用 [MIT](https://opensource.org/licenses/MIT) 许可证
