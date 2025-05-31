import { Context, Schema } from 'koishi'
import { KeywordHandler } from './handlers/keyword-handler'
import { UrlHandler } from './handlers/url-handler'
import { WarningManager } from './handlers/warning-manager'
import { GroupConfigManager } from './handlers/group-config-manager'
import { Config as ConfigType, ConfigSchema, PresetPackage } from './types'
import { KeywordDatabase } from './database'
import { registerMessageHandler } from './handlers/message-handler'
import { Command } from 'koishi'

export const name = 'keyword-gatekeeper'

/**
 * 关键词守门员插件
 *
 * 高级关键词过滤与自动处罚系统，支持关键词和URL检测、多级处罚机制、数据库持久化
 *
 * 功能：
 * - 检测群聊中的关键词和URL，支持正则表达式和白名单
 * - 自动撤回、禁言或踢出违规用户，支持升级处罚机制
 * - 记录用户违规历史，持久化存储所有警告记录
 * - 查询和管理用户的警告记录，支持@用户操作
 * - 完整的历史记录查询，包括触发内容和处罚结果
 * - 每个群组可配置独立的关键词和提示信息
 */

// 导出配置模式
export type Config = ConfigType
export const Config: Schema<Config> = ConfigSchema

// 声明服务依赖
export const inject = ['database']

// 使用说明
export const usage = `## 🔰 插件说明
高级关键词守门员是一个功能全面的消息过滤与处罚系统，可以帮助群组管理员有效控制群内违规内容。

### 🌟 主要功能
- ✅ **关键词过滤**：自动检测群消息中的敏感词汇，支持正则表达式
- 🔗 **URL监控**：自动检测非白名单网址，防止垃圾链接和钓鱼网站
- 🚫 **多级处罚**：智能升级处罚等级，从警告到禁言再到踢出
- 📊 **记录系统**：持久化存储所有违规记录，重启不丢失数据
- 🔍 **查询功能**：支持查看完整历史记录，包含消息内容和处罚类型
- 👤 **艾特支持**：支持通过@用户执行查询和清零操作
- 🏠 **群组配置**：每个群组可以设置独立的关键词和提示信息
- 🔢 **多群管理**：支持通过群号列表预设启用特定群组的配置

### 📖 使用方法
1. 设置关键词列表，可选择启用正则表达式模式
2. 配置URL检测和白名单网址
3. 启用自动处罚机制，设置处罚升级规则
4. 使用相关命令管理用户的违规记录
5. 启用群组特定配置，为每个群设置独立的关键词
6. 如需预设启用特定群组的配置，可在"指定启用特定配置的群组ID列表"中添加群号

### 👨‍💻 命令列表
- \`kw\` - 主命令，显示帮助信息
- \`kw key add <关键词>\` - 添加全局关键词
- \`kw key remove <关键词>\` - 删除全局关键词
- \`kw key list\` - 查看全局关键词列表
- \`kw key clear\` - 清空全局关键词
- \`kw url add <域名>\` - 添加URL白名单
- \`kw url remove <域名>\` - 从白名单删除域名
- \`kw url list\` - 查看URL白名单
- \`kw warn my\` - 查询自己的警告记录
- \`kw warn myhistory\` - 查看自己的完整警告历史
- \`kw warn query @用户\` - 查询指定用户的警告记录
- \`kw preset list\` - 列出所有预设包
- \`kw preset view <名称>\` - 查看预设包内容
- \`kw group keywords\` - 查看当前群组的关键词列表`

// 权限检查函数
async function checkPermission(session: any, requireAdmin: boolean = false): Promise<boolean> {
  // 检查是否为管理员
  if (session.platform === 'onebot' || session.platform === 'qq') {
    const { userId, guildId } = session
    if (!guildId) return false

    try {
      const member = await session.bot.getGuildMember(guildId, userId)
      return member && (member.roles || []).some(role =>
        ['owner', 'admin', 'administrator'].includes(role.toLowerCase())
      )
    } catch (e) {
      return false
    }
  }

  // 默认情况下，使用koishi的权限系统
  try {
    // 尝试获取用户权限等级
    const user = await session.app.database.getUser(session.platform, session.userId)
    return user && (requireAdmin ? user.authority > 3 : user.authority > 2)
  } catch (e) {
    // 如果获取失败，默认返回false
    return false
  }
}

// 主函数
export function apply(ctx: Context, config: Config) {
  // 创建日志记录器
  const logger = ctx.logger('keyword-gatekeeper')
  logger.info('关键词守门员插件启动中...')

  // 初始化数据库
  const database = new KeywordDatabase(ctx)
  const warningManager = new WarningManager(ctx)

  // 初始化系统预设包
  initializePresetPackages(ctx, database).then(() => {
    logger.info('系统预设包初始化完成')
  }).catch(err => {
    logger.error(`系统预设包初始化失败: ${err.message}`)
  })

  // 创建根命令
  ctx.command('kw', '关键词守门员')
    .usage('关键词守门员插件，用于检测和处理群聊中的敏感关键词和非白名单URL')
    .action(async ({ session }) => {
      // 直接显示命令帮助
      return '关键词守门员插件，用于检测和处理群聊中的敏感关键词和非白名单URL。\n\n可用命令：\nkw key - 关键词管理\nkw url - URL白名单管理\nkw warn - 警告记录管理\nkw preset - 预设包管理\nkw group - 群组配置'
    })

  // 🔑 关键词管理命令
  ctx.command('kw.key', '全局关键词管理')
    .action(async ({ session }) => {
      // 检查权限
      if (!await checkPermission(session)) {
        return '权限不足，需要管理员权限才能使用关键词管理功能。'
      }

      return '关键词管理命令。\n\n可用的子命令有：\nkw key add <关键词> - 添加全局关键词\nkw key remove <关键词> - 删除全局关键词\nkw key list - 查看全局关键词列表\nkw key clear - 清空全局关键词'
    })

  // 添加关键词
  ctx.command('kw.key.add <keyword:text>', '添加全局关键词')
    .action(async ({ session }, keyword) => {
      // 检查权限
      if (!await checkPermission(session)) {
        return '权限不足，需要管理员权限才能添加全局关键词。'
      }

      // 检查参数
      if (!keyword || keyword.trim() === '') {
        return '请提供要添加的关键词。'
      }

      // 添加关键词
      const trimmedKeyword = keyword.trim()
      if (config.keywords.includes(trimmedKeyword)) {
        return `关键词 "${trimmedKeyword}" 已存在。`
      }

      config.keywords.push(trimmedKeyword)
      return `已成功添加全局关键词: ${trimmedKeyword}`
    })

  // 删除关键词
  ctx.command('kw.key.remove <keyword:text>', '删除全局关键词')
    .action(async ({ session }, keyword) => {
      // 检查权限
      if (!await checkPermission(session)) {
        return '权限不足，需要管理员权限才能删除全局关键词。'
      }

      // 检查参数
      if (!keyword || keyword.trim() === '') {
        return '请提供要删除的关键词。'
      }

      // 删除关键词
      const trimmedKeyword = keyword.trim()
      const index = config.keywords.indexOf(trimmedKeyword)
      if (index === -1) {
        return `关键词 "${trimmedKeyword}" 不存在。`
      }

      config.keywords.splice(index, 1)
      return `已成功删除全局关键词: ${trimmedKeyword}`
    })

  // 列出所有关键词
  ctx.command('kw.key.list', '列出所有全局关键词')
    .action(async ({ session }) => {
      // 检查权限
      if (!await checkPermission(session)) {
        return '权限不足，需要管理员权限才能查看全局关键词列表。'
      }

      if (!config.keywords || config.keywords.length === 0) {
        return '当前没有设置全局关键词。'
      }

      return `全局关键词列表 (${config.keywords.length}个):\n${config.keywords.join('\n')}`
    })

  // 清空所有关键词
  ctx.command('kw.key.clear', '清空所有全局关键词')
    .action(async ({ session }) => {
      // 检查权限
      if (!await checkPermission(session)) {
        return '权限不足，需要管理员权限才能清空全局关键词。'
      }

      if (!config.keywords || config.keywords.length === 0) {
        return '当前没有设置全局关键词。'
      }

      const count = config.keywords.length
      config.keywords = []
      return `已成功清空全局关键词，共删除了 ${count} 个关键词。`
    })

  // 🌐 URL白名单管理命令
  ctx.command('kw.url', 'URL白名单管理')
    .action(async ({ session }) => {
      // 检查权限
      if (!await checkPermission(session)) {
        return '权限不足，需要管理员权限才能使用URL白名单管理功能。'
      }

      return 'URL白名单管理命令。\n\n可用的子命令有：\nkw url add <域名> - 添加域名到白名单\nkw url remove <域名> - 从白名单中删除域名\nkw url list - 查看白名单列表'
    })

  // 添加URL白名单
  ctx.command('kw.url.add <domain:string>', '添加URL白名单')
    .action(async ({ session }, domain) => {
      // 检查权限
      if (!await checkPermission(session)) {
        return '权限不足，需要管理员权限才能添加URL白名单。'
      }

      // 检查参数
      if (!domain || domain.trim() === '') {
        return '请提供要添加的域名。'
      }

      // 添加域名
      const trimmedDomain = domain.trim()
      if (config.urlWhitelist.includes(trimmedDomain)) {
        return `域名 "${trimmedDomain}" 已在白名单中。`
      }

      config.urlWhitelist.push(trimmedDomain)
      return `已成功添加域名到白名单: ${trimmedDomain}`
    })

  // 删除URL白名单
  ctx.command('kw.url.remove <domain:string>', '从白名单中删除URL')
    .action(async ({ session }, domain) => {
      // 检查权限
      if (!await checkPermission(session)) {
        return '权限不足，需要管理员权限才能删除URL白名单。'
      }

      // 检查参数
      if (!domain || domain.trim() === '') {
        return '请提供要删除的域名。'
      }

      // 删除域名
      const trimmedDomain = domain.trim()
      const index = config.urlWhitelist.indexOf(trimmedDomain)
      if (index === -1) {
        return `域名 "${trimmedDomain}" 不在白名单中。`
      }

      config.urlWhitelist.splice(index, 1)
      return `已成功从白名单中删除域名: ${trimmedDomain}`
    })

  // 列出所有URL白名单
  ctx.command('kw.url.list', '列出所有URL白名单')
    .action(async ({ session }) => {
      // 检查权限
      if (!await checkPermission(session)) {
        return '权限不足，需要管理员权限才能查看URL白名单。'
      }

      if (!config.urlWhitelist || config.urlWhitelist.length === 0) {
        return '当前URL白名单为空。'
      }

      return `URL白名单列表 (${config.urlWhitelist.length}个):\n${config.urlWhitelist.join('\n')}`
    })

  // ⚠️ 警告管理命令
  ctx.command('kw.warn', '关键词警告记录相关命令')
    .action(async ({ session }) => {
      return '警告记录管理命令。\n\n可用的子命令有：\nkw warn my - 查询自己的警告记录\nkw warn myhistory - 查看自己的完整警告历史\nkw warn query <@用户> - 查询指定用户的警告记录\nkw warn history <@用户> - 查看指定用户的完整警告历史\nkw warn reset <@用户> - 清零指定用户的警告记录'
    })

  // 查询自己的警告记录
  ctx.command('kw.warn.my', '查询自己的警告记录')
    .action(async ({ session }) => {
      // 检查是否允许用户自查
      if (!config.allowUserSelfQuery) {
        return '管理员已禁用用户自查功能。'
      }

      // 检查是否在群聊中
      if (!session.guildId) {
        return '此命令只能在群聊中使用。'
      }

      // 查询记录
      try {
        const record = await warningManager.queryUserWarningRecord(session.userId, config, session.guildId)

        if (record.count === 0) {
          return '您当前没有警告记录。'
        }

        let response = `您当前的警告记录：\n违规次数：${record.count}\n重置时间：${record.resetTime}`

        // 如果有最近触发信息，添加到回复中
        if (record.lastTrigger) {
          response += `\n\n最近触发：\n时间：${record.lastTrigger.timeFormatted || new Date(record.lastTrigger.time).toLocaleString()}`
          response += `\n类型：${record.lastTrigger.type === 'keyword' ? '关键词' : 'URL'}`
          response += `\n内容：${record.lastTrigger.keyword}`
          response += `\n处理：${record.lastTrigger.action === 'warn' ? '警告' : record.lastTrigger.action === 'mute' ? '禁言' : '踢出'}`
        }

        return response
      } catch (error) {
        ctx.logger.error(`查询警告记录失败: ${error.message}`)
        return '查询警告记录时出错，请稍后再试。'
      }
    })

  // 查看自己的完整警告历史
  ctx.command('kw.warn.myhistory', '查看自己的完整警告历史')
    .action(async ({ session }) => {
      // 检查是否允许用户自查
      if (!config.allowUserSelfQuery) {
        return '管理员已禁用用户自查功能。'
      }

      // 检查是否在群聊中
      if (!session.guildId) {
        return '此命令只能在群聊中使用。'
      }

      // 查询记录
      try {
        const record = await warningManager.queryUserWarningRecord(session.userId, config, session.guildId)

        if (record.count === 0 || !record.history || record.history.length === 0) {
          return '您当前没有警告历史记录。'
        }

        let response = `您的完整警告历史记录 (共${record.history.length}条):\n`

        // 添加历史记录
        record.history.forEach((item, index) => {
          response += `${index + 1}. ${item.timeFormatted || new Date(item.time).toLocaleString()} - `
          response += `${item.type === 'keyword' ? '关键词' : 'URL'} "${item.keyword}" `
          response += `(${item.action === 'warn' ? '警告' : item.action === 'mute' ? '禁言' : '踢出'})\n`
          if (item.message) {
            response += `   消息内容: ${item.message.length > 50 ? item.message.substring(0, 50) + '...' : item.message}\n`
          }
        })

        return response
      } catch (error) {
        ctx.logger.error(`查询警告历史失败: ${error.message}`)
        return '查询警告历史时出错，请稍后再试。'
      }
    })

  // 查询指定用户的警告记录
  ctx.command('kw.warn.query <userId:string>', '查询指定用户的警告记录')
    .action(async ({ session }, userId) => {
      // 检查权限
      if (!await checkPermission(session)) {
        return '权限不足，需要管理员权限才能查询其他用户的警告记录。'
      }

      // 检查是否在群聊中
      if (!session.guildId) {
        return '此命令只能在群聊中使用。'
      }

      // 提取用户ID
      let targetUserId = userId
      if (userId && userId.startsWith('<at id="') && userId.endsWith('"/>')) {
        targetUserId = userId.substring(8, userId.length - 3)
      }

      if (!targetUserId) {
        return '请提供要查询的用户ID或@用户。'
      }

      // 查询记录
      try {
        const record = await warningManager.queryUserWarningRecord(targetUserId, config, session.guildId)

        if (record.count === 0) {
          return `用户 ${targetUserId} 当前没有警告记录。`
        }

        let response = `用户 ${targetUserId} 的警告记录：\n违规次数：${record.count}\n重置时间：${record.resetTime}`

        // 如果有最近触发信息，添加到回复中
        if (record.lastTrigger) {
          response += `\n\n最近触发：\n时间：${record.lastTrigger.timeFormatted || new Date(record.lastTrigger.time).toLocaleString()}`
          response += `\n类型：${record.lastTrigger.type === 'keyword' ? '关键词' : 'URL'}`
          response += `\n内容：${record.lastTrigger.keyword}`
          response += `\n处理：${record.lastTrigger.action === 'warn' ? '警告' : record.lastTrigger.action === 'mute' ? '禁言' : '踢出'}`
        }

        return response
    } catch (error) {
        ctx.logger.error(`查询警告记录失败: ${error.message}`)
        return '查询警告记录时出错，请稍后再试。'
      }
    })

  // 🧩 预设包管理命令
  ctx.command('kw.preset', '关键词预设包管理')
    .action(async ({ session }) => {
      // 检查权限
      if (!await checkPermission(session)) {
        return '权限不足，需要管理员权限才能使用预设包管理功能。'
      }

      return '预设包管理命令。\n\n可用的子命令有：\nkw preset list - 列出所有预设包\nkw preset view <名称> - 查看预设包内容\nkw preset create <名称> <描述> - 创建预设包\nkw preset import <名称> - 导入预设包\nkw preset delete <名称> - 删除预设包'
    })

  // 列出所有预设包
  ctx.command('kw.preset.list', '列出所有可用的预设包')
    .action(async ({ session }) => {
      // 检查权限
      if (!await checkPermission(session)) {
        return '权限不足，需要管理员权限才能查看预设包列表。'
      }

      // 获取所有预设包
      const presets = await database.getAllPresetPackages()
      if (!presets || presets.length === 0) {
        return '当前没有可用的预设包。'
      }

      // 按系统预设和自定义预设分组
      const systemPresets = presets.filter(p => p.isSystem)
      const userPresets = presets.filter(p => !p.isSystem)

      // 系统预设包的友好名称映射
      const friendlyNames = {
        'common': '常见违禁词汇',
        'gambling': '赌博相关词汇',
        'adult': '成人内容词汇',
        'politics': '政治敏感词汇',
        'scam': '网络诈骗词汇',
        'spam': '垃圾信息词汇',
        'illegal': '违禁物品词汇',
        'url-blacklist': '恶意网址词汇'
      }

      let result = '可用的预设包列表：\n\n【系统预设包】\n'
      systemPresets.forEach(p => {
        const friendlyName = friendlyNames[p.name] || p.name
        result += `- ${p.name} (${friendlyName})：${p.description}\n`
      })

      if (userPresets.length > 0) {
        result += '\n【自定义预设包】\n'
        userPresets.forEach(p => {
          result += `- ${p.name}：${p.description}\n`
        })
      }

      result += '\n使用方法：\n1. 使用 kw preset view <名称> 查看预设包内容\n2. 使用 kw preset import <名称> 导入预设包到当前群组'

      return result
    })

  // 查看预设包内容
  ctx.command('kw.preset.view <name:string>', '查看预设包内容')
    .action(async ({ session }, name) => {
      // 检查权限
      if (!await checkPermission(session)) {
        return '你没有权限查看预设包内容。'
      }

      if (!name) {
        return '请提供要查看的预设包名称。使用 kw preset list 查看所有预设包。'
      }

      // 查找预设包
      const presets = await database.getAllPresetPackages()

      // 尝试精确匹配和模糊匹配
      let preset = presets.find(p => p.name === name)

      // 如果找不到精确匹配，尝试模糊匹配（支持中文名称查询）
      if (!preset) {
        const nameMap = {
          '广告': 'common',
          '违禁词': 'common',
          '常见': 'common',
          '博彩': 'gambling',
          '赌博': 'gambling',
          '色情': 'adult',
          '成人': 'adult',
          '政治': 'politics',
          '敏感': 'politics',
          '诈骗': 'scam',
          '网络诈骗': 'scam',
          '垃圾': 'spam',
          '垃圾信息': 'spam',
          '违禁品': 'illegal',
          '非法': 'illegal',
          '网址': 'url-blacklist',
          '链接': 'url-blacklist'
        }

        // 从映射中查找
        for (const [key, value] of Object.entries(nameMap)) {
          if (name.includes(key)) {
            preset = presets.find(p => p.name === value)
            if (preset) break
          }
        }
      }

      if (!preset) {
        return `找不到名为"${name}"的预设包。使用 kw preset list 查看所有预设包。`
      }

      // 如果配置不允许显示预设包内容
      if (!config.showPresetContent && !await checkPermission(session, true)) {
        return `预设包"${preset.name}"：${preset.description}\n\n管理员已禁用预设包内容查看功能。`
      }

      // 显示预设包内容
      let result = `预设包"${preset.name}"：${preset.description}\n\n包含 ${preset.keywords.length} 个关键词：\n`

      // 分批显示关键词，避免消息过长
      for (let i = 0; i < preset.keywords.length; i += 10) {
        const batch = preset.keywords.slice(i, i + 10).join('、')
        result += batch + '\n'
      }

      if (preset.isSystem) {
        result += '\n这是系统预设包，可以直接导入使用。'
      } else {
        result += `\n这是由 ${preset.createdBy} 创建的自定义预设包。`
      }

      return result
    })

  // 导入预设包
  ctx.command('kw.preset.import <name:string>', '导入预设包到当前群组')
    .action(async ({ session }, name) => {
      // 检查权限
      if (!await checkPermission(session)) {
        return '你没有权限导入预设包。'
      }

      // 检查是否在群聊中
      if (!session.guildId) {
        return '此命令只能在群聊中使用。'
      }

      // 检查是否启用了群组特定配置
      if (!config.enableGroupSpecificConfig) {
        return '未启用群组特定配置功能，请先在插件设置中开启"启用群组特定配置"选项。'
      }

      if (!name) {
        return '请提供要导入的预设包名称。使用 kw preset list 查看所有预设包。'
      }

      // 查找预设包
      const presets = await database.getAllPresetPackages()

      // 尝试精确匹配和模糊匹配
      let preset = presets.find(p => p.name === name)

      // 如果找不到精确匹配，尝试模糊匹配（支持中文名称查询）
      if (!preset) {
        const nameMap = {
          '广告': 'common',
          '违禁词': 'common',
          '常见': 'common',
          '博彩': 'gambling',
          '赌博': 'gambling',
          '色情': 'adult',
          '成人': 'adult',
          '政治': 'politics',
          '敏感': 'politics',
          '诈骗': 'scam',
          '网络诈骗': 'scam',
          '垃圾': 'spam',
          '垃圾信息': 'spam',
          '违禁品': 'illegal',
          '非法': 'illegal',
          '网址': 'url-blacklist',
          '链接': 'url-blacklist'
        }

        // 从映射中查找
        for (const [key, value] of Object.entries(nameMap)) {
          if (name.includes(key)) {
            preset = presets.find(p => p.name === value)
            if (preset) break
          }
        }
      }

      if (!preset) {
        return `找不到名为"${name}"的预设包。使用 kw preset list 查看所有预设包。`
      }

      // 获取群组配置
      let groupConfig = await database.getGroupConfig(session.guildId)

      // 如果配置不存在，创建新的配置
      if (!groupConfig) {
        groupConfig = {
          guildId: session.guildId,
          enabled: true,
          keywords: [],
          customMessage: config.customMessage,
          urlWhitelist: [],
          urlCustomMessage: config.urlCustomMessage
        }
        await database.createGroupConfig(groupConfig)
      }

      // 导入关键词，避免重复
      let importCount = 0
      for (const keyword of preset.keywords) {
        if (!groupConfig.keywords.includes(keyword)) {
          groupConfig.keywords.push(keyword)
          importCount++
        }
      }

      // 更新群组配置
      await database.updateGroupConfig(session.guildId, { keywords: groupConfig.keywords })

      return `已成功导入预设包"${preset.name}"，添加了 ${importCount} 个新关键词到当前群组。`
    })

  // 创建预设包
  ctx.command('kw.preset.create <name:string> [description:text]', '创建自定义预设包')
    .action(async ({ session }, name, description) => {
      // 检查权限
      if (!await checkPermission(session)) {
        return '你没有权限创建预设包。'
      }

      // 检查是否允许创建自定义预设包
      if (!config.allowCustomPresets) {
        return '管理员已禁用自定义预设包功能。'
      }

      if (!name) {
        return '请提供要创建的预设包名称。'
      }

      // 检查名称是否已存在
      const existingPresets = await database.getAllPresetPackages()
      if (existingPresets.some(p => p.name === name)) {
        return `预设包"${name}"已存在，请使用其他名称。`
      }

      // 创建预设包
      const newPreset: PresetPackage = {
        name,
        description: description || `用户创建的预设包: ${name}`,
        keywords: [],
        isSystem: false,
        createdBy: session.userId || 'unknown',
        createdAt: new Date().getTime()
      }

      await database.createPresetPackage(newPreset)

      return `预设包"${name}"创建成功。使用 kw preset addkw ${name} <关键词> 添加关键词。`
    })

  // 添加关键词到预设包
  ctx.command('kw.preset.addkw <name:string> <keyword:text>', '添加关键词到预设包')
    .action(async ({ session }, name, keyword) => {
      // 检查权限
      if (!await checkPermission(session)) {
        return '你没有权限修改预设包。'
      }

      if (!name) {
        return '请提供预设包名称。'
      }

      if (!keyword || keyword.trim() === '') {
        return '请提供要添加的关键词。'
      }

      // 查找预设包
      const preset = await database.getPresetPackage(name)
      if (!preset) {
        return `找不到名为"${name}"的预设包。使用 kw preset list 查看所有预设包。`
      }

      // 不允许修改系统预设包
      if (preset.isSystem) {
        return `"${name}"是系统预设包，不能修改。`
      }

      // 检查是否是创建者或管理员
      if (preset.createdBy !== session.userId && !await checkPermission(session, true)) {
        return '你没有权限修改其他用户创建的预设包。'
      }

      // 添加关键词
      const trimmedKeyword = keyword.trim()
      if (preset.keywords.includes(trimmedKeyword)) {
        return `关键词"${trimmedKeyword}"已存在于预设包"${name}"中。`
      }

      preset.keywords.push(trimmedKeyword)
      await database.updatePresetPackage(preset.id, { keywords: preset.keywords })

      return `已成功添加关键词"${trimmedKeyword}"到预设包"${name}"。当前预设包包含 ${preset.keywords.length} 个关键词。`
    })

  // 删除预设包
  ctx.command('kw.preset.delete <name:string>', '删除自定义预设包')
    .action(async ({ session }, name) => {
      // 检查权限
      if (!await checkPermission(session)) {
        return '你没有权限删除预设包。'
      }

      if (!name) {
        return '请提供要删除的预设包名称。'
      }

      // 查找预设包
      const presets = await database.getAllPresetPackages()
      const preset = presets.find(p => p.name === name)

      if (!preset) {
        return `找不到名为"${name}"的预设包。`
      }

      // 不允许删除系统预设包
      if (preset.isSystem) {
        return `"${name}"是系统预设包，不能删除。`
      }

      // 检查是否是创建者或管理员
      if (preset.createdBy !== session.userId && !await checkPermission(session, true)) {
        return '你没有权限删除其他用户创建的预设包。'
      }

      // 删除预设包
      await database.deletePresetPackage(preset.id)

      return `预设包"${name}"已成功删除。`
    })

  // 👥 群组配置命令
  ctx.command('kw.group', '群组关键词配置')
    .action(async ({ session }) => {
      // 检查权限
      if (!await checkPermission(session)) {
        return '权限不足，需要管理员权限才能使用群组配置功能。'
      }

      // 检查是否在群聊中
      if (!session.guildId) {
        return '此命令只能在群聊中使用。'
      }

      // 检查是否启用了群组特定配置
      if (!config.enableGroupSpecificConfig) {
        return '未启用群组特定配置功能，请先在插件设置中开启"启用群组特定配置"选项。'
      }

      // 显示使用帮助
      return '群组关键词配置命令。\n\n可用的子命令有：\nkw group keywords - 查看当前群组的关键词列表\nkw group addkw <关键词> - 添加群组特定关键词\nkw group removekw <关键词> - 删除群组特定关键词\nkw group importpreset <预设包名称> - 导入预设关键词包'
    })

  // 查看群组关键词列表
  ctx.command('kw.group.keywords', '查看群组关键词列表')
    .action(async ({ session }) => {
      // 检查是否在群聊中
      if (!session.guildId) {
        return '此命令只能在群聊中使用。'
      }

      // 检查是否启用了群组特定配置
      if (!config.enableGroupSpecificConfig) {
        return '未启用群组特定配置功能，请先在插件设置中开启"启用群组特定配置"选项。'
      }

      // 获取群组配置
      const groupConfig = await database.getGroupConfig(session.guildId)

      if (!groupConfig || !groupConfig.enabled) {
        return '当前群组未启用特定配置或未设置关键词。使用 kw group enable 启用群组特定配置。'
      }

      if (!groupConfig.keywords || groupConfig.keywords.length === 0) {
        return '当前群组未设置特定关键词。使用 kw group addkw <关键词> 添加关键词。'
      }

      return `当前群组关键词列表 (${groupConfig.keywords.length}个):\n${groupConfig.keywords.join('\n')}`
    })

  // 添加群组关键词
  ctx.command('kw.group.addkw <keyword:text>', '添加群组特定关键词')
    .action(async ({ session }, keyword) => {
      // 检查是否在群聊中
      if (!session.guildId) {
        return '此命令只能在群聊中使用。'
      }

      // 检查权限
      if (!await checkPermission(session)) {
        return '权限不足，需要管理员权限才能修改群组配置。'
      }

      // 检查是否启用了群组特定配置
      if (!config.enableGroupSpecificConfig) {
        return '未启用群组特定配置功能，请先在插件设置中开启"启用群组特定配置"选项。'
      }

      // 检查参数
      if (!keyword || keyword.trim() === '') {
        return '请提供要添加的关键词。'
      }

      // 获取群组配置
      let groupConfig = await database.getGroupConfig(session.guildId)

      // 如果配置不存在，创建新的配置
      if (!groupConfig) {
        groupConfig = {
          guildId: session.guildId,
          enabled: true,
          keywords: [],
          customMessage: config.customMessage,
          urlWhitelist: [],
          urlCustomMessage: config.urlCustomMessage
        }
        await database.createGroupConfig(groupConfig)
      }

      // 添加关键词
      const trimmedKeyword = keyword.trim()
      if (groupConfig.keywords.includes(trimmedKeyword)) {
        return `关键词 "${trimmedKeyword}" 已存在于群组配置中。`
      }

      groupConfig.keywords.push(trimmedKeyword)
      await database.updateGroupConfig(session.guildId, { keywords: groupConfig.keywords })

      return `已成功添加群组关键词: ${trimmedKeyword}\n当前群组共有 ${groupConfig.keywords.length} 个关键词。`
    })

  // 注册消息处理器
  registerMessageHandler(ctx, config, database)

  // 输出初始化完成日志
  logger.info('关键词守门员插件初始化完成')
}

// 初始化系统预设包
async function initializePresetPackages(ctx: Context, database: KeywordDatabase) {
  const logger = ctx.logger('keyword-gatekeeper')

  // 检查是否已存在系统预设包
  const existingPresets = await database.getAllPresetPackages()
  const systemPresets = existingPresets.filter(p => p.isSystem)

  // 如果已存在系统预设包，不进行内容更新，保留用户可能添加的内容
  if (systemPresets.length > 0) {
    logger.info(`检测到${systemPresets.length}个系统预设包，将保留用户添加的内容`)
  }

  // 定义系统预设包
  const presetPackages: PresetPackage[] = [
    {
      id: null,  // 数据库会自动生成
      name: 'common',  // 与config.defaultPresets匹配
      description: '常见违禁词汇集合',
      keywords: [
        '微信号', '加微信', '加我微信',
        '联系方式', '私聊我', '私我',
        '推广', '代理', '招代理',
        '赚钱', '月入', '日入',
        '兼职', '全职', '招聘',
        '免费领', '免费送', '免费获取',
        '低价', '特价', '优惠',
        '限时', '秒杀', '独家',
        '暴利', '爆款', '热销',
        '私发', '私聊获取', '加我领取'
      ],
      isSystem: true,
      createdBy: 'system',
      createdAt: new Date().getTime()
    },
    {
      id: null,
      name: 'gambling', // 与config.defaultPresets匹配
      description: '赌博相关敏感词汇',
      keywords: [
        '博彩', '赌博', '赌场',
        '赌钱', '压分', '押注',
        '下注', '投注', '彩票',
        '六合彩', '时时彩', '北京赛车',
        '百家乐', '龙虎斗', '牛牛',
        '扑克', '德州', '梭哈',
        '轮盘', '老虎机', '开奖',
        '中奖', '奖金', '返水',
        '返利', '洗码', '筹码'
      ],
      isSystem: true,
      createdBy: 'system',
      createdAt: new Date().getTime()
    },
    {
      id: null,
      name: 'adult', // 与config.defaultPresets匹配
      description: '成人内容相关敏感词汇',
      keywords: [
        '约炮', '一夜情', '援交',
        '上门服务', '小姐服务', '特殊服务',
        '小妹上门', '全套', '包夜',
        '楼凤', '兼职妹', '兼职女',
        '色情', '情色', 'AV',
        '裸聊', '裸体', '做爱',
        '卖淫', '嫖娼', '妓女',
        '3P', 'SM', '性虐'
      ],
      isSystem: true,
      createdBy: 'system',
      createdAt: new Date().getTime()
    },
    {
      id: null,
      name: 'politics', // 与config.defaultPresets匹配
      description: '政治敏感和不适宜讨论的关键词',
      keywords: [
        '政变', '革命', '颠覆',
        '暴动', '暴乱', '游行',
        '示威', '抗议', '集会',
        '境外势力', '外国势力', '境外资金',
        '政府倒台', '政权更替', '军事政变',
        '政治避难', '政治迫害', '政治庇护',
        '国家分裂', '分裂国家', '民族分裂',
        '中国特色社会主义道路', '社会主义核心价值观', '四个自信',
        '习近平', '毛泽东', '邓小平', '江泽民', '胡锦涛', '李克强', '温家宝', '习大大',
        '总书记', '国家主席', '中央领导', '政治局', '常委', '中南海',
        '党中央', '中央全会', '十九大', '二十大', '四中全会', '五中全会',
        '一党制', '多党制', '民主化', '自由化', '西化',
        '独立运动', '文革', '六四', '学潮', '平反',
        '政治改革', '制度改革', '宪政', '三权分立', '言论自由',
        '人权问题', '人权报告', '言论审查', '新闻自由', '网络审查',
        '法轮功', '西藏问题', '台独', '港独', '疆独'
      ],
      isSystem: true,
      createdBy: 'system',
      createdAt: new Date().getTime()
    },
    {
      id: null,
      name: 'scam', // 与config.defaultPresets匹配
      description: '常见网络诈骗相关关键词',
      keywords: [
        '刷单', '兼职刷单', '刷信誉',
        '刷好评', '日结工资', '无押金',
        '无需押金', '零投资', '零门槛',
        '高收入', '轻松赚', '躺赚',
        '稳赚不赔', '保本', '回本',
        '投资项目', '资金盘', '理财产品',
        '虚拟币', '虚拟货币', '区块链投资',
        '电话诈骗', '短信诈骗', '网络诈骗',
        '冒充公检法', '冒充客服', '退款诈骗'
      ],
      isSystem: true,
      createdBy: 'system',
      createdAt: new Date().getTime()
    },
    {
      id: null,
      name: 'spam', // 与config.defaultPresets匹配
      description: '垃圾信息相关敏感词汇',
      keywords: [
        '垃圾链接', '垃圾广告', '垃圾推广',
        '群发消息', '批量添加', '批量加群',
        '批量私信', '批量推送', '骚扰电话',
        '骚扰短信', '推销电话', '营销短信',
        '营销广告', '营销信息', '营销推广',
        '强制推广', '强制广告', '批量营销'
      ],
      isSystem: true,
      createdBy: 'system',
      createdAt: new Date().getTime()
    },
    {
      id: null,
      name: 'illegal', // 额外添加的违禁品类别
      description: '违禁物品和非法商品关键词',
      keywords: [
        '枪', '手枪', '步枪',
        '气枪', '猎枪', '军火',
        '子弹', '弹药', '炸药',
        '雷管', '管制刀具', '电击器',
        '假证', '假身份证', '假驾照',
        '办证', '办假证', '代办证件',
        '证件办理', '身份证办理', '驾照办理'
      ],
      isSystem: true,
      createdBy: 'system',
      createdAt: new Date().getTime()
    },
    {
      id: null,
      name: 'url-blacklist', // 恶意网址类型
      description: '常见恶意网址和链接关键词',
      keywords: [
        '.vip', '.top', '.xyz',
        '.cc', '.cn.com', '.shop',
        'bit.ly', 'goo.gl', 'tinyurl.com',
        't.cn', 'dwz.cn', 'suo.im',
        'u.nu', 'w.url.cn', 'tb.cn'
      ],
      isSystem: true,
      createdBy: 'system',
      createdAt: new Date().getTime()
    }
  ];

  // 存储预设包到数据库，如果已存在则保留用户内容，不覆盖
  for (const preset of presetPackages) {
    try {
      const existingPreset = await database.getPresetPackage(preset.name);
      if (existingPreset) {
        // 系统预设包已存在，不更新内容，保留用户可能添加的内容
        logger.debug(`保留系统预设包用户内容: ${preset.name}`);
      } else {
        // 创建新的预设包
        await database.createPresetPackage(preset);
        logger.info(`已创建系统预设包: ${preset.name}`);
      }
    } catch (error) {
      logger.error(`处理系统预设包 ${preset.name} 失败: ${error.message}`);
    }
  }
}
