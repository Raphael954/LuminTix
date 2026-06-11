function msUntilNextUtcMidnight() {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1000, next - now.getTime());
}

function startSchedulers({ commerceStore, emailService }) {
  async function runCleanup() {
    try {
      const count = await commerceStore.cleanupExternalPrices();
      console.log(`[cleanup] Removed ${count} expired external price assignment(s).`);
    } catch (error) {
      console.error(`[cleanup] ${error.message}`);
    }
  }

  async function runEmailQueue() {
    try {
      await emailService.processPending();
    } catch (error) {
      console.error(`[email] ${error.message}`);
    }
  }

  function scheduleMidnight() {
    const timer = setTimeout(async () => {
      await runCleanup();
      scheduleMidnight();
    }, msUntilNextUtcMidnight());
    timer.unref();
  }

  void runCleanup();
  void runEmailQueue();
  scheduleMidnight();
  const emailTimer = setInterval(runEmailQueue, 5 * 60 * 1000);
  emailTimer.unref();
}

export { msUntilNextUtcMidnight, startSchedulers };
