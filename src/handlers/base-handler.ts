import { Context, Session } from 'koishi'

// 消息处理器基类
export class MessageHandler {
  protected ctx: Context

  constructor(ctx: Context) {
    this.ctx = ctx
  }

  // 检查机器人权限
  async checkBotPermission(meta: Session): Promise<boolean> {
    try {
      // 获取机器人自己的ID
      const selfId = meta.bot.selfId || meta.bot.userId || meta.selfId

      // 检查机器人是否为群主或管理员
      let isAdmin = false

      // 对于 OneBot 适配器
      if ((meta as any).onebot?.getGroupInfo) {
        try {
          const groupInfo = await (meta as any).onebot.getGroupInfo(meta.guildId)
          // 检查机器人是否为群主
          if (groupInfo.owner_id === selfId) {
            this.ctx.logger.info(`[${meta.guildId}] 机器人是群主，拥有管理权限`)
            return true
          }
        } catch (err) {
          this.ctx.logger.warn(`[${meta.guildId}] 获取群信息失败: ${err.message}`)
        }
      }

      // 尝试获取群成员信息
      if ((meta as any).onebot?.getGroupMemberInfo) {
        try {
          const memberInfo = await (meta as any).onebot.getGroupMemberInfo(meta.guildId, selfId)
          // 检查机器人是否为管理员或群主
          if (memberInfo.role === 'admin' || memberInfo.role === 'owner') {
            this.ctx.logger.info(`[${meta.guildId}] 机器人是${memberInfo.role}，拥有管理权限`)
            return true
          }
        } catch (err) {
          this.ctx.logger.warn(`[${meta.guildId}] 获取成员信息失败: ${err.message}`)
        }
      }

      // 检查机器人自身角色 (使用 any 类型避免类型错误)
      try {
        const botMember = await (meta.bot as any).asMember?.(meta.guildId)
        if (botMember?.roles?.includes('admin') || botMember?.roles?.includes('owner')) {
          this.ctx.logger.info(`[${meta.guildId}] 机器人拥有管理角色，拥有管理权限`)
          return true
        }
      } catch (err) {
        this.ctx.logger.debug(`[${meta.guildId}] 尝试 asMember 方法失败: ${err?.message}`)
      }

      // 尝试通用方法检查是否有权限 (使用 any 类型避免类型错误)
      try {
        if ((meta.bot as any).isAdmin?.(meta.guildId)) {
          this.ctx.logger.info(`[${meta.guildId}] 机器人通过通用方法检查为管理员`)
      return true
        }
      } catch (err) {
        this.ctx.logger.debug(`[${meta.guildId}] 尝试 isAdmin 方法失败: ${err?.message}`)
      }

      this.ctx.logger.warn(`[${meta.guildId}] 机器人不是管理员或群主，无法执行管理操作`)
      return false
    } catch (error) {
      this.ctx.logger.error(`[${meta.guildId}] 检查机器人权限失败: ${error.message}`)
      return false
    }
  }

  // 检查用户是否为管理员
  async isUserAdmin(meta: Session): Promise<boolean> {
    try {
      // 检查用户是否为群主或管理员
      // 尝试使用 OneBot 适配器方法
      if ((meta as any).onebot?.getGroupMemberInfo) {
        try {
          const memberInfo = await (meta as any).onebot.getGroupMemberInfo(meta.guildId, meta.userId)
          if (memberInfo.role === 'admin' || memberInfo.role === 'owner') {
            return true
          }
        } catch (err) {
          this.ctx.logger.warn(`[${meta.guildId}] 获取用户成员信息失败: ${err.message}`)
        }
      }

      // 检查用户角色
      if (meta.author?.roles?.includes('admin') || meta.author?.roles?.includes('owner')) {
        return true
      }

      // 如果用户有权限字段且权限大于等于2（管理员）
      try {
        const authority = (meta as any).user?.authority
        if (typeof authority === 'number' && authority >= 2) {
          return true
        }
      } catch (err) {
        this.ctx.logger.debug(`[${meta.guildId}] 尝试检查用户权限失败: ${err?.message}`)
      }

      return false
    } catch (error) {
      this.ctx.logger.error(`[${meta.guildId}] 检查用户权限失败: ${error.message}`)
      return false
    }
  }

  // 获取消息内容
  getMessageContent(meta: Session): string {
    if (typeof meta.content === 'string') {
      return meta.content
    }

    return meta.elements
      .map((e) => {
        switch (e.type) {
          case 'at': return `@${e.attrs.id}`
          case 'image': return `[图片]`
          case 'face': return `[表情]`
          default: return e.attrs?.content || ''
        }
      })
      .join('')
  }

  // 格式化禁言时长
  formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}秒`

    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const remainingSeconds = seconds % 60

    let result = ''
    if (hours > 0) result += `${hours}小时`
    if (minutes > 0) result += `${minutes}分钟`
    if (remainingSeconds > 0 && hours === 0) result += `${remainingSeconds}秒`

    return result
  }
}
