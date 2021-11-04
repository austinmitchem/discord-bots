import { GuildBan } from 'discord.js';
import { Db, InsertOneWriteOpResult, MongoError } from 'mongodb';
import constants from '../service/constants/constants';
import { DiscordEvent } from '../types/discord/DiscordEvent';
import dbInstance from '../utils/dbUtils';
import Log, { LogUtils } from '../utils/Log';
import { SpamFilterConfig } from '../types/spam-filter/SpamFilterConfig';
import { SpamFilterConfigType } from '../types/spam-filter/SpamFilterConfigType';

export default class implements DiscordEvent {
	name = 'guildBanRemove';
	once = false;

	async execute(ban: GuildBan): Promise<any> {
		try {
			Log.debug(`unbanning user: ${ban.user.tag}`, {
				indexMeta: true,
				meta: {
					userId: ban.user.id,
					userTag: ban.user.tag,
					guildId: ban.guild.id,
				},
			});
			// Add unbanned users to allowlist so they don't get auto-banned by the bot
			const db: Db = await dbInstance.dbConnect(constants.DB_NAME_DEGEN);
			const dbAllowlist = db.collection(constants.DB_COLLECTION_USERNAME_SPAM_FILTER);
			const result: InsertOneWriteOpResult<SpamFilterConfig> = await dbAllowlist.insertOne({
				objectType: SpamFilterConfigType.ALLOWLIST_USER,
				discordObjectId: ban.user.id,
				discordObjectName: ban.user.username,
				discordServerId: ban.guild.id,
				discordServerName: ban.guild.name,
			});
			if (result == null || result.insertedCount !== 1) {
				throw new MongoError(`failed to insert ${ban.user.id} into allowlist`);
			}
		} catch (e) {
			LogUtils.logError('failed to process event guildBanRemove', e);
		}
	}
}