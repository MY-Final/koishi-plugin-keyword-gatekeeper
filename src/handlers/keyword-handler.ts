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

    // 减少日志输出，仅在调试模式下显示详细信息
    if (config.enableDebugMode) {
      this.ctx.logger.debug(`开始检查关键词，消息内容: "${message.substring(0, 30)}${message.length > 30 ? '...' : ''}", 关键词数量: ${keywords.length}`)
    }

    const lowerMessage = message.toLowerCase()
    for (const keyword of keywords) {
      if (!keyword) continue

      try {
        // 使用正则表达式匹配
        if (config.useRegex) {
          const flags = config.regexFlags || 'i'

          // 仅在调试模式下记录每个关键词的检测
          if (config.enableDebugMode) {
            this.ctx.logger.debug(`使用正则表达式匹配 /${keyword}/${flags}`)
          }

          const regex = new RegExp(keyword, flags)
          if (regex.test(message)) {
            this.ctx.logger.info(`正则表达式匹配成功: ${keyword}`)
            return keyword
          }
        }
        // 使用普通文本匹配
        else {
          const lowerKeyword = keyword.toLowerCase();

          // 仅在调试模式下记录每个关键词的检测
          if (config.enableDebugMode) {
            this.ctx.logger.debug(`检查普通文本是否包含: "${lowerKeyword}"`)
          }

          if (lowerMessage.includes(lowerKeyword)) {
            this.ctx.logger.info(`普通文本匹配成功: ${keyword}`)
            return keyword
          }
        }
      } catch (error) {
        this.ctx.logger.warn(`关键词匹配错误: ${error.message}`, keyword)

        // 如果正则表达式有错误，尝试使用普通文本匹配
        const lowerKeyword = keyword.toLowerCase();
        if (lowerMessage.includes(lowerKeyword)) {
          this.ctx.logger.info(`回退到普通文本匹配成功: ${keyword}`)
          return keyword
        }
      }
    }

    return null
  }

  // 检查URL并返回匹配的非白名单URL
  checkUrls(message: string, whitelist: string[] = []): string | null {
    if (!message) return null

    // URL正则表达式，能够检测更多格式的URL，包括没有协议前缀的域名
    const urlRegex = /(https?:\/\/)?([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}(:\d{1,5})?(\/[a-zA-Z0-9%_\-.\/?=&#]*)?/gi

    // 查找所有匹配的URL
    const urls = message.match(urlRegex)

    if (!urls) return null

    // 检查是否在白名单中
    for (const url of urls) {
      // 提取域名
      const domain = url.replace(/^https?:\/\//, '').split('/')[0].split(':')[0]

      // 检查是否为QQ多媒体链接
      if (domain.includes('qpic.cn')) {
        continue
      }

      // 如果在白名单中，则跳过
      let isWhitelisted = false
      for (const whitelistDomain of whitelist) {
        if (domain.includes(whitelistDomain) || domain === whitelistDomain) {
          isWhitelisted = true
          break
        }
      }

      // 如果不在白名单中，返回这个URL
      if (!isWhitelisted) {
        return url
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

  /**
   * 仅更新处罚类型，不增加计数
   * 避免重复增加警告次数
   */
  private async updatePunishmentType(
    userId: string,
    guildId: string,
    triggerInfo: {
      keyword: string,
      type: 'keyword' | 'url',
      action: 'warn' | 'mute' | 'kick',
      messageContent?: string
    }
  ): Promise<void> {
    try {
      // 获取当前记录
      const record = await this.ctx.database.get('keyword_warnings', {
        userId: userId,
        guildId: guildId || ''
      }).then(records => records[0])

      if (!record) {
        this.ctx.logger.warn(`更新处罚类型失败: 找不到记录 ${guildId}:${userId}`)
        return
      }

      // 更新处罚类型相关字段，但不修改计数
      const updateData: any = {
        lastTriggerKeyword: triggerInfo.keyword || '',
        lastTriggerType: triggerInfo.type || 'keyword',
        lastActionType: triggerInfo.action || 'warn',
      }

      // 保存完整的消息内容
      if (triggerInfo.messageContent) {
        updateData.lastMessageContent = triggerInfo.messageContent;
      }

      // 更新数据库
      await this.ctx.database.set('keyword_warnings', {
        userId: userId,
        guildId: guildId || ''
      }, updateData)

      this.ctx.logger.info(`已更新用户 ${userId} 的处罚类型为 ${triggerInfo.action}`)
    } catch (error) {
      this.ctx.logger.error(`更新处罚类型失败: ${error.message}`)
    }
  }

  // 处理自动处罚
  private async handleAutoPunishment(meta: Session, config: PluginConfig, matchedKeyword: string): Promise<boolean> {
    // 检查机器人权限
    const hasBotPermission = await this.checkBotPermission(meta)

    if (!config.enableAutoPunishment) {
      // 如果未启用自动处罚，则使用原有的处罚逻辑
      // 撤回消息已在外层handleKeywordDetection中处理，此处不再重复

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

    // 撤回消息已在外层handleKeywordDetection中处理，此处不再重复

    let actionTaken = false
    let message = ''

    // 根据违规次数执行不同的处罚，只有在有权限时才执行
    if (hasBotPermission) {
      if (violationCount === 1) {
        // 第一次：警告
        message = `您触发了关键词"${matchedKeyword}"，这是第一次警告。`
        actionTaken = true

        // 更新处罚类型为警告
        await this.updatePunishmentType(
          meta.userId,
          meta.guildId,
          {
            keyword: matchedKeyword,
            type: 'keyword',
            action: 'warn',
            messageContent: this.getMessageContent(meta)
          }
        )
      }
      else if (violationCount >= 2) {
        // 计算禁言时长，随违规次数递增
        let muteDuration = 0;

        if (violationCount === 2) {
          // 第二次违规：使用配置的第二次违规禁言时长
          muteDuration = config.secondViolationMuteDuration;
          this.ctx.logger.info(`[${meta.guildId}] 第二次违规，禁言时长: ${muteDuration}秒`);
        }
        else if (violationCount >= config.maxViolationCount) {
          // 达到最大违规次数
          if (config.kickOnMaxViolation) {
            const kicked = await this.kickUser(meta)
            if (kicked) {
              message = `用户 ${meta.username || meta.userId} 因多次触发关键词"${matchedKeyword}"已被踢出群聊。`
              actionTaken = true

              // 更新处罚类型为踢出
              await this.updatePunishmentType(
                meta.userId,
                meta.guildId,
                {
                  keyword: matchedKeyword,
                  type: 'keyword',
                  action: 'kick',
                  messageContent: this.getMessageContent(meta)
                }
              )
              return actionTaken; // 踢出后不需要继续处理
            }
            // 如果踢出失败，使用长时间禁言
            muteDuration = 3600; // 1小时
          } else {
            // 配置为不踢出，使用长时间禁言
            muteDuration = 3600; // 1小时
          }
        }
        else {
          // 中间违规次数：禁言时间按倍数递增
          // 使用第二次违规时长的倍数：(违规次数-1)倍
          muteDuration = config.secondViolationMuteDuration * (violationCount - 1);
          this.ctx.logger.info(`[${meta.guildId}] 第${violationCount}次违规，禁言时长: ${muteDuration}秒 (${config.secondViolationMuteDuration} × ${violationCount-1})`);
        }

        // 执行禁言
        if (muteDuration > 0) {
          const muted = await this.muteUser(meta, muteDuration)
          if (muted) {
            const durationText = this.formatDuration(muteDuration)
            message = `您触发了关键词"${matchedKeyword}"，这是第${violationCount}次违规，已禁言${durationText}。`
            actionTaken = true

            // 更新处罚类型为禁言
            await this.updatePunishmentType(
              meta.userId,
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

  // 检测到关键词时的处理
  async handleKeywordDetection(meta: Session, config: PluginConfig): Promise<boolean> {
    // 获取消息内容
    const content = this.getMessageContent(meta) || ''

    // 简化日志，仅记录检测开始
    this.ctx.logger.info(`[${meta.guildId}] 检测关键词，内容长度: ${content.length}字符`)

    // 使用checkKeywords方法进行检测，而不是简单的includes
    const matchedKeyword = this.checkKeywords(content, config.keywords, config)

    if (matchedKeyword) {
      this.ctx.logger.info(`[${meta.guildId}] 检测到关键词: ${matchedKeyword}`)

      // 检查机器人权限
      const hasBotPermission = await this.checkBotPermission(meta)

      // 确保优先执行撤回操作，无论后续处理如何
      let recallResult = false;
      if (config.recall) {
        recallResult = await this.recallMessage(meta);
        this.ctx.logger.info(`[${meta.guildId}] 关键词"${matchedKeyword}"触发撤回: ${recallResult ? '成功' : '失败'}`);
      }

      // 根据撤回结果和机器人权限，决定是否继续其他处罚
      if (!hasBotPermission) {
        this.ctx.logger.warn(`[${meta.guildId}] 机器人没有管理权限，只能执行撤回操作，跳过其他处罚`);
        return recallResult; // 如果只撤回成功也算处理成功
      }

      // 如果启用自动处罚
      if (config.enableAutoPunishment) {
        return await this.handleAutoPunishment(meta, config, matchedKeyword)
      }

      // 如果未启用自动处罚，则使用原有的处罚逻辑
      if (config.mute && hasBotPermission) {
        // 使用基类的muteUser方法而不是直接调用API
        const muted = await this.muteUser(meta, config.muteDuration)
        if (muted) {
          this.ctx.logger.info(`[${meta.guildId}] 用户 ${meta.userId} 因触发关键词 "${matchedKeyword}" 已被禁言 ${config.muteDuration} 秒`)
          if (config.customMessage) {
            const durationText = this.formatDuration(config.muteDuration)
            await this.sendNotice(meta, config.customMessage, durationText)
          }
        }
      } else if (config.customMessage && hasBotPermission) {
        await this.sendNotice(meta, config.customMessage)
      }

      // 如果有撤回操作，即使其他处罚失败也算处理成功
      return recallResult || true;
    } else {
      // 减少不必要的日志输出
      if (config.enableDebugMode) {
        this.ctx.logger.debug(`[${meta.guildId}] 未检测到关键词`)
      }
    }

    return false
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
