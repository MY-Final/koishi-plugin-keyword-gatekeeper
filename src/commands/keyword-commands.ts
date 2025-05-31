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
 * 注册关键词相关命令
 */
export function registerKeywordCommands(keywordCmd: Command, config: Config, database: KeywordDatabase) {
  // 添加全局关键词
  keywordCmd.subcommand('add <keyword:text>', '添加全局关键词')
    .alias('add-keyword')  // 添加别名
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

  // 删除全局关键词
  keywordCmd.subcommand('remove <keyword:text>', '删除全局关键词')
    .alias('remove-keyword')  // 添加别名
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

  // 列出所有全局关键词
  keywordCmd.subcommand('list', '列出所有全局关键词')
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
}
