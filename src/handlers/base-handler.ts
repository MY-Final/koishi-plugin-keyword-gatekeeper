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
      const selfId = meta.bot?.selfId || (meta.bot as any)?.userId || (meta as any).selfId

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
          // 忽略错误
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
          // 忽略错误
        }
      }

      // 检查机器人自身角色
      if (meta.bot) {
        try {
          const botMember: any = await (meta.bot as any).asMember?.(meta.guildId)
          if (botMember?.roles?.includes('admin') || botMember?.roles?.includes('owner')) {
            this.ctx.logger.info(`[${meta.guildId}] 机器人拥有管理角色，拥有管理权限`)
            return true
          }
        } catch (err) {
          // 忽略错误
        }

        // 尝试通用方法检查是否有权限
        try {
          if ((meta.bot as any).isAdmin?.(meta.guildId)) {
            this.ctx.logger.info(`[${meta.guildId}] 机器人通过通用方法检查为管理员`)
            return true
          }
        } catch (err) {
          // 忽略错误
        }
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
          // 忽略错误
        }
      }

      // 检查用户角色
      if (meta.author?.roles) {
        if (meta.author.roles.includes('admin') || meta.author.roles.includes('owner')) {
          return true
        }
      }

      // 检查可能存在的member属性
      const member = (meta as any).member
      if (member?.roles) {
        if (member.roles.includes('admin') || member.roles.includes('owner')) {
          return true
        }
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

    if (meta.elements && Array.isArray(meta.elements)) {
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

    return '';
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

  // 禁言用户的通用方法
  async muteUser(meta: Session, duration: number): Promise<boolean> {
    try {
      this.ctx.logger.info(`[${meta.guildId}] 尝试禁言用户 ${meta.userId}，时长: ${duration}秒`)

      // 方法1: OneBot的setGroupBan
      if ((meta as any).onebot?.setGroupBan) {
        try {
          await (meta as any).onebot.setGroupBan(meta.guildId, meta.userId, duration)
          this.ctx.logger.info(`[${meta.guildId}] 使用 onebot.setGroupBan 禁言成功`)
          return true
        } catch (e) {
          this.ctx.logger.debug(`[${meta.guildId}] onebot.setGroupBan 禁言失败: ${e.message}`)
        }
      }

      // 方法2: QQ常用的ban_group_member方法
      if ((meta as any).onebot?.ban_group_member) {
        try {
          await (meta as any).onebot.ban_group_member(meta.guildId, meta.userId, duration)
          this.ctx.logger.info(`[${meta.guildId}] 使用 onebot.ban_group_member 禁言成功`)
          return true
        } catch (e) {
          this.ctx.logger.debug(`[${meta.guildId}] onebot.ban_group_member 禁言失败: ${e.message}`)
        }
      }

      // 方法3: OneBot的set_group_ban
      if ((meta as any).onebot?.set_group_ban) {
        try {
          this.ctx.logger.debug(`[${meta.guildId}] 尝试使用 onebot.set_group_ban 禁言用户`)
          await (meta as any).onebot.set_group_ban(meta.guildId, meta.userId, duration)
          this.ctx.logger.info(`[${meta.guildId}] 使用 onebot.set_group_ban 禁言成功`)
          return true
        } catch (e) {
          this.ctx.logger.debug(`[${meta.guildId}] onebot.set_group_ban 禁言失败: ${e.message}`)
        }
      }

      // 方法4: QQ群专用的设置禁言方法
      if ((meta as any).bot && typeof (meta as any).bot['setGroupMute'] === 'function') {
        try {
          this.ctx.logger.debug(`[${meta.guildId}] 尝试使用 bot.setGroupMute 禁言用户`)
          await (meta as any).bot['setGroupMute'](meta.guildId, meta.userId, duration)
          this.ctx.logger.info(`[${meta.guildId}] 使用 bot.setGroupMute 禁言成功`)
          return true
        } catch (e) {
          this.ctx.logger.debug(`[${meta.guildId}] bot.setGroupMute 禁言失败: ${e.message}`)
        }
      }

      // 方法5: Bot对象的$setGroupBan (OneBot适配器)
      if ((meta as any).bot && typeof (meta as any).bot['$setGroupBan'] === 'function') {
        try {
          this.ctx.logger.debug(`[${meta.guildId}] 尝试使用 bot.$setGroupBan 禁言用户`)
          await (meta as any).bot['$setGroupBan'](meta.guildId, meta.userId, duration)
          this.ctx.logger.info(`[${meta.guildId}] 使用 bot.$setGroupBan 禁言成功`)
          return true
        } catch (e) {
          this.ctx.logger.debug(`[${meta.guildId}] bot.$setGroupBan 禁言失败: ${e.message}`)
        }
      }

      // 方法6: Bot对象的setGroupBan
      if ((meta as any).bot && typeof (meta as any).bot['setGroupBan'] === 'function') {
        try {
          this.ctx.logger.debug(`[${meta.guildId}] 尝试使用 bot.setGroupBan 禁言用户`)
          await (meta as any).bot['setGroupBan'](meta.guildId, meta.userId, duration)
          this.ctx.logger.info(`[${meta.guildId}] 使用 bot.setGroupBan 禁言成功`)
          return true
        } catch (e) {
          this.ctx.logger.debug(`[${meta.guildId}] bot.setGroupBan 禁言失败: ${e.message}`)
        }
      }

      // 方法7: 通用API
      if ((meta as any).bot && typeof (meta as any).bot.muteGuildMember === 'function') {
        try {
          this.ctx.logger.debug(`[${meta.guildId}] 尝试使用 bot.muteGuildMember 禁言用户`)
          await (meta as any).bot.muteGuildMember(meta.guildId, meta.userId, duration)
          this.ctx.logger.info(`[${meta.guildId}] 使用通用 API muteGuildMember 禁言成功`)
          return true
        } catch (e) {
          this.ctx.logger.debug(`[${meta.guildId}] bot.muteGuildMember 禁言失败: ${e.message}`)
        }
      }

      // 方法8: Bot的mute方法
      if ((meta as any).bot && typeof (meta as any).bot.mute === 'function') {
        try {
          this.ctx.logger.debug(`[${meta.guildId}] 尝试使用 bot.mute 禁言用户`)
          await (meta as any).bot.mute(meta.guildId, meta.userId, duration)
          this.ctx.logger.info(`[${meta.guildId}] 使用 bot.mute 禁言成功`)
          return true
        } catch (e) {
          this.ctx.logger.debug(`[${meta.guildId}] bot.mute 禁言失败: ${e.message}`)
        }
      }

      // 方法9: 内部方法
      if ((meta as any).bot && (meta as any).bot.internal && typeof (meta as any).bot.internal.mute === 'function') {
        try {
          this.ctx.logger.debug(`[${meta.guildId}] 尝试使用 bot.internal.mute 禁言用户`)
          await (meta as any).bot.internal.mute(meta.guildId, meta.userId, duration)
          this.ctx.logger.info(`[${meta.guildId}] 使用 bot.internal.mute 禁言成功`)
          return true
        } catch (e) {
          this.ctx.logger.debug(`[${meta.guildId}] bot.internal.mute 禁言失败: ${e.message}`)
        }
      }

      // 方法10: 使用直接API调用
      try {
        if ((meta as any).bot && (meta as any).bot.platform === 'onebot') {
          this.ctx.logger.debug(`[${meta.guildId}] 尝试使用直接API调用进行禁言`)
          const result = await (meta as any).bot.internal._http('set_group_ban', {
            group_id: Number(meta.guildId),
            user_id: Number(meta.userId),
            duration
          })
          this.ctx.logger.info(`[${meta.guildId}] 使用直接API调用禁言结果: ${JSON.stringify(result)}`)
          if (result && result.status === 'ok') {
            return true
          }
        }
      } catch (e) {
        this.ctx.logger.debug(`[${meta.guildId}] 直接API调用禁言失败: ${e.message}`)
      }

      // 所有方法都失败了
      this.ctx.logger.warn(`[${meta.guildId}] 所有禁言方法尝试失败`)
      return false
    } catch (error) {
      this.ctx.logger.error(`[${meta.guildId}] 禁言失败: ${error.message}`)
      if (error.stack) {
        this.ctx.logger.debug(`[${meta.guildId}] 禁言错误堆栈: ${error.stack}`)
      }
      return false
    }
  }
}
