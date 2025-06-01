import { Session, h } from 'koishi'
import { MessageHandler } from './base-handler'
import { Config as PluginConfig } from '../types'
import { WarningManager } from './warning-manager'

// 网址处理器
export class UrlHandler extends MessageHandler {
  // 使用更激进的URL检测策略，多个正则表达式分别匹配不同的URL形式
  // 主正则：匹配标准URL格式
  private readonly URL_REGEX_STANDARD = /(?:https?:\/\/|www\.)[^\s\"\'\(\)\[\]\{\}\<\>:;,。，！？!?=]+/gi
  // 普通域名正则：匹配不带协议的域名
  private readonly URL_REGEX_DOMAIN = /\b[a-zA-Z0-9][a-zA-Z0-9-]*\.[a-zA-Z]{2,}(?:\/[^\s\"\'\(\)\[\]\{\}\<\>:;,。，！？!?]*)?/gi
  // IP地址正则：匹配IP地址形式
  private readonly URL_REGEX_IP = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d{1,5})?(?:\/[^\s\"\'\(\)\[\]\{\}\<\>:;,。，！？!?]*)?/gi

  // 使用警告记录管理器
  private warningManager: WarningManager

  constructor(ctx) {
    super(ctx)
    this.warningManager = new WarningManager(ctx)
  }

  // 预处理消息内容，处理HTML实体引用等
  private preprocessMessage(message: string): string {
    // 替换常见的HTML实体引用，避免&amp;这样的内容打断URL
    let processed = message
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    // 在特殊字符与可能的URL之间添加空格，确保更好地检测
    // 这会将 "@http://" 替换为 "@ http://"
    processed = processed.replace(/([@＠\^\$\#\*\(\)\[\]\{\}\|\\;:,，。！？!?])(?=https?:\/\/|www\.)/gi, '$1 ');

    // 在特殊字符与可能的域名之间添加空格
    processed = processed.replace(/([^\s\w\-\.])(?=[\w\-]+\.(?:com|net|org|cn|io|xyz|top|vip))/gi, '$1 ');

    this.ctx.logger.debug(`预处理后的消息: ${processed}`);
    return processed;
  }

  // 检查是否是一个简单的文件名(而非URL)
  private isLikelyFilename(url: string): boolean {
    // 首先排除IP地址
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?$/i.test(url)) {
      return false; // 这是一个IP地址，不是文件名
    }

    // 哈希文件名检测 - 专门处理QQ语音、视频等媒体文件
    // QQ语音文件通常是32位MD5哈希值+扩展名格式
    if (/^[a-f0-9]{32}\.[a-z0-9]{2,4}$/i.test(url)) {
      this.ctx.logger.debug(`检测到哈希文件名: ${url}，判定为文件而非URL`);
      return true;
    }

    // 其他哈希文件名格式
    if (/^[a-f0-9]{8,40}\.[a-z0-9]{2,4}$/i.test(url) && !url.includes('/')) {
      this.ctx.logger.debug(`检测到可能的哈希文件名: ${url}，判定为文件而非URL`);
      return true;
    }

    // 常见的媒体文件扩展名
    const mediaExtensions = [
      '.amr', '.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma', '.mp',
      '.opus', '.mid', '.midi', '.aiff', '.alac', '.silk',
      '.mp4', '.webm', '.mov', '.avi', '.mkv', '.flv', '.rmvb', '.wmv',
      '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.tif', '.tiff'
    ];

    // 检查是否以媒体文件扩展名结尾
    if (mediaExtensions.some(ext => url.toLowerCase().endsWith(ext))) {
      this.ctx.logger.debug(`检测到媒体文件扩展名: ${url}，判定为文件而非URL`);
      return true;
    }

    // 如果没有路径和协议，仅仅是一个带扩展名的短字符串，可能是文件名
    if (/^[\w\-]+\.[a-z0-9]{2,4}$/i.test(url) && !url.includes('/') && !url.includes(':')) {
      // 检查文件扩展名
      const fileExtensions = [
        '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
        '.mp4', '.webm', '.mov', '.avi', '.mkv', '.flv',
        '.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a',
        '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt',
        '.zip', '.rar', '.7z', '.tar', '.gz', '.apk', '.exe'
      ];

      // 如果以文件扩展名结尾，可能是文件
      return fileExtensions.some(ext => url.toLowerCase().endsWith(ext));
    }

    return false;
  }

  // 检查是否包含网址
  checkUrls(message: string, whitelist: string[]): string | null {
    if (!message) return null

    // 记录原始消息
    this.ctx.logger.debug(`检查消息中的URL: ${message}`);

    // 检查是否包含分享卡片或媒体消息
    if (this.isMediaOrShareMessage(message)) {
      this.ctx.logger.debug(`检测到分享卡片或媒体消息，跳过URL检测`);
      return null;
    }

    // 预处理消息内容
    message = this.preprocessMessage(message);

    // 排除插件命令
    if (message.match(/^(\/|\.)?kw(\.|\ )/i)) {
      this.ctx.logger.debug(`跳过插件命令检测: ${message}`)
      return null
    }

    // 排除特定插件命令
    const pluginCommands = [
      'kw.group.preset', 'kw group preset',
      'kw.group.remove-preset', 'kw group remove-preset',
      'kw.group.enable', 'kw group enable',
      'kw.group.disable', 'kw group disable',
      'kw.group.reset', 'kw group reset',
      'kw.warning.my', 'kw warning my',
      'kw.warning.query', 'kw warning query',
      'kw.warning.reset', 'kw warning reset',
      'kw.warning.list', 'kw warning list',
      'kw.url.whitelist', 'kw url whitelist'
    ]

    if (pluginCommands.some(cmd => message.startsWith(cmd))) {
      this.ctx.logger.debug(`跳过特定插件命令: ${message}`)
      return null
    }

    // 使用多重正则表达式匹配不同类型的URL
    // 1. 匹配标准URL (http://, https://, www.)
    const urlsStandard = message.match(this.URL_REGEX_STANDARD) || [];
    this.ctx.logger.debug(`标准URL匹配结果: ${urlsStandard.join(', ') || '无'}`);

    // 2. 匹配IP地址形式
    const ipUrls = message.match(this.URL_REGEX_IP) || [];
    this.ctx.logger.debug(`IP地址匹配结果: ${ipUrls.join(', ') || '无'}`);

    // 3. 匹配裸域名
    const domainUrls = message.match(this.URL_REGEX_DOMAIN) || [];
    this.ctx.logger.debug(`裸域名匹配结果: ${domainUrls.join(', ') || '无'}`);

    // 合并所有匹配结果到数组（需要正确处理类型）
    let urls: string[] = [];
    if (urlsStandard && urlsStandard.length) urls = urls.concat(Array.from(urlsStandard));
    if (ipUrls && ipUrls.length) urls = urls.concat(Array.from(ipUrls));
    if (domainUrls && domainUrls.length) urls = urls.concat(Array.from(domainUrls));

    // 去重
    urls = Array.from(new Set(urls));

    if (!urls.length) {
      this.ctx.logger.debug(`没有找到任何URL`);
      return null;
    }

    this.ctx.logger.debug(`找到${urls.length}个潜在URL: ${urls.join(', ')}`);

    // 创建一个已处理URL的集合，避免重复处理
    const processedDomains = new Set<string>();

    // 常见的安全域名白名单
    const safeWhitelist = [
      // QQ相关
      'qq.com', 'gtimg.cn', 'qpic.cn', 'qlogo.cn', 'gtimg.com',
      'gchat.qpic.cn', 'c2cpicdw.qpic.cn', 'p.qpic.cn',
      'nt.qq.com.cn', 'qzone.qq.com', 'qqmail.com',

      // 腾讯相关
      'tencent.com', 'weixin.qq.com', 'wx.qq.com',
      'myqcloud.com', 'tencent-cloud.cn',

      // 音乐平台
      'music.qq.com', 'y.qq.com', 'music.163.com', 'kugou.com',
      'kuwo.cn', 'xiami.com', 'douban.fm', 'music.migu.cn',
      'qianqian.com', 'taihe.com',

      // 视频平台
      'v.qq.com', 'video.qq.com', 'bilibili.com', 'b23.tv',
      'youku.com', 'iqiyi.com', 'douyin.com', 'kuaishou.com',
      'weishi.qq.com', 'douyinpic.com', 'douyincdn.com',
      'xigua.com', 'huoshan.com',

      // 常见图片CDN
      'sinaimg.cn', 'mmbiz.qpic.cn', 'wx.qlogo.cn',
      'hdslb.com', 'bilivideo.com', 'bili.com',

      // 常见平台
      'baidu.com', 'bdstatic.com', 'google.com',
      'microsoft.com', 'msn.com', 'bing.com',
      'weibo.com', 'zhihu.com',

      // 其他CDN
      '126.net', '163.com', 'netease.com',
      'qiniucdn.com', 'qnimg.cn', 'qiniup.com',
      'xiaohongshu.com', 'xhscdn.com', 'xhslink.com'
    ]

    // 合并白名单
    const combinedWhitelist = [...whitelist, ...safeWhitelist];
    this.ctx.logger.debug(`白名单域名数量: ${combinedWhitelist.length}`);

    // 检查URL是否在白名单中
    for (const url of urls) {
      // 首先检查是否是文件名而不是URL
      if (this.isLikelyFilename(url)) {
        this.ctx.logger.debug(`跳过可能为文件名的内容: ${url}`);
        continue;
      }

      let hostname = '';

      try {
        // 处理URL，确保有协议前缀
        let urlWithProtocol = url;
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          urlWithProtocol = 'http://' + url;
        }

        const urlObj = new URL(urlWithProtocol);
        hostname = urlObj.hostname;

        // 如果域名已处理过，跳过
        if (processedDomains.has(hostname)) {
          this.ctx.logger.debug(`跳过已处理域名: ${hostname}`);
          continue;
        }

        // 添加到已处理集合
        processedDomains.add(hostname);

        // 跳过媒体资源URL
        if (this.isMediaUrl(url, hostname)) {
          this.ctx.logger.debug(`跳过媒体URL: ${url}`);
          continue;
        }

        // 检查是否在白名单中
        const isWhitelisted = combinedWhitelist.some(domain => {
          const match = hostname === domain ||
                       hostname.endsWith(`.${domain}`) ||
                       domain.includes(hostname);
          if (match) {
            this.ctx.logger.debug(`URL ${url} 匹配白名单 ${domain}`);
          }
          return match;
        });

        if (!isWhitelisted) {
          this.ctx.logger.info(`⚠️ 检测到非白名单URL: ${url} (${hostname})`);
          // 返回原始匹配的URL，而不是带协议的版本
          return url;
        } else {
          this.ctx.logger.debug(`URL在白名单中: ${url} (${hostname})`);
        }
      } catch (error) {
        // URL解析错误，可能需要特殊处理
        this.ctx.logger.debug(`URL解析错误: ${error.message}, 内容: ${url}`);

        // 尝试直接匹配域名部分
        const domainMatch = /([a-zA-Z0-9][a-zA-Z0-9-]*\.[a-zA-Z]{2,})/.exec(url);
        if (domainMatch) {
          const simpleDomain = domainMatch[1];
          this.ctx.logger.debug(`从错误URL提取域名: ${simpleDomain}`);

          // 检查简化域名是否在白名单中
          const isSimpleDomainWhitelisted = combinedWhitelist.some(domain => {
            return simpleDomain === domain ||
                   simpleDomain.endsWith(`.${domain}`) ||
                   domain.includes(simpleDomain);
          });

          if (!isSimpleDomainWhitelisted) {
            this.ctx.logger.info(`⚠️ 检测到非白名单域名: ${simpleDomain} (从 ${url})`);
            return url;
          }
        } else {
          // 如果无法提取域名，检查是否包含常见顶级域名
          const hasTLD = ['.com', '.net', '.org', '.io', '.cn', '.xyz', '.top'].some(tld =>
            url.includes(tld)
          );

          if (hasTLD) {
            this.ctx.logger.info(`⚠️ 检测到可能的非白名单URL: ${url} (无法解析)`);
            return url;
          }
        }

        // 如果都不符合，则跳过
        continue;
      }
    }

    return null
  }

  // 检查消息是否是媒体消息（语音、图片、视频等）或分享卡片
  private isMediaOrShareMessage(message: string): boolean {
    // 检查是否是纯媒体消息
    if (this.isMediaMessage(message)) {
      return true;
    }

    // 检查是否包含分享卡片格式 - 适用于QQ音乐、网易云音乐等分享卡片
    if (message.includes('[CQ:json,') ||
        message.includes('[CQ:xml,') ||
        message.includes('[CQ:share,')) {
      this.ctx.logger.debug(`检测到分享卡片格式消息: ${message.slice(0, 50)}...`);
      return true;
    }

    // 检查常见音乐分享格式
    if (message.includes('分享了一首歌') ||
        message.includes('分享了一条音乐') ||
        message.includes('分享了一个音乐') ||
        message.includes('分享了一个视频') ||
        message.includes('的音乐') ||
        message.includes('音乐名:') ||
        message.includes('歌曲名:') ||
        message.includes('音乐来自:') ||
        message.includes('QQ音乐') ||
        message.includes('网易云音乐') ||
        message.includes('酷狗音乐') ||
        message.includes('酷我音乐') ||
        message.includes('喜马拉雅') ||
        message.includes('分享了一个小程序') ||
        message.includes('哔哩哔哩')) {
      this.ctx.logger.debug(`检测到常见音乐/视频分享文本: ${message}`);
      return true;
    }

    return false;
  }

  // 检查消息是否是媒体消息（语音、图片、视频等）
  private isMediaMessage(message: string): boolean {
    // 检查完整CQ码
    if (message.includes('[CQ:record,') || // 语音
        message.includes('[CQ:voice,') ||  // 语音
        message.includes('[CQ:audio,') ||  // 音频
        message.includes('[CQ:image,') ||  // 图片
        message.includes('[CQ:video,') ||  // 视频
        message.includes('[CQ:face,') ||   // 表情
        message.includes('[CQ:bface,') ||  // 大表情
        message.includes('[CQ:file,')) {   // 文件
      return true;
    }

    // 检查其他消息中的媒体内容标识
    if (message.includes('[mirai:audio') ||
        message.includes('[mirai:voice') ||
        message.includes('[mirai:image') ||
        message.includes('[mirai:video') ||
        message.includes('[图片]') ||
        message.includes('[语音]') ||
        message.includes('[视频]') ||
        message.includes('[文件]')) {
      return true;
    }

    // 检查消息内容是否只包含一个哈希文件名 (.amr, .mp 等)
    const trimmedMessage = message.trim();
    if (/^[a-f0-9]{32}\.(amr|mp|mp3|silk|slk|wav|wma)$/i.test(trimmedMessage)) {
      this.ctx.logger.debug(`消息内容匹配语音/音频文件格式: ${trimmedMessage}`);
      return true;
    }

    // 检查消息是否仅包含图片或视频文件名
    if (/^[a-f0-9]{32}\.(jpg|jpeg|png|gif|webp|mp4|avi|mov)$/i.test(trimmedMessage)) {
      this.ctx.logger.debug(`消息内容匹配图片/视频文件格式: ${trimmedMessage}`);
      return true;
    }

    return false;
  }

  // 检查URL是否为媒体资源URL
  private isMediaUrl(url: string, hostname: string): boolean {
    // 特征路径检测
    const mediaPathPatterns = [
      'QFace', '/gchatpic_new/', '/c2c-', '/emoji/', '/face/',
      '/faceemotion/', '/chatimg/', '/offpic_new/', '/mmbiz_', '/logo/',
      '/offical/', '/official/', '/image/', '/sticker/',
      '/resource/', '/download', '/thumbnail/', '/profile/',
      '/avatar/', '/qrcode/', '/icon/', '/photo/',
      '/share/', '/static/', '/assets/', '/media/',
      '/uploads/', '/emojis/', '/gif/', '/cdn/',
      '/music/', '/audio/', '/voice/', '/sound/',
      '/video/', '/record/', '/file/', '/doc/'
    ];

    if (mediaPathPatterns.some(pattern => url.includes(pattern))) {
      return true;
    }

    // 多媒体域名特征检测
    const mediaDomainKeywords = [
      'multimedia', 'media', 'img', 'image', 'pic', 'photo',
      'static', 'assets', 'resource', 'cdn', 'music', 'audio',
      'voice', 'video', 'file', 'storage'
    ];

    if (mediaDomainKeywords.some(keyword => hostname.includes(keyword))) {
      return true;
    }

    // URL参数检测
    const mediaParamKeywords = [
      'image=', 'img=', 'pic=', 'photo=', 'avatar=', 'icon=',
      'audio=', 'voice=', 'video=', 'file=', 'record='
    ];

    try {
      const urlObj = new URL(url.startsWith('http') ? url : `http://${url}`);
      if (mediaParamKeywords.some(param => urlObj.search.includes(param))) {
        return true;
      }
    } catch (error) {
      // 忽略URL解析错误
    }

    return false;
  }

  // 处理网址检测
  async handleUrlDetection(meta: Session, config: PluginConfig): Promise<boolean> {
    // 如果未启用网址检测，直接返回
    if (!config.detectUrls) return false

    // 获取消息内容
    const message = this.getMessageContent(meta)

    // 检查是否包含非白名单网址
    const matchedUrl = this.checkUrls(message, config.urlWhitelist)
    if (!matchedUrl) return false

    // 检查用户是否为管理员
    if (await this.isUserAdmin(meta)) {
      this.ctx.logger.info(`[${meta.guildId}] 用户 ${meta.userId} 是管理员，不进行网址检测处理`)
      return false
    }

    // 检查机器人权限
    const hasBotPermission = await this.checkBotPermission(meta)

    // 如果启用了自动处罚机制，则使用自动处罚
    if (config.enableAutoPunishment) {
      return await this.handleAutoPunishment(meta, config, matchedUrl)
    }

    // 否则使用原有逻辑
    // 处理撤回
    if (config.urlAction === 'recall' || config.urlAction === 'both') {
      await this.recallMessage(meta)
    }

    // 处理禁言
    if ((config.urlAction === 'mute' || config.urlAction === 'both') && hasBotPermission) {
      const muted = await this.muteUser(meta, config.urlMuteDuration)

      if (muted) {
        const durationText = this.formatDuration(config.urlMuteDuration)

        // 发送提示消息
        if (config.urlCustomMessage) {
          await this.sendNotice(meta, config.urlCustomMessage, durationText)
        }

        this.ctx.logger.info(`[${meta.guildId}] 用户 ${meta.userId} 因发送网址 "${matchedUrl}" 被禁言 ${durationText}`)
      }
    } else if (config.urlCustomMessage && hasBotPermission) {
      // 只有在有权限时才发送提示消息
      await this.sendNotice(meta, config.urlCustomMessage)
    } else if (!hasBotPermission && (config.urlAction === 'mute' || config.urlAction === 'both')) {
      // 如果没有权限，只记录日志不发送消息
      this.ctx.logger.warn(`[${meta.guildId}] 机器人没有管理权限，无法禁言用户`)
    }

    return true
  }

  // 处理自动处罚
  private async handleAutoPunishment(meta: Session, config: PluginConfig, matchedUrl: string): Promise<boolean> {
    // 检查机器人权限
    const hasBotPermission = await this.checkBotPermission(meta)

    // 记录处理前的状态
    const beforeRecord = await this.warningManager.queryUserWarningRecord(meta.userId, config, meta.guildId)
    this.ctx.logger.info(`[${meta.guildId}] URL处罚: 处理前用户 ${meta.userId} 的警告记录: 次数=${beforeRecord.count}`)

    // 更新并获取用户的违规次数
    const violationCount = await this.warningManager.updateUserPunishmentRecord(
      meta.userId,
      config,
      meta.guildId,
      {
        keyword: matchedUrl,
        type: 'url',
        action: 'warn', // 默认为警告，稍后根据实际处罚更新
        messageContent: this.getMessageContent(meta)
      }
    )
    this.ctx.logger.info(`[${meta.guildId}] URL处罚: 已更新用户 ${meta.userId} 的警告记录: 次数=${violationCount}`)

    // 记录处理后的状态
    const afterRecord = await this.warningManager.queryUserWarningRecord(meta.userId, config, meta.guildId)
    this.ctx.logger.info(`[${meta.guildId}] URL处罚: 处理后用户 ${meta.userId} 的警告记录: 次数=${afterRecord.count}`)

    if (beforeRecord.count === afterRecord.count && violationCount !== afterRecord.count) {
      this.ctx.logger.warn(`[${meta.guildId}] URL处罚: 警告记录更新异常: 预期次数=${violationCount}, 实际次数=${afterRecord.count}`)
    }

    // 撤回消息（所有违规等级都撤回）
    if (config.urlAction === 'recall' || config.urlAction === 'both') {
      await this.recallMessage(meta)
      this.ctx.logger.info(`[${meta.guildId}] URL处罚: 已撤回用户 ${meta.userId} 发送的含URL消息`)
    }

    // 如果没有权限，记录日志但不执行处罚操作
    if (!hasBotPermission) {
      this.ctx.logger.warn(`[${meta.guildId}] URL处罚: 机器人没有管理权限，无法执行处罚操作`)
      return true
    }

    let actionTaken = false
    let message = ''
    let actionType: 'warn' | 'mute' | 'kick' = 'warn' // 默认为警告

    // 根据违规次数执行不同的处罚
    if (violationCount === 1) {
      // 第一次：警告
      message = `您发送了非白名单网址"${matchedUrl}"，这是第一次警告。`
      actionTaken = true
      this.ctx.logger.info(`[${meta.guildId}] URL处罚: 用户 ${meta.userId} 第1次违规，执行警告`)
    }
    else if (violationCount >= 2) {
      // 计算禁言时长，随违规次数递增
      let muteDuration = 0;

      if (violationCount === 2) {
        // 第二次违规：使用配置的第二次违规禁言时长
        muteDuration = config.secondViolationMuteDuration;
        this.ctx.logger.info(`[${meta.guildId}] URL处罚: 第二次违规，禁言时长: ${muteDuration}秒`);
      }
      else if (violationCount >= config.maxViolationCount) {
        // 达到最大违规次数
        if (config.kickOnMaxViolation) {
          this.ctx.logger.info(`[${meta.guildId}] URL处罚: 用户 ${meta.userId} 达到最大违规次数 ${violationCount}/${config.maxViolationCount}，尝试执行踢出`)
          const kicked = await this.kickUser(meta)
          if (kicked) {
            message = `用户 ${meta.username || meta.userId} 因多次发送非白名单网址"${matchedUrl}"已被踢出群聊。`
            actionTaken = true
            actionType = 'kick'
            this.ctx.logger.info(`[${meta.guildId}] URL处罚: 用户 ${meta.userId} 第${violationCount}次违规，已踢出群聊`)

            // 更新处罚类型为踢出
            await this.warningManager.updateUserPunishmentRecord(
              meta.userId,
              config,
              meta.guildId,
              {
                keyword: matchedUrl,
                type: 'url',
                action: 'kick',
                messageContent: this.getMessageContent(meta)
              }
            )

            return actionTaken; // 踢出后不需要继续处理
          }
          // 如果踢出失败，使用长时间禁言
          this.ctx.logger.warn(`[${meta.guildId}] URL处罚: 踢出用户 ${meta.userId} 失败，将使用长时间禁言代替`)
          muteDuration = 3600; // 1小时
        } else {
          // 配置为不踢出，使用长时间禁言
          muteDuration = 3600; // 1小时
          this.ctx.logger.info(`[${meta.guildId}] URL处罚: 用户 ${meta.userId} 达到最大违规次数 ${violationCount}/${config.maxViolationCount}，执行长时间禁言(${muteDuration}秒)`)
        }
      }
      else {
        // 中间违规次数：禁言时间按倍数递增
        // 使用第二次违规时长的倍数：(违规次数-1)倍
        muteDuration = config.secondViolationMuteDuration * (violationCount - 1);
        this.ctx.logger.info(`[${meta.guildId}] URL处罚: 第${violationCount}次违规，禁言时长: ${muteDuration}秒 (${config.secondViolationMuteDuration} × ${violationCount-1})`);
      }

      // 执行禁言
      if (muteDuration > 0) {
        const muted = await this.muteUser(meta, muteDuration)
        if (muted) {
          const durationText = this.formatDuration(muteDuration)
          message = `您发送了非白名单网址"${matchedUrl}"，这是第${violationCount}次违规，已禁言${durationText}。`
          actionTaken = true
          actionType = 'mute'
          this.ctx.logger.info(`[${meta.guildId}] URL处罚: 用户 ${meta.userId} 第${violationCount}次违规，已禁言${durationText}`)
        } else {
          this.ctx.logger.warn(`[${meta.guildId}] URL处罚: 禁言用户 ${meta.userId} 失败`)
        }
      }
    }

    // 更新处罚类型
    if (actionTaken && actionType !== 'warn') {
      await this.warningManager.updateUserPunishmentRecord(
        meta.userId,
        config,
        meta.guildId,
        {
          keyword: matchedUrl,
          type: 'url',
          action: actionType,
          messageContent: this.getMessageContent(meta)
        }
      )
    }

    // 发送处罚通知
    if (actionTaken && message) {
      await this.sendNotice(meta, message)
      this.ctx.logger.info(`[${meta.guildId}] URL处罚: 用户 ${meta.userId} 因发送非白名单网址 "${matchedUrl}" 第${violationCount}次违规，已执行自动处罚并发送通知`)
    }

    return actionTaken
  }

  // 踢出用户
  async kickUser(meta: Session): Promise<boolean> {
    try {
      this.ctx.logger.info(`[${meta.guildId}] 尝试踢出用户 ${meta.userId}`)

      // 尝试使用 OneBot 的 setGroupKick 方法
      if ((meta as any).onebot?.setGroupKick) {
        await (meta as any).onebot.setGroupKick(meta.guildId, meta.userId, false)
        this.ctx.logger.info(`[${meta.guildId}] 使用 onebot.setGroupKick 踢出成功`)
        return true
      }
      // 优先使用 bot 对象上的 $setGroupKick 方法（OneBot 适配器）
      else if (meta.bot && typeof meta.bot['$setGroupKick'] === 'function') {
        await meta.bot['$setGroupKick'](meta.guildId, meta.userId, false)
        this.ctx.logger.info(`[${meta.guildId}] 使用 bot.$setGroupKick 踢出成功`)
        return true
      }
      // 尝试使用 setGroupKick 方法
      else if (meta.bot && typeof meta.bot['setGroupKick'] === 'function') {
        await meta.bot['setGroupKick'](meta.guildId, meta.userId, false)
        this.ctx.logger.info(`[${meta.guildId}] 使用 bot.setGroupKick 踢出成功`)
        return true
      }
      // 最后尝试通用 API
      else if (meta.bot && typeof meta.bot.kickGuildMember === 'function') {
        await meta.bot.kickGuildMember(meta.guildId, meta.userId)
        this.ctx.logger.info(`[${meta.guildId}] 使用通用 API 踢出成功`)
        return true
      } else {
        this.ctx.logger.warn(`[${meta.guildId}] 无法踢出用户：平台不支持踢出功能或无法获取踢出方法`)
        return false
      }
    } catch (error) {
      this.ctx.logger.error(`[${meta.guildId}] 踢出用户失败: ${error.message}`)
      if (error.stack) {
        this.ctx.logger.debug(`[${meta.guildId}] 踢出错误堆栈: ${error.stack}`)
      }
      return false
    }
  }

  // 撤回消息
  async recallMessage(meta: Session): Promise<boolean> {
    try {
      // 尝试使用 OneBot 的 deleteMsg 方法
      if (meta.messageId && (meta as any).onebot?.deleteMsg) {
        await (meta as any).onebot.deleteMsg(meta.messageId)
        this.ctx.logger.info(`[${meta.guildId}] 使用 onebot.deleteMsg 撤回成功`)
        return true
      }
      // 使用 bot.deleteMessage 撤回消息
      else if (meta.messageId) {
        await meta.bot.deleteMessage(meta.channelId, meta.messageId)
        this.ctx.logger.info(`[${meta.guildId}] 使用 bot.deleteMessage 撤回成功`)
        return true
      }
      return false
    } catch (error) {
      this.ctx.logger.warn(`[${meta.guildId}] 消息撤回失败: ${error.message}`)
      return false
    }
  }

  // 禁言用户
  async muteUser(meta: Session, duration: number): Promise<boolean> {
    try {
      this.ctx.logger.info(`[${meta.guildId}] 尝试禁言用户 ${meta.userId}，时长: ${duration}秒`)

      // 尝试使用 OneBot 的 setGroupBan 方法
      if ((meta as any).onebot?.setGroupBan) {
        await (meta as any).onebot.setGroupBan(meta.guildId, meta.userId, duration)
        this.ctx.logger.info(`[${meta.guildId}] 使用 onebot.setGroupBan 禁言成功`)
        return true
      }
      // 优先使用 bot 对象上的 $setGroupBan 方法（OneBot 适配器）
      else if (meta.bot && typeof meta.bot['$setGroupBan'] === 'function') {
        await meta.bot['$setGroupBan'](meta.guildId, meta.userId, duration)
        this.ctx.logger.info(`[${meta.guildId}] 使用 bot.$setGroupBan 禁言成功`)
        return true
      }
      // 尝试使用 setGroupBan 方法（可能是 OneBot 适配器）
      else if (meta.bot && typeof meta.bot['setGroupBan'] === 'function') {
        await meta.bot['setGroupBan'](meta.guildId, meta.userId, duration)
        this.ctx.logger.info(`[${meta.guildId}] 使用 bot.setGroupBan 禁言成功`)
        return true
      }
      // 最后尝试通用 API
      else if (meta.bot && typeof meta.bot.muteGuildMember === 'function') {
        await meta.bot.muteGuildMember(meta.guildId, meta.userId, duration)
        this.ctx.logger.info(`[${meta.guildId}] 使用通用 API 禁言成功`)
        return true
      } else {
        this.ctx.logger.warn(`[${meta.guildId}] 无法禁言用户：平台不支持禁言功能或无法获取禁言方法`)
        return false
      }
    } catch (error) {
      this.ctx.logger.error(`[${meta.guildId}] 禁言失败: ${error.message}`)
      if (error.stack) {
        this.ctx.logger.debug(`[${meta.guildId}] 禁言错误堆栈: ${error.stack}`)
      }
      return false
    }
  }

  // 发送提示消息
  async sendNotice(meta: Session, message: string, durationText?: string): Promise<void> {
    try {
      // 尝试使用 OneBot 的 sendGroupMsg 方法
      if ((meta as any).onebot?.sendGroupMsg) {
        const atText = `[CQ:at,qq=${meta.userId}]`
        let msgText = `${atText} ${message}`

        if (durationText) {
          msgText += `\n已禁言 ${durationText}`
        }

        await (meta as any).onebot.sendGroupMsg(meta.guildId, msgText)
        this.ctx.logger.info(`[${meta.guildId}] 使用 onebot.sendGroupMsg 发送提示成功`)
        return
      }

      // 使用 Koishi 的 h 构造器创建消息，正确处理 at 元素
      let noticeMsg = h('', [
        h.at(meta.userId),
        ` ${message}`
      ])

      if (durationText) {
        noticeMsg = h('', [
          noticeMsg,
          `\n已禁言 ${durationText}`
        ])
      }

      // 使用 koishi 的 API 发送消息
      await meta.send(noticeMsg)
    } catch (error) {
      this.ctx.logger.warn(`[${meta.guildId}] 发送提示消息失败: ${error.message}`)
    }
  }

  // 格式化禁言时间
  formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}秒`

    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const remainingSeconds = seconds % 60

    let durationText = ''
    if (hours > 0) durationText += `${hours}小时`
    if (minutes > 0) durationText += `${minutes}分钟`
    if (remainingSeconds > 0) durationText += `${remainingSeconds}秒`

    return durationText
  }

  // 查询用户警告记录
  async queryUserWarningRecord(userId: string, config: PluginConfig, guildId?: string): Promise<{count: number, resetTime: string}> {
    return await this.warningManager.queryUserWarningRecord(userId, config, guildId)
  }

  // 清零用户警告记录
  async resetUserWarningRecord(userId: string, guildId?: string): Promise<boolean> {
    return await this.warningManager.resetUserWarningRecord(userId, guildId)
  }

  // 获取所有有警告记录的用户ID
  async getAllWarnedUserIds(guildId?: string, config?: PluginConfig): Promise<string[]> {
    return await this.warningManager.getAllWarnedUserIds(guildId, config)
  }
}
