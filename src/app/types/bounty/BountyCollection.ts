import { Collection, Int32, ObjectId } from 'mongodb';

export interface BountyCollection extends Collection {
	_id: ObjectId,
	season: string,
	title: string,
	description: string,
	criteria: string,
	reward: Reward,
	createdBy: UserObject,
	claimedBy: UserObject
	createdAt: string,
	dueAt: string,
	status: string,
	statusHistory: string[],
	discordMessageId: string,
}

export type UserObject = {
	discordHandle: string,
	discordId: string,
};

export type Reward = {
	currency: string,
	amount: Int32,
	scale: Int32,
};