import { Context } from 'koishi'
import { Config } from '../types'
import { KeywordDatabase } from '../database'
import { WarningManager } from './warning-manager'

/**
 * 注册消息处理器
 * 用于检测和处理消息中的关键词和URL
 */
export function registerMessageHandler(ctx: Context, config: Config, database: KeywordDatabase) {
  // 创建日志记录器
  const logger = ctx.logger('keyword-gatekeeper')

  // 创建警告管理器
  const warningManager = new WarningManager(ctx)

  // 注册中间件
  ctx.middleware(async (meta, next) => {
    // 只处理群聊消息
    if (!meta.guildId) return next()

    try {
      // 获取消息内容
      const content = meta.content || ''

      // 检查是否为命令 - 仅基于内容检查，避免类型错误
      const isCommand = content.startsWith('kw') ||
                         content.startsWith('kw.') ||
                         content.startsWith('/kw') ||
                         content.startsWith('.kw')

      // 如果是命令，跳过关键词和网址检测
      if (isCommand) {
        logger.debug(`[${meta.guildId}] 跳过命令检测: ${content}`)
        return next()
      }

      // 检查群组是否在启用列表中
      if (config.enableGroupSpecificConfig) {
        const groupConfig = await database.getGroupConfig(meta.guildId)

        // 如果群组配置存在且已启用
        if (groupConfig && groupConfig.enabled) {
          logger.debug(`[${meta.guildId}] 使用群组特定配置进行检测`)

          // 检测关键词
          if (await detectKeywords(ctx, meta, groupConfig.keywords, groupConfig.customMessage || config.customMessage, config, warningManager)) {
            return next()
          }

          // 检测URL
          if (config.detectUrls) {
            if (await detectUrls(ctx, meta, groupConfig.urlWhitelist || config.urlWhitelist,
                                groupConfig.urlCustomMessage || config.urlCustomMessage, config, warningManager)) {
              return next()
            }
          }

          // 如果没有触发任何检测，继续处理消息
          return next()
        }

        // 检查是否在自动启用的群组列表中
        if (config.enabledGroups && config.enabledGroups.includes(meta.guildId)) {
          // 如果在自动启用列表中但还没有配置，创建一个新的配置
          if (!groupConfig) {
            logger.info(`[${meta.guildId}] 群组在自动启用列表中，创建新配置`)

            // 创建默认配置
            const newConfig = {
              guildId: meta.guildId,
              enabled: true,
              keywords: [],
              customMessage: config.customMessage,
              urlWhitelist: [],
              urlCustomMessage: config.urlCustomMessage
            }

            await database.createGroupConfig(newConfig)

            // 如果配置了自动导入预设包
            if (config.autoImportPresets && config.defaultPresets && config.defaultPresets.length > 0) {
              logger.info(`[${meta.guildId}] 自动导入预设包`)

              // 导入每个预设包
              for (const presetName of config.defaultPresets) {
                const preset = await database.getPresetPackage(presetName)
                if (preset) {
                  // 合并关键词
                  newConfig.keywords = [...new Set([...newConfig.keywords, ...preset.keywords])]
                  logger.info(`[${meta.guildId}] 导入预设包 ${presetName}，添加 ${preset.keywords.length} 个关键词`)
                }
              }

              // 更新配置
              await database.updateGroupConfig(meta.guildId, { keywords: newConfig.keywords })
            }
          }
        }
      }

      // 使用全局配置进行检测
      logger.debug(`[${meta.guildId}] 使用全局配置进行检测`)

      // 检测关键词
      if (await detectKeywords(ctx, meta, config.keywords, config.customMessage, config, warningManager)) {
        return next()
      }

      // 检测URL
      if (config.detectUrls) {
        if (await detectUrls(ctx, meta, config.urlWhitelist, config.urlCustomMessage, config, warningManager)) {
          return next()
        }
      }
    } catch (error) {
      logger.error(`[${meta.guildId}] 处理异常: ${error.message}`)
    }

    return next()
  }, true)
}

/**
 * 检测消息中的关键词
 */
async function detectKeywords(ctx: Context, meta: any, keywords: string[], customMessage: string, config: Config, warningManager: WarningManager): Promise<boolean> {
  // 如果没有关键词，直接返回
  if (!keywords || keywords.length === 0) {
    return false
  }

  const content = meta.content || ''
  const logger = ctx.logger('keyword-gatekeeper')

  // 获取配置
  const pluginConfig = ctx.config.keyword_gatekeeper || ctx.config['keyword-gatekeeper'] || config

  // 检测每个关键词
  for (const keyword of keywords) {
    if (content.includes(keyword)) {
      logger.info(`[${meta.guildId}] 检测到关键词: ${keyword}`)

      // 确定处罚类型
      let actionType: 'warn' | 'mute' | 'kick' = 'warn'

      // 尝试撤回消息
      let recallSuccess = false
      try {
        if (meta.session && typeof meta.session.recall === 'function') {
          await meta.session.recall()
          logger.info(`[${meta.guildId}] 已撤回包含关键词的消息`)
          recallSuccess = true
        } else if (typeof meta.recall === 'function') {
          await meta.recall()
          logger.info(`[${meta.guildId}] 已撤回包含关键词的消息`)
          recallSuccess = true
        } else if (meta.bot && typeof meta.bot.deleteMessage === 'function') {
          await meta.bot.deleteMessage(meta.guildId, meta.messageId)
          logger.info(`[${meta.guildId}] 已撤回包含关键词的消息`)
          recallSuccess = true
        } else {
          logger.warn(`[${meta.guildId}] 无法撤回消息：找不到可用的撤回方法`)
        }
      } catch (e) {
        logger.error(`[${meta.guildId}] 撤回消息失败: ${e.message}`)
      }

      // 如果配置了禁言功能，则禁言用户
      let muteSuccess = false
      if (pluginConfig && pluginConfig.mute) {
        try {
          await muteUser(ctx, meta, pluginConfig.muteDuration || 300)
          logger.info(`[${meta.guildId}] 已禁言用户 ${meta.userId} ${pluginConfig.muteDuration || 300}秒，因触发关键词: ${keyword}`)
          muteSuccess = true
          actionType = 'mute'
        } catch (e) {
          logger.error(`[${meta.guildId}] 禁言用户失败: ${e.message}`)
        }
      }

      // 更新警告记录
      try {
        // 构建触发信息
        const triggerInfo = {
          keyword: keyword,
          type: 'keyword' as 'keyword' | 'url',
          action: actionType,
          messageContent: content
        }

        // 更新用户处罚记录
        const violationCount = await warningManager.updateUserPunishmentRecord(
          meta.userId,
          pluginConfig,
          meta.guildId,
          triggerInfo
        )

        logger.info(`[${meta.guildId}] 用户 ${meta.userId} 违规次数已更新: ${violationCount}`)
      } catch (e) {
        logger.error(`[${meta.guildId}] 更新警告记录失败: ${e.message}`)
      }

      // 发送提示消息
      if (customMessage) {
        const message = customMessage.replace('{user}', `<at id="${meta.userId}"/>`)
        await meta.send(message)
      }

      return true
    }
  }

  return false
}

/**
 * 检测消息中的URL
 */
async function detectUrls(ctx: Context, meta: any, whitelist: string[], customMessage: string, config: Config, warningManager: WarningManager): Promise<boolean> {
  const content = meta.content || ''
  const logger = ctx.logger('keyword-gatekeeper')

  // 获取配置
  const pluginConfig = ctx.config.keyword_gatekeeper || ctx.config['keyword-gatekeeper'] || config

  // 更新的URL正则表达式，能够检测更多格式的URL，包括没有协议前缀的域名
  // 1. 标准URL格式 (https://example.com)
  // 2. 无协议域名 (example.com)
  // 3. 带子域名 (sub.example.com)
  // 4. 带路径 (example.com/path)
  // 5. 带端口 (example.com:8080)
  const urlRegex = /(https?:\/\/)?([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}(:\d{1,5})?(\/[a-zA-Z0-9%_\-.\/?=&#]*)?/gi

  // 查找所有匹配的URL
  const urls = content.match(urlRegex)

  if (!urls) {
    return false
  }

  logger.debug(`[${meta.guildId}] 检测到URL: ${urls.join(', ')}`)

  // 检查是否为QQ表情包或图片链接
  for (let url of urls) {
    // 移除可能的结尾标点
    url = url.replace(/[.,;!?]$/, '')

    // 记录原始匹配的URL用于调试
    logger.debug(`[${meta.guildId}] 正在检查URL: ${url}`)

    // 检查是否为QQ多媒体链接
    if (url.includes('gchat.qpic.cn') ||
        url.includes('c2cpicdw.qpic.cn') ||
        url.includes('p.qpic.cn') ||
        url.includes('c2c.qpic.cn') ||
        url.includes('vip.image.qpic.cn')) {
      logger.debug(`[${meta.guildId}] 跳过QQ多媒体链接: ${url}`)
      continue
    }

    // 检查是否在白名单中
    let isWhitelisted = false
    for (const domain of whitelist || []) {
      if (url.toLowerCase().includes(domain.toLowerCase())) {
        isWhitelisted = true;
        logger.debug(`[${meta.guildId}] URL ${url} 在白名单中: ${domain}`)
        break
      }
    }

    if (!isWhitelisted) {
      logger.info(`[${meta.guildId}] 检测到非白名单URL: ${url}`)

      // 确定处罚类型
      let actionType: 'warn' | 'mute' | 'kick' = 'warn'

      // 根据配置执行操作
      let recallSuccess = false
      if (pluginConfig.urlAction === 'recall' || pluginConfig.urlAction === 'both') {
        try {
          if (meta.session && typeof meta.session.recall === 'function') {
            await meta.session.recall()
            logger.info(`[${meta.guildId}] 已撤回包含非白名单URL的消息`)
            recallSuccess = true
          } else if (typeof meta.recall === 'function') {
            await meta.recall()
            logger.info(`[${meta.guildId}] 已撤回包含非白名单URL的消息`)
            recallSuccess = true
          } else if (meta.bot && typeof meta.bot.deleteMessage === 'function') {
            await meta.bot.deleteMessage(meta.guildId, meta.messageId)
            logger.info(`[${meta.guildId}] 已撤回包含非白名单URL的消息`)
            recallSuccess = true
          } else {
            logger.warn(`[${meta.guildId}] 无法撤回消息：找不到可用的撤回方法`)
          }
        } catch (e) {
          logger.error(`[${meta.guildId}] 撤回消息失败: ${e.message}`)
        }
      }

      // 如果配置了禁言功能，则禁言用户
      let muteSuccess = false
      if (pluginConfig.urlAction === 'mute' || pluginConfig.urlAction === 'both') {
        try {
          await muteUser(ctx, meta, pluginConfig.urlMuteDuration || 300)
          logger.info(`[${meta.guildId}] 已禁言用户 ${meta.userId} ${pluginConfig.urlMuteDuration || 300}秒，因发送非白名单URL: ${url}`)
          muteSuccess = true
          actionType = 'mute'
        } catch (e) {
          logger.error(`[${meta.guildId}] 禁言用户失败: ${e.message}`)
        }
      }

      // 更新警告记录
      try {
        // 构建触发信息
        const triggerInfo = {
          keyword: url,
          type: 'url' as 'keyword' | 'url',
          action: actionType,
          messageContent: content
        }

        // 更新用户处罚记录
        const violationCount = await warningManager.updateUserPunishmentRecord(
          meta.userId,
          pluginConfig,
          meta.guildId,
          triggerInfo
        )

        logger.info(`[${meta.guildId}] 用户 ${meta.userId} 违规次数已更新: ${violationCount}`)
      } catch (e) {
        logger.error(`[${meta.guildId}] 更新警告记录失败: ${e.message}`)
      }

      // 发送提示消息
      if (customMessage) {
        const message = customMessage.replace('{user}', `<at id="${meta.userId}"/>`)
        await meta.send(message)
      }

      return true
    }
  }

  return false
}

/**
 * 禁言用户
 */
async function muteUser(ctx: Context, meta: any, duration: number): Promise<boolean> {
  const logger = ctx.logger('keyword-gatekeeper')
  logger.info(`[${meta.guildId}] 尝试禁言用户 ${meta.userId}，时长: ${duration}秒`)

  try {
    // 尝试使用各种可能的禁言方法
    if (meta.onebot && typeof meta.onebot.setGroupBan === 'function') {
      await meta.onebot.setGroupBan(meta.guildId, meta.userId, duration)
      logger.info(`[${meta.guildId}] 使用 onebot.setGroupBan 禁言成功`)
      return true
    }
    else if (meta.bot && meta.bot.$ && typeof meta.bot.$.setGroupBan === 'function') {
      await meta.bot.$.setGroupBan(meta.guildId, meta.userId, duration)
      logger.info(`[${meta.guildId}] 使用 bot.$.setGroupBan 禁言成功`)
      return true
    }
    else if (meta.bot && typeof meta.bot.setGroupBan === 'function') {
      await meta.bot.setGroupBan(meta.guildId, meta.userId, duration)
      logger.info(`[${meta.guildId}] 使用 bot.setGroupBan 禁言成功`)
      return true
    }
    else if (meta.bot && typeof meta.bot.muteGuildMember === 'function') {
      await meta.bot.muteGuildMember(meta.guildId, meta.userId, duration)
      logger.info(`[${meta.guildId}] 使用通用 API 禁言成功`)
      return true
    }
    else if (meta.session && typeof meta.session.bot.muteGuildMember === 'function') {
      await meta.session.bot.muteGuildMember(meta.guildId, meta.userId, duration)
      logger.info(`[${meta.guildId}] 使用 session.bot.muteGuildMember 禁言成功`)
      return true
    }
    else if (meta.session && meta.session.bot && meta.session.bot.internal && typeof meta.session.bot.internal.mute === 'function') {
      await meta.session.bot.internal.mute(meta.guildId, meta.userId, duration)
      logger.info(`[${meta.guildId}] 使用 session.bot.internal.mute 禁言成功`)
      return true
    }
    else {
      logger.warn(`[${meta.guildId}] 无法禁言用户：平台不支持禁言功能或无法获取禁言方法`)
      return false
    }
  } catch (error) {
    logger.error(`[${meta.guildId}] 禁言失败: ${error.message}`)
    logger.debug(`[${meta.guildId}] 禁言错误堆栈: ${error.stack}`)
    return false
  }
}