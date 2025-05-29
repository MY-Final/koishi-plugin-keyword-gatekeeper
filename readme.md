# koishi-plugin-message-guard

[![npm](https://img.shields.io/npm/v/koishi-plugin-message-guard?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-message-guard)

> 检测并撤回包含关键词的消息，进行禁言或踢出群聊，支持正则表达式匹配。

## 功能特点

- 🛡️ **关键词过滤**：自动检测消息中的敏感词汇
- 🔄 **正则表达式支持**：可使用正则表达式进行更灵活的匹配
- 🚫 **自动撤回**：检测到敏感内容时自动撤回消息
- ⏱️ **自动禁言**：可对发送敏感内容的用户进行禁言
- 📝 **自定义提示**：可自定义触发后的提示消息
- 🔢 **自动处罚机制**：根据用户触发次数自动升级处罚等级
- 🕒 **处罚记录重置**：支持定时重置用户的违规记录

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
  # 关键词检测配置
  keywords:          # 需要检测的关键词列表
    - '敏感词1'
    - '敏感词2'
  useRegex: false    # 是否将关键词作为正则表达式处理
  regexFlags: 'i'    # 正则表达式标志（i-忽略大小写, g-全局匹配, m-多行匹配）

  # 基础处罚配置
  recall: true       # 是否撤回包含关键词的消息
  mute: true         # 是否禁言发送包含关键词消息的用户
  muteDuration: 600  # 禁言时长（秒）
  customMessage: '检测到违规内容，已进行处理'  # 检测到关键词后的提示消息

  # 自动处罚机制配置
  enableAutoPunishment: false    # 是否启用自动处罚机制
  secondViolationMuteDuration: 60  # 第二次违规的禁言时长（秒）
  maxViolationCount: 3           # 最大违规次数，达到此次数后将执行最终处罚
  kickOnMaxViolation: true       # 达到最大违规次数时是否踢出用户
  punishmentResetHours: 24       # 处罚记录重置时间（小时）
```

## 自动处罚机制

启用自动处罚机制后，插件会根据用户触发关键词的次数自动升级处罚等级：

1. **第一次触发**：警告提示并撤回消息
2. **第二次触发**：禁言指定时长（可自定义，默认60秒）
3. **第三次及以上触发**：
   - 如果未达到最大违规次数：禁言时间会随违规次数增加而递增
   - 如果达到最大违规次数：踢出群聊或长时间禁言（可配置）

系统会记录每个用户的触发次数，并支持按时间重置（默认24小时）。

## 适配器支持

该插件已在以下适配器上测试通过：
- OneBot (QQ机器人)

其他适配器可能需要额外配置或不完全支持所有功能。

## 使用示例

设置关键词列表并启用自动处罚机制：
```yaml
message-guard:
  keywords:
    - '敏感词1'
    - '[0-9]{11}'  # 匹配11位数字
  useRegex: true
  regexFlags: 'i'
  recall: true

  # 启用自动处罚机制
  enableAutoPunishment: true
  secondViolationMuteDuration: 120  # 第二次违规禁言2分钟
  maxViolationCount: 4              # 第四次违规执行最终处罚
  kickOnMaxViolation: true          # 达到最大违规次数时踢出用户
  punishmentResetHours: 24          # 24小时后重置违规记录
```

## 许可证

使用 [MIT](https://opensource.org/licenses/MIT) 许可证
