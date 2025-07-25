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
  checkKeywords(message: string, keywords: string[], useRegex: boolean = false, regexFlags: string = 'i'): string | null {
    if (!keywords || keywords.length === 0) return null

    const lowerMessage = message.toLowerCase()
    for (const keyword of keywords) {
      if (!keyword) continue

      try {
        // 使用正则表达式匹配
        if (useRegex) {
          const flags = regexFlags || 'i'
          const regex = new RegExp(keyword, flags)
          if (regex.test(message)) {
            return keyword
          }
        }
        // 使用普通文本匹配
        else {
          const lowerKeyword = keyword.toLowerCase();
          if (lowerMessage.includes(lowerKeyword)) {
            return keyword
          }
        }
      } catch (error) {
        this.ctx.logger.warn(`关键词匹配错误: ${error.message}`, keyword)

        // 如果正则表达式有错误，尝试使用普通文本匹配
        const lowerKeyword = keyword.toLowerCase();
        if (lowerMessage.includes(lowerKeyword)) {
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

    // 常见的图片和表情域名白名单
    const imageWhitelist = [
      'qpic.cn',       // QQ图片
      'gchat.qpic.cn', // QQ群聊图片
      'c2cpicdw.qpic.cn', // QQ个人图片
      'p.qpic.cn',     // QQ表情包
      'pic.qq.com',    // QQ相关图片
      'mmbiz.qpic.cn', // 微信公众号图片
      'wx.qlogo.cn',   // 微信头像
      'thirdqq.qlogo.cn', // QQ头像
      'q1.qlogo.cn',   // QQ头像
      'q2.qlogo.cn',   // QQ头像
      'q3.qlogo.cn',   // QQ头像
      'q4.qlogo.cn',   // QQ头像
      'qlogo.cn',      // QQ相关图片
      'emoji.qq.com',  // QQ表情
      'img.alicdn.com', // 阿里云图片
      'img.aliyun.com', // 阿里云图片
      'img.alicdn.com', // 阿里云图片
      'aliyuncs.com',  // 阿里云服务
      'baidu.com',     // 百度相关
      'bdstatic.com',  // 百度静态资源
      '126.net',       // 网易相关
      '163.com',       // 网易相关
      'qiniucdn.com',  // 七牛云
      'qnimg.cn',      // 七牛云
      'qiniup.com',    // 七牛云
      'myqcloud.com',  // 腾讯云
      'cos.ap-',       // 腾讯云COS
      'tencent-cloud.cn' // 腾讯云
    ]

    // 检查是否在白名单中
    for (const url of urls) {
      // 提取域名
      const domain = url.replace(/^https?:\/\//, '').split('/')[0].split(':')[0]

      // 检查是否为QQ的CQ码图片
      if (url.includes('[CQ:image') || url.includes('[CQ:face')) {
        continue
      }

      // 检查是否为图片域名白名单
      let isImageDomain = false
      for (const imageDomain of imageWhitelist) {
        if (domain.includes(imageDomain)) {
          isImageDomain = true
          break
        }
      }

      // 如果是图片域名，直接跳过
      if (isImageDomain) {
        continue
      }

      // 如果在用户配置的白名单中，则跳过
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
        this.ctx.logger.debug(`[${meta.guildId}] 使用 onebot.deleteMsg 撤回成功`)
        return true
      }
      // 使用 bot.deleteMessage 撤回消息
      else if (meta.messageId) {
        await meta.bot.deleteMessage(meta.channelId, meta.messageId)
        this.ctx.logger.debug(`[${meta.guildId}] 使用 bot.deleteMessage 撤回成功`)
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
      this.ctx.logger.debug(`[${meta.guildId}] 尝试禁言用户 ${meta.userId}，时长: ${duration}秒`)

      // 尝试使用 OneBot 的 setGroupBan 方法
      if ((meta as any).onebot?.setGroupBan) {
        await (meta as any).onebot.setGroupBan(meta.guildId, meta.userId, duration)
        this.ctx.logger.debug(`[${meta.guildId}] 使用 onebot.setGroupBan 禁言成功`)
        return true
      }
      // 优先使用 bot 对象上的 $setGroupBan 方法（OneBot 适配器）
      else if (meta.bot && typeof meta.bot['$setGroupBan'] === 'function') {
        await meta.bot['$setGroupBan'](meta.guildId, meta.userId, duration)
        this.ctx.logger.debug(`[${meta.guildId}] 使用 bot.$setGroupBan 禁言成功`)
        return true
      }
      // 尝试使用 setGroupBan 方法（可能是 OneBot 适配器）
      else if (meta.bot && typeof meta.bot['setGroupBan'] === 'function') {
        await meta.bot['setGroupBan'](meta.guildId, meta.userId, duration)
        this.ctx.logger.debug(`[${meta.guildId}] 使用 bot.setGroupBan 禁言成功`)
        return true
      }
      // 最后尝试通用 API
      else if (meta.bot && typeof meta.bot.muteGuildMember === 'function') {
        await meta.bot.muteGuildMember(meta.guildId, meta.userId, duration)
        this.ctx.logger.debug(`[${meta.guildId}] 使用通用 API 禁言成功`)
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

    // 记录处理前的状态
    const beforeRecord = await this.warningManager.queryUserWarningRecord(meta.userId, config, meta.guildId)
    this.ctx.logger.info(`[${meta.guildId}] 关键词处罚: 处理前用户 ${meta.userId} 的警告记录: 次数=${beforeRecord.count}`)

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
    this.ctx.logger.info(`[${meta.guildId}] 关键词处罚: 已更新用户 ${meta.userId} 的警告记录: 次数=${violationCount}`)

    // 记录处理后的状态
    const afterRecord = await this.warningManager.queryUserWarningRecord(meta.userId, config, meta.guildId)
    this.ctx.logger.info(`[${meta.guildId}] 关键词处罚: 处理后用户 ${meta.userId} 的警告记录: 次数=${afterRecord.count}`)

    if (beforeRecord.count === afterRecord.count && violationCount !== afterRecord.count) {
      this.ctx.logger.warn(`[${meta.guildId}] 关键词处罚: 警告记录更新异常: 预期次数=${violationCount}, 实际次数=${afterRecord.count}`)
    }

    // 撤回消息已在外层handleKeywordDetection中处理，此处不再重复
    if (config.recall) {
      this.ctx.logger.info(`[${meta.guildId}] 关键词处罚: 已撤回用户 ${meta.userId} 的违规消息`)
    }

    // 如果没有权限，记录日志但不执行处罚操作
    if (!hasBotPermission) {
      this.ctx.logger.warn(`[${meta.guildId}] 关键词处罚: 机器人没有管理权限，无法执行处罚操作`)
      return true
    }

    let actionTaken = false
    let message = ''
    let actionType: 'warn' | 'mute' | 'kick' = 'warn' // 默认为警告

    // 根据违规次数执行不同的处罚
    if (violationCount === 1) {
      // 第一次：警告
      message = `您触发了关键词"${matchedKeyword}"，这是第一次警告。`
      actionTaken = true
      this.ctx.logger.info(`[${meta.guildId}] 关键词处罚: 用户 ${meta.userId} 第1次违规，执行警告`)
    }
    else if (violationCount >= 2) {
      // 计算禁言时长，随违规次数递增
      let muteDuration = 0;

      if (violationCount === 2) {
        // 第二次违规：使用配置的第二次违规禁言时长
        muteDuration = config.secondViolationMuteDuration;
        this.ctx.logger.info(`[${meta.guildId}] 关键词处罚: 第二次违规，禁言时长: ${muteDuration}秒`);
      }
      else if (violationCount >= config.maxViolationCount) {
        // 达到最大违规次数
        if (config.kickOnMaxViolation) {
          this.ctx.logger.info(`[${meta.guildId}] 关键词处罚: 用户 ${meta.userId} 达到最大违规次数 ${violationCount}/${config.maxViolationCount}，尝试执行踢出`)
          const kicked = await this.kickUser(meta)
          if (kicked) {
            message = `用户 ${meta.username || meta.userId} 因多次触发关键词"${matchedKeyword}"已被踢出群聊。`
            actionTaken = true
            actionType = 'kick'
            this.ctx.logger.info(`[${meta.guildId}] 关键词处罚: 用户 ${meta.userId} 第${violationCount}次违规，已踢出群聊`)

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
          this.ctx.logger.warn(`[${meta.guildId}] 关键词处罚: 踢出用户 ${meta.userId} 失败，将使用长时间禁言代替`)
          muteDuration = 3600; // 1小时
        } else {
          // 配置为不踢出，使用长时间禁言
          muteDuration = 3600; // 1小时
          this.ctx.logger.info(`[${meta.guildId}] 关键词处罚: 用户 ${meta.userId} 达到最大违规次数 ${violationCount}/${config.maxViolationCount}，执行长时间禁言(${muteDuration}秒)`)
        }
      }
      else {
        // 中间违规次数：禁言时间按倍数递增
        // 使用第二次违规时长的倍数：(违规次数-1)倍
        muteDuration = config.secondViolationMuteDuration * (violationCount - 1);
        this.ctx.logger.info(`[${meta.guildId}] 关键词处罚: 第${violationCount}次违规，禁言时长: ${muteDuration}秒 (${config.secondViolationMuteDuration} × ${violationCount-1})`);
      }

      // 执行禁言
      if (muteDuration > 0) {
        const muted = await this.muteUser(meta, muteDuration)
        if (muted) {
          const durationText = this.formatDuration(muteDuration)
          message = `您触发了关键词"${matchedKeyword}"，这是第${violationCount}次违规，已禁言${durationText}。`
          actionTaken = true
          actionType = 'mute'
          this.ctx.logger.info(`[${meta.guildId}] 关键词处罚: 用户 ${meta.userId} 第${violationCount}次违规，已禁言${durationText}`)
        } else {
          this.ctx.logger.warn(`[${meta.guildId}] 关键词处罚: 禁言用户 ${meta.userId} 失败`)
        }
      }
    }

    // 更新处罚类型
    if (actionTaken && actionType !== 'warn') {
      await this.updatePunishmentType(
        meta.userId,
        meta.guildId,
        {
          keyword: matchedKeyword,
          type: 'keyword',
          action: actionType,
          messageContent: this.getMessageContent(meta)
        }
      )
    }

    // 发送处罚通知
    if (actionTaken && message) {
      await this.sendNotice(meta, message)
      this.ctx.logger.info(`[${meta.guildId}] 关键词处罚: 用户 ${meta.userId} 因触发关键词 "${matchedKeyword}" 第${violationCount}次违规，已执行自动处罚并发送通知`)
    }

    return actionTaken
  }

  /**
   * 处理关键词检测
   * @param meta 消息元数据
   * @param config 插件配置
   * @returns 是否检测到关键词
   */
  async handleKeywordDetection(meta: any, config: PluginConfig): Promise<boolean> {
    // 获取消息内容
    let content = this.getMessageContent(meta)
    if (!content) return false

    // 提取关键词列表
    const keywords = config.keywords || []

    // 检测关键词
    const matchResult = this.checkKeywords(content, keywords, config.useRegex, config.regexFlags)

    if (matchResult) {
      // 只在实际触发时输出简短日志，避免过多细节
      const shortContent = content.length > 20 ? content.substring(0, 20) + '...' : content
      if (config.enableDebugMode) {
        this.ctx.logger.info(`检测到关键词: ${matchResult}`)
        this.ctx.logger.debug(`内容长度: ${content.length}字符`)
      }

      // 检查机器人权限
      const hasBotPermission = await this.checkBotPermission(meta)

      // 优先执行撤回操作
      if (config.recall) {
        await this.recallMessage(meta)
      }

      // 根据是否启用自动处罚机制选择处理方式
      if (config.enableAutoPunishment) {
        // 使用自动处罚机制（升级处罚）
        return await this.handleAutoPunishment(meta, config, matchResult)
      } else {
        // 使用简单处罚逻辑
        if (config.mute && hasBotPermission) {
          await this.muteUser(meta, config.muteDuration)

          // 更新处罚记录
          await this.warningManager.updateUserPunishmentRecord(
            meta.userId,
            config,
            meta.guildId,
            {
              keyword: matchResult,
              type: 'keyword',
              action: 'mute',
              messageContent: content
            }
          )
        }

        // 发送提示消息
        if (config.customMessage && hasBotPermission) {
          await this.sendNotice(meta, config.customMessage)
        }
      }

      return true
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
