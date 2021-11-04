import { Collection, ObjectId } from 'mongodb';
import { SpamFilterConfigType } from './SpamFilterConfigType';

export interface SpamFilterConfig extends Collection {
    _id: ObjectId,
	objectType: SpamFilterConfigType,
	discordObjectId: string,
	discordObjectName: string,
	discordServerId: string,
	discordServerName: string,
}