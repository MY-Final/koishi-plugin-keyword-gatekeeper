import { Context, Command } from 'koishi'
import { Config } from '../types'
import { WarningManager } from '../handlers/warning-manager'

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

/**
 * 注册警告相关命令
 * @param ctx Koishi上下文
 * @param config 插件配置
 * @param warningCmd 警告主命令
 */
export function registerWarningCommands(ctx: Context, config: Config, warningCmd: Command) {
  // 创建警告管理器
  const warningManager = new WarningManager(ctx)

  // 查询自己的警告记录
  warningCmd.subcommand('my', '查询自己的警告记录')
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
  warningCmd.subcommand('myhistory', '查看自己的完整警告历史')
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
  warningCmd.subcommand('query <userId:string>', '查询指定用户的警告记录')
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

  // 查看指定用户的完整警告历史
  warningCmd.subcommand('history <userId:string>', '查看指定用户的完整警告历史')
    .action(async ({ session }, userId) => {
      // 检查权限
      if (!await checkPermission(session)) {
        return '权限不足，需要管理员权限才能查看其他用户的警告历史。'
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

        if (record.count === 0 || !record.history || record.history.length === 0) {
          return `用户 ${targetUserId} 当前没有警告历史记录。`
        }

        let response = `用户 ${targetUserId} 的完整警告历史记录 (共${record.history.length}条):\n`

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

  // 清零指定用户的警告记录
  warningCmd.subcommand('reset <userId:string>', '清零指定用户的警告记录')
    .action(async ({ session }, userId) => {
      // 检查权限
      if (!await checkPermission(session)) {
        return '权限不足，需要管理员权限才能清零用户的警告记录。'
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
        return '请提供要清零警告记录的用户ID或@用户。'
      }

      // 清零记录
      try {
        const success = await warningManager.resetUserWarningRecord(targetUserId, session.guildId)

        if (success) {
          return `已成功清零用户 ${targetUserId} 的警告记录。`
        } else {
          return `用户 ${targetUserId} 当前没有警告记录，无需清零。`
        }
      } catch (error) {
        ctx.logger.error(`清零警告记录失败: ${error.message}`)
        return '清零警告记录时出错，请稍后再试。'
      }
    })

  // 列出所有有警告记录的用户
  warningCmd.subcommand('list', '列出所有有警告记录的用户')
    .action(async ({ session }) => {
      // 检查权限
      if (!await checkPermission(session)) {
        return '权限不足，需要管理员权限才能查看所有用户的警告记录。'
      }

      // 检查是否在群聊中
      if (!session.guildId) {
        return '此命令只能在群聊中使用。'
      }

      // 获取所有有警告记录的用户
      try {
        const userIds = await warningManager.getAllWarnedUserIds(session.guildId, config)

        if (userIds.length === 0) {
          return '当前没有用户有警告记录。'
        }

        let response = `当前有警告记录的用户 (共${userIds.length}人):\n`

        // 添加用户列表
        for (let i = 0; i < userIds.length; i++) {
          const userId = userIds[i]
          const record = await warningManager.queryUserWarningRecord(userId, config, session.guildId)
          response += `${i + 1}. 用户 ${userId} - 违规次数: ${record.count}, 重置时间: ${record.resetTime}\n`
        }

        return response
      } catch (error) {
        ctx.logger.error(`列出警告记录失败: ${error.message}`)
        return '列出警告记录时出错，请稍后再试。'
      }
    })

  // 查看所有警告记录的详细信息
  warningCmd.subcommand('debug', '查看所有警告记录的详细信息')
    .action(async ({ session }) => {
      // 检查权限
      if (!await checkPermission(session)) {
        return '权限不足，需要管理员权限才能查看调试信息。'
      }

      // 获取调试信息
      try {
        const debugInfo = await warningManager.getDebugInfo()
        return debugInfo
      } catch (error) {
        ctx.logger.error(`获取调试信息失败: ${error.message}`)
        return '获取调试信息时出错，请稍后再试。'
      }
    })

  // 强制同步所有警告记录
  warningCmd.subcommand('sync', '强制同步所有警告记录')
    .action(async ({ session }) => {
      // 检查权限
      if (!await checkPermission(session)) {
        return '权限不足，需要管理员权限才能同步警告记录。'
      }

      // 同步记录
      try {
        const result = await warningManager.syncAllRecords(config)
        return `同步完成: 总共 ${result.total} 条记录, 保留 ${result.kept} 条, 重置 ${result.reset} 条`
      } catch (error) {
        ctx.logger.error(`同步警告记录失败: ${error.message}`)
        return '同步警告记录时出错，请稍后再试。'
      }
    })

  // 清空所有警告记录
  const clearAllCmd = warningCmd.subcommand('clearall', '清空所有警告记录')
    .action(async ({ session }) => {
      // 检查权限
      if (!await checkPermission(session, true)) {
        return '权限不足，需要超级管理员权限才能清空所有警告记录。'
      }

      // 提示确认
      return '此操作将清空所有用户的警告记录，且无法恢复。请使用 `kwwarn clearall confirm` 确认操作。'
    })

  // 确认清空所有警告记录
  clearAllCmd.subcommand('confirm', '确认清空所有警告记录')
    .action(async ({ session }) => {
      // 检查权限
      if (!await checkPermission(session, true)) {
        return '权限不足，需要超级管理员权限才能清空所有警告记录。'
      }

      // 清空记录
      try {
        // 获取所有记录
        const records = await ctx.database.get('keyword_warnings', {})

        // 清空每条记录
        for (const record of records) {
          await ctx.database.set('keyword_warnings', {
            id: record.id
          }, {
            count: 0,
            lastTriggerTime: 0
          })
        }

        return `已成功清空所有警告记录，共清空 ${records.length} 条记录。`
      } catch (error) {
        ctx.logger.error(`清空警告记录失败: ${error.message}`)
        return '清空警告记录时出错，请稍后再试。'
      }
    })
}
