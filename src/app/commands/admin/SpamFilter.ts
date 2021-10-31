import { CommandContext, CommandOptionType, SlashCommand, SlashCreator } from "slash-create";
import EarlyTermination from "../../errors/EarlyTermination";
import ValidationError from "../../errors/ValidationError";
import ConfigSpamFilter from "../../service/spam-filter/ConfigSpamFilter";
import { LogUtils } from "../../utils/Log";
import ServiceUtils from "../../utils/ServiceUtils";


export default class SpamFilter extends SlashCommand {
	constructor(creator: SlashCreator) {
		super(creator, {
			name: 'spam-filter',
			description: 'Configure username spam filter',
			guildIDs: ['851552281249972254'],
			options: [
				{
					name: 'config',
					type: CommandOptionType.SUB_COMMAND,
					description: 'Configure roles that have high-ranking users.',
					options: [
						{
							name: 'role-1',
							type: CommandOptionType.ROLE,
							description: 'Role with high-ranking members.',
							required: false,
						},
						{
							name: 'role-2',
							type: CommandOptionType.ROLE,
							description: 'Role with high-ranking members.',
							required: false,
						},
						{
							name: 'role-3',
							type: CommandOptionType.ROLE,
							description: 'Role with high-ranking members.',
							required: false,
						}
					]
				}
			],
			throttling: {
				usages: 1,
				duration: 1,
			},
			defaultPermission: true,
		})
	}

	async run(ctx: CommandContext) {
		LogUtils.logCommandStart(ctx);
		if (ctx.user.bot || ctx.guildID == undefined) return 'Please try /spam-filter within discord channel.'; 

		const { guildMember } = await ServiceUtils.getGuildAndMember(ctx);

		let highRankingRoles = [ctx.options.config['role-1'], ctx.options.config['role-2'], ctx.options.config['role-3']]
		let command = ConfigSpamFilter(ctx, guildMember, highRankingRoles);
		return this.handleCommandError(ctx, command);
	}

	handleCommandError(ctx: CommandContext, command: Promise<any>) {
		command.then(() => {
			return ctx.send('Successfully configured username spam filter.');
		}).catch(e => {
			if (e instanceof ValidationError) {
				return ctx.send(e.message);
			} else if (e instanceof EarlyTermination) {
				return ctx.send(e.message);
			} else {
				LogUtils.logError('failed to handle spam-filter command', e);
				return ctx.send('Sorry something is not working and our devs are looking into it.');
			}
		});
	}
	
}