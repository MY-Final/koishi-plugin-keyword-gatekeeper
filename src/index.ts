import { Context } from 'koishi'
import { KeywordHandler } from './handlers/keyword-handler'
import { UrlHandler } from './handlers/url-handler'
import { WarningManager } from './handlers/warning-manager'
import { Config as PluginConfig, ConfigSchema } from './types'

export const name = 'keyword-gatekeeper'

/**
 * 关键词守门员插件
 *
 * 功能：
 * - 检测群聊中的关键词和URL，自动撤回或禁言
 * - 记录用户违规次数，根据次数自动升级处罚等级
 * - 支持查询和管理用户的警告记录
 * - 支持通过@用户或直接输入用户ID查询/清零记录
 * - 可配置是否允许普通用户查询自己的警告记录(allowUserSelfQuery选项)
 */

// 导出配置模式
export const Config = ConfigSchema

// 声明服务依赖
export const inject = ['database']

// 主函数
export function apply(ctx: Context, options: PluginConfig) {
  // 创建处理器实例
  const keywordHandler = new KeywordHandler(ctx)
  const urlHandler = new UrlHandler(ctx)
  const warningManager = new WarningManager(ctx)

  // 注册中间件
  ctx.middleware(async (meta, next) => {
    // 只处理群聊消息
    if (!meta.guildId) return next()

    try {
      // 获取消息内容
      const content = meta.content || ''

      // 检查是否为命令 - 仅基于内容检查，避免类型错误
      const isCommand = content.startsWith('keyword') ||
                         content.startsWith('keyword.') ||
                         content.startsWith('/keyword') ||
                         content.startsWith('.keyword')

      // 如果是命令，跳过关键词和网址检测
      if (isCommand) {
        ctx.logger.info(`[${meta.guildId}] 跳过命令检测: ${content}`)
        return next()
      }

      // 处理关键词检测
      const keywordResult = await keywordHandler.handleKeywordDetection(meta, options)

      // 如果关键词检测已经处理了消息，则跳过网址检测
      if (keywordResult) return next()

      // 处理网址检测
      await urlHandler.handleUrlDetection(meta, options)
    } catch (error) {
      ctx.logger.error(`[${meta.guildId}] 处理异常: ${error.message}`)
    }

    return next()
  }, true)

  // 注册查询警告记录命令
  ctx.command('keyword.warning', '关键词警告记录相关命令')
    .usage('查询或管理关键词警告记录')
    .alias('keyword warning')

  // 查询自己的警告记录
  ctx.command('keyword.warning.my', '查询自己的警告记录')
    .alias('keyword warning my')
    .userFields(['authority'])
    .action(async ({ session }) => {
      const userId = session.userId
      const guildId = session.guildId
      ctx.logger.info(`[${guildId}] 用户 ${userId} 查询自己的警告记录`)

      if (!options.enableAutoPunishment) {
        return '自动处罚机制未启用，无法查询警告记录。'
      }

      // 检查是否允许普通用户查询自己的记录
      if (!options.allowUserSelfQuery && session.user?.authority < 2) {
        return '当前设置不允许普通用户查询警告记录，请联系管理员。'
      }

      const result = await warningManager.queryUserWarningRecord(userId, options, guildId)
      ctx.logger.info(`[${guildId}] 查询结果: ${JSON.stringify(result)}`)

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
          response += `\n\n使用 keyword.warning.my-history 查看您的完整历史记录`;
        }

        return response;
      }
    })

  // 查询指定用户的警告记录（需要管理员权限）
  ctx.command('keyword.warning.query [userId:string]', '查询指定用户的警告记录')
    .alias('keyword warning query [userId:string]')
    .userFields(['authority'])
    .action(async ({ session }, userId) => {
      // 尝试从消息中提取@的用户ID
      const atMatch = session.content.match(/<at id="([^"]+)"\/>/);
      const targetUserId = atMatch ? atMatch[1] : userId;

      ctx.logger.info(`[${session.guildId}] 用户 ${session.userId} 查询用户 ${targetUserId} 的警告记录`)

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
      ctx.logger.info(`[${guildId}] 查询结果: ${JSON.stringify(result)}`)

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
            response += `\n\n使用 keyword.warning.history ${targetUserId} 查看完整历史记录`;
          }
        }

        return response;
      }
    })

  // 清零指定用户的警告记录（需要管理员权限）
  ctx.command('keyword.warning.reset [userId:string]', '清零指定用户的警告记录')
    .alias('keyword warning reset [userId:string]')
    .userFields(['authority'])
    .action(async ({ session }, userId) => {
      // 尝试从消息中提取@的用户ID
      const atMatch = session.content.match(/<at id="([^"]+)"\/>/);
      const targetUserId = atMatch ? atMatch[1] : userId;

      ctx.logger.info(`[${session.guildId}] 用户 ${session.userId} 尝试清零用户 ${targetUserId} 的警告记录`)

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
      ctx.logger.info(`[${guildId}] 清零用户 ${targetUserId} 的警告记录`)

      try {
        const success = await warningManager.resetUserWarningRecord(targetUserId, guildId)
        ctx.logger.info(`[${guildId}] 清零结果: ${success ? '成功' : '失败'}`)

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
  ctx.command('keyword.warning.list', '列出所有有警告记录的用户')
    .alias('keyword warning list')
    .userFields(['authority'])
    .action(async ({ session }) => {
      ctx.logger.info(`[${session.guildId}] 用户 ${session.userId} 查询所有警告记录`)

      // 检查权限
      if (session.user?.authority < 2) {
        return '权限不足，需要管理员权限才能查看所有警告记录。'
      }

      if (!options.enableAutoPunishment) {
        return '自动处罚机制未启用，无法查看警告记录。'
      }

      const guildId = session.guildId
      ctx.logger.info(`[${guildId}] 查询所有警告记录`)

      // 打印所有记录，帮助调试
      ctx.logger.info(`[${guildId}] 当前所有警告记录:`)
      try {
        // 传入配置参数，确保使用正确的过期时间
        const userIds = await warningManager.getAllWarnedUserIds(guildId, options)
        ctx.logger.info(`[${guildId}] 找到 ${userIds.length} 条记录`)

        if (userIds.length === 0) {
          // 提供更详细的帮助信息
          return `当前群组 (${guildId}) 没有用户有警告记录。\n\n可能的原因：
1. 群内未触发过关键词/URL检测
2. 记录已被重置或超过时间自动清零
3. 插件配置中未启用自动处罚机制\n
如需查看更详细的记录状态，请使用命令 keyword.warning.debug`
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
  ctx.command('keyword.warning.debug', '查看所有警告记录（调试用）')
    .alias('keyword warning debug')
    .userFields(['authority'])
    .action(async ({ session }) => {
      // 检查权限
      if (session.user?.authority < 2) {
        return '权限不足，需要管理员权限才能使用调试命令。'
      }

      try {
        // 获取所有记录的调试信息
        const debugInfo = await warningManager.getDebugInfo()
        ctx.logger.info(`[${session.guildId}] 用户 ${session.userId} 查看调试信息`)
        ctx.logger.info(debugInfo)

        return debugInfo
      } catch (error) {
        ctx.logger.error(`[${session.guildId}] 获取调试信息失败: ${error.message}`)
        return '获取调试信息时发生错误，请查看日志。'
      }
    })

  // 添加强制同步命令，用于修复记录不一致的问题
  ctx.command('keyword.warning.sync', '强制同步所有警告记录')
    .alias('keyword warning sync')
    .userFields(['authority'])
    .action(async ({ session }) => {
      // 检查权限
      if (session.user?.authority < 2) {
        return '权限不足，需要管理员权限才能使用同步命令。'
      }

      ctx.logger.info(`[${session.guildId}] 用户 ${session.userId} 请求同步警告记录`)

      // 获取所有记录
      const syncResult = await warningManager.syncAllRecords(options)

      return `警告记录同步完成，共处理了 ${syncResult.total} 条记录，其中保留 ${syncResult.kept} 条，重置 ${syncResult.reset} 条。`
    })

  // 添加清空所有警告记录的命令
  ctx.command('keyword.warning.clear-all', '清空所有警告记录')
    .alias('keyword warning clear-all')
    .userFields(['authority'])
    .action(async ({ session }) => {
      // 检查权限
      if (session.user?.authority < 3) {
        return '权限不足，需要超级管理员权限才能清空所有警告记录。'
      }

      ctx.logger.info(`[${session.guildId}] 用户 ${session.userId} 请求清空所有警告记录`)

      try {
        // 使用数据库直接清空记录
        const result = await ctx.database.remove('keyword_warnings', {})
        ctx.logger.info(`已清理 ${result} 条警告记录`)
        return `已清理 ${result} 条警告记录`
      } catch (error) {
        ctx.logger.error(`[${session.guildId}] 清空记录失败: ${error.message}`)
        return '清空记录时发生错误，请查看日志。'
      }
    })

  // 添加查看完整历史记录的命令（需要管理员权限）
  ctx.command('keyword.warning.history <userId:string>', '查看指定用户的完整警告历史')
    .alias('keyword warning history <userId:string>')
    .userFields(['authority'])
    .action(async ({ session }, userId) => {
      // 尝试从消息中提取@的用户ID
      const atMatch = session.content.match(/<at id="([^"]+)"\/>/);
      const targetUserId = atMatch ? atMatch[1] : userId;

      ctx.logger.info(`[${session.guildId}] 用户 ${session.userId} 查询用户 ${targetUserId} 的完整警告历史`)

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
  ctx.command('keyword.warning.my-history', '查看自己的完整警告历史')
    .alias('keyword warning my-history')
    .userFields(['authority'])
    .action(async ({ session }) => {
      const userId = session.userId
      const guildId = session.guildId
      ctx.logger.info(`[${guildId}] 用户 ${userId} 查询自己的完整警告历史`)

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
        });

        // 如果历史记录超过2条，添加查看完整历史的提示
        if (result.history.length > 3) {
          response += `\n\n使用 keyword.warning.my-history 查看您的完整历史记录`;
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
