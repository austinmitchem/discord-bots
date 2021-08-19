import constants from '../../constants/constants';
import mongo, { Db, UpdateWriteOpResult } from 'mongodb';
import BountyUtils from '../../../utils/BountyUtils';
import { GuildMember, Message, MessageOptions, TextChannel } from 'discord.js';
import dbInstance from '../../../utils/db';
import channelIDs from '../../constants/channelIDs';
import ServiceUtils from '../../../utils/ServiceUtils';
import envUrls from '../../constants/envUrls';
import { BountyCollection } from '../../../types/bounty/BountyCollection';

export default async (guildMember: GuildMember, bountyId: string): Promise<any> => {
	await BountyUtils.validateBountyId(guildMember, bountyId);
	return finalizeBounty(guildMember, bountyId);
};

export const finalizeBounty = async (guildMember: GuildMember, bountyId: string): Promise<any> => {
	console.log('starting to finalize bounty: ' + bountyId);

	const db: Db = await dbInstance.dbConnect(constants.DB_NAME_BOUNTY_BOARD);
	const dbCollection = db.collection(constants.DB_COLLECTION_BOUNTIES);
	const dbBountyResult: BountyCollection = await dbCollection.findOne({
		_id: new mongo.ObjectId(bountyId),
		status: 'Draft',
	});

	await BountyUtils.checkBountyExists(guildMember, dbBountyResult, bountyId);

	if (dbBountyResult.status != 'Draft') {
		console.log(`${bountyId} bounty is not drafted`);
		return guildMember.send(`<@${guildMember.user.id}> Sorry bounty is not drafted.`);
	}
	const messageOptions: MessageOptions = generateEmbedMessage(dbBountyResult, 'Open', guildMember.user.avatarURL());

	const bountyChannel: TextChannel = guildMember.guild.channels.cache.get(channelIDs.bountyBoard) as TextChannel;
	const bountyMessage: Message = await bountyChannel.send(messageOptions) as Message;
	console.log('bounty published to #bounty-board');
	addPublishReactions(bountyMessage);

	const currentDate = (new Date()).toISOString();
	const writeResult: UpdateWriteOpResult = await dbCollection.updateOne(dbBountyResult, {
		$set: {
			status: 'Open',
			discordMessageId: bountyMessage.id,
		},
		$push: {
			statusHistory: {
				status: 'Open',
				setAt: currentDate,
			},
		},
	});

	if (writeResult.modifiedCount != 1) {
		console.log(`failed to update record ${bountyId} for user <@${guildMember.user.id}>`);
		return guildMember.send(`<@${guildMember.user.id}> Sorry something is not working, our devs are looking into it.`);
	}

	await dbInstance.close();

	return guildMember.send(`<@${guildMember.user.id}> Bounty published to #🧀-bounty-board and the website! ${envUrls.BOUNTY_BOARD_URL}${bountyId}`);
};

export const addPublishReactions = (message: Message): void => {
	message.reactions.removeAll();
	message.react('🏴');
	message.react('🔄');
	message.react('📝');
	message.react('❌');
};

export const generateEmbedMessage = (dbBounty: BountyCollection, newStatus: string, iconUrl?: string): MessageOptions => {
	return {
		embed: {
			color: '#1e7e34',
			title: dbBounty.title,
			url: envUrls.BOUNTY_BOARD_URL + dbBounty._id,
			author: {
				icon_url: iconUrl,
				name: dbBounty.createdBy.discordHandle,
			},
			description: dbBounty.description,
			fields: [
				{ name: 'Reward', value: dbBounty.reward.amount + ' ' + dbBounty.reward.currency.toUpperCase(), inline: true },
				{ name: 'Status', value: newStatus, inline: true },
				{ name: 'Deadline', value: ServiceUtils.formatDisplayDate(dbBounty.dueAt), inline: true },
				{ name: 'Criteria', value: dbBounty.criteria },
				{ name: 'HashId', value: dbBounty._id },
				{ name: 'Created By', value: dbBounty.createdBy.discordHandle, inline: true },
			],
			timestamp: new Date(),
			footer: {
				text: '🏴 - start | 🔄 - refresh | 📝 - edit | ❌ - delete',
			},
		},
	};
};