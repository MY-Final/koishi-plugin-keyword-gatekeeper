# koishi-plugin-keyword-gatekeeper

[![npm](https://img.shields.io/npm/v/koishi-plugin-keyword-gatekeeper?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-keyword-gatekeeper)

> 高级关键词过滤与自动处罚系统，支持关键词和URL检测、多级处罚机制、数据库持久化

## 🔰 插件说明

高级关键词守门员是一个功能全面的消息过滤与处罚系统，可以帮助群组管理员有效控制群内违规内容。

## 🌟 主要功能

- ✅ **关键词过滤**：自动检测群消息中的敏感词汇，支持正则表达式
- 🔗 **URL监控**：自动检测非白名单网址，防止垃圾链接和钓鱼网站
- 🚫 **多级处罚**：智能升级处罚等级，从警告到禁言再到踢出
- 📊 **记录系统**：持久化存储所有违规记录，重启不丢失数据
- 🔍 **查询功能**：支持查看完整历史记录，包含消息内容和处罚类型
- 👤 **艾特支持**：支持通过@用户执行查询和清零操作
- 🔐 **智能权限**：自动适应机器人权限状态，避免无效操作
- 🏠 **群组配置**：每个QQ群可以设置独立的关键词和提示信息
- 🔢 **多群管理**：支持通过群号列表预设启用特定群组的配置

## 📥 安装方法

```bash
# 使用 npm
npm install koishi-plugin-keyword-gatekeeper

# 使用 yarn
yarn add koishi-plugin-keyword-gatekeeper

# 使用 Koishi 插件市场
# 在插件市场中搜索"keyword-gatekeeper"并安装
```

## 📖 使用方法

1. 设置关键词列表，可选择启用正则表达式模式
2. 配置URL检测和白名单网址
3. 启用自动处罚机制，设置处罚升级规则
4. 使用相关命令管理用户的违规记录
5. 启用群组特定配置，为每个群设置独立的关键词

## ⚙️ 配置说明

插件配置已分为6个功能区块，使设置更加直观：

### 关键词检测设置

```yaml
keyword-gatekeeper:
  # 关键词检测设置
  keywords:          # 需要检测的关键词列表
    - '敏感词1'
    - '敏感词2'
  useRegex: false    # 是否将关键词作为正则表达式处理
  regexFlags: 'i'    # 正则表达式标志（i-忽略大小写, g-全局匹配, m-多行匹配）
```

### 关键词处理设置

```yaml
  # 关键词处理设置
  recall: true       # 是否撤回包含关键词的消息
  mute: true         # 是否禁言发送包含关键词消息的用户
  muteDuration: 600  # 禁言时长（秒）
  customMessage: '检测到违规内容，已进行处理'  # 检测到关键词后的提示消息
```

### 网址检测设置

```yaml
  # 网址检测设置
  detectUrls: true   # 是否启用网址检测功能
  urlWhitelist:      # 网址白名单，这些域名不会被检测
    - 'koishi.chat'
    - 'github.com'
  urlAction: 'both'  # 检测到网址后的操作：recall(仅撤回)、mute(仅禁言)、both(撤回并禁言)
  urlMuteDuration: 300  # 检测到网址后的禁言时长（秒）
  urlCustomMessage: '检测到未经允许的网址链接，已进行处理'  # 检测到网址后的提示消息
```

### 自动处罚设置

```yaml
  # 自动处罚设置
  enableAutoPunishment: true    # 是否启用自动处罚机制
  secondViolationMuteDuration: 60  # 第二次违规的禁言时长（秒）
  maxViolationCount: 3           # 最大违规次数，达到此次数后将执行最终处罚
  kickOnMaxViolation: true       # 达到最大违规次数时是否踢出用户
  punishmentResetHours: 24       # 处罚记录重置时间（小时）
```

### 权限控制设置

```yaml
  # 权限控制设置
  allowUserSelfQuery: true       # 是否允许普通用户查询自己的警告记录
```

### 群组配置设置

```yaml
  # 群组配置设置
  enableGroupSpecificConfig: true  # 【功能总开关】是否启用"群组特定配置"功能，必须开启此项才能使用群组相关设置
  enabledGroups:                   # 【自动启用】指定哪些群组自动启用特定配置，这些群组无需手动执行kw.group.enable命令
    - '123456789'
    - '987654321'
  defaultPresets: ['common']       # 默认启用的预设关键词包，可选：politics, adult, gambling, spam, scam, common
  autoImportPresets: true          # 是否在群组启用特定配置时自动导入默认预设包
```

## 🚨 自动处罚机制

启用自动处罚机制后，插件会根据用户触发关键词的次数自动升级处罚等级：

1. **第一次触发**：警告提示并撤回消息
2. **第二次触发**：禁言指定时长（可自定义，默认60秒）
3. **第三次及以上触发**：
   - 如果未达到最大违规次数：禁言时间会随违规次数增加而递增
   - 如果达到最大违规次数：踢出群聊或长时间禁言（可配置）

系统会记录每个用户的触发次数，并支持按时间重置（默认24小时）。

## 👨‍💻 命令列表

### 用户命令

- `kw.warning.my` - 查询自己的警告记录
  ```
  > kw.warning.my
  您当前的警告次数为: 1次，将在23小时45分钟后自动重置。
  最近一次触发: 关键词 "敏感词"
  触发时间: 2023年05月29日 13时50分01秒
  执行处罚: 警告
  触发消息: 这是一条包含敏感词的消息

  历史触发记录 (最近2条):
  1. 2023年05月28日 10时15分22秒 - 关键词 "敏感词" (警告)
  2. 2023年05月28日 18时45分10秒 - 网址 "bad-example.com" (警告)
  ```

- `kw.warning.my-history` - 查看自己的完整警告历史
  ```
  > kw.warning.my-history
  您的完整警告历史记录 (共5条):
  1. 2023年05月28日 10时15分22秒 - 关键词 "敏感词" (警告)
     消息内容: 这是一条包含敏感词的消息
  2. 2023年05月28日 18时45分10秒 - 网址 "bad-example.com" (警告)
     消息内容: 大家快来看 bad-example.com 这个网站
  3. 2023年05月29日 09时30分45秒 - 关键词 "违禁词" (警告)
     消息内容: 这是一条包含违禁词的消息
  4. 2023年05月29日 12时20分33秒 - 关键词 "敏感词" (禁言)
     消息内容: 又是一条包含敏感词的消息
  5. 2023年05月29日 13时50分01秒 - 关键词 "敏感词" (禁言)
     消息内容: 这还是一条包含敏感词的消息
  ```

### 警告管理命令

以下命令需要管理员权限：

- `kw.warning.query @用户` - 查询指定用户的警告记录
- `kw.warning.history @用户` - 查看指定用户的完整警告历史
- `kw.warning.reset @用户` - 清零指定用户的警告记录
- `kw.warning.list` - 列出所有有警告记录的用户
- `kw.warning.debug` - 查看所有警告记录的详细信息（调试用）
- `kw.warning.sync` - 强制同步所有警告记录
- `kw.warning.clear-all` - 清空所有警告记录（需要超级管理员权限）

### 关键词管理命令

- `kw.keyword.add <关键词>` - 添加全局关键词
- `kw.keyword.remove <关键词>` - 删除全局关键词
- `kw.keyword.list` - 列出所有全局关键词
- `kw.keyword.clear` - 清空所有全局关键词

### URL白名单管理命令

- `kw.url.add <域名>` - 添加域名到白名单
- `kw.url.remove <域名>` - 从白名单中删除域名
- `kw.url.list` - 列出所有URL白名单

### 预设包管理命令

- `kw.preset.list` - 列出所有可用的预设包
- `kw.preset.view <名称>` - 查看指定预设包的内容
- `kw.preset.create <名称> <描述>` - 创建一个新的自定义预设包
- `kw.preset.add <名称> <关键词>` - 向指定预设包添加关键词
- `kw.preset.remove <名称> <关键词>` - 从指定预设包移除关键词
- `kw.preset.import <名称>` - 将预设包导入到全局配置
- `kw.preset.export <名称>` - 导出预设包内容

### 群组配置命令

- `kw.group.keywords` - 查看当前群组的关键词列表
- `kw.group.add-keyword <关键词>` - 添加群组特定关键词
- `kw.group.remove-keyword <关键词>` - 删除群组特定关键词
- `kw.group.set-message <提示信息>` - 设置群组特定提示信息
- `kw.group.enable` - 启用群组特定配置
- `kw.group.disable` - 禁用群组特定配置
- `kw.group.reset` - 重置群组特定配置
- `kw.group.import-preset <预设包名称>` - 导入预设关键词包到当前群组

## 📝 版本更新

### v0.0.8
- 🔄 **命令结构优化**：重构命令注册机制，使用点分隔的层级结构
- 🛠️ **修复命令冲突**：解决子命令路径冲突问题，确保所有命令正常工作
- 📋 **统一命令格式**：统一所有命令格式为 `kw.category.action` 的形式
- 🔍 **增强命令可发现性**：改进命令帮助信息，使命令更容易被发现和使用
- 🔒 **权限系统优化**：完善权限检查逻辑，支持不同级别的权限要求
- 📚 **文档更新**：更新命令列表和使用说明，使文档与实际功能保持一致

### v0.0.7
- ✨ **预设关键词包**：添加预设关键词包功能，支持一键导入多种类型的违禁词

## 🏠 群组特定配置

从 v0.0.6 版本开始，插件支持为每个QQ群设置独立的关键词和提示信息。这使得不同的群组可以有各自的关键词列表，更好地满足不同群的管理需求。

### 使用方法

1. 在插件设置中启用"群组特定配置"选项
2. 在需要配置的群中使用 `kw.group.enable` 启用群特定配置
3. 使用 `kw.group.add-keyword` 添加该群特有的关键词
4. 使用 `kw.group.set-message` 设置该群的自定义提示信息

### 工作原理

- 当群组启用特定配置后，该群将优先使用其特定的关键词列表，而不是全局配置中的关键词
- 如果群组配置中未设置自定义提示信息，则仍使用全局配置中的提示信息
- 每个群组的配置互不影响，可以独立添加或删除关键词
- 群组配置持久化存储在数据库中，机器人重启后不会丢失

## 💾 数据持久化

从 v0.0.4 版本开始，警告记录会持久化存储在 Koishi 数据库中，不会因机器人重启而丢失。存储的数据包括：

- 用户ID和群组ID
- 违规次数和最后触发时间
- 触发的关键词或URL
- 触发类型（关键词/URL）
- 执行的处罚类型（警告/禁言/踢出）
- 触发的消息内容（完整保存）
- 处罚历史记录（最多保留10条）
- 格式化的时间（方便阅读）

这确保了即使机器人重启，也能保持完整的警告记录，并能提供详细的违规历史信息。

## 🔌 适配器支持

该插件已在以下适配器上测试通过：
- OneBot (QQ机器人)

其他适配器可能需要额外配置或不完全支持所有功能。

## 📋 使用示例

### 📝 使用示例

#### 添加关键词并查看列表

```
> kw.keyword.add 敏感词
已成功添加全局关键词: 敏感词

> kw.keyword.list
全局关键词列表 (1个):
敏感词
```

#### 配置群组特定关键词

```
> kw.group.enable
已成功启用群组特定配置。使用 kw.group.add-keyword 添加群组关键词。

> kw.group.add-keyword 群组敏感词
已成功添加群组关键词: 群组敏感词
当前群组共有 1 个关键词。

> kw.group.keywords
当前群组关键词列表 (1个):
群组敏感词
```

#### 使用预设包

```
> kw.preset.list
可用的预设包列表：

【系统预设包】
- politics：政治相关敏感词汇
- adult：成人内容相关敏感词汇
- gambling：赌博相关敏感词汇
- spam：垃圾信息相关敏感词汇
- scam：诈骗相关敏感词汇
- common：常见违禁词汇集合

> kw.preset.view common
预设包 "common" 的详细信息：
- 描述：常见违禁词汇集合
- 类型：系统预设
- 创建者：system
- 创建时间：2023/6/1 15:30:45
- 包含关键词数量：3

包含的关键词：
1. 常见违禁词1
2. 常见违禁词2
3. 常见违禁词3

> kw.group.import-preset common
成功将预设包 "common" 导入到当前群组，共添加 3 个新关键词。
```

#### 创建自定义预设包

```
> kw.preset.create mypack 我的自定义预设包
成功创建预设包 "mypack"。使用 kw.preset.add mypack <keyword> 添加关键词。

> kw.preset.add mypack 自定义敏感词1
成功将关键词 "自定义敏感词1" 添加到预设包 "mypack"。

> kw.preset.add mypack 自定义敏感词2
成功将关键词 "自定义敏感词2" 添加到预设包 "mypack"。

> kw.preset.view mypack
预设包 "mypack" 的详细信息：
- 描述：我的自定义预设包
- 类型：自定义预设
- 创建者：12345678
- 创建时间：2023/6/1 16:45:30
- 包含关键词数量：2

包含的关键词：
1. 自定义敏感词1
2. 自定义敏感词2
```

## 📄 许可证

使用 [MIT](https://opensource.org/licenses/MIT) 许可证

## 关键词守门员 (Keyword Gatekeeper)

[![npm](https://img.shields.io/npm/v/koishi-plugin-keyword-gatekeeper?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-keyword-gatekeeper)

检测和处理群聊中的敏感关键词和非白名单URL，支持群组特定配置和自动处罚机制

### 🌟 功能特点

- ✅ **关键词检测**：自动检测消息中的敏感关键词，支持普通文本和正则表达式
- ✅ **URL检测**：检测非白名单URL，防止垃圾链接和钓鱼网站
- ✅ **多种处罚方式**：撤回消息、禁言用户，可单独配置
- ✅ **自动处罚机制**：根据违规次数自动升级处罚等级
- ✅ **群组特定配置**：为不同群组设置独立的关键词和提示信息
- ✅ **预设关键词包**：内置多种常见违规内容的预设关键词包
- ✅ **自定义预设包**：支持创建、编辑和管理自定义预设包
- ✅ **可视化预设包**：查看预设包内容，方便管理和使用

### 📋 使用方法

#### 基本命令

- `kw.keyword.add <关键词>` - 添加全局关键词
- `kw.keyword.remove <关键词>` - 删除全局关键词
- `kw.keyword.list` - 列出所有全局关键词
- `kw.url.add <域名>` - 添加URL白名单
- `kw.url.remove <域名>` - 删除URL白名单
- `kw.url.list` - 列出所有URL白名单

#### 群组配置命令

- `kw.group.keywords` - 查看当前群组的关键词列表
- `kw.group.add-keyword <关键词>` - 添加群组特定关键词
- `kw.group.remove-keyword <关键词>` - 删除群组特定关键词
- `kw.group.set-message <提示信息>` - 设置群组特定提示信息
- `kw.group.enable` - 启用群组特定配置
- `kw.group.disable` - 禁用群组特定配置
- `kw.group.reset` - 重置群组特定配置
- `kw.group.import-preset <预设包名称>` - 导入预设关键词包到当前群组

#### 预设包命令

- `kw.preset.list` - 列出所有可用的预设包
- `kw.preset.view <名称>` - 查看指定预设包的内容
- `kw.preset.create <名称> <描述>` - 创建一个新的自定义预设包
- `kw.preset.add <名称> <关键词>` - 向指定预设包添加关键词
- `kw.preset.remove <名称> <关键词>` - 从指定预设包移除关键词
- `kw.preset.delete <名称>` - 删除指定的自定义预设包
- `kw.preset.import <名称>` - 将预设包导入到全局配置
- `kw.preset.export <名称>` - 导出预设包内容

### ⚙️ 配置项

#### 关键词检测设置

- `keywords`: 需要检测的关键词列表
- `useRegex`: 是否将关键词作为正则表达式处理
- `regexFlags`: 正则表达式标志

#### 关键词处理设置

- `recall`: 是否撤回包含关键词的消息
- `mute`: 是否禁言发送包含关键词消息的用户
- `muteDuration`: 关键词触发后的禁言时长（秒）
- `customMessage`: 检测到关键词后的提示消息

#### 网址检测设置

- `detectUrls`: 是否启用网址检测功能
- `urlWhitelist`: 网址白名单
- `urlAction`: 检测到非白名单网址后要执行的操作
- `urlMuteDuration`: 检测到网址后的禁言时长（秒）
- `urlCustomMessage`: 检测到非白名单网址后的提示消息

#### 自动处罚设置

- `enableAutoPunishment`: 是否启用自动处罚机制
- `secondViolationMuteDuration`: 第二次违规的禁言时长（秒）
- `maxViolationCount`: 最大违规次数
- `kickOnMaxViolation`: 达到最大违规次数时是否踢出用户
- `punishmentResetHours`: 处罚记录重置时间（小时）

#### 权限控制设置

- `allowUserSelfQuery`: 是否允许普通用户查询自己的警告记录

#### 群组配置设置

- `enableGroupSpecificConfig`: 是否启用"群组特定配置"功能
- `enabledGroups`: 指定哪些群组自动启用特定配置
- `defaultPresets`: 默认启用的预设关键词包
- `autoImportPresets`: 是否在群组启用特定配置时自动导入默认预设包

#### 预设包设置

- `showPresetContent`: 是否在命令中显示预设包的完整内容
- `allowCustomPresets`: 是否允许创建和管理自定义预设包

### 🆕 v0.0.8 更新内容

- 添加了预设包可视化功能，可以查看预设包中的所有关键词
- 支持创建、编辑和管理自定义预设包
- 添加了预设包导入功能，可以将预设包导入到指定群组
- 优化了预设包管理逻辑，提高了可靠性
- 改进了配置界面，添加了预设包相关设置

### 📝 使用示例

#### 添加关键词并查看列表

```
> kw.keyword.add 敏感词
已成功添加全局关键词: 敏感词

> kw.keyword.list
全局关键词列表 (1个):
敏感词
```

#### 配置群组特定关键词

```
> kw.group.enable
已成功启用群组特定配置。使用 kw.group.add-keyword 添加群组关键词。

> kw.group.add-keyword 群组敏感词
已成功添加群组关键词: 群组敏感词
当前群组共有 1 个关键词。

> kw.group.keywords
当前群组关键词列表 (1个):
群组敏感词
```

#### 使用预设包

```
> kw.preset.list
可用的预设包列表：

【系统预设包】
- politics：政治相关敏感词汇
- adult：成人内容相关敏感词汇
- gambling：赌博相关敏感词汇
- spam：垃圾信息相关敏感词汇
- scam：诈骗相关敏感词汇
- common：常见违禁词汇集合

> kw.preset.view common
预设包 "common" 的详细信息：
- 描述：常见违禁词汇集合
- 类型：系统预设
- 创建者：system
- 创建时间：2023/6/1 15:30:45
- 包含关键词数量：3

包含的关键词：
1. 常见违禁词1
2. 常见违禁词2
3. 常见违禁词3

> kw.group.import-preset common
成功将预设包 "common" 导入到当前群组，共添加 3 个新关键词。
```

#### 创建自定义预设包

```
> kw.preset.create mypack 我的自定义预设包
成功创建预设包 "mypack"。使用 kw.preset.add mypack <keyword> 添加关键词。

> kw.preset.add mypack 自定义敏感词1
成功将关键词 "自定义敏感词1" 添加到预设包 "mypack"。

> kw.preset.add mypack 自定义敏感词2
成功将关键词 "自定义敏感词2" 添加到预设包 "mypack"。

> kw.preset.view mypack
预设包 "mypack" 的详细信息：
- 描述：我的自定义预设包
- 类型：自定义预设
- 创建者：12345678
- 创建时间：2023/6/1 16:45:30
- 包含关键词数量：2

包含的关键词：
1. 自定义敏感词1
2. 自定义敏感词2
```

### �� 许可证

MIT License
