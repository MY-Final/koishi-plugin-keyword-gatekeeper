import { Context } from 'koishi'
import { KeywordHandler } from './handlers/keyword-handler'
import { UrlHandler } from './handlers/url-handler'
import { Config as PluginConfig, ConfigSchema } from './types'

export const name = 'keyword-gatekeeper'

// 导出配置模式
export const Config = ConfigSchema

// 主函数
export function apply(ctx: Context, options: PluginConfig) {
  // 创建处理器实例
  const keywordHandler = new KeywordHandler(ctx)
  const urlHandler = new UrlHandler(ctx)

  // 注册中间件
  ctx.middleware(async (meta, next) => {
    // 只处理群聊消息
    if (!meta.guildId) return next()

    try {
      // 处理关键词检测
      const keywordResult = await keywordHandler.handleKeywordDetection(meta, options)

      // 如果关键词检测已经处理了消息，则跳过网址检测
      if (keywordResult) return next()

      // 处理网址检测
      await urlHandler.handleUrlDetection(meta, options)
    } catch (error) {
      ctx.logger.error(`[${meta.guildId}] 处理异常: ${error.message}`)
    }

    return next()
  }, true)
}

