import { Schema } from 'koishi'

// 关键词类型
export interface KeywordConfig {
  content: string
  isRegex: boolean
  flags?: string
}

// 配置接口
export interface Config {
  keywords: string[]
  useRegex: boolean
  regexFlags: string
  recall: boolean
  mute: boolean
  muteDuration: number
  customMessage: string
}

// 配置模式
export const ConfigSchema: Schema<Config> = Schema.object({
  keywords: Schema.array(String)
    .description('需要检测的关键词列表')
    .default([]),
  useRegex: Schema.boolean()
    .description('是否将关键词作为正则表达式处理')
    .default(false),
  regexFlags: Schema.string()
    .description('正则表达式标志（如：i-忽略大小写, g-全局匹配, m-多行匹配）')
    .default('i'),
  recall: Schema.boolean()
    .description('是否撤回包含关键词的消息')
    .default(true),
  mute: Schema.boolean()
    .description('是否禁言发送包含关键词消息的用户')
    .default(true),
  muteDuration: Schema.number()
    .description('禁言时长（秒）')
    .default(600),
  customMessage: Schema.string()
    .description('检测到关键词后的提示消息（留空则不发送提示）')
    .default('检测到违规内容，已进行处理')
})
