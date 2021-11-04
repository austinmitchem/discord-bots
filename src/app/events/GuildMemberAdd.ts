import { GuildMember } from 'discord.js';
import { DiscordEvent } from '../types/discord/DiscordEvent';
import ServiceUtils from '../utils/ServiceUtils';
import { LogUtils } from '../utils/Log';
import SpamFilter from '../service/spam-filter/SpamFilter';

export default class implements DiscordEvent {
	name = 'guildMemberAdd';
	once = false;

	async execute(member: GuildMember): Promise<any> {
		try {
			if (ServiceUtils.isBanklessDAO(member.guild)) {
				if (await SpamFilter.runUsernameSpamFilter(member)) {
					return;
				}
			}
		} catch (e) {
			LogUtils.logError('failed process event guildMemberAdd', e);
		}
	}
}