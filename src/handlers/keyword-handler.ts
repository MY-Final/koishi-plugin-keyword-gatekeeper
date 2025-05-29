import { Session, h } from 'koishi'
import { MessageHandler } from './base-handler'
import { Config as PluginConfig } from '../types'
import { WarningManager } from './warning-manager'
import type { OneBot } from 'koishi-plugin-adapter-onebot'

// 关键词处理器
export class KeywordHandler extends MessageHandler {
  // 使用警告记录管理器
  private warningManager: WarningManager

  constructor(ctx) {
    super(ctx)
    this.warningManager = new WarningManager(ctx)
  }

  // 检查是否包含关键词
  checkKeywords(message: string, keywords: string[], config: PluginConfig): string | null {
    if (!keywords || keywords.length === 0) return null

    const lowerMessage = message.toLowerCase()
    for (const keyword of keywords) {
      if (!keyword) continue

      try {
        // 使用正则表达式匹配
        if (config.useRegex) {
          const flags = config.regexFlags || 'i'
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
    if (seconds < 60) return `${seconds}秒`

    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const remainingSeconds = seconds % 60

    let durationText = ''
    if (hours > 0) durationText += `${hours}小时`
    if (minutes > 0) durationText += `${minutes}分钟`
    if (remainingSeconds > 0) durationText += `${remainingSeconds}秒`

    return durationText
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

  // 踢出用户
  async kickUser(meta: Session): Promise<boolean> {
    try {
      this.ctx.logger.info(`[${meta.guildId}] 尝试踢出用户 ${meta.userId}`)

      // 尝试使用 OneBot 的 setGroupKick 方法
      if ((meta as any).onebot?.setGroupKick) {
        await (meta as any).onebot.setGroupKick(meta.guildId, meta.userId, false)
        this.ctx.logger.info(`[${meta.guildId}] 使用 onebot.setGroupKick 踢出成功`)
        return true
      }
      // 优先使用 bot 对象上的 $setGroupKick 方法（OneBot 适配器）
      else if (meta.bot && typeof meta.bot['$setGroupKick'] === 'function') {
        await meta.bot['$setGroupKick'](meta.guildId, meta.userId, false)
        this.ctx.logger.info(`[${meta.guildId}] 使用 bot.$setGroupKick 踢出成功`)
        return true
      }
      // 尝试使用 setGroupKick 方法
      else if (meta.bot && typeof meta.bot['setGroupKick'] === 'function') {
        await meta.bot['setGroupKick'](meta.guildId, meta.userId, false)
        this.ctx.logger.info(`[${meta.guildId}] 使用 bot.setGroupKick 踢出成功`)
        return true
      }
      // 最后尝试通用 API
      else if (meta.bot && typeof meta.bot.kickGuildMember === 'function') {
        await meta.bot.kickGuildMember(meta.guildId, meta.userId)
        this.ctx.logger.info(`[${meta.guildId}] 使用通用 API 踢出成功`)
        return true
      } else {
        this.ctx.logger.warn(`[${meta.guildId}] 无法踢出用户：平台不支持踢出功能或无法获取踢出方法`)
        return false
      }
    } catch (error) {
      this.ctx.logger.error(`[${meta.guildId}] 踢出用户失败: ${error.message}`)
      if (error.stack) {
        this.ctx.logger.debug(`[${meta.guildId}] 踢出错误堆栈: ${error.stack}`)
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

  // 处理自动处罚
  private async handleAutoPunishment(meta: Session, config: PluginConfig, matchedKeyword: string): Promise<boolean> {
    // 检查机器人权限
    const hasBotPermission = await this.checkBotPermission(meta)

    if (!config.enableAutoPunishment) {
      // 如果未启用自动处罚，则使用原有的处罚逻辑
      if (config.recall) {
        await this.recallMessage(meta)
      }

      if (config.mute) {
        // 只有机器人有权限时才尝试禁言
        if (hasBotPermission) {
          const muted = await this.muteUser(meta, config.muteDuration)
          if (muted && config.customMessage) {
            const durationText = this.formatDuration(config.muteDuration)
            await this.sendNotice(meta, config.customMessage, durationText)
          }
        } else {
          // 如果没有权限，记录日志但不发送消息
          this.ctx.logger.warn(`[${meta.guildId}] 机器人没有管理权限，无法禁言用户`)
        }
      } else if (config.customMessage && hasBotPermission) {
        // 只有在有权限时才发送提示消息
        await this.sendNotice(meta, config.customMessage)
      }

      return true
    }

    // 记录处理前的状态
    const beforeRecord = await this.warningManager.queryUserWarningRecord(meta.userId, config, meta.guildId)
    this.ctx.logger.info(`[${meta.guildId}] 处理前用户 ${meta.userId} 的警告记录: 次数=${beforeRecord.count}`)

    // 更新并获取用户的违规次数
    const violationCount = await this.warningManager.updateUserPunishmentRecord(
      meta.userId,
      config,
      meta.guildId,
      {
        keyword: matchedKeyword,
        type: 'keyword',
        action: 'warn', // 默认为警告，稍后根据实际处罚更新
        messageContent: this.getMessageContent(meta)
      }
    )
    this.ctx.logger.info(`[${meta.guildId}] 已更新用户 ${meta.userId} 的警告记录: 次数=${violationCount}`)

    // 记录处理后的状态
    const afterRecord = await this.warningManager.queryUserWarningRecord(meta.userId, config, meta.guildId)
    this.ctx.logger.info(`[${meta.guildId}] 处理后用户 ${meta.userId} 的警告记录: 次数=${afterRecord.count}`)

    if (beforeRecord.count === afterRecord.count && violationCount !== afterRecord.count) {
      this.ctx.logger.warn(`[${meta.guildId}] 警告记录更新异常: 预期次数=${violationCount}, 实际次数=${afterRecord.count}`)
    }

    // 撤回消息（所有违规等级都撤回）
    if (config.recall) {
      await this.recallMessage(meta)
    }

    let actionTaken = false
    let message = ''

    // 根据违规次数执行不同的处罚，只有在有权限时才执行
    if (hasBotPermission) {
      if (violationCount === 1) {
        // 第一次：警告
        message = `您触发了关键词"${matchedKeyword}"，这是第一次警告。`
        actionTaken = true

        // 更新处罚类型为警告
        await this.warningManager.updateUserPunishmentRecord(
          meta.userId,
          config,
          meta.guildId,
          {
            keyword: matchedKeyword,
            type: 'keyword',
            action: 'warn',
            messageContent: this.getMessageContent(meta)
          }
        )
      }
      else if (violationCount === 2) {
        // 第二次：禁言自定义时长
        const muteDuration = config.secondViolationMuteDuration
        const muted = await this.muteUser(meta, muteDuration)
        if (muted) {
          const durationText = this.formatDuration(muteDuration)
          message = `您触发了关键词"${matchedKeyword}"，这是第二次违规，已禁言${durationText}。`
          actionTaken = true

          // 更新处罚类型为禁言
          await this.warningManager.updateUserPunishmentRecord(
            meta.userId,
            config,
            meta.guildId,
            {
              keyword: matchedKeyword,
              type: 'keyword',
              action: 'mute',
              messageContent: this.getMessageContent(meta)
            }
          )
        }
      }
      else if (violationCount >= config.maxViolationCount) {
        // 达到最大违规次数：根据配置踢出或长时间禁言
        if (config.kickOnMaxViolation) {
          const kicked = await this.kickUser(meta)
          if (kicked) {
            message = `用户 ${meta.username || meta.userId} 因多次触发关键词"${matchedKeyword}"已被踢出群聊。`
            actionTaken = true

            // 更新处罚类型为踢出
            await this.warningManager.updateUserPunishmentRecord(
              meta.userId,
              config,
              meta.guildId,
              {
                keyword: matchedKeyword,
                type: 'keyword',
                action: 'kick',
                messageContent: this.getMessageContent(meta)
              }
            )
          } else {
            // 如果踢出失败，尝试禁言
            const longMuteDuration = 3600 // 1小时
            const muted = await this.muteUser(meta, longMuteDuration)
            if (muted) {
              message = `您触发了关键词"${matchedKeyword}"，这是第${violationCount}次违规，已禁言1小时。`
              actionTaken = true

              // 更新处罚类型为禁言
              await this.warningManager.updateUserPunishmentRecord(
                meta.userId,
                config,
                meta.guildId,
                {
                  keyword: matchedKeyword,
                  type: 'keyword',
                  action: 'mute',
                  messageContent: this.getMessageContent(meta)
                }
              )
            }
          }
        } else {
          // 配置为不踢出，只禁言
          const longMuteDuration = 3600 // 1小时
          const muted = await this.muteUser(meta, longMuteDuration)
          if (muted) {
            message = `您触发了关键词"${matchedKeyword}"，这是第${violationCount}次违规，已禁言1小时。`
            actionTaken = true

            // 更新处罚类型为禁言
            await this.warningManager.updateUserPunishmentRecord(
              meta.userId,
              config,
              meta.guildId,
              {
                keyword: matchedKeyword,
                type: 'keyword',
                action: 'mute',
                messageContent: this.getMessageContent(meta)
              }
            )
          }
        }
      }
      else {
        // 介于第二次和最大次数之间的违规：禁言时间递增
        // 禁言时间随违规次数增加而增加
        const muteDuration = Math.min(config.secondViolationMuteDuration * (violationCount - 1), 7200) // 最多2小时
        const muted = await this.muteUser(meta, muteDuration)
        if (muted) {
          const durationText = this.formatDuration(muteDuration)
          message = `您触发了关键词"${matchedKeyword}"，这是第${violationCount}次违规，已禁言${durationText}。`
          actionTaken = true

          // 更新处罚类型为禁言
          await this.warningManager.updateUserPunishmentRecord(
            meta.userId,
            config,
            meta.guildId,
            {
              keyword: matchedKeyword,
              type: 'keyword',
              action: 'mute',
              messageContent: this.getMessageContent(meta)
            }
          )
        }
      }
    } else {
      // 如果没有权限，记录日志但不发送消息
      this.ctx.logger.warn(`[${meta.guildId}] 机器人没有管理权限，无法执行处罚操作`)
      return true
    }

    // 发送处罚通知
    if (actionTaken && message) {
      await this.sendNotice(meta, message)
      this.ctx.logger.info(`[${meta.guildId}] 用户 ${meta.userId} 因触发关键词 "${matchedKeyword}" 第${violationCount}次违规，已执行自动处罚`)
    }

    return actionTaken
  }

  // 处理关键词检测
  async handleKeywordDetection(meta: Session, config: PluginConfig): Promise<boolean> {
    // 获取消息内容
    const message = this.getMessageContent(meta)

    // 检查是否包含关键词
    const matchedKeyword = this.checkKeywords(message, config.keywords, config)
    if (!matchedKeyword) return false

    // 检查用户是否为管理员
    if (await this.isUserAdmin(meta)) {
      this.ctx.logger.info(`[${meta.guildId}] 用户 ${meta.userId} 是管理员，不进行处理`)
      return false
    }

    // 打印调试信息
    this.ctx.logger.info(`[${meta.guildId}] 用户 ${meta.userId} 触发关键词 "${matchedKeyword}"`)

    // 如果启用了自动处罚机制
    if (config.enableAutoPunishment) {
      // 在处理前先查询当前记录
      const beforeRecord = await this.warningManager.queryUserWarningRecord(meta.userId, config, meta.guildId)
      this.ctx.logger.info(`[${meta.guildId}] 处理前用户 ${meta.userId} 的警告记录: 次数=${beforeRecord.count}`)
    }

    // 处理自动处罚机制
    const result = await this.handleAutoPunishment(meta, config, matchedKeyword)

    // 如果启用了自动处罚机制
    if (config.enableAutoPunishment) {
      // 在处理后再查询记录，确认是否更新成功
      const afterRecord = await this.warningManager.queryUserWarningRecord(meta.userId, config, meta.guildId)
      this.ctx.logger.info(`[${meta.guildId}] 处理后用户 ${meta.userId} 的警告记录: 次数=${afterRecord.count}`)
    }

    return result
  }

  // 查询用户警告记录
  async queryUserWarningRecord(userId: string, config: PluginConfig, guildId?: string): Promise<{count: number, resetTime: string}> {
    return this.warningManager.queryUserWarningRecord(userId, config, guildId)
  }

  // 清零用户警告记录
  async resetUserWarningRecord(userId: string, guildId?: string): Promise<boolean> {
    return await this.warningManager.resetUserWarningRecord(userId, guildId)
  }

  // 获取所有有警告记录的用户ID
  async getAllWarnedUserIds(guildId?: string, config?: PluginConfig): Promise<string[]> {
    return await this.warningManager.getAllWarnedUserIds(guildId, config)
  }
}
