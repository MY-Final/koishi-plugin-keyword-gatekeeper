import { Context, Command } from 'koishi'
import { Config } from '../types'
import { KeywordDatabase } from '../database'

// 权限检查函数
async function checkPermission(session: any): Promise<boolean> {
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
    return user && user.authority > 2
  } catch (e) {
    // 如果获取失败，默认返回false
    return false
  }
}

/**
 * 注册群组相关命令
 * @param ctx Koishi上下文
 * @param config 插件配置
 * @param database 数据库实例
 * @param groupCmd 群组命令对象
 */
export function registerGroupCommands(ctx: Context, config: Config, database: KeywordDatabase, groupCmd: Command) {
  // 群组配置命令
  groupCmd.usage('管理群组特定的关键词配置')
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
      return `群组关键词配置命令:
- kwgroup keywords - 查看当前群组的关键词列表
- kwgroup addkw <关键词> - 添加群组特定关键词
- kwgroup removekw <关键词> - 删除群组特定关键词
- kwgroup setmsg <提示信息> - 设置群组特定提示信息
- kwgroup enable - 启用群组特定配置
- kwgroup disable - 禁用群组特定配置
- kwgroup reset - 重置群组特定配置
- kwgroup importpreset <预设包名称> - 导入预设关键词包
- kwgroup config - 设置惩罚规则
- kwgroup record [@用户] - 查看用户记录`
    })

  // 查看群组关键词列表
  groupCmd.subcommand('keywords', '查看群组关键词列表')
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
        return '当前群组未启用特定配置或未设置关键词。使用 kwgroup enable 启用群组特定配置。'
      }

      if (!groupConfig.keywords || groupConfig.keywords.length === 0) {
        return '当前群组未设置特定关键词。使用 kwgroup addkw <关键词> 添加关键词。'
      }

      return `当前群组关键词列表 (${groupConfig.keywords.length}个):\n${groupConfig.keywords.join('\n')}`
    })

  // 添加群组关键词
  groupCmd.subcommand('addkw <keyword:text>', '添加群组特定关键词')
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

  // 删除群组关键词
  groupCmd.subcommand('removekw <keyword:text>', '删除群组特定关键词')
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
        return '请提供要删除的关键词。'
      }

      // 获取群组配置
      const groupConfig = await database.getGroupConfig(session.guildId)

      // 如果配置不存在，返回错误
      if (!groupConfig) {
        return '当前群组未启用特定配置，请先使用 kwgroup enable 启用群组特定配置。'
      }

      // 删除关键词
      const trimmedKeyword = keyword.trim()
      const index = groupConfig.keywords.indexOf(trimmedKeyword)
      if (index === -1) {
        return `关键词 "${trimmedKeyword}" 不存在于群组配置中。`
      }

      groupConfig.keywords.splice(index, 1)
      await database.updateGroupConfig(session.guildId, { keywords: groupConfig.keywords })

      return `已成功删除群组关键词: ${trimmedKeyword}\n当前群组还有 ${groupConfig.keywords.length} 个关键词。`
    })

  // 设置群组提示信息
  groupCmd.subcommand('setmsg <message:text>', '设置群组特定提示信息')
    .action(async ({ session }, message) => {
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
      if (!message || message.trim() === '') {
        return '请提供要设置的提示信息。'
      }

      // 获取群组配置
      let groupConfig = await database.getGroupConfig(session.guildId)

      // 如果配置不存在，创建新的配置
      if (!groupConfig) {
        groupConfig = {
          guildId: session.guildId,
          enabled: true,
          keywords: [],
          customMessage: message.trim(),
          urlWhitelist: [],
          urlCustomMessage: config.urlCustomMessage
        }
        await database.createGroupConfig(groupConfig)
      } else {
        // 更新提示信息
        await database.updateGroupConfig(session.guildId, { customMessage: message.trim() })
      }

      return `已成功设置群组提示信息: ${message.trim()}`
    })

  // 启用群组特定配置
  groupCmd.subcommand('enable', '启用群组特定配置')
    .action(async ({ session }) => {
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

      // 获取当前配置
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

        // 如果配置了自动导入预设包并且有选择默认预设包
        if (config.autoImportPresets && config.defaultPresets && config.defaultPresets.length > 0) {
          let response = `已成功启用群组特定配置。\n`;
          let importResults = [];

          // 导入每个默认预设包
          for (const presetName of config.defaultPresets) {
            const preset = await database.getPresetPackage(presetName)
            if (preset) {
              // 合并关键词，避免重复
              const originalLength = groupConfig.keywords.length
              groupConfig.keywords = [...new Set([...groupConfig.keywords, ...preset.keywords])]
              const addedCount = groupConfig.keywords.length - originalLength

              importResults.push(`- "${presetName}": 成功添加 ${addedCount} 个关键词`)
            }
          }

          // 更新配置
          await database.updateGroupConfig(session.guildId, { keywords: groupConfig.keywords })

          if (importResults.length > 0) {
            response += `\n已自动导入以下预设包:\n${importResults.join('\n')}`;
            response += `\n\n使用 kwgroup keywords 查看已导入的关键词。`;
            return response;
          } else {
            return `已成功启用群组特定配置。使用 kwgroup addkw 添加群组关键词。`;
          }
        } else {
          return `已成功启用群组特定配置。使用 kwgroup addkw 添加群组关键词。`;
        }
      }

      // 如果配置已存在但被禁用，则启用它
      if (!groupConfig.enabled) {
        await database.updateGroupConfig(session.guildId, { enabled: true })
        return `已成功启用群组特定配置。`;
      }

      return '当前群组已启用特定配置。';
    })

  // 禁用群组特定配置
  groupCmd.subcommand('disable', '禁用群组特定配置')
    .action(async ({ session }) => {
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

      // 获取当前配置
      const groupConfig = await database.getGroupConfig(session.guildId)

      // 如果配置不存在，返回提示
      if (!groupConfig) {
        return '当前群组未设置特定配置。'
      }

      // 如果配置已存在且已启用，则禁用它
      if (groupConfig.enabled) {
        await database.updateGroupConfig(session.guildId, { enabled: false })
        return `已成功禁用群组特定配置，将使用全局配置。`
      }

      return '当前群组已禁用特定配置。'
    })

  // 重置群组特定配置
  groupCmd.subcommand('reset', '重置群组特定配置')
    .action(async ({ session }) => {
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

      // 删除群组配置
      await database.deleteGroupConfig(session.guildId)
      return `已成功重置群组特定配置，将使用全局配置。`
    })

  // 导入预设包到群组
  groupCmd.subcommand('importpreset <presetName:string>', '导入预设关键词包')
    .action(async ({ session }, presetName) => {
      // 检查是否在群聊中
      if (!session.guildId) {
        return '此命令只能在群聊中使用。'
      }

      // 检查权限
      if (!await checkPermission(session)) {
        return '权限不足，需要管理员权限才能导入预设包。'
      }

      // 检查是否启用了群组特定配置
      if (!config.enableGroupSpecificConfig) {
        return '未启用群组特定配置功能，请先在插件设置中开启"启用群组特定配置"选项。'
      }

      // 检查参数
      if (!presetName) {
        // 如果没有提供预设包名称，列出所有可用的预设包
        const presets = await database.getAllPresetPackages()
        if (!presets || presets.length === 0) {
          return '当前没有可用的预设包。'
        }

        let result = '可用的预设包列表：\n'
        presets.forEach(p => {
          result += `- ${p.name}：${p.description}\n`
        })
        result += '\n使用 kwgroup importpreset <预设包名称> 导入指定的预设包'
        return result
      }

      // 获取预设包
      const preset = await database.getPresetPackage(presetName)
      if (!preset) {
        return `找不到名为 "${presetName}" 的预设包。`
      }

      // 获取群组配置
      let groupConfig = await database.getGroupConfig(session.guildId)
      if (!groupConfig) {
        // 如果群组配置不存在，创建一个新的
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

      // 合并关键词，避免重复
      const originalKeywords = [...groupConfig.keywords]
      const newKeywords = [...new Set([...originalKeywords, ...preset.keywords])]
      await database.updateGroupConfig(session.guildId, { keywords: newKeywords })

      return `成功将预设包 "${presetName}" 导入到当前群组，共添加 ${newKeywords.length - originalKeywords.length} 个新关键词。`
    })

  // 从群组移除预设包
  groupCmd.subcommand('removepreset <presetName:string>', '删除预设关键词包')
    .action(async ({ session }, presetName) => {
      // 检查是否在群聊中
      if (!session.guildId) {
        return '此命令只能在群聊中使用。'
      }

      // 检查权限
      if (!await checkPermission(session)) {
        return '权限不足，需要管理员权限才能删除预设包。'
      }

      // 检查是否启用了群组特定配置
      if (!config.enableGroupSpecificConfig) {
        return '未启用群组特定配置功能，请先在插件设置中开启"启用群组特定配置"选项。'
      }

      // 检查参数
      if (!presetName) {
        // 如果没有提供预设包名称，列出所有可用的预设包
        const presets = await database.getAllPresetPackages()
        if (!presets || presets.length === 0) {
          return '当前没有可用的预设包。'
        }

        let result = '可用的预设包列表：\n'
        presets.forEach(p => {
          result += `- ${p.name}：${p.description}\n`
        })
        result += '\n使用 kwgroup removepreset <预设包名称> 删除指定的预设包中的关键词'
        return result
      }

      // 获取预设包
      const preset = await database.getPresetPackage(presetName)
      if (!preset) {
        return `找不到名为 "${presetName}" 的预设包。`
      }

      // 获取群组配置
      const groupConfig = await database.getGroupConfig(session.guildId)
      if (!groupConfig) {
        return '当前群组未启用特定配置，请先使用 kwgroup enable 启用群组特定配置。'
      }

      // 移除预设包中的关键词
      const originalKeywords = [...groupConfig.keywords]
      const newKeywords = originalKeywords.filter(keyword => !preset.keywords.includes(keyword))
      await database.updateGroupConfig(session.guildId, { keywords: newKeywords })

      return `成功从当前群组移除预设包 "${presetName}" 中的关键词，共删除 ${originalKeywords.length - newKeywords.length} 个关键词。`
    })

  // 设置惩罚规则
  groupCmd.subcommand('config', '设置惩罚规则')
    .action(async ({ session }) => {
      // 检查是否在群聊中
      if (!session.guildId) {
        return '此命令只能在群聊中使用。'
      }

      // 检查权限
      if (!await checkPermission(session)) {
        return '权限不足，需要管理员权限才能修改惩罚规则。'
      }

      // 显示当前惩罚规则
      return `当前惩罚规则配置：
- 第一次触发：警告
- 第二次触发：撤回消息
- 第三次触发：禁言 ${config.muteDuration || 300}秒
- 多次触发：踢出群聊

使用插件设置页面可以修改这些规则。`
    })

  // 查看用户记录
  groupCmd.subcommand('record [userId:string]', '查看用户违规记录')
    .action(async ({ session }, userId) => {
      // 检查是否在群聊中
      if (!session.guildId) {
        return '此命令只能在群聊中使用。'
      }

      // 获取目标用户ID
      const targetUserId = userId || session.userId

      // 如果查询他人记录，需要管理员权限
      if (targetUserId !== session.userId && !await checkPermission(session)) {
        return '权限不足，需要管理员权限才能查看其他用户的违规记录。'
      }

      // 由于当前数据库接口不支持直接查询用户警告记录，返回提示信息
      return `用户记录查询功能正在开发中，敬请期待。

目前您可以在插件设置页面查看所有用户的违规记录。`
    })
}
