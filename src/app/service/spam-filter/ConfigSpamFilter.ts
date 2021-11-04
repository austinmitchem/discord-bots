import { Collection, GuildMember, Message, MessageEmbedOptions, MessageReaction, Role, Snowflake } from 'discord.js';
import { Db, Collection as MongoCollection, InsertWriteOpResult, BulkWriteError, MongoError, Cursor } from 'mongodb';
import { CommandContext } from 'slash-create';
import ValidationError from '../../errors/ValidationError';
import { SpamFilterConfig } from '../../types/spam-filter/SpamFilterConfig';
import { SpamFilterConfigType } from '../../types/spam-filter/SpamFilterConfigType';
import dbUtils from '../../utils/dbUtils';
import { LogUtils } from '../../utils/Log';
import ServiceUtils from '../../utils/ServiceUtils';
import constants from '../constants/constants';

const protectRoles = '✅';
const unprotectRoles = '❌';
const addToAllowlist = '🆗';
const removeFromAllowlist = '🛑';
const edit = '📝';

export default async (ctx: CommandContext, guildMember: GuildMember, roles?: string[]): Promise<any> => {
	if (!(ServiceUtils.isDiscordAdmin(guildMember) || ServiceUtils.isDiscordServerManager(guildMember))) {
		throw new ValidationError('Sorry, only discord admins and managers can configure spam filter settings.');
	}

	const protectedRoles: Role[] = await ServiceUtils.retrieveRoles(guildMember.guild, roles);
	const dbInstance: Db = await dbUtils.dbConnect(constants.DB_NAME_DEGEN);

	if (protectedRoles.length == 0) {
		await ctx.send(`Hey ${ctx.user.mention}, I just sent you a DM!`).catch(e => LogUtils.logError('failed to send dm to user', e));
		await guildMember.send({ embeds: [await getRolesFromUsernameSpamFilter(guildMember, dbInstance)] });
		return;
	}

	const intro: MessageEmbedOptions = {
		title: 'Username Spam Filter Configuration',
		description: 'Welcome to Username Spam Filter configuration.\n\n' +
			'The username spam filter will auto-ban any user that joins with or changes their nickname to a username ' +
			'or nickname of a member with a protected role.\n' +
			'Users with roles on the allowlist cannot be auto-banned by the bot. It is recommended to assign a base ' +
			'verified member role to the allowlist.',
		footer: {
			text: '@Bankless DAO 🏴',
		},
	};

	const fields = [];
	for (const role of protectedRoles) {
		fields.push({
			name: 'Role',
			value: role.name,
			inline: true,
		});
	}

	const whichRolesAreAllowedQuestion: MessageEmbedOptions = {
		title: 'How should these roles be configured?',
		description: `${protectRoles} - Desginate roles for protection by the username spam filter. Users that change their nickname to that of a user in one of these roles will be auto-banned.
		${unprotectRoles} - Remove roles from protection by the username spam filter.
		${addToAllowlist} - Add roles to allowlist. Users in these roles cannot be banned by the username spam filter.
		${removeFromAllowlist} - Remove roles from allow list.`,
		fields: fields,
		timestamp: new Date().getTime(),
		footer: {
			text: `${protectRoles} - protect roles | ${unprotectRoles} - unprotect roles | ${addToAllowlist} - add to allowlist | ${removeFromAllowlist} - remove from allowlist | ${edit} - edit | Please reply within 60 minutes`,
		},
	};

	const message: Message = await guildMember.send({ embeds: [intro, whichRolesAreAllowedQuestion] });
	await ctx.send(`Hey ${ctx.user.mention}, I just sent you a DM!`).catch(e => LogUtils.logError('failed to send dm to user', e));
	await message.react(protectRoles);
	await message.react(unprotectRoles);
	await message.react(addToAllowlist);
	await message.react(removeFromAllowlist);
	await message.react(edit);

	const collected: Collection<Snowflake | string, MessageReaction> = await message.awaitReactions({
		max: 1,
		time: (6000 * 60),
		errors: ['time'],
		filter: async (reaction, user) => {
			return [protectRoles, unprotectRoles, addToAllowlist, removeFromAllowlist, edit].includes(reaction.emoji.name) && !user.bot;
		},
	});
	const reaction: MessageReaction = collected.first();
	let confirmationMsg: MessageEmbedOptions;

	if (reaction.emoji.name === protectRoles) {
		await addRolesToUsernameSpamFilter(guildMember, dbInstance, protectedRoles, SpamFilterConfigType.PROTECTED_ROLE);
		confirmationMsg = {
			title: 'Configuration Added',
			description: 'The roles are now protected by the username spam filter.',
		};
	} else if (reaction.emoji.name === unprotectRoles) {
		await removeRolesFromUsernameSpamFilter(guildMember, dbInstance, protectedRoles, SpamFilterConfigType.PROTECTED_ROLE);
		confirmationMsg = {
			title: 'Configuration Removed',
			description: 'The roles are no longer protected by the username spam filter.',
		};
	} else if (reaction.emoji.name === addToAllowlist) {
		await addRolesToUsernameSpamFilter(guildMember, dbInstance, protectedRoles, SpamFilterConfigType.ALLOWLIST_ROLE);
		confirmationMsg = {
			title: 'Configuration Added',
			description: 'The roles are now on the allowlist.',
		};
	} else if (reaction.emoji.name === removeFromAllowlist) {
		await removeRolesFromUsernameSpamFilter(guildMember, dbInstance, protectedRoles, SpamFilterConfigType.ALLOWLIST_ROLE);
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

export const addRolesToUsernameSpamFilter = async (guildMember: GuildMember, dbInstance: Db, roles: Role[], objectType: SpamFilterConfigType): Promise<any> => {

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

	let result: InsertWriteOpResult<SpamFilterConfig>;
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

export const removeRolesFromUsernameSpamFilter = async (guildMember: GuildMember, db: Db, roles: Role[], objectType: SpamFilterConfigType): Promise<any> => {

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

export const getRolesFromUsernameSpamFilter = async (guildMember: GuildMember, db: Db): Promise<MessageEmbedOptions> => {

	const usernameSpamFilterDb: MongoCollection = db.collection(constants.DB_COLLECTION_USERNAME_SPAM_FILTER);

	const rolesCursor: Cursor<SpamFilterConfig> = await usernameSpamFilterDb.find({
		discordServerId: guildMember.guild.id
	});
	const protectedRoles: string[] = [];
	const allowlistRoles: string[] = [];

	await rolesCursor.forEach((config: SpamFilterConfig) => {
		if (config.objectType == SpamFilterConfigType.PROTECTED_ROLE) {
			protectedRoles.push(config.discordObjectName);
		} else if (config.objectType == SpamFilterConfigType.ALLOWLIST_ROLE) {
			allowlistRoles.push(config.discordObjectName);
		}
	});

	let protectedRolesString = '';
	let allowlistRolesString = '';

	protectedRoles.length == 0 ? protectedRolesString = 'None' 
		: protectedRoles.forEach(role => { protectedRolesString += `${role}\n` })

	allowlistRoles.length == 0 ? allowlistRolesString = 'None'
		: allowlistRoles.forEach(role => { allowlistRolesString += `${role}\n` })

	return {
		title: 'Username Spam Filter Configuration',
		description: `**Roles protected by filter:**\n${protectedRolesString}\n` 
			+ `**Roles on allowlist:**\n${allowlistRolesString}`
	}
}