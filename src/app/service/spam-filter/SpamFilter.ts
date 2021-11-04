import { GuildMember } from 'discord.js';
import { Collection, Cursor, Db } from 'mongodb';
import { Confusables } from '../../utils/Confusables';
import Log from '../../utils/Log';
import ServiceUtils from '../../utils/ServiceUtils';
import dbInstance from '../../utils/dbUtils';
import constants from '../constants/constants';
import { SpamFilterConfig } from '../../types/spam-filter/SpamFilterConfig';
import { SpamFilterConfigType } from '../../types/spam-filter/SpamFilterConfigType';

const nonStandardCharsRegex = /[^\w\s\p{P}\p{S}Ξ]/gu;
const emojiRegex = /\p{So}/gu;
const whitespaceRegex = /[\s]/g;

const SpamFilter = {
	/**
	 * Bans a guild member if they have a nickname or username similar to that of a protected member 
	 * of the Discord. 
	 * 
	 * @param member guild member object
	 * @returns boolean indicating if user was banned
	 */
	async runUsernameSpamFilter(member: GuildMember): Promise<boolean> {
		if (await this.skipUsernameSpamFilter(member)) {
			return false;
		}

		const protectedRoles = await this.getProtectedRolesForServer(member);

		// If list is empty, username spam filter has not been configured for Discord server
		if (protectedRoles.length == 0) {
			return false;
		}

		// Get members from protected roles
		const protectedMembers = await ServiceUtils.getMembersWithRoles(member.guild, protectedRoles);

		// Sanitize protected member names in preparation for comparing them to new member nickname
		const protectedNames = protectedMembers.map(protectedMember => {
			if (protectedMember.nickname) {
				return this.sanitizeUsername(protectedMember.nickname);
			}
			return this.sanitizeUsername(protectedMember.user.username);
		});

		// New members and members resetting their nickname will not have a nickname
		let nickname = null;
		if (member.nickname) {
			nickname = this.sanitizeUsername(member.nickname);
		}

		const username = this.sanitizeUsername(member.user.username);

		if ((nickname && protectedNames.includes(nickname)) || protectedNames.includes(username)) {
			const debugMessage = `Nickname: ${member.displayName}. Username: ${member.user.tag}.`;

			// Fetch admin contacts
			const aboveAverageJoe = await member.guild.members.fetch('198981821147381760');
			const frogmonkee = await member.guild.members.fetch('197852493537869824');

			// Send DM to user before banning them because bot can't DM user after banning them. 
			await member.send(`You were auto-banned from the ${member.guild.name} server. If you believe this was a mistake, please contact <@${aboveAverageJoe.id}> or <@${frogmonkee.id}>.`)
				.catch(e => {
					// Users that have blocked the bot or disabled DMs cannot receive a DM from the bot
					Log.log(`Unable to message user before auto-banning them. ${debugMessage} ${e}`);
				});

			await member.ban({ reason: `Auto-banned by username spam filter. ${debugMessage}` })
				.then(() => {
					Log.log(`Auto-banned user. ${debugMessage}`);
				})
				.catch(e => {
					Log.log(`Unable to auto-ban user. ${debugMessage} ${e}`);
				});
			
			return true;
		}

		return false;
	},

	/**
	 * Sanitizes a username by converting confusable unicode characters to latin.
	 * 
	 * @param name username to sanitize
	 * @returns sanitized username
	 */
	sanitizeUsername(name: string): string {
		return name.normalize('NFKC')
			.replace(emojiRegex, '')
			.replace(whitespaceRegex, '')
			.replace(nonStandardCharsRegex, char => Confusables.get(char) || char)
			.toLowerCase();
	},

	/**
	 * Determines if the username spam filter should be skipped based on defined criteria.
	 * 
	 * @param member guild member object
	 * @returns boolean indicating if username spam filter should be skipped
	 */
	async skipUsernameSpamFilter(member: GuildMember): Promise<boolean> {
		// Skip if guild member cannot be banned
		if (!member.bannable) {
			Log.log(`Skipping username spam filter because ${member.user.tag} is not bannable.`);
			return true;
		}

		// Skip if guild member is on the allowlist
		if (await this.memberOnAllowlist(member)) {
			Log.log(`Skipping username spam filter because ${member.user.tag} is on the allowlist.`);
			return true;
		}

		// Skip if guild member's role is on the allowlist
		if (await this.roleOnAllowlist(member)) {
			Log.log(`Skipping username spam filter because ${member.user.tag} has a role on the allowlist.`);
			return true;
		}

		return false;
	},

	/**
	 * Checks if member is on allowlist for Discord server.
	 * 
	 * @param member guild member object
	 * @returns boolean indicating if member is on allowlist for Discord server
	 */
	async memberOnAllowlist(member: GuildMember): Promise<boolean> {
		const db: Db = await dbInstance.dbConnect(constants.DB_NAME_DEGEN);
		const usernameSpamFilterDb = db.collection(constants.DB_COLLECTION_USERNAME_SPAM_FILTER);

		// Check if member is on allowlist
		const allowlist: SpamFilterConfig = await usernameSpamFilterDb.findOne({
			objectType: SpamFilterConfigType.ALLOWLIST_USER,
			discordObjectId: member.user.id,
			discordServerId: member.guild.id,
		});

		if (allowlist) {
			return true;
		}

		return false;
	},

	/**
	 * Checks if member has a role that is on allowlist for Discord server.
	 * 
	 * @param member guild member object
	 * @returns boolean indicating if member has a role on the allowlist for Discord server
	 */
	async roleOnAllowlist(member: GuildMember): Promise<boolean> {
		const db: Db = await dbInstance.dbConnect(constants.DB_NAME_DEGEN);
		const usernameSpamFilterDb: Collection = db.collection(constants.DB_COLLECTION_USERNAME_SPAM_FILTER);

		// Get roles on the allowlist
		const allowlistRoleCursor: Cursor<SpamFilterConfig> = await usernameSpamFilterDb.find({
			objectType: SpamFilterConfigType.ALLOWLIST_ROLE,
			discordServerId: member.guild.id,
		});
		const allowlistRoleList: SpamFilterConfig[] = [];

		await allowlistRoleCursor.forEach((usernameSpamFilterConfig: SpamFilterConfig) => {
			allowlistRoleList.push(usernameSpamFilterConfig);
		});

		const allowlistRoles = allowlistRoleList.map(role => role.discordObjectId);

		if (ServiceUtils.hasSomeRole(member, allowlistRoles)) {
			return true;
		}

		return false;
	},

	/**
	* Get the configured protected roles for a Discord server
	* 
	* @param member guild member object
	* @returns protected roles configured for the username spam filter
	*/
	async getProtectedRolesForServer(member: GuildMember): Promise<string[]> {
		const db: Db = await dbInstance.dbConnect(constants.DB_NAME_DEGEN);
		const usernameSpamFilterDb: Collection = db.collection(constants.DB_COLLECTION_USERNAME_SPAM_FILTER);

		// Get protected roles configured for Discord server
		const protectedRolesCursor: Cursor<SpamFilterConfig> = await usernameSpamFilterDb.find({
			objectType: SpamFilterConfigType.PROTECTED_ROLE,
			discordServerId: member.guild.id,
		});
		const protectedRolesList: SpamFilterConfig[] = [];

		await protectedRolesCursor.forEach((usernameSpamFilterConfig: SpamFilterConfig) => {
			protectedRolesList.push(usernameSpamFilterConfig);
		});

		return protectedRolesList.map(role => role.discordObjectId);
	},
};

export default SpamFilter;