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

  // 创建根命令
  ctx.command('kw', '关键词守门员')
    .usage('关键词守门员插件，用于检测和处理群聊中的敏感关键词和非白名单URL')
    .action(async ({ session }) => {
      // 直接显示命令帮助
      return '关键词守门员插件，用于检测和处理群聊中的敏感关键词和非白名单URL。\n\n可用命令：\nkw key - 关键词管理\nkw url - URL白名单管理\nkw warn - 警告记录管理\nkw preset - 预设包管理\nkw group - 群组配置'
    })

  // 🔑 关键词管理命令
  ctx.command('kw.key', '全局关键词管理')
    .action(({ session }) => {
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
    .action(({ session }) => {
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
    .action(({ session }) => {
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
    .action(({ session }) => {
      return '预设包管理命令。\n\n可用的子命令有：\nkw preset list - 列出所有预设包\nkw preset view <名称> - 查看预设包内容\nkw preset create <名称> <描述> - 创建预设包\nkw preset import <名称> - 导入预设包\nkw preset delete <名称> - 删除预设包'
    })

  // 列出所有预设包
  ctx.command('kw.preset.list', '列出所有可用的预设包')
    .action(async ({ session }) => {
      // 检查权限
      if (!await checkPermission(session)) {
        return '你没有权限查看预设包列表。'
      }

      // 获取所有预设包
      const presets = await database.getAllPresetPackages()
      if (!presets || presets.length === 0) {
        return '当前没有可用的预设包。'
      }

      // 按系统预设和自定义预设分组
      const systemPresets = presets.filter(p => p.isSystem)
      const userPresets = presets.filter(p => !p.isSystem)

      let result = '可用的预设包列表：\n\n【系统预设包】\n'
      systemPresets.forEach(p => {
        result += `- ${p.name}：${p.description}\n`
      })

      if (userPresets.length > 0) {
        result += '\n【自定义预设包】\n'
        userPresets.forEach(p => {
          result += `- ${p.name}：${p.description}\n`
        })
      }

      return result
    })

  // 👥 群组配置命令
  ctx.command('kw.group', '群组关键词配置')
    .action(async ({ session }) => {
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
