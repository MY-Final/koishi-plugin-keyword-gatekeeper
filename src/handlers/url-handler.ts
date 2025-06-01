import { Session, h } from 'koishi'
import { MessageHandler } from './base-handler'
import { Config as PluginConfig } from '../types'
import { WarningManager } from './warning-manager'

// 网址处理器
export class UrlHandler extends MessageHandler {
  // 网址正则表达式 - 增强版，可以匹配不带协议前缀的域名
  private readonly URL_REGEX = /(https?:\/\/)?(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/gi

  // 使用警告记录管理器
  private warningManager: WarningManager

  constructor(ctx) {
    super(ctx)
    this.warningManager = new WarningManager(ctx)
  }

  // 检查是否包含网址
  checkUrls(message: string, whitelist: string[]): string | null {
    if (!message) return null

    // 排除所有插件命令格式
    // 1. 检查是否是插件命令
    if (message.match(/^(\/|\.)?kw(\.|\ )/i)) {
      this.ctx.logger.debug(`跳过插件命令检测: ${message}`)
      return null
    }

    // 2. 特别排除所有预设命令，避免任何误判
    const pluginCommands = [
      'kw.group.preset', 'kw group preset',
      'kw.group.remove-preset', 'kw group remove-preset',
      'kw.group.enable', 'kw group enable',
      'kw.group.disable', 'kw group disable',
      'kw.group.reset', 'kw group reset',
      'kw.warning.my', 'kw warning my',
      'kw.warning.query', 'kw warning query',
      'kw.warning.reset', 'kw warning reset',
      'kw.warning.list', 'kw warning list',
      'kw.url.whitelist', 'kw url whitelist'
    ]

    if (pluginCommands.some(cmd => message.startsWith(cmd))) {
      this.ctx.logger.debug(`跳过特定插件命令: ${message}`)
      return null
    }

    const urls = message.match(this.URL_REGEX)
    if (!urls || urls.length === 0) return null

    // 检查是否在白名单中
    for (const url of urls) {
      // 排除QQ表情包、图片和其他媒体资源URL
      // 1. QQ表情包和图片常见标识
      if (url.includes('QFace') ||
          url.includes('/gchatpic_new/') ||
          url.includes('/c2c-') ||
          url.includes('/emoji/') ||
          url.includes('/face/')) {
        this.ctx.logger.debug(`跳过QQ表情包/图片URL: ${url}`)
        continue
      }

      // 2. 常见媒体文件扩展名
      const mediaExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.mp4', '.mp3', '.wav', '.webm', '.ogg'];
      if (mediaExtensions.some(ext => url.toLowerCase().endsWith(ext))) {
        this.ctx.logger.debug(`跳过媒体文件URL: ${url}`)
        continue
      }

      // 3. 特殊判断资源链接
      if (url.includes('/offical/') ||
          url.includes('/image/') ||
          url.includes('/sticker/') ||
          url.includes('/resource/') ||
          url.includes('/download?')) {
        this.ctx.logger.debug(`跳过资源文件URL: ${url}`)
        continue
      }

      try {
        // 确保有协议前缀，以便 URL 构造函数能够正确解析
        let urlWithProtocol = url
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          urlWithProtocol = 'http://' + url
        }

        const urlObj = new URL(urlWithProtocol)
        const hostname = urlObj.hostname

        // 4. 特殊处理QQ多媒体链接
        if (hostname.includes('multimedia') ||
            hostname.includes('media') ||
            hostname.includes('img') ||
            hostname.includes('pic') ||
            hostname.includes('static') ||
            hostname.includes('cdn')) {
          this.ctx.logger.debug(`跳过多媒体域名URL: ${url} (${hostname})`)
          continue
        }

        // 检查域名是否在白名单中
        const isWhitelisted = whitelist.some(domain =>
          hostname === domain || hostname.endsWith(`.${domain}`))

        if (!isWhitelisted) {
          // 进一步排除常见的安全域名
          const commonSafeDomains = [
            'qq.com', 'gtimg.com', 'qpic.cn', 'qlogo.cn',
            'nt.qq.com.cn', 'qzone.qq.com', 'qqmail.com',
            'tencent.com', 'myqcloud.com'
          ];
          if (commonSafeDomains.some(domain => hostname.endsWith(`.${domain}`) || hostname === domain)) {
            this.ctx.logger.debug(`跳过安全域名URL: ${url} (${hostname})`)
            continue;
          }

          // 对于实际检测到的非白名单URL，保留info级别日志
          this.ctx.logger.info(`检测到非白名单URL: ${url} (${hostname})`)
          return url // 返回第一个不在白名单中的URL
        }
      } catch (error) {
        this.ctx.logger.warn(`URL解析错误: ${error.message}`, url)
      }
    }

    return null
  }

  // 处理网址检测
  async handleUrlDetection(meta: Session, config: PluginConfig): Promise<boolean> {
    // 如果未启用网址检测，直接返回
    if (!config.detectUrls) return false

    // 获取消息内容
    const message = this.getMessageContent(meta)

    // 检查是否包含非白名单网址
    const matchedUrl = this.checkUrls(message, config.urlWhitelist)
    if (!matchedUrl) return false

    // 检查用户是否为管理员
    if (await this.isUserAdmin(meta)) {
      this.ctx.logger.info(`[${meta.guildId}] 用户 ${meta.userId} 是管理员，不进行网址检测处理`)
      return false
    }

    // 检查机器人权限
    const hasBotPermission = await this.checkBotPermission(meta)

    // 如果启用了自动处罚机制，则使用自动处罚
    if (config.enableAutoPunishment) {
      return await this.handleAutoPunishment(meta, config, matchedUrl)
    }

    // 否则使用原有逻辑
    // 处理撤回
    if (config.urlAction === 'recall' || config.urlAction === 'both') {
      await this.recallMessage(meta)
    }

    // 处理禁言
    if ((config.urlAction === 'mute' || config.urlAction === 'both') && hasBotPermission) {
      const muted = await this.muteUser(meta, config.urlMuteDuration)

      if (muted) {
        const durationText = this.formatDuration(config.urlMuteDuration)

        // 发送提示消息
        if (config.urlCustomMessage) {
          await this.sendNotice(meta, config.urlCustomMessage, durationText)
        }

        this.ctx.logger.info(`[${meta.guildId}] 用户 ${meta.userId} 因发送网址 "${matchedUrl}" 被禁言 ${durationText}`)
      }
    } else if (config.urlCustomMessage && hasBotPermission) {
      // 只有在有权限时才发送提示消息
      await this.sendNotice(meta, config.urlCustomMessage)
    } else if (!hasBotPermission && (config.urlAction === 'mute' || config.urlAction === 'both')) {
      // 如果没有权限，只记录日志不发送消息
      this.ctx.logger.warn(`[${meta.guildId}] 机器人没有管理权限，无法禁言用户`)
    }

    return true
  }

  // 处理自动处罚
  private async handleAutoPunishment(meta: Session, config: PluginConfig, matchedUrl: string): Promise<boolean> {
    // 检查机器人权限
    const hasBotPermission = await this.checkBotPermission(meta)

    // 记录处理前的状态
    const beforeRecord = await this.warningManager.queryUserWarningRecord(meta.userId, config, meta.guildId)
    this.ctx.logger.info(`[${meta.guildId}] 处理前用户 ${meta.userId} 的警告记录: 次数=${beforeRecord.count}`)

    // 更新并获取用户的违规次数
    const violationCount = await this.warningManager.updateUserPunishmentRecord(
      meta.userId,
      config,
      meta.guildId,
      {
        keyword: matchedUrl,
        type: 'url',
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
    if (config.urlAction === 'recall' || config.urlAction === 'both') {
      await this.recallMessage(meta)
    }

    // 如果没有权限，记录日志但不执行处罚操作
    if (!hasBotPermission) {
      this.ctx.logger.warn(`[${meta.guildId}] 机器人没有管理权限，无法执行处罚操作`)
      return true
    }

    let actionTaken = false
    let message = ''

    // 根据违规次数执行不同的处罚
    if (violationCount === 1) {
      // 第一次：警告
      message = `您发送了非白名单网址"${matchedUrl}"，这是第一次警告。`
      actionTaken = true

      // 更新处罚类型为警告
      await this.warningManager.updateUserPunishmentRecord(
        meta.userId,
        config,
        meta.guildId,
        {
          keyword: matchedUrl,
          type: 'url',
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
            message = `用户 ${meta.username || meta.userId} 因多次发送非白名单网址"${matchedUrl}"已被踢出群聊。`
            actionTaken = true

            // 更新处罚类型为踢出
            await this.warningManager.updateUserPunishmentRecord(
              meta.userId,
              config,
              meta.guildId,
              {
                keyword: matchedUrl,
                type: 'url',
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
          message = `您发送了非白名单网址"${matchedUrl}"，这是第${violationCount}次违规，已禁言${durationText}。`
          actionTaken = true

          // 更新处罚类型为禁言
          await this.warningManager.updateUserPunishmentRecord(
            meta.userId,
            config,
            meta.guildId,
            {
              keyword: matchedUrl,
              type: 'url',
              action: 'mute',
              messageContent: this.getMessageContent(meta)
            }
          )
        }
      }
    }

    // 发送处罚通知
    if (actionTaken && message) {
      await this.sendNotice(meta, message)
      this.ctx.logger.info(`[${meta.guildId}] 用户 ${meta.userId} 因发送非白名单网址 "${matchedUrl}" 第${violationCount}次违规，已执行自动处罚`)
    }

    return actionTaken
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

  // 查询用户警告记录
  async queryUserWarningRecord(userId: string, config: PluginConfig, guildId?: string): Promise<{count: number, resetTime: string}> {
    return await this.warningManager.queryUserWarningRecord(userId, config, guildId)
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
