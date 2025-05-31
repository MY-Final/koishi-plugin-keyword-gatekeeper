import { Context } from 'koishi'
import { Config as PluginConfig, GroupConfig } from '../types'

// 定义数据库模型
declare module 'koishi' {
  interface Tables {
    keyword_group_configs: GroupConfigTable
  }
}

// 群组配置数据库表结构
export interface GroupConfigTable {
  id: number
  guildId: string
  enabled: boolean
  keywords: string        // JSON 字符串，存储关键词数组
  customMessage: string
  urlWhitelist: string    // JSON 字符串，存储 URL 白名单数组
  urlCustomMessage: string
  lastModifiedTime: number
  lastModifiedBy: string  // 最后修改的用户 ID
}

/**
 * 群组配置管理器
 * 负责管理每个群组的特定配置，支持查询、更新和删除
 */
export class GroupConfigManager {
  private ctx: Context
  private dbInitialized: boolean = false
  // 缓存群组配置，提高性能
  private groupConfigs: Map<string, GroupConfig> = new Map()

  constructor(ctx: Context) {
    this.ctx = ctx

    // 数据库初始化
    this.ctx.on('ready', async () => {
      await this.initDatabase()
      this.ctx.logger.info('群组配置管理器已初始化')
    })
  }

  /**
   * 初始化数据库
   */
  private async initDatabase(): Promise<void> {
    if (this.dbInitialized) return

    try {
      // 检查并扩展数据库模型
      this.ctx.model.extend('keyword_group_configs', {
        id: 'unsigned',
        guildId: 'string',
        enabled: 'boolean',
        keywords: 'text',
        customMessage: 'string',
        urlWhitelist: 'text',
        urlCustomMessage: 'string',
        lastModifiedTime: 'unsigned',
        lastModifiedBy: 'string'
      }, {
        autoInc: true,
        primary: 'id',
        unique: [['guildId']],
      })

      // 从数据库加载已有的群组配置到内存
      await this.loadGroupConfigsFromDatabase()

      this.dbInitialized = true
      this.ctx.logger.info('群组配置数据库初始化成功')
    } catch (error) {
      this.ctx.logger.error(`群组配置数据库初始化失败: ${error.message}`)
    }
  }

  /**
   * 从数据库加载群组配置到内存
   */
  private async loadGroupConfigsFromDatabase(): Promise<void> {
    try {
      const records = await this.ctx.database.get('keyword_group_configs', {})
      this.ctx.logger.info(`从数据库加载了 ${records.length} 条群组配置`)

      // 清空当前内存中的记录
      this.groupConfigs.clear()

      // 将数据库记录加载到内存
      records.forEach(record => {
        try {
          const config: GroupConfig = {
            guildId: record.guildId,
            enabled: record.enabled,
            keywords: JSON.parse(record.keywords || '[]'),
            customMessage: record.customMessage || '',
            urlWhitelist: JSON.parse(record.urlWhitelist || '[]'),
            urlCustomMessage: record.urlCustomMessage || ''
          }
          this.groupConfigs.set(record.guildId, config)
        } catch (e) {
          this.ctx.logger.error(`解析群组配置失败 (${record.guildId}): ${e.message}`)
        }
      })

      this.ctx.logger.debug('群组配置加载完成')
    } catch (error) {
      this.ctx.logger.error(`加载群组配置失败: ${error.message}`)
    }
  }

  /**
   * 获取指定群组的配置
   * 如果不存在，返回 null
   */
  async getGroupConfig(guildId: string): Promise<GroupConfig | null> {
    if (!this.dbInitialized) await this.initDatabase()

    // 先从内存缓存中查找
    if (this.groupConfigs.has(guildId)) {
      return this.groupConfigs.get(guildId)
    }

    // 如果缓存中没有，则尝试从数据库加载
    try {
      const records = await this.ctx.database.get('keyword_group_configs', { guildId })
      if (records.length > 0) {
        const record = records[0]
        const config: GroupConfig = {
          guildId: record.guildId,
          enabled: record.enabled,
          keywords: JSON.parse(record.keywords || '[]'),
          customMessage: record.customMessage || '',
          urlWhitelist: JSON.parse(record.urlWhitelist || '[]'),
          urlCustomMessage: record.urlCustomMessage || ''
        }
        // 更新缓存
        this.groupConfigs.set(guildId, config)
        return config
      }
    } catch (error) {
      this.ctx.logger.error(`获取群组配置失败 (${guildId}): ${error.message}`)
    }

    return null
  }

  /**
   * 更新或创建群组配置
   */
  async updateGroupConfig(
    guildId: string,
    config: Partial<GroupConfig>,
    userId: string
  ): Promise<boolean> {
    if (!this.dbInitialized) await this.initDatabase()

    try {
      // 检查该群组是否已有配置
      const existingConfig = await this.getGroupConfig(guildId)
      const now = Date.now()

      // 准备要更新的数据
      const updateData: any = {
        guildId,
        lastModifiedTime: now,
        lastModifiedBy: userId
      }

      // 合并配置参数
      if (config.enabled !== undefined) updateData.enabled = config.enabled
      if (config.customMessage !== undefined) updateData.customMessage = config.customMessage
      if (config.urlCustomMessage !== undefined) updateData.urlCustomMessage = config.urlCustomMessage

      // 处理数组类型，需要 JSON 序列化
      if (config.keywords !== undefined) updateData.keywords = JSON.stringify(config.keywords)
      if (config.urlWhitelist !== undefined) updateData.urlWhitelist = JSON.stringify(config.urlWhitelist)

      // 如果不存在，则创建新记录
      if (!existingConfig) {
        // 设置默认值
        if (updateData.enabled === undefined) updateData.enabled = true
        if (updateData.keywords === undefined) updateData.keywords = '[]'
        if (updateData.customMessage === undefined) updateData.customMessage = ''
        if (updateData.urlWhitelist === undefined) updateData.urlWhitelist = '[]'
        if (updateData.urlCustomMessage === undefined) updateData.urlCustomMessage = ''

        await this.ctx.database.create('keyword_group_configs', updateData)
        this.ctx.logger.info(`创建群组配置成功 (${guildId})`)
      } else {
        // 更新现有记录
        await this.ctx.database.set('keyword_group_configs', { guildId }, updateData)
        this.ctx.logger.info(`更新群组配置成功 (${guildId})`)
      }

      // 更新内存缓存
      await this.loadGroupConfigsFromDatabase()

      return true
    } catch (error) {
      this.ctx.logger.error(`更新群组配置失败 (${guildId}): ${error.message}`)
      return false
    }
  }

  /**
   * 删除群组配置
   */
  async deleteGroupConfig(guildId: string): Promise<boolean> {
    if (!this.dbInitialized) await this.initDatabase()

    try {
      // 从数据库删除记录
      await this.ctx.database.remove('keyword_group_configs', { guildId })
      // 从缓存中删除
      this.groupConfigs.delete(guildId)

      this.ctx.logger.info(`删除群组配置成功 (${guildId})`)
      return true
    } catch (error) {
      this.ctx.logger.error(`删除群组配置失败 (${guildId}): ${error.message}`)
      return false
    }
  }

  /**
   * 合并全局配置和群组特定配置
   * 如果群组配置不存在或未启用，则返回全局配置
   */
  async getMergedConfig(guildId: string, globalConfig: PluginConfig): Promise<PluginConfig> {
    // 如果未启用群组特定配置，直接返回全局配置
    if (!globalConfig.enableGroupSpecificConfig) return globalConfig

    const groupConfig = await this.getGroupConfig(guildId)

    // 如果群组配置不存在或未启用，返回全局配置
    if (!groupConfig || !groupConfig.enabled) return globalConfig

    // 创建全局配置的副本
    const mergedConfig = { ...globalConfig }

    // 合并群组特定的关键词（如果存在）
    if (groupConfig.keywords && groupConfig.keywords.length > 0) {
      mergedConfig.keywords = [...groupConfig.keywords]
    }

    // 合并自定义提示消息（如果存在）
    if (groupConfig.customMessage) {
      mergedConfig.customMessage = groupConfig.customMessage
    }

    // 合并URL白名单（如果存在）
    if (groupConfig.urlWhitelist && groupConfig.urlWhitelist.length > 0) {
      mergedConfig.urlWhitelist = [...groupConfig.urlWhitelist]
    }

    // 合并URL自定义提示消息（如果存在）
    if (groupConfig.urlCustomMessage) {
      mergedConfig.urlCustomMessage = groupConfig.urlCustomMessage
    }

    return mergedConfig
  }

  /**
   * 获取所有启用了特定配置的群组ID
   */
  async getActiveGroupIds(): Promise<string[]> {
    if (!this.dbInitialized) await this.initDatabase()

    const records = await this.ctx.database.get('keyword_group_configs', { enabled: true })
    return records.map(record => record.guildId)
  }

  /**
   * 添加关键词到群组配置
   */
  async addKeyword(guildId: string, keyword: string, userId: string): Promise<boolean> {
    // 获取当前配置
    let groupConfig = await this.getGroupConfig(guildId)

    // 如果配置不存在，创建新的
    if (!groupConfig) {
      groupConfig = {
        guildId,
        enabled: true,
        keywords: [keyword],
        customMessage: '',
        urlWhitelist: [],
        urlCustomMessage: ''
      }
    } else {
      // 检查关键词是否已存在
      if (!groupConfig.keywords.includes(keyword)) {
        groupConfig.keywords.push(keyword)
      } else {
        return false // 关键词已存在
      }
    }

    // 更新配置
    return this.updateGroupConfig(guildId, groupConfig, userId)
  }

  /**
   * 从群组配置中删除关键词
   */
  async removeKeyword(guildId: string, keyword: string, userId: string): Promise<boolean> {
    // 获取当前配置
    const groupConfig = await this.getGroupConfig(guildId)

    // 如果配置不存在，返回失败
    if (!groupConfig) return false

    // 查找并删除关键词
    const index = groupConfig.keywords.indexOf(keyword)
    if (index !== -1) {
      groupConfig.keywords.splice(index, 1)
      // 更新配置
      return this.updateGroupConfig(guildId, groupConfig, userId)
    }

    return false // 关键词不存在
  }

  /**
   * 更新群组自定义提示消息
   */
  async updateCustomMessage(guildId: string, message: string, userId: string): Promise<boolean> {
    let groupConfig = await this.getGroupConfig(guildId)

    // 如果配置不存在，创建新的
    if (!groupConfig) {
      groupConfig = {
        guildId,
        enabled: true,
        keywords: [],
        customMessage: message,
        urlWhitelist: [],
        urlCustomMessage: ''
      }
    } else {
      groupConfig.customMessage = message
    }

    // 更新配置
    return this.updateGroupConfig(guildId, { customMessage: message }, userId)
  }

  /**
   * 批量添加关键词到群组配置
   * @param guildId 群组ID
   * @param keywords 要添加的关键词数组
   * @param userId 操作用户ID
   * @returns 添加结果对象，包含成功和失败的关键词
   */
  async addKeywordsBatch(
    guildId: string,
    keywords: string[],
    userId: string
  ): Promise<{
    success: string[],
    duplicates: string[],
    total: number
  }> {
    if (!keywords || keywords.length === 0) {
      return { success: [], duplicates: [], total: 0 }
    }

    // 获取当前配置
    let groupConfig = await this.getGroupConfig(guildId)

    // 结果统计
    const result = {
      success: [] as string[],
      duplicates: [] as string[],
      total: keywords.length
    }

    // 如果配置不存在，创建新的
    if (!groupConfig) {
      groupConfig = {
        guildId,
        enabled: true,
        keywords: [],
        customMessage: '',
        urlWhitelist: [],
        urlCustomMessage: ''
      }
    }

    // 过滤并添加关键词
    for (const keyword of keywords) {
      // 跳过空关键词
      if (!keyword || keyword.trim() === '') continue

      const trimmedKeyword = keyword.trim()

      // 检查关键词是否已存在
      if (!groupConfig.keywords.includes(trimmedKeyword)) {
        groupConfig.keywords.push(trimmedKeyword)
        result.success.push(trimmedKeyword)
      } else {
        result.duplicates.push(trimmedKeyword)
      }
    }

    // 只有成功添加了关键词才更新配置
    if (result.success.length > 0) {
      await this.updateGroupConfig(guildId, groupConfig, userId)
    }

    return result
  }

  /**
   * 导入预设关键词包
   * @param guildId 群组ID
   * @param presetName 预设包名称
   * @param userId 操作用户ID
   * @returns 导入结果
   */
  async importPresetKeywords(
    guildId: string,
    presetName: string,
    userId: string
  ): Promise<{
    success: string[],
    duplicates: string[],
    total: number
  }> {
    // 预设关键词包定义
    const presets: Record<string, string[]> = {
      'politics': [
        '政治敏感词1', '政治敏感词2', '政治敏感词3',
        '政治敏感词4', '政治敏感词5'
      ],
      'adult': [
        '成人内容1', '成人内容2', '成人内容3',
        '成人内容4', '成人内容5'
      ],
      'gambling': [
        '赌博1', '赌博2', '赌博3',
        '赌博4', '赌博5'
      ],
      'spam': [
        '垃圾信息1', '垃圾信息2', '垃圾信息3',
        '垃圾信息4', '垃圾信息5'
      ],
      'scam': [
        '诈骗1', '诈骗2', '诈骗3',
        '诈骗4', '诈骗5'
      ],
      'common': [
        '常见违禁词1', '常见违禁词2', '常见违禁词3',
        '常见违禁词4', '常见违禁词5', '常见违禁词6',
        '常见违禁词7', '常见违禁词8', '常见违禁词9',
        '常见违禁词10'
      ]
    }

    // 检查预设包是否存在
    if (!presets[presetName]) {
      return {
        success: [],
        duplicates: [],
        total: 0
      }
    }

    // 获取预设包中的关键词
    const keywords = presets[presetName]

    // 使用已有的批量添加方法导入关键词
    return this.addKeywordsBatch(guildId, keywords, userId)
  }

  /**
   * 获取所有可用的预设关键词包名称
   * @returns 预设包名称数组
   */
  getAvailablePresets(): string[] {
    return ['politics', 'adult', 'gambling', 'spam', 'scam', 'common']
  }

  /**
   * 获取预设关键词包的介绍信息
   * @returns 预设包介绍信息
   */
  getPresetDescriptions(): Record<string, string> {
    return {
      'politics': '政治相关敏感词汇（5个词）',
      'adult': '成人内容相关敏感词汇（5个词）',
      'gambling': '赌博相关敏感词汇（5个词）',
      'spam': '垃圾信息相关敏感词汇（5个词）',
      'scam': '诈骗相关敏感词汇（5个词）',
      'common': '常见违禁词汇集合（10个词）'
    }
  }
}
