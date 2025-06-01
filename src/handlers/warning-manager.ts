import { Context } from 'koishi'
import { Config as PluginConfig, PunishmentRecord } from '../types'

// 定义数据库模型
declare module 'koishi' {
  interface Tables {
    keyword_warnings: KeywordWarningTable
  }
}

// 警告记录数据库表结构
export interface KeywordWarningTable {
  id: number
  userId: string
  guildId: string
  count: number
  lastTriggerTime: number
  lastTriggerKeyword: string       // 最近触发的关键词或URL
  lastTriggerType: 'keyword' | 'url' // 触发类型
  lastActionType: 'warn' | 'mute' | 'kick' // 最近执行的处罚类型
  lastMessageContent: string       // 最近被撤回的消息内容 (可能截断过长内容)
  actionHistory: string            // JSON字符串，记录处罚历史 [{time, type, keyword, action}]
  lastTriggerTimeFormatted: string // 格式化的触发时间，如"2023年05月29日 13:50:01"
}

/**
 * 警告记录管理器
 * 负责管理用户的警告记录，支持查询、更新和清零
 */
export class WarningManager {
  private ctx: Context
  // 保留内存映射以提高性能，每次操作后与数据库同步
  private punishmentRecords: Map<string, PunishmentRecord> = new Map()
  // 添加一个日志记录开关
  private enableDebugLog: boolean = false // 默认关闭调试日志
  // 是否已初始化数据库
  private dbInitialized: boolean = false
  // 静态实例计数，确保只有一个实例输出初始化日志
  private static instanceCount: number = 0
  private instanceId: number

  constructor(ctx: Context) {
    this.ctx = ctx
    this.instanceId = ++WarningManager.instanceCount

    // 检查是否启用调试模式
    try {
      const config = ctx.config.keyword_gatekeeper || {}
      if (config.enableDebugMode) {
        this.enableDebugLog = true
      }
    } catch (error) {
      // 忽略错误
    }

    // 数据库初始化
    this.ctx.on('ready', async () => {
      await this.initDatabase()
      // 只有第一个实例输出info级别日志
      if (this.instanceId === 1) {
        this.ctx.logger.info('警告记录管理器已初始化')
      } else {
        this.logDebug('警告记录管理器已初始化 (实例 ' + this.instanceId + ')')
      }
    })
  }

  /**
   * 设置调试模式
   * @param enable 是否启用调试模式
   */
  public setDebugMode(enable: boolean): void {
    this.enableDebugLog = enable
    if (enable) {
      this.ctx.logger.debug('WarningManager调试日志已启用')
    } else {
      this.ctx.logger.debug('WarningManager调试日志已禁用')
    }
  }

  /**
   * 初始化数据库
   */
  private async initDatabase(): Promise<void> {
    if (this.dbInitialized) return

    try {
      // 检查并扩展数据库模型
      this.ctx.model.extend('keyword_warnings', {
        id: 'unsigned',
        userId: 'string',
        guildId: 'string',
        count: 'unsigned',
        lastTriggerTime: 'unsigned',
        lastTriggerKeyword: 'string',
        lastTriggerType: 'string',
        lastActionType: 'string',
        lastMessageContent: 'text',
        actionHistory: 'text',
        lastTriggerTimeFormatted: 'string'
      }, {
        // 设置复合索引，确保查询效率
        autoInc: true,
        primary: 'id',
        unique: [['userId', 'guildId']],
      })

      // 从数据库加载已有的警告记录到内存
      await this.loadWarningsFromDatabase()

      this.dbInitialized = true
      // 只有第一个实例输出info级别日志
      if (this.instanceId === 1) {
        this.ctx.logger.debug('警告记录数据库初始化成功')
      } else {
        this.logDebug('警告记录数据库初始化成功 (实例 ' + this.instanceId + ')')
      }
    } catch (error) {
      this.ctx.logger.error(`警告记录数据库初始化失败: ${error.message}`)
    }
  }

  /**
   * 从数据库加载警告记录到内存
   */
  private async loadWarningsFromDatabase(): Promise<void> {
    try {
      const records = await this.ctx.database.get('keyword_warnings', {})
      // 只有第一个实例输出info级别日志，且仅当调试模式开启时输出详细内容
      if (this.instanceId === 1) {
        this.logDebug(`从数据库加载了 ${records.length} 条警告记录`)
      }

      // 清空当前内存中的记录
      this.punishmentRecords.clear()

      // 将数据库记录加载到内存
      records.forEach(record => {
        const key = this.getRecordKey(record.userId, record.guildId)
        this.punishmentRecords.set(key, {
          userId: record.userId,
          count: record.count,
          lastTriggerTime: record.lastTriggerTime
        })
      })

      // 只在调试模式下输出完成日志
      if (this.enableDebugLog && this.instanceId === 1) {
        this.ctx.logger.debug('警告记录加载完成')
      }
    } catch (error) {
      this.ctx.logger.error(`加载警告记录失败: ${error.message}`)
    }
  }

  /**
   * 生成用户记录的唯一键
   * 使用 guildId:userId 的格式确保不同群的记录是独立的
   */
  private getRecordKey(userId: string, guildId?: string): string {
    const key = guildId ? `${guildId}:${userId}` : userId
    this.logDebug(`生成记录键: ${key}`)
    return key
  }

  /**
   * 输出调试日志
   */
  private logDebug(message: string, ...args: any[]): void {
    if (this.enableDebugLog) {
      // 使用简洁的日志形式，避免过多细节
      const simpleMsg = message.replace(/\(实例 \d+\)/g, '').trim();
      this.ctx.logger.debug(`[警告记录] ${simpleMsg}`, ...args)
    }
  }

  /**
   * 格式化日期时间为中文格式
   * @param timestamp 时间戳
   * @returns 格式化后的日期时间字符串，如"2023年05月29日 13:50:01"
   */
  private formatDateTime(timestamp: number): string {
    if (!timestamp) return '';

    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${year}年${month}月${day}日 ${hours}时${minutes}分${seconds}秒`;
  }

  /**
   * 更新用户处罚记录
   * @param userId 用户ID
   * @param config 插件配置
   * @param guildId 群组ID (可选)
   * @param triggerInfo 触发信息 (可选)
   * @returns 更新后的违规次数
   */
  async updateUserPunishmentRecord(
    userId: string,
    config: PluginConfig,
    guildId?: string,
    triggerInfo?: {
      keyword: string,               // 触发的关键词或URL
      type: 'keyword' | 'url',       // 触发类型
      action: 'warn' | 'mute' | 'kick', // 执行的处罚类型
      messageContent?: string        // 被撤回的消息内容
    }
  ): Promise<number> {
    // 确保数据库已初始化
    if (!this.dbInitialized) await this.initDatabase()

    const key = this.getRecordKey(userId, guildId)
    this.logDebug(`更新警告记录: ${key}`)

    const now = Date.now()
    const resetTimeMs = config.punishmentResetHours * 60 * 60 * 1000

    // 查询数据库中是否存在记录
    let record = await this.ctx.database.get('keyword_warnings', {
      userId: userId,
      guildId: guildId || ''
    }).then(records => records[0])

    let oldCount = 0; // 记录旧的计数值

    if (!record) {
      // 创建新记录
      this.logDebug(`创建新的警告记录: ${key}`)

      record = {
        userId,
        guildId: guildId || '',
        count: 0, // 确保新记录从0开始计数
        lastTriggerTime: 0,
        lastTriggerKeyword: '',
        lastTriggerType: 'keyword',
        lastActionType: 'warn',
        lastMessageContent: '',
        actionHistory: '[]',
        lastTriggerTimeFormatted: ''
      } as KeywordWarningTable

      // 插入新记录到数据库
      await this.ctx.database.create('keyword_warnings', record)

      // 重新获取记录以获取ID
      record = await this.ctx.database.get('keyword_warnings', {
        userId: userId,
        guildId: guildId || ''
      }).then(records => records[0])

      oldCount = 0; // 新记录的旧计数为0
      this.ctx.logger.info(`${key}: 创建新警告记录，初始计数=0`)
    } else {
      oldCount = record.count; // 保存现有记录的计数
      this.ctx.logger.info(`${key}: 找到现有警告记录，当前计数=${oldCount}`)
    }

    // 检查是否需要重置记录
    if (now - record.lastTriggerTime > resetTimeMs) {
      oldCount = 0; // 重置后的旧计数为0
      record.count = 0;
      this.logDebug(`记录已重置: ${key}`)
      this.ctx.logger.info(`${key}: 记录已过期，重置计数=0, 上次更新时间=${new Date(record.lastTriggerTime).toLocaleString()}`)
    }

    // 增加违规次数 (只增加一次)
    record.count = oldCount + 1;
    record.lastTriggerTime = now;
    this.ctx.logger.info(`${key}: 增加违规计数，新计数=${record.count}, 时间=${new Date(record.lastTriggerTime).toLocaleString()}`)

    // 更新触发信息（如果提供）
    const updateData: any = {
      count: record.count,
      lastTriggerTime: record.lastTriggerTime,
      lastTriggerTimeFormatted: this.formatDateTime(now)
    }

    // 记录更新前后的计数，用于调试
    this.logDebug(`记录 ${key} 更新计数: 之前=${oldCount}, 之后=${record.count}`)

    if (triggerInfo) {
      // 更新最近的触发信息
      updateData.lastTriggerKeyword = triggerInfo.keyword || '';
      updateData.lastTriggerType = triggerInfo.type || 'keyword';
      updateData.lastActionType = triggerInfo.action || 'warn';

      // 保存完整的消息内容，不再限制长度
      if (triggerInfo.messageContent) {
        updateData.lastMessageContent = triggerInfo.messageContent;
      }

      // 更新处罚历史
      try {
        let history = [];
        try {
          history = JSON.parse(record.actionHistory || '[]');
        } catch (e) {
          this.ctx.logger.warn(`解析处罚历史失败: ${e.message}，将重置历史记录`);
          history = [];
        }

        // 添加新的处罚记录
        history.push({
          time: now,
          keyword: triggerInfo.keyword,
          type: triggerInfo.type,
          action: triggerInfo.action,
          timeFormatted: this.formatDateTime(now),
          message: triggerInfo.messageContent || ''
        });

        // 限制历史记录数量，保留最近10条
        if (history.length > 10) {
          history = history.slice(history.length - 10);
        }

        updateData.actionHistory = JSON.stringify(history);
      } catch (error) {
        this.ctx.logger.error(`更新处罚历史失败: ${error.message}`);
      }
    }

    // 更新数据库
    await this.ctx.database.set('keyword_warnings', {
      userId: userId,
      guildId: guildId || ''
    }, updateData)

    // 更新内存缓存
    this.punishmentRecords.set(key, {
      userId,
      count: record.count,
      lastTriggerTime: record.lastTriggerTime
    })

    this.logDebug(`更新记录: ${key}, 新违规次数: ${record.count}`)
    this.ctx.logger.info(`更新记录: ${key}, 新违规次数: ${record.count}`)
    this.ctx.logger.info(`当前记录详情 - 键: ${key}, 用户ID: ${record.userId}, 次数: ${record.count}, 时间: ${new Date(record.lastTriggerTime).toLocaleString()}`)

    return record.count
  }

  /**
   * 查询用户警告记录
   * @param userId 用户ID
   * @param config 插件配置
   * @param guildId 群组ID (可选)
   */
  async queryUserWarningRecord(userId: string, config: PluginConfig, guildId?: string): Promise<{
    count: number,
    resetTime: string,
    lastTrigger?: {
      keyword: string,
      type: string,
      action: string,
      time: number,
      message: string,
      timeFormatted?: string
    },
    history?: Array<{
      time: number,
      keyword: string,
      type: string,
      action: string,
      message?: string,
      timeFormatted?: string
    }>
  }> {
    // 确保数据库已初始化
    if (!this.dbInitialized) await this.initDatabase()

    const key = this.getRecordKey(userId, guildId)
    // 只在调试模式开启时输出查询日志
    if (this.enableDebugLog) {
      this.logDebug(`查询警告记录: ${key}`)
    }

    // 从数据库查询记录
    const records = await this.ctx.database.get('keyword_warnings', {
      userId: userId,
      guildId: guildId || ''
    })

    // 仅在调试模式下打印所有记录简要信息
    if (this.enableDebugLog) {
      const allRecords = await this.ctx.database.get('keyword_warnings', {})
      if (allRecords.length > 0) {
        this.logDebug(`数据库中共有 ${allRecords.length} 条警告记录`)
      }
    }

    // 如果没有记录，创建一个空记录
    if (records.length === 0) {
      this.ctx.logger.info(`记录不存在: ${key}，创建新记录`)

      // 新的空记录
      const newRecord = {
        userId,
        guildId: guildId || '',
        count: 0,
        lastTriggerTime: 0
      } as KeywordWarningTable

      // 插入新记录到数据库
      await this.ctx.database.create('keyword_warnings', newRecord)

      // 更新内存缓存
      this.punishmentRecords.set(key, {
        userId,
        count: 0,
        lastTriggerTime: 0
      })

      this.ctx.logger.info(`记录 ${key} 为空（从未触发）`)
      return { count: 0, resetTime: '从未触发' }
    }

    const record = records[0]
    const now = Date.now()

    // 记录详细信息用于调试
    this.ctx.logger.info(`查询记录详情 - 键: ${key}, 用户ID: ${record.userId}, 次数: ${record.count}, 最后时间: ${new Date(record.lastTriggerTime).toLocaleString()}`)

    // 计算重置时间
    const resetTimeMs = config.punishmentResetHours * 60 * 60 * 1000
    const elapsedTime = now - record.lastTriggerTime

    // 如果已经过了重置时间或从未设置时间，则显示为已重置
    if (record.lastTriggerTime === 0) {
      this.logDebug(`记录 ${key} 为空（从未触发）`)
      this.ctx.logger.info(`记录 ${key} 为空（从未触发）`)
      return { count: 0, resetTime: '从未触发' }
    } else if (elapsedTime > resetTimeMs) {
      this.logDebug(`记录 ${key} 已过期 (${elapsedTime / (60 * 60 * 1000)} 小时)`)
      this.ctx.logger.info(`记录 ${key} 已过期 (${elapsedTime / (60 * 60 * 1000)} 小时)`)

      // 更新数据库中的记录为重置状态
      await this.ctx.database.set('keyword_warnings', {
        id: record.id
      }, {
        count: 0,
        lastTriggerTime: 0
      })

      // 更新内存缓存
      this.punishmentRecords.set(key, {
        userId,
        count: 0,
        lastTriggerTime: 0
      })

      return { count: 0, resetTime: '已重置' }
    }

    // 计算剩余重置时间
    const remainingTime = resetTimeMs - elapsedTime
    const remainingHours = Math.floor(remainingTime / (60 * 60 * 1000))
    const remainingMinutes = Math.floor((remainingTime % (60 * 60 * 1000)) / (60 * 1000))

    const resetTime = `${remainingHours}小时${remainingMinutes}分钟后`
    this.logDebug(`记录 ${key} 查询结果: 次数=${record.count}, 重置时间=${resetTime}`)
    this.ctx.logger.info(`记录 ${key} 查询结果: 次数=${record.count}, 重置时间=${resetTime}`)

    // 构建包含更多信息的返回结果
    const result = {
      count: record.count,
      resetTime,
      lastTrigger: undefined,
      history: undefined
    }

    // 添加最近触发信息
    if (record.lastTriggerKeyword) {
      result.lastTrigger = {
        keyword: record.lastTriggerKeyword,
        type: record.lastTriggerType,
        action: record.lastActionType,
        time: record.lastTriggerTime,
        message: record.lastMessageContent || '无内容',
        timeFormatted: record.lastTriggerTimeFormatted
      }
    }

    // 添加历史记录
    try {
      if (record.actionHistory) {
        const historyData = JSON.parse(record.actionHistory);
        // 为每条历史记录添加格式化的时间
        result.history = historyData.map(item => ({
          ...item,
          timeFormatted: this.formatDateTime(item.time)
        }));
      }
    } catch (error) {
      this.ctx.logger.error(`解析处罚历史失败: ${error.message}`)
    }

    return result
  }

  /**
   * 清零用户警告记录
   * @param userId 用户ID
   * @param guildId 群组ID (可选)
   */
  async resetUserWarningRecord(userId: string, guildId?: string): Promise<boolean> {
    // 确保数据库已初始化
    if (!this.dbInitialized) await this.initDatabase()

    const key = this.getRecordKey(userId, guildId)
    this.logDebug(`尝试清零记录: ${key}`)

    // 查询是否存在记录
    const records = await this.ctx.database.get('keyword_warnings', {
      userId: userId,
      guildId: guildId || ''
    })

    if (records.length === 0) {
      this.logDebug(`尝试重置不存在的记录: ${key}`)
      this.logDebug(`尝试重置不存在的记录: ${key}`)
      return false
    }

    // 重置记录
    await this.ctx.database.set('keyword_warnings', {
      userId: userId,
      guildId: guildId || ''
    }, {
      count: 0,
      lastTriggerTime: 0
    })

    // 更新内存缓存
    this.punishmentRecords.set(key, {
      userId,
      count: 0,
      lastTriggerTime: 0
    })

    this.logDebug(`记录已清零: ${key}`)
    this.ctx.logger.info(`记录已清零: ${key}`)
    return true
  }

  /**
   * 获取所有有警告记录的用户ID
   * @param guildId 群组ID (可选)，如果提供则只返回该群组的记录
   * @param config 插件配置，用于计算记录是否过期
   */
  async getAllWarnedUserIds(guildId?: string, config?: PluginConfig): Promise<string[]> {
    // 确保数据库已初始化
    if (!this.dbInitialized) await this.initDatabase()

    const userIds: string[] = []
    this.logDebug(`获取所有警告记录${guildId ? ` (群组: ${guildId})` : ''}`)
    this.logDebug(`获取所有警告记录${guildId ? ` (群组: ${guildId})` : ''}`)

    // 打印当前所有记录
    this.logDebug('当前所有警告记录:')
    const allRecords = await this.ctx.database.get('keyword_warnings', {})
    allRecords.forEach(record => {
      const recordKey = this.getRecordKey(record.userId, record.guildId)
      this.logDebug(`  ${recordKey}: 次数=${record.count}, 最后时间=${new Date(record.lastTriggerTime).toLocaleString()}`)
    })

    // 计算重置时间
    const now = Date.now()
    // 使用默认24小时，或者使用配置的时间
    const resetTimeMs = config ? config.punishmentResetHours * 60 * 60 * 1000 : 24 * 60 * 60 * 1000

    // 记录总记录数和有效记录数
    let totalRecords = 0
    let validRecords = 0

    // 查询条件
    const query: any = {
      count: { $gt: 0 } // 只选择有警告次数的记录
    }

    // 如果指定了群组ID，只返回该群组的记录
    if (guildId) {
      query.guildId = guildId
    }

    // 从数据库查询记录
    const records = await this.ctx.database.get('keyword_warnings', query)

    totalRecords = records.length

    // 过滤有效记录
    for (const record of records) {
      // 检查记录是否过期
      const elapsedTime = now - record.lastTriggerTime
      const isExpired = record.lastTriggerTime === 0 || elapsedTime > resetTimeMs

      if (isExpired) {
        this.logDebug(`  跳过过期记录: ${record.guildId}:${record.userId}, 最后时间: ${new Date(record.lastTriggerTime).toLocaleString()}, 已过期: ${elapsedTime / (60 * 60 * 1000)} 小时`)
        continue
      }

      // 记录有效
      validRecords++
      userIds.push(record.userId)
      this.logDebug(`  找到记录: ${record.guildId}:${record.userId}, 次数=${record.count}`)
      this.logDebug(`  找到记录: ${record.guildId}:${record.userId}, 次数=${record.count}, 最后时间: ${new Date(record.lastTriggerTime).toLocaleString()}`)
    }

    this.logDebug(`共找到 ${userIds.length} 条记录`)
    this.logDebug(`统计: 总记录数=${totalRecords}, 有效记录数=${validRecords}, 符合条件记录数=${userIds.length}`)
    return userIds
  }

  /**
   * 同步所有警告记录
   * 检查所有记录，保留有效的，重置过期的
   * @param config 插件配置
   */
  async syncAllRecords(config: PluginConfig): Promise<{total: number, kept: number, reset: number}> {
    // 确保数据库已初始化
    if (!this.dbInitialized) await this.initDatabase()

    this.ctx.logger.info('开始同步所有警告记录')

    let total = 0
    let kept = 0
    let reset = 0

    const now = Date.now()
    const resetTimeMs = config.punishmentResetHours * 60 * 60 * 1000

    // 获取所有记录
    const records = await this.ctx.database.get('keyword_warnings', {})
    total = records.length

    // 处理每条记录
    for (const record of records) {
      // 检查记录是否过期
      const elapsedTime = now - record.lastTriggerTime
      const isExpired = elapsedTime > resetTimeMs || record.lastTriggerTime === 0

      if (record.count > 0 && !isExpired) {
        // 保留有效记录
        kept++
        this.logDebug(`保留记录: ${record.guildId}:${record.userId}, 次数=${record.count}, 最后时间=${new Date(record.lastTriggerTime).toLocaleString()}`)
      } else {
        // 重置过期记录
        await this.ctx.database.set('keyword_warnings', {
          id: record.id
        }, {
          count: 0,
          lastTriggerTime: 0
        })

        // 更新内存缓存
        const key = this.getRecordKey(record.userId, record.guildId)
        this.punishmentRecords.set(key, {
          userId: record.userId,
          count: 0,
          lastTriggerTime: 0
        })

        reset++
        this.logDebug(`重置记录: ${record.guildId}:${record.userId}`)
      }
    }

    this.ctx.logger.info(`同步完成: 总共 ${total} 条记录, 保留 ${kept} 条, 重置 ${reset} 条`)
    return { total, kept, reset }
  }

  /**
   * 获取当前所有记录的调试信息
   */
  async getDebugInfo(): Promise<string> {
    // 确保数据库已初始化
    if (!this.dbInitialized) await this.initDatabase()

    let info = '当前所有警告记录:\n'

    // 从数据库获取所有记录
    const records = await this.ctx.database.get('keyword_warnings', {})

    if (records.length === 0) {
      return info + '无记录\n'
    }

    records.forEach(record => {
      const key = this.getRecordKey(record.userId, record.guildId)
      info += `${key}: 次数=${record.count}, 最后时间=${record.lastTriggerTimeFormatted || new Date(record.lastTriggerTime).toLocaleString()}\n`

      // 添加更多详细信息
      if (record.lastTriggerKeyword) {
        info += `  最近触发: ${record.lastTriggerKeyword} (${record.lastTriggerType})\n`
        info += `  处罚类型: ${record.lastActionType}\n`
        if (record.lastMessageContent) {
          info += `  消息内容: ${record.lastMessageContent}\n`
        }
      }

      info += '\n'
    })

    return info
  }

  /**
   * 获取警告记录的总数
   */
  async getRecordCount(): Promise<number> {
    // 确保数据库已初始化
    if (!this.dbInitialized) await this.initDatabase()

    try {
      // 获取所有记录并计算长度
      const records = await this.ctx.database.get('keyword_warnings', {})
      return records.length
    } catch (error) {
      this.ctx.logger.error(`获取记录数量失败: ${error.message}`)
      return 0
    }
  }

  /**
   * 获取缓存中的记录数量
   */
  getCacheSize(): number {
    return this.punishmentRecords.size
  }

  /**
   * 同步所有警告记录（从数据库到内存缓存）
   */
  async syncFromDatabase(): Promise<boolean> {
    // 确保数据库已初始化
    if (!this.dbInitialized) await this.initDatabase()

    try {
      // 清空当前缓存
      this.punishmentRecords.clear()

      // 获取所有记录
      const records = await this.ctx.database.get('keyword_warnings', {})

      // 将记录加载到缓存
      records.forEach(record => {
        const key = this.getRecordKey(record.userId, record.guildId)
        this.punishmentRecords.set(key, {
          userId: record.userId,
          count: record.count,
          lastTriggerTime: record.lastTriggerTime
        })
      })

      this.ctx.logger.info(`已同步 ${records.length} 条警告记录到内存缓存`)
      return true
    } catch (error) {
      this.ctx.logger.error(`同步警告记录失败: ${error.message}`)
      return false
    }
  }

  /**
   * 清空所有警告记录（从内存缓存中）
   */
  async clearCache(): Promise<boolean> {
    try {
      // 清空内存缓存
      this.punishmentRecords.clear()
      this.ctx.logger.info('已清空内存缓存中的所有警告记录')
      return true
    } catch (error) {
      this.ctx.logger.error(`清空缓存记录失败: ${error.message}`)
      return false
    }
  }
}
