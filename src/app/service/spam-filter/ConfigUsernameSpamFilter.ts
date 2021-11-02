import { Collection, GuildMember, Message, MessageEmbedOptions, MessageReaction, Role, Snowflake } from 'discord.js';
import { Db, Collection as MongoCollection, InsertWriteOpResult, BulkWriteError, MongoError, Cursor } from 'mongodb';
import { CommandContext } from 'slash-create';
import ValidationError from '../../errors/ValidationError';
import { UsernameSpamFilterConfig } from '../../types/spam-filter/UsernameSpamFilter';
import { UsernameSpamFilterType } from '../../types/spam-filter/UsernameSpamFilterType';
import dbUtils from '../../utils/dbUtils';
import { LogUtils } from '../../utils/Log';
import ServiceUtils from '../../utils/ServiceUtils';
import constants from '../constants/constants';

const addToFilter = '✅';
const removeFromFilter = '❌';
const addToAllowlist = '🆗';
const removeFromAllowlist = '🛑';
const edit = '📝';

export default async (ctx: CommandContext, guildMember: GuildMember, roles?: string[]) : Promise<any> => {
	if (!(ServiceUtils.isDiscordAdmin(guildMember) || ServiceUtils.isDiscordServerManager(guildMember))) {
		throw new ValidationError('Sorry, only discord admins and managers can configure spam filter settings.');
	}

	const highRankingRoles: Role[] = await ServiceUtils.retrieveRoles(guildMember.guild, roles);
	const dbInstance: Db = await dbUtils.dbConnect(constants.DB_NAME_DEGEN);

	if (highRankingRoles.length == 0) {
		await ctx.send(`Hey ${ctx.user.mention}, I just sent you a DM!`).catch(e => LogUtils.logError('failed to send dm to user', e));
		await guildMember.send(await getRolesFromUsernameSpamFilter(guildMember, dbInstance));
		return;
	}

	const intro: MessageEmbedOptions = {
		title: 'Username Spam Filter Configuration',
		description: 'Welcome to Username Spam Filter configuration.\n\n' +
			'This is used as a first-time setup of the username spam filter. I can help assign or remove high-ranking ' +
			'roles to be used by the username spam filter.\n\n' +
			'The username spam filter will auto-ban any user that joins with or changes their nickname to a username ' +
            'or nickname of a member with a high-ranking role.',
		footer: {
			text: '@Bankless DAO 🏴',
		},
	};

	const fields = [];
	for (const role of highRankingRoles) {
		fields.push({
			name: 'Role',
			value: role.name,
			inline: true,
		});
	}

	const whichRolesAreAllowedQuestion: MessageEmbedOptions = {
		title: 'How should these roles be configured?',
		description: `${addToFilter} - Add roles to username spam filter. Users that change their nickname to that of a user in one of these roles will be auto-banned.
		${removeFromFilter} - Remove roles from username spam filter.
		${addToAllowlist} - Add roles to allowlist. Users in these roles cannot be banned by the username spam filter.
		${removeFromAllowlist} - Remove roles from allow list.`,
		fields: fields,
		timestamp: new Date().getTime(),
		footer: {
			text: `${addToFilter} - add to filter | ${removeFromFilter} - remove from filter | ${addToAllowlist} - add to allowlist | ${removeFromAllowlist} - remove from allowlist | ${edit} - edit | Please reply within 60 minutes`,
		},
	};
	
	const message: Message = await guildMember.send({ embeds: [intro, whichRolesAreAllowedQuestion] });
	await ctx.send(`Hey ${ctx.user.mention}, I just sent you a DM!`).catch(e => LogUtils.logError('failed to send dm to user', e));
	await message.react(addToFilter);
	await message.react(removeFromFilter);
	await message.react(addToAllowlist);
	await message.react(removeFromAllowlist);
	await message.react(edit);

	const collected: Collection<Snowflake | string, MessageReaction> = await message.awaitReactions({
		max: 1,
		time: (6000 * 60),
		errors: ['time'],
		filter: async (reaction, user) => {
			return [addToFilter, removeFromFilter, addToAllowlist, removeFromAllowlist, edit].includes(reaction.emoji.name) && !user.bot;
		},
	});
	const reaction: MessageReaction = collected.first();
	let confirmationMsg: MessageEmbedOptions; 

	if (reaction.emoji.name === addToFilter) {
		await addRolesToUsernameSpamFilter(guildMember, dbInstance, highRankingRoles, UsernameSpamFilterType.HIGH_RANKING_ROLE);
		confirmationMsg = {
			title: 'Configuration Added',
			description: 'The roles are now protected by the username spam filter.',
		};
	} else if (reaction.emoji.name === removeFromFilter) {
		await removeRolesFromUsernameSpamFilter(guildMember, dbInstance, highRankingRoles, UsernameSpamFilterType.HIGH_RANKING_ROLE);
		confirmationMsg = {
			title: 'Configuration Removed',
			description: 'The roles are no longer protected by the username spam filter.',
		};
	} else if (reaction.emoji.name === addToAllowlist) {
		await addRolesToUsernameSpamFilter(guildMember, dbInstance, highRankingRoles, UsernameSpamFilterType.ALLOWLIST_ROLE);
		confirmationMsg = {
			title: 'Configuration Added',
			description: 'The roles are now on the allowlist.',
		};
	} else if (reaction.emoji.name === removeFromAllowlist) {
		await removeRolesFromUsernameSpamFilter(guildMember, dbInstance, highRankingRoles, UsernameSpamFilterType.ALLOWLIST_ROLE);
		confirmationMsg = {
			title: 'Configuration Removed',
			description: 'The roles are no longer on the allowlist.',
		};
	} else if (reaction.emoji.name === edit) {
		await guildMember.send({ content: 'Configuration setup ended.' });
		throw new ValidationError('Please re-initiate spam-filter configuration.');
	} else {
		throw new ValidationError('Please approve or deny access.');
	}

	await guildMember.send({ embeds: [confirmationMsg] });
	return;
};

export const addRolesToUsernameSpamFilter = async (guildMember: GuildMember, dbInstance: Db, roles: Role[], objectType: UsernameSpamFilterType): Promise<any> => {
    
	const usernameSpamFilterDb: MongoCollection = dbInstance.collection(constants.DB_COLLECTION_USERNAME_SPAM_FILTER);
    
	const usernameSpamFilterList = [];
	for (const role of roles) {
		usernameSpamFilterList.push({
			objectType: objectType,
			discordObjectId: role.id,
			discordObjectName: role.name,
			discordServerId: guildMember.guild.id,
			discordServerName: guildMember.guild.name,
		});
	}

	let result: InsertWriteOpResult<UsernameSpamFilterConfig>;
	try {
		result = await usernameSpamFilterDb.insertMany(usernameSpamFilterList, {
			ordered: false,
		});
	} catch (e) {
		if (e instanceof BulkWriteError && e.code === 11000) {
			LogUtils.logError('dup key found, proceeding', e);
		}
		LogUtils.logError('failed to store username spam filter roles in db', e);
		return;
	}
	
	if (result == null) {
		throw new MongoError('failed to insert usernameSpamFilter');
	}
};

export const removeRolesFromUsernameSpamFilter = async (guildMember: GuildMember, db: Db, roles: Role[], objectType: UsernameSpamFilterType): Promise<any> => {

	const usernameSpamFilterDb: MongoCollection = db.collection(constants.DB_COLLECTION_USERNAME_SPAM_FILTER);

	try {
		for (const role of roles) {
			await usernameSpamFilterDb.deleteOne({
				objectType: objectType,
				discordObjectId: role.id,
				discordServerId: guildMember.guild.id,
			});
		}
	} catch (e) {
		LogUtils.logError('failed to remove username spam filter roles from db', e);
	}
};

export const getRolesFromUsernameSpamFilter = async (guildMember: GuildMember, db: Db): Promise<string> => {

	const usernameSpamFilterDb: MongoCollection = db.collection(constants.DB_COLLECTION_USERNAME_SPAM_FILTER);

	const rolesCursor: Cursor<UsernameSpamFilterConfig> = await usernameSpamFilterDb.find({
		discordServerId: guildMember.guild.id
	});
	const highRankingRoles: UsernameSpamFilterConfig[] = [];
	const allowlistRoles: UsernameSpamFilterConfig[] = [];

	await rolesCursor.forEach((usernameSpamFilterConfig: UsernameSpamFilterConfig) => {
		if (usernameSpamFilterConfig.objectType == UsernameSpamFilterType.HIGH_RANKING_ROLE) {
			highRankingRoles.push(usernameSpamFilterConfig);
		} else if (usernameSpamFilterConfig.objectType == UsernameSpamFilterType.ALLOWLIST_ROLE) {
			allowlistRoles.push(usernameSpamFilterConfig);
		}
	});

	return `Roles protected by filter: ${highRankingRoles.forEach(role => {role.discordObjectName})}
	Roles on allowlist: ${allowlistRoles.forEach(role => {role.discordObjectName})}`
}