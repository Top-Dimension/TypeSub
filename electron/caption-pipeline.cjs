const { improveCaption } = require('./ai-caption.cjs');

function createCaptionPipeline({ command, aiConfig, onAiError, improve = improveCaption }) {
  let correction;

  function cancelCorrection() {
    correction?.abort();
    correction = undefined;
  }

  function clear() {
    cancelCorrection();
    command('clear');
  }

  function submit(text, { revise = false, optimize = false } = {}) {
    cancelCorrection();
    const raw = text.trim().slice(0, 4000);
    if (!raw) return command('clear');
    const accepted = command(revise ? 'partial' : 'start', raw);
    if (!accepted || !optimize) return accepted;

    const config = aiConfig();
    if (!config?.apiKey || !config.model) return accepted;
    const controller = new AbortController();
    correction = controller;
    improve(raw, config, { signal: controller.signal })
      .then((output) => {
        if (correction === controller && output !== raw) command('partial', output);
      })
      .catch((error) => {
        if (correction === controller) onAiError(error);
      })
      .finally(() => {
        if (correction === controller) correction = undefined;
      });
    return accepted;
  }

  return { clear, submit, cancelCorrection };
}

module.exports = { createCaptionPipeline };
