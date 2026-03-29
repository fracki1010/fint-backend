function writeLog(level, event, data = {}) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...data,
  };

  console.log(JSON.stringify(payload));
}

function logInfo(event, data) {
  writeLog("info", event, data);
}

function logWarn(event, data) {
  writeLog("warn", event, data);
}

function logError(event, data) {
  writeLog("error", event, data);
}

module.exports = {
  logInfo,
  logWarn,
  logError,
};
