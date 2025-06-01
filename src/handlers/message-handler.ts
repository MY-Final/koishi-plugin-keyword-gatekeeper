import { Context, Session } from 'koishi'
import { Config } from '../types'
import { KeywordDatabase } from '../database'
import { WarningManager } from './warning-manager'
import { KeywordHandler } from './keyword-handler'

/**
 * 辅助函数：获取消息内容
 * 从meta对象中提取消息内容，尝试多种可能的消息格式
 */
function getMessageContent(meta: any): string {
  try {
  // 尝试直接获取content
  if (meta.content) {
    return meta.content;
  }

  // 尝试从message字段获取
  if (meta.message) {
    if (typeof meta.message === 'string') {
      return meta.message;
    } else if (Array.isArray(meta.message)) {
        return meta.message.map(segment => segment.type === 'text' ? segment.data?.text || '' : '').join('');
    } else if (typeof meta.message === 'object') {
      return meta.message.text || meta.message.content || JSON.stringify(meta.message);
    }
  }

  // 尝试从elements数组获取
  if (meta.elements && Array.isArray(meta.elements)) {
    return meta.elements
      .map((e) => {
        switch (e.type) {
          case 'text': return e.attrs?.content || '';
          case 'at': return `@${e.attrs.id}`;
          case 'image': return `[图片]`;
          case 'face': return `[表情]`;
          default: return e.attrs?.content || '';
        }
      })
      .join('');
  }

  // 尝试从raw字段获取
  if (meta.raw) {
    if (typeof meta.raw === 'string') {
      return meta.raw;
    } else if (typeof meta.raw === 'object') {
      return meta.raw.message || meta.raw.content || JSON.stringify(meta.raw);
    }
  }

    // 没有找到内容，返回空字符串
    return '';
  } catch (error) {
    // 如果出现任何错误，记录并返回空字符串
    console.error('获取消息内容时发生错误:', error);
  return '';
  }
}

/**
 * 检查用户是否为管理员或群主
 * @param ctx Koishi上下文
 * @param meta 消息元数据
 * @returns 是否为管理员或群主
 */
async function isAdminOrOwner(ctx, meta): Promise<boolean> {
  try {
    // 如果没有群组ID，无法判断是否为管理员
    if (!meta.guildId) return false

    // 检查是否为群管理员或群主
    if (meta.platform === 'onebot' || meta.platform === 'qq') {
      // 尝试获取群成员信息
      if (meta.onebot) {
        try {
          const memberInfo = await meta.onebot.getGroupMemberInfo(meta.guildId, meta.userId)
          // role: owner-群主, admin-管理员, member-普通成员
          if (memberInfo && (memberInfo.role === 'owner' || memberInfo.role === 'admin')) {
            return true
          }
        } catch (e) {
          ctx.logger.debug(`获取群成员信息失败: ${e.message}`)
        }
      } else if (meta.bot && typeof meta.bot.getGuildMember === 'function') {
        try {
          const member = await meta.bot.getGuildMember(meta.guildId, meta.userId)
          if (member && member.roles && member.roles.some(role => ['owner', 'admin', 'administrator'].includes(role.toLowerCase()))) {
            return true
          }
        } catch (e) {
          ctx.logger.debug(`获取群成员信息失败: ${e.message}`)
        }
      }
    }

    // 检查是否为Koishi管理员
    try {
      const user = await ctx.database.getUser(meta.platform, meta.userId)
      if (user && user.authority > 1) { // authority > 1 为管理员
        return true
      }
    } catch (e) {
      ctx.logger.debug(`获取用户权限失败: ${e.message}`)
    }

    return false
  } catch (error) {
    ctx.logger.error(`检查管理员权限出错: ${error.message}`)
    return false
  }
}

/**
 * 注册消息处理器
 * 用于检测和处理消息中的关键词和URL
 */
export function registerMessageHandler(ctx: Context, config: Config, database: KeywordDatabase) {
  // 创建日志记录器
  const logger = ctx.logger('keyword-gatekeeper')

  // 创建警告管理器
  const warningManager = new WarningManager(ctx)

  // 创建关键词处理器
  const keywordHandler = new KeywordHandler(ctx)

  // 输出调试信息
  logger.debug('正在注册关键词检测中间件...')

  // 检查配置是否存在kun关键词，如果不存在则添加
  if (!config.keywords) {
    config.keywords = [];
  }

  logger.debug(`初始关键词列表: ${JSON.stringify(config.keywords)}`);

  // 确保"kun"在关键词列表中
  if (!config.keywords.includes('kun')) {
    logger.debug('未找到关键词"kun"，正在添加到关键词列表');
    config.keywords.push('kun');
  }

  // 如果有配置关键词，打印关键词信息
  if (config.keywords && config.keywords.length > 0) {
    logger.debug(`监测 ${config.keywords.length} 个关键词: ${config.keywords.join(', ')}`)
    logger.debug(`正则匹配模式: ${config.useRegex ? '已启用' : '未启用'}, 正则标志: ${config.regexFlags || 'i'}`)
  } else {
    logger.debug('未配置全局关键词，将使用群组特定配置或跳过关键词检测')
  }

  // 注册中间件
  ctx.middleware(async (meta, next) => {
    try {
      // 获取消息内容
      const content = getMessageContent(meta)

      // 减少日志输出，仅当开启调试模式且真正需要的时候才记录信息
      if (config.enableDebugMode) {
        logger.debug(`收到消息: ${JSON.stringify({
          platform: meta.platform,
          userId: meta.userId,
          guildId: meta.guildId,
          content: content.substring(0, 30) + (content.length > 30 ? '...' : '')
        })}`)
      }

      // 检查是否为命令 - 仅基于内容检查
      const isCommand = content.startsWith('kw') ||
                         content.startsWith('kw.') ||
                         content.startsWith('/kw') ||
                         content.startsWith('.kw')

      // 如果是命令，跳过关键词和网址检测
      if (isCommand) {
        if (config.enableDebugMode) {
          logger.debug(`跳过命令检测: ${content}`)
        }
        return next()
      }

      // 检查用户是否为管理员或群主，如果设置了跳过管理员检查，且用户是管理员，则跳过检测
      if (config.skipAdminCheck) {
        const isAdmin = await isAdminOrOwner(ctx, meta)
        if (isAdmin) {
          if (config.enableDebugMode) {
            logger.debug(`[${meta.guildId}] 用户 ${meta.userId} 是管理员或群主，跳过关键词检测`)
          }
          return next()
        }
      }

      // 检查机器人是否有管理权限
      const hasBotPermission = await keywordHandler.checkBotPermission(meta)

      // 如果机器人没有管理权限，直接跳过处理
      if (!hasBotPermission && meta.guildId) {
        logger.warn(`[${meta.guildId}] 机器人没有管理权限，跳过关键词和URL检测。请确保机器人是管理员。`)
        return next()
      }

      // 创建一个变量记录是否已经处理过消息
      let messageHandled = false;

      // 直接先检测全局关键词，确保无论是否在群聊中都能处理全局关键词
      if (config.keywords && config.keywords.length > 0) {
        if (config.enableDebugMode) {
          logger.debug(`使用全局配置进行检测`)
        }

        // 使用KeywordHandler进行关键词检测
        const globalDetected = await keywordHandler.handleKeywordDetection(meta, config)
        if (globalDetected) {
          // 只在真正触发关键词时输出一条简洁的日志
          if (config.enableDebugMode) {
            logger.debug(`全局关键词检测触发，已处理消息`)
          }
          messageHandled = true; // 标记已处理，但继续检测其他规则
        }
      }

      // 处理群组特定配置（即使全局关键词已触发，也检查群组配置）
      if (meta.guildId && config.enableGroupSpecificConfig) {
        const groupConfig = await database.getGroupConfig(meta.guildId)

        // 如果群组配置存在且已启用
        if (groupConfig && groupConfig.enabled) {
          if (config.enableDebugMode) {
            logger.debug(`[${meta.guildId}] 使用群组特定配置进行检测`)
          }

          // 使用群组配置进行关键词检测
          const groupDetected = await keywordHandler.handleKeywordDetection(meta, {
            ...config,
            keywords: groupConfig.keywords,
            customMessage: groupConfig.customMessage || config.customMessage
          });

          if (groupDetected) {
            if (config.enableDebugMode) {
              logger.debug(`群组关键词检测触发，已处理消息`)
            }
            messageHandled = true; // 标记已处理
          }

          // 如果启用了URL检测且消息尚未被处理
          if (config.detectUrls && !messageHandled) {
            // 直接调用URL检测处理
            const matchedUrl = keywordHandler.checkUrls(content, groupConfig.urlWhitelist || config.urlWhitelist)
            if (matchedUrl) {
              if (config.enableDebugMode) {
                logger.debug(`[${meta.guildId}] 检测到非白名单URL: ${matchedUrl}`)
              }

              // 尝试撤回消息
              if (config.urlAction === 'recall' || config.urlAction === 'both') {
                await keywordHandler.recallMessage(meta)
              }

              // 如果配置了禁言，执行禁言
              if (config.urlAction === 'mute' || config.urlAction === 'both') {
                await keywordHandler.muteUser(meta, config.urlMuteDuration || 300)
              }

              // 更新警告记录
              await warningManager.updateUserPunishmentRecord(
                meta.userId,
                config,
                meta.guildId,
                {
                  keyword: matchedUrl,
                  type: 'url',
                  action: (config.urlAction === 'mute' || config.urlAction === 'both') ? 'mute' : 'warn',
                  messageContent: content
                }
              )

              // 发送提示消息
              if (groupConfig.urlCustomMessage || config.urlCustomMessage) {
                const message = (groupConfig.urlCustomMessage || config.urlCustomMessage)
                  .replace('{user}', '')
                  .replace('{keyword}', matchedUrl)
                  .replace('{action}', (config.urlAction === 'mute' || config.urlAction === 'both') ? '禁言' : '警告')
                  .replace('{count}', '1')

                await keywordHandler.sendNotice(meta, message)
              }

              messageHandled = true;
            }
          }
        }

        // 检查是否在自动启用的群组列表中
        if (config.enabledGroups && config.enabledGroups.includes(meta.guildId)) {
          // 如果在自动启用列表中但还没有配置，创建一个新的配置
          if (!groupConfig) {
            logger.debug(`[${meta.guildId}] 群组在自动启用列表中，创建新配置`)

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
              logger.debug(`[${meta.guildId}] 自动导入预设包`)

              // 导入每个预设包
              for (const presetName of config.defaultPresets) {
                const preset = await database.getPresetPackage(presetName)
                if (preset) {
                  // 合并关键词
                  newConfig.keywords = [...new Set([...newConfig.keywords, ...preset.keywords])]
                  logger.debug(`[${meta.guildId}] 导入预设包 ${presetName}，添加 ${preset.keywords.length} 个关键词`)
                }
              }

              // 更新配置
              await database.updateGroupConfig(meta.guildId, { keywords: newConfig.keywords })
            }
          }
        }
      }

      // 检测全局URL（如果消息尚未被处理）
      if (config.detectUrls && !messageHandled) {
        const matchedUrl = keywordHandler.checkUrls(content, config.urlWhitelist)
        if (matchedUrl) {
          logger.debug(`检测到非白名单URL: ${matchedUrl}`)

          // 尝试撤回消息
          if (config.urlAction === 'recall' || config.urlAction === 'both') {
            await keywordHandler.recallMessage(meta)
          }

          // 如果配置了禁言，执行禁言
          if (config.urlAction === 'mute' || config.urlAction === 'both') {
            await keywordHandler.muteUser(meta, config.urlMuteDuration || 300)
          }

          // 更新警告记录
          await warningManager.updateUserPunishmentRecord(
            meta.userId,
            config,
            meta.guildId,
            {
              keyword: matchedUrl,
              type: 'url',
              action: (config.urlAction === 'mute' || config.urlAction === 'both') ? 'mute' : 'warn',
              messageContent: content
            }
          )

          // 发送提示消息
          if (config.urlCustomMessage) {
            const message = config.urlCustomMessage
              .replace('{user}', '')
              .replace('{keyword}', matchedUrl)
              .replace('{action}', (config.urlAction === 'mute' || config.urlAction === 'both') ? '禁言' : '警告')
              .replace('{count}', '1')

            await keywordHandler.sendNotice(meta, message)
          }

          messageHandled = true;
        }
      }
    } catch (error) {
      logger.error(`处理异常: ${error.message}`)
      if (error.stack) {
        logger.debug(`错误堆栈: ${error.stack}`)
      }
    }

    return next()
  }, true)  // 使用true表示高优先级
}
