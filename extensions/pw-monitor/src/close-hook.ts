// close-hook.ts — Session close cleanup
// Called when `pw close` ends the session.

export default async (ctx: any) => {
  ctx.logger.info('session closing, monitor state preserved for recovery');
};
