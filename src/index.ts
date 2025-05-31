import { Context } from 'koishi'
import { KeywordHandler } from './handlers/keyword-handler'
import { UrlHandler } from './handlers/url-handler'
import { WarningManager } from './handlers/warning-manager'
import { GroupConfigManager } from './handlers/group-config-manager'
import { Config as PluginConfig, ConfigSchema } from './types'

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
export const Config = ConfigSchema

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

### 📖 使用方法
1. 设置关键词列表，可选择启用正则表达式模式
2. 配置URL检测和白名单网址
3. 启用自动处罚机制，设置处罚升级规则
4. 使用相关命令管理用户的违规记录
5. 启用群组特定配置，为每个群设置独立的关键词

### 👨‍💻 命令列表
- \`kw.warning.my\` - 查询自己的警告记录
- \`kw.warning.my-history\` - 查看自己的完整警告历史
- \`kw.warning.query @用户\` - 查询指定用户的警告记录（管理员）
- \`kw.warning.history @用户\` - 查看指定用户的完整警告历史（管理员）
- \`kw.warning.reset @用户\` - 清零指定用户的警告记录（管理员）
- \`kw.warning.list\` - 列出所有有警告记录的用户（管理员）
- \`kw.warning.debug\` - 查看所有警告记录的详细信息（管理员）
- \`kw.warning.sync\` - 强制同步所有警告记录（管理员）
- \`kw.warning.clear-all\` - 清空所有警告记录（超级管理员）
- \`kw.group.keywords\` - 查看当前群组的关键词列表（管理员）
- \`kw.group.add-keyword 关键词\` - 添加群组特定关键词（管理员）
- \`kw.group.remove-keyword 关键词\` - 删除群组特定关键词（管理员）
- \`kw.group.set-message 提示信息\` - 设置群组特定提示信息（管理员）
- \`kw.group.enable\` - 启用群组特定配置（管理员）
- \`kw.group.disable\` - 禁用群组特定配置（管理员）
- \`kw.group.reset\` - 重置群组特定配置（管理员）
- \`kw.group.preset <presetName:string>\` - 导入预设关键词包（管理员）
- \`kw.group.remove-preset <presetName:string>\` - 删除预设关键词包（管理员）`

// 主函数
export function apply(ctx: Context, options: PluginConfig) {
  // 创建处理器实例
  const keywordHandler = new KeywordHandler(ctx)
  const urlHandler = new UrlHandler(ctx)
  const warningManager = new WarningManager(ctx)
  const groupConfigManager = new GroupConfigManager(ctx)

  // 注册中间件
  ctx.middleware(async (meta, next) => {
    // 只处理群聊消息
    if (!meta.guildId) return next()

    try {
      // 获取消息内容
      const content = meta.content || ''

      // 检查是否为命令 - 仅基于内容检查，避免类型错误
      const isCommand = content.startsWith('kw') ||
                         content.startsWith('kw.') ||
                         content.startsWith('/kw') ||
                         content.startsWith('.kw')

      // 如果是命令，跳过关键词和网址检测
      if (isCommand) {
        ctx.logger.debug(`[${meta.guildId}] 跳过命令检测: ${content}`)
        return next()
      }

      // 获取合并后的配置（全局 + 群组特定）
      const mergedConfig = await groupConfigManager.getMergedConfig(meta.guildId, options)
      ctx.logger.debug(`[${meta.guildId}] 使用${mergedConfig === options ? '全局' : '群组特定'}配置进行检测`)

      // 处理关键词检测
      const keywordResult = await keywordHandler.handleKeywordDetection(meta, mergedConfig)

      // 如果关键词检测已经处理了消息，则跳过网址检测
      if (keywordResult) return next()

      // 处理网址检测
      await urlHandler.handleUrlDetection(meta, mergedConfig)
    } catch (error) {
      ctx.logger.error(`[${meta.guildId}] 处理异常: ${error.message}`)
    }

    return next()
  }, true)

  // 注册查询警告记录命令
  ctx.command('kw.warning', '关键词警告记录相关命令')
    .usage('查询或管理关键词警告记录')
    .alias('kw warning')

  // 注册群组配置命令
  ctx.command('kw.group', '群组关键词配置命令')
    .usage('管理群组特定的关键词配置')
    .alias('kw group')
    .userFields(['authority'])
    .channelFields(['id'])
    .action(async ({ session }) => {
      // 检查是否在群聊中
      if (!session.guildId) {
        return '此命令只能在群聊中使用。'
      }

      // 检查是否启用了群组特定配置
      if (!options.enableGroupSpecificConfig) {
        return '未启用群组特定配置功能，请先在插件设置中开启"启用群组特定配置"选项。'
      }

      // 显示使用帮助
      return `群组关键词配置命令:
- kw.group.keywords - 查看当前群组的关键词列表
- kw.group.add-keyword <关键词> - 添加群组特定关键词
- kw.group.remove-keyword <关键词> - 删除群组特定关键词
- kw.group.set-message <提示信息> - 设置群组特定提示信息
- kw.group.enable - 启用群组特定配置
- kw.group.disable - 禁用群组特定配置
- kw.group.reset - 重置群组特定配置
- kw.group.preset <presetName:string> - 导入预设关键词包
- kw.group.remove-preset <presetName:string> - 删除预设关键词包`
    })

  // 查看群组关键词列表
  ctx.command('kw.group.keywords', '查看群组关键词列表')
    .alias('kw group keywords')
    .userFields(['authority'])
    .channelFields(['id'])
    .action(async ({ session }) => {
      // 检查是否在群聊中
      if (!session.guildId) {
        return '此命令只能在群聊中使用。'
      }

      // 检查是否启用了群组特定配置
      if (!options.enableGroupSpecificConfig) {
        return '未启用群组特定配置功能，请先在插件设置中开启"启用群组特定配置"选项。'
      }

      // 获取群组配置
      const groupConfig = await groupConfigManager.getGroupConfig(session.guildId)

      if (!groupConfig || !groupConfig.enabled) {
        return '当前群组未启用特定配置或未设置关键词。使用 kw.group.enable 启用群组特定配置。'
      }

      if (!groupConfig.keywords || groupConfig.keywords.length === 0) {
        return '当前群组未设置特定关键词。使用 kw.group.add-keyword <关键词> 添加关键词。'
      }

      return `当前群组关键词列表 (${groupConfig.keywords.length}个):\n${groupConfig.keywords.join('\n')}`
    })

  // 添加群组关键词
  ctx.command('kw.group.add-keyword <keyword:text>', '添加群组特定关键词')
    .alias('kw group add-keyword <keyword:text>')
    .userFields(['authority'])
    .channelFields(['id'])
    .action(async ({ session }, keyword) => {
      // 检查是否在群聊中
      if (!session.guildId) {
        return '此命令只能在群聊中使用。'
      }

      // 检查权限
      if (session.user?.authority < 2) {
        return '权限不足，需要管理员权限才能修改群组配置。'
      }

      // 检查是否启用了群组特定配置
      if (!options.enableGroupSpecificConfig) {
        return '未启用群组特定配置功能，请先在插件设置中开启"启用群组特定配置"选项。'
      }

      // 检查参数
      if (!keyword || keyword.trim() === '') {
        return '请提供要添加的关键词。'
      }

      // 添加关键词
      const success = await groupConfigManager.addKeyword(
        session.guildId,
        keyword.trim(),
        session.userId
      )

      if (success) {
        // 获取更新后的配置
        const groupConfig = await groupConfigManager.getGroupConfig(session.guildId)
        return `已成功添加群组关键词: ${keyword.trim()}\n当前群组共有 ${groupConfig.keywords.length} 个关键词。`
      } else {
        return `添加关键词失败，可能该关键词已存在。`
      }
    })

  // 删除群组关键词
  ctx.command('kw.group.remove-keyword <keyword:text>', '删除群组特定关键词')
    .alias('kw group remove-keyword <keyword:text>')
    .userFields(['authority'])
    .channelFields(['id'])
    .action(async ({ session }, keyword) => {
      // 检查是否在群聊中
      if (!session.guildId) {
        return '此命令只能在群聊中使用。'
      }

      // 检查权限
      if (session.user?.authority < 2) {
        return '权限不足，需要管理员权限才能修改群组配置。'
      }

      // 检查是否启用了群组特定配置
      if (!options.enableGroupSpecificConfig) {
        return '未启用群组特定配置功能，请先在插件设置中开启"启用群组特定配置"选项。'
      }

      // 检查参数
      if (!keyword || keyword.trim() === '') {
        return '请提供要删除的关键词。'
      }

      // 删除关键词
      const success = await groupConfigManager.removeKeyword(
        session.guildId,
        keyword.trim(),
        session.userId
      )

      if (success) {
        // 获取更新后的配置
        const groupConfig = await groupConfigManager.getGroupConfig(session.guildId)
        return `已成功删除群组关键词: ${keyword.trim()}\n当前群组还有 ${groupConfig.keywords.length} 个关键词。`
      } else {
        return `删除关键词失败，可能该关键词不存在。`
      }
    })

  // 设置群组提示信息
  ctx.command('kw.group.set-message <message:text>', '设置群组特定提示信息')
    .alias('kw group set-message <message:text>')
    .userFields(['authority'])
    .channelFields(['id'])
    .action(async ({ session }, message) => {
      // 检查是否在群聊中
      if (!session.guildId) {
        return '此命令只能在群聊中使用。'
      }

      // 检查权限
      if (session.user?.authority < 2) {
        return '权限不足，需要管理员权限才能修改群组配置。'
      }

      // 检查是否启用了群组特定配置
      if (!options.enableGroupSpecificConfig) {
        return '未启用群组特定配置功能，请先在插件设置中开启"启用群组特定配置"选项。'
      }

      // 检查参数
      if (!message || message.trim() === '') {
        return '请提供要设置的提示信息。'
      }

      // 更新提示信息
      const success = await groupConfigManager.updateCustomMessage(
        session.guildId,
        message.trim(),
        session.userId
      )

      if (success) {
        return `已成功设置群组提示信息: ${message.trim()}`
      } else {
        return `设置提示信息失败。`
      }
    })

  // 启用群组特定配置
  ctx.command('kw.group.enable', '启用群组特定配置')
    .alias('kw group enable')
    .userFields(['authority'])
    .channelFields(['id'])
    .action(async ({ session }) => {
      // 检查是否在群聊中
      if (!session.guildId) {
        return '此命令只能在群聊中使用。'
      }

      // 检查权限
      if (session.user?.authority < 2) {
        return '权限不足，需要管理员权限才能修改群组配置。'
      }

      // 检查是否启用了群组特定配置
      if (!options.enableGroupSpecificConfig) {
        return '未启用群组特定配置功能，请先在插件设置中开启"启用群组特定配置"选项。'
      }

      // 获取当前配置
      let groupConfig = await groupConfigManager.getGroupConfig(session.guildId)

      // 如果配置不存在，创建新的配置
      if (!groupConfig) {
        const success = await groupConfigManager.updateGroupConfig(
          session.guildId,
          {
            guildId: session.guildId,
            enabled: true,
            keywords: [],
            customMessage: '',
            urlWhitelist: [],
            urlCustomMessage: ''
          },
          session.userId
        )

        if (success) {
          return `已成功启用群组特定配置。使用 kw.group.add-keyword 添加群组关键词。`
        } else {
          return `启用群组特定配置失败。`
        }
      }

      // 如果配置已存在但被禁用，则启用它
      if (!groupConfig.enabled) {
        const success = await groupConfigManager.updateGroupConfig(
          session.guildId,
          { enabled: true },
          session.userId
        )

        if (success) {
          return `已成功启用群组特定配置。`
        } else {
          return `启用群组特定配置失败。`
        }
      }

      return '当前群组已启用特定配置。'
    })

  // 导入预设关键词包
  ctx.command('kw.group.preset <presetName:string>', '导入预设关键词包')
    .alias('kw group preset <presetName:string>')
    .userFields(['authority'])
    .channelFields(['id', 'guildId'])
    .action(async ({ session }, presetName) => {
      // 检查是否在群聊中
      if (!session?.channel?.guildId) {
        return '此命令只能在群聊中使用。'
      }

      // 检查权限
      if (session.user?.authority < 2) {
        return '权限不足，需要管理员权限才能导入预设关键词包。'
      }

      // 检查是否启用了群组特定配置
      if (!options.enableGroupSpecificConfig) {
        return '未启用群组特定配置功能，请先在插件设置中开启"启用群组特定配置"选项。'
      }

      const guildId = session.channel.guildId
      const userId = session.userId

      // 如果没有指定预设包名称，显示可用的预设包列表
      if (!presetName) {
        const presets = groupConfigManager.getAvailablePresets()
        const descriptions = groupConfigManager.getPresetDescriptions()

        let response = '可用的预设关键词包：\n'
        presets.forEach(preset => {
          response += `- ${preset}: ${descriptions[preset]}\n`
        })

        response += '\n使用方法：kw.group.preset <预设包名称> 导入指定的预设包'
        return response
      }

      // 导入预设包
      const result = await groupConfigManager.importPresetKeywords(guildId, presetName, userId)

      // 如果预设包不存在
      if (result.total === 0) {
        const presets = groupConfigManager.getAvailablePresets()
        return `预设包 "${presetName}" 不存在。可用的预设包：${presets.join(', ')}`
      }

      // 导入结果
      let response = `预设关键词包 "${presetName}" 导入结果：\n总计：${result.total} 个关键词\n`

      if (result.success.length > 0) {
        response += `✅ 成功添加：${result.success.length} 个\n`
        // 如果成功添加的关键词超过5个，只显示前5个
        if (result.success.length > 5) {
          response += result.success.slice(0, 5).map(k => `- ${k}`).join('\n')
          response += `\n... 等共 ${result.success.length} 个关键词`
        } else {
          response += result.success.map(k => `- ${k}`).join('\n')
        }
      }

      if (result.duplicates.length > 0) {
        response += `\n\n⚠️ 已存在（跳过）：${result.duplicates.length} 个\n`
        // 如果重复的关键词超过5个，只显示前5个
        if (result.duplicates.length > 5) {
          response += result.duplicates.slice(0, 5).map(k => `- ${k}`).join('\n')
          response += `\n... 等共 ${result.duplicates.length} 个关键词`
        } else {
          response += result.duplicates.map(k => `- ${k}`).join('\n')
        }
      }

      return response
    })

  // 删除预设关键词包
  ctx.command('kw.group.remove-preset <presetName:string>', '删除预设关键词包')
    .alias('kw group remove-preset <presetName:string>')
    .userFields(['authority'])
    .channelFields(['id', 'guildId'])
    .action(async ({ session }, presetName) => {
      // 检查是否在群聊中
      if (!session?.channel?.guildId) {
        return '此命令只能在群聊中使用。'
      }

      // 检查权限
      if (session.user?.authority < 2) {
        return '权限不足，需要管理员权限才能删除预设关键词包。'
      }

      // 检查是否启用了群组特定配置
      if (!options.enableGroupSpecificConfig) {
        return '未启用群组特定配置功能，请先在插件设置中开启"启用群组特定配置"选项。'
      }

      const guildId = session.channel.guildId
      const userId = session.userId

      // 如果没有指定预设包名称，显示可用的预设包列表
      if (!presetName) {
        const presets = groupConfigManager.getAvailablePresets()
        const descriptions = groupConfigManager.getPresetDescriptions()

        let response = '可用的预设关键词包：\n'
        presets.forEach(preset => {
          response += `- ${preset}: ${descriptions[preset]}\n`
        })

        response += '\n使用方法：kw.group.remove-preset <预设包名称> 删除指定的预设包中的关键词'
        return response
      }

      // 删除预设包中的关键词
      const result = await groupConfigManager.removePresetKeywords(guildId, presetName, userId)

      // 如果预设包不存在
      if (result.total === 0) {
        const presets = groupConfigManager.getAvailablePresets()
        return `预设包 "${presetName}" 不存在。可用的预设包：${presets.join(', ')}`
      }

      // 删除结果
      let response = `预设关键词包 "${presetName}" 删除结果：\n总计：${result.total} 个关键词\n`

      if (result.success.length > 0) {
        response += `✅ 成功删除：${result.success.length} 个\n`
        // 如果成功删除的关键词超过5个，只显示前5个
        if (result.success.length > 5) {
          response += result.success.slice(0, 5).map(k => `- ${k}`).join('\n')
          response += `\n... 等共 ${result.success.length} 个关键词`
        } else {
          response += result.success.map(k => `- ${k}`).join('\n')
        }
      }

      if (result.notFound.length > 0) {
        response += `\n\n⚠️ 未找到（跳过）：${result.notFound.length} 个\n`
        // 如果未找到的关键词超过5个，只显示前5个
        if (result.notFound.length > 5) {
          response += result.notFound.slice(0, 5).map(k => `- ${k}`).join('\n')
          response += `\n... 等共 ${result.notFound.length} 个关键词`
        } else {
          response += result.notFound.map(k => `- ${k}`).join('\n')
        }
      }

      return response
    })

  // 禁用群组特定配置
  ctx.command('kw.group.disable', '禁用群组特定配置')
    .alias('kw group disable')
    .userFields(['authority'])
    .channelFields(['id'])
    .action(async ({ session }) => {
      // 检查是否在群聊中
      if (!session.guildId) {
        return '此命令只能在群聊中使用。'
      }

      // 检查权限
      if (session.user?.authority < 2) {
        return '权限不足，需要管理员权限才能修改群组配置。'
      }

      // 检查是否启用了群组特定配置
      if (!options.enableGroupSpecificConfig) {
        return '未启用群组特定配置功能，请先在插件设置中开启"启用群组特定配置"选项。'
      }

      // 获取当前配置
      const groupConfig = await groupConfigManager.getGroupConfig(session.guildId)

      // 如果配置不存在，返回提示
      if (!groupConfig) {
        return '当前群组未设置特定配置。'
      }

      // 如果配置已存在且已启用，则禁用它
      if (groupConfig.enabled) {
        const success = await groupConfigManager.updateGroupConfig(
          session.guildId,
          { enabled: false },
          session.userId
        )

        if (success) {
          return `已成功禁用群组特定配置，将使用全局配置。`
        } else {
          return `禁用群组特定配置失败。`
        }
      }

      return '当前群组已禁用特定配置。'
    })

  // 重置群组特定配置
  ctx.command('kw.group.reset', '重置群组特定配置')
    .alias('kw group reset')
    .userFields(['authority'])
    .channelFields(['id'])
    .action(async ({ session }) => {
      // 检查是否在群聊中
      if (!session.guildId) {
        return '此命令只能在群聊中使用。'
      }

      // 检查权限
      if (session.user?.authority < 2) {
        return '权限不足，需要管理员权限才能修改群组配置。'
      }

      // 检查是否启用了群组特定配置
      if (!options.enableGroupSpecificConfig) {
        return '未启用群组特定配置功能，请先在插件设置中开启"启用群组特定配置"选项。'
      }

      // 删除群组配置
      const success = await groupConfigManager.deleteGroupConfig(session.guildId)

      if (success) {
        return `已成功重置群组特定配置，将使用全局配置。`
      } else {
        return `重置群组特定配置失败。`
      }
    })

  // 查询自己的警告记录
  ctx.command('kw.warning.my', '查询自己的警告记录')
    .alias('kw warning my')
    .userFields(['authority'])
    .action(async ({ session }) => {
      const userId = session.userId
      const guildId = session.guildId
      ctx.logger.debug(`[${guildId}] 用户 ${userId} 查询自己的警告记录`)

      if (!options.enableAutoPunishment) {
        return '自动处罚机制未启用，无法查询警告记录。'
      }

      // 检查是否允许普通用户查询自己的记录
      if (!options.allowUserSelfQuery && session.user?.authority < 2) {
        return '当前设置不允许普通用户查询警告记录，请联系管理员。'
      }

      const result = await warningManager.queryUserWarningRecord(userId, options, guildId)
      ctx.logger.debug(`[${guildId}] 查询结果: ${JSON.stringify(result)}`)

      if (result.count === 0) {
        return '您当前没有警告记录。'
      } else {
        let response = `您当前的警告次数为: ${result.count}次，将在${result.resetTime}自动重置。`

        // 添加最近触发信息
        if (result.lastTrigger) {
          const triggerType = result.lastTrigger.type === 'url' ? '网址' : '关键词';
          // 使用格式化的时间，如果有的话
          const triggerTime = result.lastTrigger.timeFormatted || new Date(result.lastTrigger.time).toLocaleString();

          response += `\n最近一次触发: ${triggerType} "${result.lastTrigger.keyword}"`
          response += `\n触发时间: ${triggerTime}`
          response += `\n执行处罚: ${result.lastTrigger.action === 'warn' ? '警告' :
                                    result.lastTrigger.action === 'mute' ? '禁言' : '踢出'}`

          if (result.lastTrigger.message) {
            response += `\n触发消息: ${result.lastTrigger.message}`
          }
        }

        // 添加历史记录摘要
        if (result.history && result.history.length > 1) { // 如果有多于1条的历史记录
          response += `\n\n历史触发记录 (最近${Math.min(result.history.length - 1, 2)}条):`

          // 显示除了最新一条外的最近2条记录
          const recentHistory = result.history.slice(-3, -1);

          recentHistory.forEach((record, index) => {
            // 使用格式化的时间，如果有的话
            const recordTime = record.timeFormatted || new Date(record.time).toLocaleString();
            const recordType = record.type === 'url' ? '网址' : '关键词';
            const action = record.action === 'warn' ? '警告' :
                          record.action === 'mute' ? '禁言' : '踢出';

            response += `\n${index + 1}. ${recordTime} - ${recordType} "${record.keyword}" (${action})`
          });
        }

        // 如果历史记录超过2条，添加查看完整历史的提示
        if (result.history.length > 3) {
          response += `\n\n使用 kw.warning.my-history 查看您的完整历史记录`;
        }

        return response;
      }
    })

  // 查询指定用户的警告记录（需要管理员权限）
  ctx.command('kw.warning.query [userId:string]', '查询指定用户的警告记录')
    .alias('kw warning query [userId:string]')
    .userFields(['authority'])
    .action(async ({ session }, userId) => {
      // 尝试从消息中提取@的用户ID
      const atMatch = session.content.match(/<at id="([^"]+)"\/>/);
      const targetUserId = atMatch ? atMatch[1] : userId;

      ctx.logger.debug(`[${session.guildId}] 用户 ${session.userId} 查询用户 ${targetUserId} 的警告记录`)

      // 检查权限
      if (session.user?.authority < 2) {
        return '权限不足，需要管理员权限才能查询其他用户的警告记录。'
      }

      if (!options.enableAutoPunishment) {
        return '自动处罚机制未启用，无法查询警告记录。'
      }

      if (!targetUserId) {
        return '请提供要查询的用户ID或@要查询的用户。'
      }

      const guildId = session.guildId
      const result = await warningManager.queryUserWarningRecord(targetUserId, options, guildId)
      ctx.logger.debug(`[${guildId}] 查询结果: ${JSON.stringify(result)}`)

      if (result.count === 0) {
        return `用户 ${targetUserId} 当前没有警告记录。`
      } else {
        let response = `用户 ${targetUserId} 当前的警告次数为: ${result.count}次，将在${result.resetTime}自动重置。`

        // 添加最近触发信息
        if (result.lastTrigger) {
          const triggerType = result.lastTrigger.type === 'url' ? '网址' : '关键词';
          // 使用格式化的时间，如果有的话
          const triggerTime = result.lastTrigger.timeFormatted || new Date(result.lastTrigger.time).toLocaleString();

          response += `\n最近一次触发: ${triggerType} "${result.lastTrigger.keyword}"`
          response += `\n触发时间: ${triggerTime}`
          response += `\n执行处罚: ${result.lastTrigger.action === 'warn' ? '警告' :
                                    result.lastTrigger.action === 'mute' ? '禁言' : '踢出'}`

          if (result.lastTrigger.message) {
            response += `\n触发消息: ${result.lastTrigger.message}`
          }
        }

        // 添加历史记录摘要
        if (result.history && result.history.length > 0) {
          response += `\n\n历史触发记录 (最近${Math.min(result.history.length, 3)}条):`

          // 只显示最近3条记录
          const recentHistory = result.history.slice(-3);

          recentHistory.forEach((record, index) => {
            // 使用格式化的时间，如果有的话
            const recordTime = record.timeFormatted || new Date(record.time).toLocaleString();
            const recordType = record.type === 'url' ? '网址' : '关键词';
            const action = record.action === 'warn' ? '警告' :
                          record.action === 'mute' ? '禁言' : '踢出';

            response += `\n${index + 1}. ${recordTime} - ${recordType} "${record.keyword}" (${action})`
          });

          // 如果历史记录超过3条，添加查看完整历史的提示
          if (result.history.length > 3) {
            response += `\n\n使用 kw.warning.history ${targetUserId} 查看完整历史记录`;
          }
        }

        return response;
      }
    })

  // 清零指定用户的警告记录（需要管理员权限）
  ctx.command('kw.warning.reset [userId:string]', '清零指定用户的警告记录')
    .alias('kw warning reset [userId:string]')
    .userFields(['authority'])
    .action(async ({ session }, userId) => {
      // 尝试从消息中提取@的用户ID
      const atMatch = session.content.match(/<at id="([^"]+)"\/>/);
      const targetUserId = atMatch ? atMatch[1] : userId;

      ctx.logger.debug(`[${session.guildId}] 用户 ${session.userId} 尝试清零用户 ${targetUserId} 的警告记录`)

      // 检查权限
      if (session.user?.authority < 2) {
        return '权限不足，需要管理员权限才能清零警告记录。'
      }

      if (!options.enableAutoPunishment) {
        return '自动处罚机制未启用，无法清零警告记录。'
      }

      if (!targetUserId) {
        return '请提供要清零警告记录的用户ID或@要清零记录的用户。'
      }

      const guildId = session.guildId
      ctx.logger.debug(`[${guildId}] 清零用户 ${targetUserId} 的警告记录`)

      try {
        const success = await warningManager.resetUserWarningRecord(targetUserId, guildId)
        ctx.logger.debug(`[${guildId}] 清零结果: ${success ? '成功' : '失败'}`)

        if (success) {
          return `已成功清零用户 ${targetUserId} 的警告记录。`
        } else {
          return `用户 ${targetUserId} 没有警告记录，无需清零。`
        }
      } catch (error) {
        ctx.logger.error(`[${guildId}] 清零记录失败: ${error.message}`)
        return '清零记录时发生错误，请查看日志。'
      }
    })

  // 查看所有有警告记录的用户（需要管理员权限）
  ctx.command('kw.warning.list', '列出所有有警告记录的用户')
    .alias('kw warning list')
    .userFields(['authority'])
    .action(async ({ session }) => {
      ctx.logger.debug(`[${session.guildId}] 用户 ${session.userId} 查询所有警告记录`)

      // 检查权限
      if (session.user?.authority < 2) {
        return '权限不足，需要管理员权限才能查看所有警告记录。'
      }

      if (!options.enableAutoPunishment) {
        return '自动处罚机制未启用，无法查看警告记录。'
      }

      const guildId = session.guildId
      ctx.logger.debug(`[${guildId}] 查询所有警告记录`)

      // 打印所有记录，帮助调试
      ctx.logger.debug(`[${guildId}] 当前所有警告记录:`)
      try {
        // 传入配置参数，确保使用正确的过期时间
        const userIds = await warningManager.getAllWarnedUserIds(guildId, options)
        ctx.logger.debug(`[${guildId}] 找到 ${userIds.length} 条记录`)

        if (userIds.length === 0) {
          // 提供更详细的帮助信息
          return `当前群组 (${guildId}) 没有用户有警告记录。\n\n可能的原因：
1. 群内未触发过关键词/URL检测
2. 记录已被重置或超过时间自动清零
3. 插件配置中未启用自动处罚机制\n
如需查看更详细的记录状态，请使用命令 kw.warning.debug`
        }

        let message = '当前群组有警告记录的用户：\n'
        for (const userId of userIds) {
          const result = await warningManager.queryUserWarningRecord(userId, options, guildId)
          let userLine = `用户 ${userId}: ${result.count}次警告，${result.resetTime}重置`;

          // 添加最近触发信息摘要
          if (result.lastTrigger) {
            const triggerType = result.lastTrigger.type === 'url' ? '网址' : '关键词';
            userLine += ` (最近: ${triggerType} "${result.lastTrigger.keyword}")`;
          }

          message += userLine + '\n';
        }

        return message.trim()
      } catch (error) {
        ctx.logger.error(`[${guildId}] 查询记录失败: ${error.message}`)
        return '查询记录时发生错误，请查看日志。'
      }
    })

  // 添加调试命令，查看所有警告记录（需要管理员权限）
  ctx.command('kw.warning.debug', '查看所有警告记录（调试用）')
    .alias('kw warning debug')
    .userFields(['authority'])
    .action(async ({ session }) => {
      // 检查权限
      if (session.user?.authority < 2) {
        return '权限不足，需要管理员权限才能使用调试命令。'
      }

      try {
        // 获取所有记录的调试信息
        const debugInfo = await warningManager.getDebugInfo()
        ctx.logger.debug(`[${session.guildId}] 用户 ${session.userId} 查看调试信息`)
        ctx.logger.debug(debugInfo)

        return debugInfo
      } catch (error) {
        ctx.logger.error(`[${session.guildId}] 获取调试信息失败: ${error.message}`)
        return '获取调试信息时发生错误，请查看日志。'
      }
    })

  // 添加强制同步命令，用于修复记录不一致的问题
  ctx.command('kw.warning.sync', '强制同步所有警告记录')
    .alias('kw warning sync')
    .userFields(['authority'])
    .action(async ({ session }) => {
      // 检查权限
      if (session.user?.authority < 2) {
        return '权限不足，需要管理员权限才能使用同步命令。'
      }

      ctx.logger.debug(`[${session.guildId}] 用户 ${session.userId} 请求同步警告记录`)

      // 获取所有记录
      const syncResult = await warningManager.syncAllRecords(options)

      return `警告记录同步完成，共处理了 ${syncResult.total} 条记录，其中保留 ${syncResult.kept} 条，重置 ${syncResult.reset} 条。`
    })

  // 添加清空所有警告记录的命令
  ctx.command('kw.warning.clear-all', '清空所有警告记录')
    .alias('kw warning clear-all')
    .userFields(['authority'])
    .action(async ({ session }) => {
      // 检查权限
      if (session.user?.authority < 3) {
        return '权限不足，需要超级管理员权限才能清空所有警告记录。'
      }

      ctx.logger.debug(`[${session.guildId}] 用户 ${session.userId} 请求清空所有警告记录`)

      try {
        // 先查询当前有多少条记录
        const recordCount = await warningManager.getRecordCount()

        // 然后执行清空操作
        await ctx.database.remove('keyword_warnings', {})

        // 清空内存缓存
        if (warningManager && warningManager['punishmentRecords']) {
          warningManager['punishmentRecords'].clear()
        }

        ctx.logger.debug(`已清理 ${recordCount} 条警告记录`)
        return `已清理 ${recordCount} 条警告记录`
      } catch (error) {
        ctx.logger.error(`[${session.guildId}] 清空记录失败: ${error.message}`)
        return '清空记录时发生错误，请查看日志。'
      }
    })

  // 添加查看完整历史记录的命令（需要管理员权限）
  ctx.command('kw.warning.history <userId:string>', '查看指定用户的完整警告历史')
    .alias('kw warning history <userId:string>')
    .userFields(['authority'])
    .action(async ({ session }, userId) => {
      // 尝试从消息中提取@的用户ID
      const atMatch = session.content.match(/<at id="([^"]+)"\/>/);
      const targetUserId = atMatch ? atMatch[1] : userId;

      ctx.logger.debug(`[${session.guildId}] 用户 ${session.userId} 查询用户 ${targetUserId} 的完整警告历史`)

      // 检查权限
      if (session.user?.authority < 2) {
        return '权限不足，需要管理员权限才能查询历史记录。'
      }

      if (!options.enableAutoPunishment) {
        return '自动处罚机制未启用，无法查询警告记录。'
      }

      if (!targetUserId) {
        return '请提供要查询的用户ID或@要查询的用户。'
      }

      const guildId = session.guildId
      const result = await warningManager.queryUserWarningRecord(targetUserId, options, guildId)

      if (result.count === 0) {
        return `用户 ${targetUserId} 当前没有警告记录。`
      } else if (!result.history || result.history.length === 0) {
        return `用户 ${targetUserId} 没有历史警告记录。`
      } else {
        let response = `用户 ${targetUserId} 的完整警告历史记录 (共${result.history.length}条):\n`

        // 显示所有历史记录
        result.history.forEach((record, index) => {
          const recordTime = record.timeFormatted || new Date(record.time).toLocaleString();
          const recordType = record.type === 'url' ? '网址' : '关键词';
          const action = record.action === 'warn' ? '警告' :
                        record.action === 'mute' ? '禁言' : '踢出';

          response += `\n${index + 1}. ${recordTime} - ${recordType} "${record.keyword}" (${action})`
          // 如果有消息内容，则显示
          if (record.message) {
            response += `\n   消息内容: ${record.message}`
          }
        });

        return response;
      }
    })

  // 添加查看自己完整历史记录的命令
  ctx.command('kw.warning.my-history', '查看自己的完整警告历史')
    .alias('kw warning my-history')
    .userFields(['authority'])
    .action(async ({ session }) => {
      const userId = session.userId
      const guildId = session.guildId
      ctx.logger.debug(`[${guildId}] 用户 ${userId} 查询自己的完整警告历史`)

      if (!options.enableAutoPunishment) {
        return '自动处罚机制未启用，无法查询警告记录。'
      }

      // 检查是否允许普通用户查询自己的记录
      if (!options.allowUserSelfQuery && session.user?.authority < 2) {
        return '当前设置不允许普通用户查询警告记录，请联系管理员。'
      }

      const result = await warningManager.queryUserWarningRecord(userId, options, guildId)

      if (result.count === 0) {
        return '您当前没有警告记录。'
      } else if (!result.history || result.history.length === 0) {
        return '您没有历史警告记录。'
      } else {
        let response = `您的完整警告历史记录 (共${result.history.length}条):\n`

        // 显示所有历史记录
        result.history.forEach((record, index) => {
          const recordTime = record.timeFormatted || new Date(record.time).toLocaleString();
          const recordType = record.type === 'url' ? '网址' : '关键词';
          const action = record.action === 'warn' ? '警告' :
                        record.action === 'mute' ? '禁言' : '踢出';

          response += `\n${index + 1}. ${recordTime} - ${recordType} "${record.keyword}" (${action})`
          // 如果有消息内容，则显示
          if (record.message) {
            response += `\n   消息内容: ${record.message}`
          }
        });

        // 如果历史记录超过2条，添加查看完整历史的提示
        if (result.history.length > 3) {
          response += `\n\n使用 kw.warning.my-history 查看您的完整历史记录`;
        }

        return response;
      }
    })

  // 注册使用页
  // 此部分在一些环境中可能不兼容，暂时注释掉
  /*
  ctx.schema.extend('keyword-gatekeeper', {
    debug: {
      type: 'boolean',
      title: '调试模式',
      description: '开启后会在控制台显示更多调试信息',
      default: false,
      component: 'el-switch',
    },
    debugAction: {
      type: 'action',
      title: '清理警告记录',
      description: '清理当前内存中所有的警告记录',
      onClick: () => {
        ctx.logger.info('用户通过界面点击清理警告记录')

        // 获取警告管理器实例
        let cleared = 0

        // 直接访问并清理
        if (warningManager && warningManager['punishmentRecords']) {
          const records = warningManager['punishmentRecords']

          ctx.logger.info(`开始清理警告记录，当前共有 ${records.size} 条记录`)

          records.forEach((record, key) => {
            record.count = 0
            record.lastTriggerTime = 0
            cleared++
          })

          ctx.logger.info(`已清理 ${cleared} 条警告记录`)
          return `已清理 ${cleared} 条警告记录`
        }

        return '警告记录清理失败，请检查日志'
      }
    }
  })
  */
}
