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
      // 简化权限检查逻辑，假设机器人有权限
      // 在实际应用中，可以根据具体平台实现权限检查
      return true
    } catch (error) {
      this.ctx.logger.error(`[${meta.guildId}] 检查机器人权限失败: ${error.message}`)
      return false
    }
  }

  // 检查用户是否为管理员
  async isUserAdmin(meta: Session): Promise<boolean> {
    try {
      // 简化权限检查逻辑
      // 在实际应用中，可以根据具体平台实现权限检查
      return meta.author?.roles?.includes('admin') || meta.author?.roles?.includes('owner') || false
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
}
