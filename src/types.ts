import { Schema } from 'koishi'

// 关键词类型
export interface KeywordConfig {
  content: string
  isRegex: boolean
  flags?: string
}

// 处罚记录
export interface PunishmentRecord {
  userId: string
  count: number
  lastTriggerTime: number
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
  // 网址检测相关配置
  detectUrls: boolean
  urlWhitelist: string[]
  urlAction: 'recall' | 'mute' | 'both'
  urlMuteDuration: number
  urlCustomMessage: string
  // 自动处罚机制
  enableAutoPunishment: boolean
  secondViolationMuteDuration: number
  maxViolationCount: number
  kickOnMaxViolation: boolean
  punishmentResetHours: number
  // 查询权限控制
  allowUserSelfQuery: boolean
}

// 配置模式
export const ConfigSchema: Schema<Config> = Schema.intersect([
  Schema.object({
    keywords: Schema.array(String)
      .description('需要检测的关键词列表，每个关键词单独添加')
      .default([]),
    useRegex: Schema.boolean()
      .description('是否将关键词作为正则表达式处理，启用后可以使用更复杂的匹配规则')
      .default(false),
    regexFlags: Schema.string()
      .description('正则表达式标志：i-忽略大小写, g-全局匹配, m-多行匹配, s-允许.匹配换行符')
      .default('i'),
  }).description('关键词检测设置'),

  Schema.object({
    recall: Schema.boolean()
      .description('是否撤回包含关键词的消息，开启后机器人将尝试删除触发的消息')
      .default(true),
    mute: Schema.boolean()
      .description('是否禁言发送包含关键词消息的用户，需要机器人具有管理员权限')
      .default(true),
    muteDuration: Schema.number()
      .description('关键词触发后的禁言时长（秒），建议设置为60-600之间')
      .min(1)
      .max(2592000) // 30天上限
      .default(600),
    customMessage: Schema.string()
      .description('检测到关键词后的提示消息，可使用@提醒用户，留空则不发送提示')
      .default('检测到违规内容，已进行处理'),
  }).description('关键词处理设置'),

  Schema.object({
    detectUrls: Schema.boolean()
      .description('是否启用网址检测功能，可以检测并处理消息中的URL链接')
      .default(true),
    urlWhitelist: Schema.array(String)
      .description('网址白名单，这些域名及其子域名不会被检测，例如：koishi.chat, github.com')
      .default([]),
    urlAction: Schema.union([
      Schema.const('recall').description('仅撤回消息'),
      Schema.const('mute').description('仅禁言用户'),
      Schema.const('both').description('撤回消息并禁言用户')
    ])
      .description('检测到非白名单网址后要执行的操作')
      .default('both'),
    urlMuteDuration: Schema.number()
      .description('检测到网址后的禁言时长（秒），可以与关键词禁言时长不同')
      .min(1)
      .max(2592000) // 30天上限
      .default(300),
    urlCustomMessage: Schema.string()
      .description('检测到非白名单网址后的提示消息，留空则不发送提示')
      .default('检测到未经允许的网址链接，已进行处理'),
  }).description('网址检测设置'),

  Schema.object({
    enableAutoPunishment: Schema.boolean()
      .description('是否启用自动处罚机制，根据用户触发次数自动升级处罚等级')
      .default(false),
    secondViolationMuteDuration: Schema.number()
      .description('第二次违规的禁言时长（秒），默认为60秒')
      .min(10)
      .max(2592000) // 30天上限
      .default(60),
    maxViolationCount: Schema.number()
      .description('最大违规次数，达到此次数后将执行最终处罚（踢出或长时间禁言）')
      .min(2)
      .max(10)
      .default(3),
    kickOnMaxViolation: Schema.boolean()
      .description('达到最大违规次数时是否踢出用户（如果设为false，则仅禁言）')
      .default(true),
    punishmentResetHours: Schema.number()
      .description('处罚记录重置时间（小时），超过这个时间后用户的违规次数将重置')
      .min(1)
      .max(720) // 最多30天
      .default(24),
  }).description('自动处罚设置'),

  Schema.object({
    allowUserSelfQuery: Schema.boolean()
      .description('是否允许普通用户查询自己的警告记录，关闭后只有管理员可以查询')
      .default(true),
  }).description('权限控制设置'),
])
