import { Context } from 'koishi'
import { KeywordHandler } from './handlers/keyword-handler'
import { ConfigSchema } from './types'

export const name = 'keyword-gatekeeper'

// 导出配置模式
export const Config = ConfigSchema

// 主函数
export function apply(ctx: Context) {
  // 创建关键词处理器实例
  const keywordHandler = new KeywordHandler(ctx)

  // 注册中间件
  ctx.middleware(async (meta, next) => {
    // 只处理群聊消息
    if (!meta.guildId) return next()

    try {
      // 处理关键词检测
      await keywordHandler.handleKeywordDetection(meta, ctx.config)
    } catch (error) {
      ctx.logger.error(`[${meta.guildId}] 处理异常: ${error.message}`)
    }

    return next()
  }, true)
}

