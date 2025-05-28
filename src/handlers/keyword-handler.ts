import { Session, h } from 'koishi'
import { MessageHandler } from './base-handler'
import { Config } from '../types'
import type { OneBot } from 'koishi-plugin-adapter-onebot'

// 关键词处理器
export class KeywordHandler extends MessageHandler {
  // 检查是否包含关键词
  checkKeywords(message: string, keywords: string[]): string | null {
    if (!keywords || keywords.length === 0) return null

    const lowerMessage = message.toLowerCase()
    for (const keyword of keywords) {
      if (!keyword) continue

      try {
        // 使用正则表达式匹配
        if (this.ctx.config.useRegex) {
          const flags = this.ctx.config.regexFlags || 'i'
          const regex = new RegExp(keyword, flags)
          if (regex.test(message)) {
            return keyword
          }
        }
        // 使用普通文本匹配
        else {
          if (lowerMessage.includes(keyword.toLowerCase())) {
            return keyword
          }
        }
      } catch (error) {
        this.ctx.logger.warn(`关键词匹配错误: ${error.message}`, keyword)
      }
    }

    return null
  }

  // 撤回消息
  async recallMessage(meta: Session): Promise<boolean> {
    try {
      // 尝试使用 OneBot 的 deleteMsg 方法
      if (meta.messageId && (meta as any).onebot?.deleteMsg) {
        await (meta as any).onebot.deleteMsg(meta.messageId)
        this.ctx.logger.info(`[${meta.guildId}] 使用 onebot.deleteMsg 撤回成功`)
        return true
      }
      // 使用 bot.deleteMessage 撤回消息
      else if (meta.messageId) {
        await meta.bot.deleteMessage(meta.channelId, meta.messageId)
        this.ctx.logger.info(`[${meta.guildId}] 使用 bot.deleteMessage 撤回成功`)
        return true
      }
      return false
    } catch (error) {
      this.ctx.logger.warn(`[${meta.guildId}] 消息撤回失败: ${error.message}`)
      return false
    }
  }

  // 格式化禁言时间
  formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.ceil((seconds % 3600) / 60)

    let durationText = ''
    if (hours > 0) durationText += `${hours}小时`
    if (minutes > 0) durationText += `${minutes}分钟`

    return durationText || '1分钟'
  }

  // 禁言用户
  async muteUser(meta: Session, duration: number): Promise<boolean> {
    try {
      this.ctx.logger.info(`[${meta.guildId}] 尝试禁言用户 ${meta.userId}，时长: ${duration}秒`)

      // 尝试使用 OneBot 的 setGroupBan 方法
      if ((meta as any).onebot?.setGroupBan) {
        await (meta as any).onebot.setGroupBan(meta.guildId, meta.userId, duration)
        this.ctx.logger.info(`[${meta.guildId}] 使用 onebot.setGroupBan 禁言成功`)
        return true
      }
      // 优先使用 bot 对象上的 $setGroupBan 方法（OneBot 适配器）
      else if (meta.bot && typeof meta.bot['$setGroupBan'] === 'function') {
        await meta.bot['$setGroupBan'](meta.guildId, meta.userId, duration)
        this.ctx.logger.info(`[${meta.guildId}] 使用 bot.$setGroupBan 禁言成功`)
        return true
      }
      // 尝试使用 setGroupBan 方法（可能是 OneBot 适配器）
      else if (meta.bot && typeof meta.bot['setGroupBan'] === 'function') {
        await meta.bot['setGroupBan'](meta.guildId, meta.userId, duration)
        this.ctx.logger.info(`[${meta.guildId}] 使用 bot.setGroupBan 禁言成功`)
        return true
      }
      // 最后尝试通用 API
      else if (meta.bot && typeof meta.bot.muteGuildMember === 'function') {
        await meta.bot.muteGuildMember(meta.guildId, meta.userId, duration)
        this.ctx.logger.info(`[${meta.guildId}] 使用通用 API 禁言成功`)
        return true
      } else {
        this.ctx.logger.warn(`[${meta.guildId}] 无法禁言用户：平台不支持禁言功能或无法获取禁言方法`)
        return false
      }
    } catch (error) {
      this.ctx.logger.error(`[${meta.guildId}] 禁言失败: ${error.message}`)
      if (error.stack) {
        this.ctx.logger.debug(`[${meta.guildId}] 禁言错误堆栈: ${error.stack}`)
      }
      return false
    }
  }

  // 发送提示消息
  async sendNotice(meta: Session, message: string, durationText?: string): Promise<void> {
    try {
      // 尝试使用 OneBot 的 sendGroupMsg 方法
      if ((meta as any).onebot?.sendGroupMsg) {
        const atText = `[CQ:at,qq=${meta.userId}]`
        let msgText = `${atText} ${message}`

        if (durationText) {
          msgText += `\n已禁言 ${durationText}`
        }

        await (meta as any).onebot.sendGroupMsg(meta.guildId, msgText)
        this.ctx.logger.info(`[${meta.guildId}] 使用 onebot.sendGroupMsg 发送提示成功`)
        return
      }

      // 使用 Koishi 的 h 构造器创建消息，正确处理 at 元素
      let noticeMsg = h('', [
        h.at(meta.userId),
        ` ${message}`
      ])

      if (durationText) {
        noticeMsg = h('', [
          noticeMsg,
          `\n已禁言 ${durationText}`
        ])
      }

      // 使用 koishi 的 API 发送消息
      await meta.send(noticeMsg)
    } catch (error) {
      this.ctx.logger.warn(`[${meta.guildId}] 发送提示消息失败: ${error.message}`)
    }
  }

  // 处理关键词检测
  async handleKeywordDetection(meta: Session, config: Config): Promise<boolean> {
    // 获取消息内容
    const message = this.getMessageContent(meta)

    // 检查是否包含关键词
    const matchedKeyword = this.checkKeywords(message, config.keywords)
    if (!matchedKeyword) return false

    // 检查机器人权限
    if (!await this.checkBotPermission(meta)) return false

    // 检查用户是否为管理员
    if (await this.isUserAdmin(meta)) {
      this.ctx.logger.info(`[${meta.guildId}] 用户 ${meta.userId} 是管理员，不进行处理`)
      return false
    }

    // 处理撤回
    if (config.recall) {
      await this.recallMessage(meta)
    }

    // 处理禁言
    if (config.mute) {
      const muted = await this.muteUser(meta, config.muteDuration)

      if (muted) {
        const durationText = this.formatDuration(config.muteDuration)

        // 发送提示消息
        if (config.customMessage) {
          await this.sendNotice(meta, config.customMessage, durationText)
        }

        this.ctx.logger.info(`[${meta.guildId}] 用户 ${meta.userId} 因触发关键词 "${matchedKeyword}" 被禁言 ${durationText}`)
      }
    } else if (config.customMessage) {
      // 只发送提示，不禁言
      await this.sendNotice(meta, config.customMessage)
    }

    return true
  }
}
