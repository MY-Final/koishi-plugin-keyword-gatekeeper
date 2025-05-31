import { Context, Command, Session } from 'koishi'
import { Config, PresetPackage } from '../types'
import { KeywordDatabase } from '../database'

// 权限检查函数
async function checkPermission(session: any, requireAdmin: boolean = false): Promise<boolean> {
  // 检查是否为管理员
  if (session.platform === 'onebot' || session.platform === 'qq') {
    const { userId, guildId } = session
    if (!guildId) return false

    try {
      const member = await session.bot.getGuildMember(guildId, userId)
      return member && (member.roles || []).some(role =>
        ['owner', 'admin', 'administrator'].includes(role.toLowerCase())
      )
    } catch (e) {
      return false
    }
  }

  // 默认情况下，使用koishi的权限系统
  try {
    // 尝试获取用户权限等级
    const user = await session.app.database.getUser(session.platform, session.userId)
    return user && (requireAdmin ? user.authority > 3 : user.authority > 2)
  } catch (e) {
    // 如果获取失败，默认返回false
    return false
  }
}

/**
 * 注册预设包相关命令
 * @param ctx Koishi上下文
 * @param config 插件配置
 * @param database 数据库实例
 * @param presetCmd 预设命令对象
 */
export function registerPresetCommands(ctx: Context, config: Config, database: KeywordDatabase, presetCmd: Command) {
  // 预设包管理命令
  presetCmd.usage('管理关键词预设包，包括查看、创建、编辑和删除预设包')
    .action(({ session }) => {
      return `预设包管理命令：
- kwpreset list - 列出所有预设包
- kwpreset view <名称> - 查看预设包内容
- kwpreset create <名称> <描述> - 创建预设包
- kwpreset add <名称> <关键词> - 向预设包添加关键词
- kwpreset remove <名称> <关键词> - 从预设包移除关键词
- kwpreset delete <名称> - 删除预设包
- kwpreset import <名称> [群组ID] - 将预设包导入到群组`
    })

  // 列出所有预设包
  presetCmd.subcommand('list', '列出所有可用的预设包')
    .action(async ({ session }) => {
      // 检查权限
      if (!await checkPermission(session)) {
        return '你没有权限查看预设包列表。'
      }

      // 获取所有预设包
      const presets = await database.getAllPresetPackages()
      if (!presets || presets.length === 0) {
        return '当前没有可用的预设包。'
      }

      // 按系统预设和自定义预设分组
      const systemPresets = presets.filter(p => p.isSystem)
      const userPresets = presets.filter(p => !p.isSystem)

      let result = '可用的预设包列表：\n\n【系统预设包】\n'
      systemPresets.forEach(p => {
        result += `- ${p.name}：${p.description}\n`
      })

      if (userPresets.length > 0) {
        result += '\n【自定义预设包】\n'
        userPresets.forEach(p => {
          result += `- ${p.name}：${p.description}\n`
        })
      }

      return result
    })

  // 查看预设包内容
  presetCmd.subcommand('view <name:string>', '查看指定预设包的内容')
    .action(async ({ session }, name) => {
      // 检查参数
      if (!name) {
        return '请指定要查看的预设包名称。'
      }

      // 检查权限
      if (!await checkPermission(session)) {
        return '你没有权限查看预设包内容。'
      }

      // 检查是否允许显示预设包内容
      if (!config.showPresetContent) {
        return '管理员已禁用预设包内容查看功能。'
      }

      // 获取预设包
      const preset = await database.getPresetPackage(name)
      if (!preset) {
        return `找不到名为 "${name}" 的预设包。`
      }

      // 构建回复
      let result = `预设包 "${preset.name}" 的详细信息：\n`
      result += `- 描述：${preset.description}\n`
      result += `- 类型：${preset.isSystem ? '系统预设' : '自定义预设'}\n`
      result += `- 创建者：${preset.createdBy}\n`
      result += `- 创建时间：${new Date(preset.createdAt).toLocaleString()}\n`
      result += `- 包含关键词数量：${preset.keywords.length}\n\n`

      // 显示关键词列表
      result += '包含的关键词：\n'
      preset.keywords.forEach((keyword, index) => {
        result += `${index + 1}. ${keyword}\n`
      })

      return result
    })

  // 创建自定义预设包
  presetCmd.subcommand('create <name:string> <description:text>', '创建一个新的自定义预设包')
    .action(async ({ session }, name, description) => {
      // 检查参数
      if (!name || !description) {
        return '请提供预设包名称和描述。'
      }

      // 检查权限
      if (!await checkPermission(session, true)) {
        return '你没有权限创建预设包。'
      }

      // 检查是否允许创建自定义预设包
      if (!config.allowCustomPresets) {
        return '管理员已禁用自定义预设包功能。'
      }

      // 检查名称是否已存在
      const existing = await database.getPresetPackage(name)
      if (existing) {
        return `名为 "${name}" 的预设包已存在，请使用其他名称。`
      }

      // 创建预设包
      const newPreset: PresetPackage = {
        name,
        description,
        keywords: [],
        isSystem: false,
        createdBy: session.userId,
        createdAt: Date.now()
      }

      await database.createPresetPackage(newPreset)
      return `成功创建预设包 "${name}"。使用 kwpreset add ${name} <keyword> 添加关键词。`
    })

  // 向预设包添加关键词
  presetCmd.subcommand('add <name:string> <keyword:text>', '向指定预设包添加关键词')
    .action(async ({ session }, name, keyword) => {
      // 检查参数
      if (!name || !keyword) {
        return '请提供预设包名称和要添加的关键词。'
      }

      // 检查权限
      if (!await checkPermission(session, true)) {
        return '你没有权限编辑预设包。'
      }

      // 获取预设包
      const preset = await database.getPresetPackage(name)
      if (!preset) {
        return `找不到名为 "${name}" 的预设包。`
      }

      // 检查是否为系统预设包
      if (preset.isSystem) {
        return '系统预设包不能被修改。'
      }

      // 检查关键词是否已存在
      if (preset.keywords.includes(keyword)) {
        return `关键词 "${keyword}" 已存在于预设包中。`
      }

      // 添加关键词
      preset.keywords.push(keyword)
      await database.updatePresetPackage(preset.id, { keywords: preset.keywords })

      return `成功将关键词 "${keyword}" 添加到预设包 "${name}"。`
    })

  // 从预设包移除关键词
  presetCmd.subcommand('remove <name:string> <keyword:text>', '从指定预设包移除关键词')
    .action(async ({ session }, name, keyword) => {
      // 检查参数
      if (!name || !keyword) {
        return '请提供预设包名称和要移除的关键词。'
      }

      // 检查权限
      if (!await checkPermission(session, true)) {
        return '你没有权限编辑预设包。'
      }

      // 获取预设包
      const preset = await database.getPresetPackage(name)
      if (!preset) {
        return `找不到名为 "${name}" 的预设包。`
      }

      // 检查是否为系统预设包
      if (preset.isSystem) {
        return '系统预设包不能被修改。'
      }

      // 检查关键词是否存在
      const keywordIndex = preset.keywords.indexOf(keyword)
      if (keywordIndex === -1) {
        return `关键词 "${keyword}" 不存在于预设包中。`
      }

      // 移除关键词
      preset.keywords.splice(keywordIndex, 1)
      await database.updatePresetPackage(preset.id, { keywords: preset.keywords })

      return `成功从预设包 "${name}" 移除关键词 "${keyword}"。`
    })

  // 删除预设包
  presetCmd.subcommand('delete <name:string>', '删除指定的自定义预设包')
    .action(async ({ session }, name) => {
      // 检查参数
      if (!name) {
        return '请提供要删除的预设包名称。'
      }

      // 检查权限
      if (!await checkPermission(session, true)) {
        return '你没有权限删除预设包。'
      }

      // 获取预设包
      const preset = await database.getPresetPackage(name)
      if (!preset) {
        return `找不到名为 "${name}" 的预设包。`
      }

      // 检查是否为系统预设包
      if (preset.isSystem) {
        return '系统预设包不能被删除。'
      }

      // 删除预设包
      await database.deletePresetPackage(preset.id)

      return `成功删除预设包 "${name}"。`
    })

  // 导入预设包到群组配置
  presetCmd.subcommand('import <name:string> [guildId:string]', '将预设包导入到当前群组或指定群组')
    .action(async ({ session }, name, guildId) => {
      // 检查参数
      if (!name) {
        return '请提供要导入的预设包名称。'
      }

      // 使用当前群组ID或指定的群组ID
      const targetGuildId = guildId || session.guildId
      if (!targetGuildId) {
        return '请在群组中使用此命令，或指定目标群组ID。'
      }

      // 检查权限
      if (!await checkPermission(session, true)) {
        return '你没有权限导入预设包。'
      }

      // 获取预设包
      const preset = await database.getPresetPackage(name)
      if (!preset) {
        return `找不到名为 "${name}" 的预设包。`
      }

      // 获取群组配置
      let groupConfig = await database.getGroupConfig(targetGuildId)
      if (!groupConfig) {
        // 如果群组配置不存在，创建一个新的
        groupConfig = {
          guildId: targetGuildId,
          enabled: true,
          keywords: [],
          customMessage: config.customMessage,
          urlWhitelist: [],
          urlCustomMessage: config.urlCustomMessage
        }
        await database.createGroupConfig(groupConfig)
      }

      // 合并关键词，避免重复
      const newKeywords = [...new Set([...groupConfig.keywords, ...preset.keywords])]
      await database.updateGroupConfig(targetGuildId, { keywords: newKeywords })

      return `成功将预设包 "${name}" 导入到群组 ${targetGuildId}，共添加 ${newKeywords.length - groupConfig.keywords.length} 个新关键词。`
    })
}
