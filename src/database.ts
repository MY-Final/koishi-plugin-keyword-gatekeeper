import { Context, Database, Dict, Schema } from 'koishi'
import { GroupConfig, PresetPackage, PunishmentRecord } from './types'

// 定义数据库模型
declare module 'koishi' {
  interface Tables {
    keyword_punishment_record: PunishmentRecord
    keyword_group_config: GroupConfig
    keyword_preset_package: PresetPackage
  }
}

export class KeywordDatabase {
  private ctx: Context
  private dbInitialized: boolean = false

  constructor(ctx: Context) {
    this.ctx = ctx
    this.initialize()
  }

  private async initialize() {
    if (this.dbInitialized) return

    try {
      // 初始化处罚记录表
      this.ctx.model.extend('keyword_punishment_record', {
        userId: {
          type: 'string'
        },
        count: 'integer',
        lastTriggerTime: 'integer'
      }, {
        primary: 'userId'
      })

      // 初始化群组配置表
      this.ctx.model.extend('keyword_group_config', {
        guildId: {
          type: 'string'
        },
        enabled: 'boolean',
        keywords: 'json',
        customMessage: 'string',
        urlWhitelist: 'json',
        urlCustomMessage: 'string'
      }, {
        primary: 'guildId'
      })

      // 初始化预设包表
      this.ctx.model.extend('keyword_preset_package', {
        id: 'unsigned',
        name: 'string',
        description: 'string',
        keywords: 'json',
        isSystem: 'boolean',
        createdBy: 'string',
        createdAt: 'integer'
      }, {
        primary: 'id',
        autoInc: true
      })

      this.dbInitialized = true
      // 日志初始化成功
      this.ctx.logger.info('关键词守门员数据库初始化成功')
    } catch (error) {
      this.ctx.logger.error(`预设包数据库初始化失败: ${error.message}`)
    }
  }

  // 处罚记录相关方法
  async getPunishmentRecord(userId: string): Promise<PunishmentRecord> {
    const records = await this.ctx.database.get('keyword_punishment_record', { userId })
    if (records && records.length > 0) {
      return records[0]
    }
    return null
  }

  async createOrUpdatePunishmentRecord(userId: string, count: number): Promise<void> {
    const record = await this.getPunishmentRecord(userId)
    if (record) {
      await this.ctx.database.set('keyword_punishment_record', { userId }, {
        count,
        lastTriggerTime: Date.now()
      })
    } else {
      await this.ctx.database.create('keyword_punishment_record', {
        userId,
        count,
        lastTriggerTime: Date.now()
      })
    }
  }

  async resetPunishmentRecord(userId: string): Promise<void> {
    await this.ctx.database.set('keyword_punishment_record', { userId }, {
      count: 0,
      lastTriggerTime: Date.now()
    })
  }

  async getAllPunishmentRecords(): Promise<PunishmentRecord[]> {
    return await this.ctx.database.get('keyword_punishment_record', {})
  }

  // 群组配置相关方法
  async getGroupConfig(guildId: string): Promise<GroupConfig> {
    const configs = await this.ctx.database.get('keyword_group_config', { guildId })
    if (configs && configs.length > 0) {
      return configs[0]
    }
    return null
  }

  async createGroupConfig(config: GroupConfig): Promise<void> {
    await this.ctx.database.create('keyword_group_config', config)
  }

  async updateGroupConfig(guildId: string, updates: Partial<GroupConfig>): Promise<void> {
    await this.ctx.database.set('keyword_group_config', { guildId }, updates)
  }

  async deleteGroupConfig(guildId: string): Promise<void> {
    await this.ctx.database.remove('keyword_group_config', { guildId })
  }

  async getAllGroupConfigs(): Promise<GroupConfig[]> {
    return await this.ctx.database.get('keyword_group_config', {})
  }

  // 预设包相关方法
  async getPresetPackage(name: string): Promise<PresetPackage> {
    const presets = await this.ctx.database.get('keyword_preset_package', { name })
    if (presets && presets.length > 0) {
      return presets[0]
    }
    return null
  }

  async getPresetPackageById(id: number): Promise<PresetPackage> {
    const presets = await this.ctx.database.get('keyword_preset_package', { id })
    if (presets && presets.length > 0) {
      return presets[0]
    }
    return null
  }

  async getAllPresetPackages(): Promise<PresetPackage[]> {
    return await this.ctx.database.get('keyword_preset_package', {})
  }

  async getSystemPresetPackages(): Promise<PresetPackage[]> {
    return await this.ctx.database.get('keyword_preset_package', { isSystem: true })
  }

  async getUserPresetPackages(): Promise<PresetPackage[]> {
    return await this.ctx.database.get('keyword_preset_package', { isSystem: false })
  }

  async createPresetPackage(preset: PresetPackage): Promise<void> {
    await this.ctx.database.create('keyword_preset_package', preset)
  }

  async updatePresetPackage(id: number, updates: Partial<PresetPackage>): Promise<void> {
    await this.ctx.database.set('keyword_preset_package', { id }, updates)
  }

  async deletePresetPackage(id: number): Promise<void> {
    await this.ctx.database.remove('keyword_preset_package', { id })
  }
}
